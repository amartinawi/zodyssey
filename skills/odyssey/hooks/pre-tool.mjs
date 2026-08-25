#!/usr/bin/env node
// pre-tool.mjs — the ZOdyssey enforcement gate for Write/Edit/ApplyPatch/NotebookEdit/Bash
// and Task/Agent.
//
// SAFETY FIRST: this hook is a NO-OP unless an orchestration run is active.
// "Active" = there exists a <cwd>/.zcode/state/*.json with phase not in {done, audited, abandoned}.
// If no active run, exit 0 immediately so normal ZCode editing is completely unaffected.
//
// When a run IS active, it enforces (per DESIGN.md §6):
//   • Edit tools (Write/Edit/ApplyPatch/NotebookEdit): allowed only if state.review.verdict == OKAY.
//     Writes to .zcode/plans/ and .zcode/notepads/ are always allowed (bookkeeping).
//     .zcode/state/ is NOT bookkeeping — state writes go through the verdict gate, so an
//     agent cannot self-authorize a verdict by writing state.json (audit 2026-08-01 gap #1b).
//   • Bash: blocked when review.verdict != OKAY if the command writes files (sed -i, >, tee,
//     git apply, etc.). Read-only Bash is always allowed. (audit 2026-08-01 gap #1a)
//   • Dispatch tools (Task/Agent): allowed except when the execute-phase parallel cap is hit.
//
// stdin: the ZCode/Claude hook JSON. We read tool_name + tool_input.
// stdout: JSON decision on block; empty on pass.
// exit: 0 pass · 2 block (with reason).

import { readFileSync, readdirSync, existsSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, statSync, appendFileSync } from "node:fs";
import { join, dirname, resolve as pathResolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { exit, env } from "node:process";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { selectByTarget, discoverStateDirs, mostRecent } from "./lib/find-run.mjs";
import { verifyMarker, adoptHint, projectBindingHolds } from "../scripts/lib/state-auth.mjs";
import { resolvePath, containedIn } from "../scripts/lib/repo-path.mjs";
import { resolvePlanPath } from "../scripts/lib/plan-path.mjs";
import { sameName } from "../scripts/lib/capability-name.mjs";

// W5-minor: realpath the project dir so a symlinked/env-logical path resolves consistently
// with realpath'd edit targets (otherwise in-repo files mis-classify as out-of-repo → gate deadlock).
const RAW_PROJECT_DIR =
  process.env.CLAUDE_PROJECT_DIR || process.env.ZCODE_PROJECT_DIR || process.cwd();
const PROJECT_DIR = (() => {
  try { return realpathSync.native(RAW_PROJECT_DIR); } catch { return RAW_PROJECT_DIR; }
})();
const PROJECT_PREFIX = PROJECT_DIR + sep; // for safe containment test (no sibling <dir>-evil match)
const STATE_DIR = join(PROJECT_DIR, ".zcode", "state");
const CAP = (() => {
  const n = parseInt(process.env.ZODYSSEY_PARALLEL_CAP || "4", 10);
  return Number.isInteger(n) && n > 0 ? n : 4;
})();
// How long an in-flight dispatch entry counts before it's considered orphaned (crash recovery).
const INFLIGHT_TTL_MS = 30 * 60 * 1000; // 30 min
// A run whose updated_at is older than this is treated as inactive (abandoned mid-run).
// (audit gap #5a: stops hooks staying armed forever on a crashed/abandoned run.)
const STALE_MS = (() => {
  const h = parseFloat(process.env.ZODYSSEY_STALE_HOURS || "24");
  return Number.isFinite(h) && h > 0 ? h * 3600 * 1000 : 24 * 3600 * 1000;
})();

// Terminal phases: hooks disarm when the run reaches one of these. "audited" and
// "abandoned" matter because nothing in code ever sets "done" and the consult path
// sets "audited" — without these the gate stays armed forever (audit gap #5).
const TERMINAL = new Set(["done", "audited", "abandoned"]);

// Absolute path to set-phase.mjs, resolved ESM-relative so the path we print in
// warnings actually exists post-install: the literal ~/.zcode/skills/odyssey/ path
// is purged by Phase 2 of install.mjs, and the script lives under the plugin cache
// at <cache>/skills/odyssey/scripts/set-phase.mjs (this hook is at .../hooks/).
const SET_PHASE_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), "scripts", "set-phase.mjs");
const PARSE_PLAN_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), "scripts", "parse-plan.mjs");

// --- helpers (declared at top level, BEFORE any dispatch code that calls them —
//     `const` has a temporal-dead-zone, so this ordering is load-bearing) ---

// Write-capable Bash patterns. A command matching ANY of these is gated (requires OKAY).
// Conservative — when in doubt, gate. (audit re-audit G4: closed the holes — `-e`/`--eval`,
// no-space redirection, perl -pi / awk -i, git restore/am/cherry-pick/revert/stash pop,
// and script indirection node script.mjs / bash script.sh.)
// SEC-2 (external audit 2026-08-04): added ln/tar/unzip/zip/7z/gzip/gunzip/rsync/make/gcc -o/
// docker run -v (all slipped the enumerative list), AND inverted git to a safe-verb allowlist
// (merge/pull/fetch/branch/tag/checkout<branch>/bare-stash all mutated the worktree but were absent).
// SEC-2 also fixed the `2>&1` false-positive: fd-duplication is not a redirection-to-file.
// fd duplication (2>&1, 1>&2), NOT a file write. GLOBAL: a command can carry more than one
// (`ls 2>&1 3>&2`) and a non-global replace left every occurrence after the first in place.
const FD_DUP = /\d*>&\d/g;
const WRITE_PATTERNS = [
  // Redirection to a file. Strip fd-duplication first so `2>&1`/`1>&2` don't false-trip.
  //
  // AUDIT-3 FINDING 3 (CRITICAL in effect): this required a WORD before the `>`
  // (`\S+(\.\w+)?\s*>>?`), so a command consisting only of a redirect — `> .zcode/state/t.json` —
  // matched nothing and ran as "read-only". That truncates the state file; discovery then fails to
  // parse it, finds no run, and EVERY hook becomes a no-op. A one-command kill switch for the whole
  // gate, reachable pre-OKAY in any phase. Match the redirect operator itself wherever it appears.
  //
  // R1 (audit-3 verification): the first attempt at this excluded `&` and a DIGIT before the `>`,
  // on the reasoning that they were fd forms. Wrong — and it REGRESSED the very kill switch this
  // fix closed. `2> .zcode/state/t.json`, `&> …`, `1> …`, `2>> …` and `exec 3> …` all went
  // BLOCK (0.5.0) -> ALLOW (0.5.1): one keystroke from the command the fix was written for, with
  // the hole and the fix shipping in the same regex. FD_DUP already strips `\d*>&\d`, so a digit
  // still sitting before a `>` is a REAL file redirect, never a descriptor duplication.
  //
  // Exclude only `-` (so `grep -- '->'` does not trip — which the pre-0.5.1 pattern got wrong in
  // the opposite direction) and `>` (so `>>` counts once). `>&` and `>|` are admitted explicitly;
  // neither build ever caught them.
  (cmd) => /(^|[^->])\s*&?\d*>[>|&]?\s*[^\s>&|;]/.test(cmd.replace(FD_DUP, " ")),
  /\btee\b/,
  // sed in-place. `-i\b` alone missed two real forms (audit-4, G-class): a CLUSTERED short flag
  // (`sed -ni 's/a/b/' f` — `-ni` has no word boundary before the `i`) and the long option
  // (`sed --in-place`). `-i.bak` and `-e … -i` were already caught. This is the existing pattern
  // being incomplete, not a new binary to enumerate.
  /\bsed\s+[^&;\n]*(?:--in-place|-[a-z]*i)\b/i,
  /\b(?:perl|ruby)\s+-\w*(?:p|e)/, // perl -pi -e, perl -e, ruby -e
  /\bperl\s+[^&;\n]*-i\b/,
  /\bawk\s+[^&;\n]*-i\b/, // awk -i inplace (gawk ext)
  /\b(?:ed|ex)\b/, // line editors (write on save)
  // SEC-2: git inverted to a SAFE-VERB allowlist. Allow status/diff/log/show/ls-files/blame/
  // rev-parse/cat-file/name-rev/describe/fetch --dry-run (reads); EVERY OTHER git subcommand is
  // gated (merge/pull/fetch/branch/tag/checkout<branch>/stash/reset/clean/worktree/add/commit/...).
  // The old enumerative list missed most worktree-mutating verbs.
  /\bgit\s+(?!(?:status|diff|log|show|ls-files|ls-tree|blame|annotate|rev-parse|cat-file|name-rev|describe|shortlog|reflog|config\s+--get|remote\s+--verbose|remote\s+-v|fetch\s+--dry-run|help|version|range-diff|cherry\b)(?:\s|$))/,
  /\bpatch\b/,
  /\bdd\s+[^&;\n]*of=/,
  /\b(?:mv|cp|rm|install|truncate|chmod|chown|mkdir|cpio|shred|wipe)\b/,
  /\bln\b/, // SEC-2: hard/symlinks — `ln src dst` places a file under dst (the reviews/ attack)
  /\b(?:tar|unzip|zip|7z|7za|gzip|gunzip|zstd|unzstd|xz|unxz|bz2|bunzip2)\b/, // SEC-2: archive extract/write
  /\brsync\b/, // SEC-2: rsync copies files into arbitrary paths
  /\bmake\b/, // SEC-2: arbitrary build output
  /\b(?:gcc|g\+\+|cc|clang|clang\+\+|rustc|cargo|go\s+build|go\s+install)\b/, // SEC-2: compilers emit binaries
  /\bdocker\s+run\b/, // SEC-2: -v bind-mount writes; gate the whole verb (conservative)
  // INTERPRETERS — inverted to an allowlist (AUDIT-3 FINDING 1, CRITICAL).
  //
  // The two patterns here used to be positional and both were trivially sidestepped:
  //   · the eval-flag pattern required the eval flag to be the FIRST token after the interpreter,
  //     so `python -u -c "…"`, `python3 -B -c "…"`, `node --no-warnings -e "…"` and `ruby -w -e`
  //     matched nothing;
  //   · the script-indirection pattern skipped any invocation whose next token starts with `-`
  //     (`(?!-)`), so those same commands fell through it too, as did `python - <<'EOF'` (stdin
  //     heredoc — the operand is literally `-`).
  // Result: arbitrary code execution classified as READ-ONLY and ran pre-OKAY in any phase. That
  // is the full forged-run takeover chain this release exists to close, reopened through a
  // different door — and made worse by the marker key being readable via ungated `cat`.
  //
  // Enumerating flag shapes is what failed. Invert instead, the same posture SEC-2 took for git:
  // ANY invocation of a general-purpose interpreter is gated, except a bare version/help query.
  // Over-blocking is safe here — the sanctioned `node <odyssey-script>` path does not rely on this
  // returning read-only; it is allowed one step later by isTrustedScriptInvoke, which runs after
  // looksReadOnly and applies a realpath-checked allowlist.
  // R2 (audit-3 verification): `\b` treats `.` as a word boundary, so `\bsh\b` matched the
  // EXTENSION in `deploy.sh` and `cat deploy.sh` / `wc -l build.sh` / `ls *.sh` all started
  // blocking — an availability regression in every phase, and the version-flag carve-out cannot
  // help because `sh` is not the command token there. The lookbehind requires COMMAND POSITION:
  // the token may follow start-of-string, a separator, or `/` (so `/usr/bin/python3` works), but
  // never a word character, `.` or `-`. `deploy.sh` and `run-node.js` are filenames; `sh script`,
  // `; sh evil` and `xargs sh` are invocations.
  /(?<![\w.-])(?:python[\d.]*|node|nodejs|deno|bun|ruby|perl|php|Rscript|osascript|lua|tclsh|pwsh|powershell)\b(?!\s+(?:--version|-V|--help|-h)\s*$)/,
  // Shell interpreters, same rule: `bash -c`, `sh script.sh` and bare `bash` are gated;
  // `bash --version` is not, and a `.sh` filename in a read-only command is not a shell.
  /(?<![\w.-])(?:bash|sh|zsh|ksh|dash|fish)\b(?!\s+(?:--version|-V|--help|-h)\s*$)/,
  /\bcurl\b[^&;\n]*\|\s*(?:sh|bash|zsh)\b/,
  /\bwget\b[^&;\n]*\|\s*(?:sh|bash|zsh)\b/,
  // R3 (audit-3 verification): these passed as read-only on BOTH builds. `source`/`.` execute a
  // file in the current shell, and the downloaders write one — so `curl -o /tmp/x <url>` followed
  // by `source /tmp/x` is a two-command ungated arbitrary-execution chain, pre-OKAY, in any phase.
  // Same class as the interpreter finding, reachable without an interpreter.
  //
  // The auditor suggested naming these as residuals rather than enumerating them, on the grounds
  // that the honest fix is command-position-aware classification. R2 just added exactly that, so
  // they are enumerated HERE with the position rule applied — which is the same fix, not a
  // guess-the-next-binary list: `source`/`.` only count at command position, so `foo.source` and
  // a bare `.` inside a path are unaffected.
  /(?<![\w.-])source\s+\S/,
  /(^|[;&|(]\s*)\.\s+\S/,                    // dot-sourcing: `. /tmp/x`, `; . ./env`
  /(?<![\w.-])curl\b[^;&|\n]*\s-(?:o\b|-output\b|O\b|-remote-name\b)/,
  /(?<![\w.-])wget\b(?![^;&|\n]*\s--spider\b)/,   // wget writes a file by default; --spider does not
  /(?<![\w.-])sed\b[^;&|\n]*\bw\s+\S/,       // sed's `w file` command writes, with no -i in sight
  /(?<![\w.-])busybox\b/,                    // busybox <applet> reaches sh/sed/dd/… behind one name
  // DIRECT EXECUTION OF A PATH (audit-4, G-class). `./deploy.sh`, `/tmp/evil`, `~/bin/evil`,
  // `src/foo.js` and `exec /tmp/evil` all ran as READ-ONLY pre-OKAY in any phase. No amount of
  // naming interpreters reaches these — there is no interpreter token to name. What identifies
  // them is structural: the COMMAND HEAD is a path, so the shell will execute that file with
  // whatever privileges this agent has.
  //
  // Matched at command position only (start, or after ; & | && || ), so a path appearing as an
  // ARGUMENT — `cat ./deploy.sh`, `ls /tmp/evil`, `grep x src/foo.js` — is untouched. That
  // distinction is the whole point: reading a file is not running it.
  (cmd) => {
    for (const seg of String(cmd).split(/(?:^|[;&|\n])+|\|\||&&/)) {
      const head = seg.trim().replace(/^(?:[A-Za-z_][\w]*=\S*\s+)*/, "").split(/\s+/)[0] || "";
      if (!head) continue;
      const bare = head.replace(/^(?:exec|command|builtin)$/i, "");
      const t = bare === "" ? (seg.trim().split(/\s+/)[1] || "") : head;
      if (/^(?:\.\/|\.\.\/|~\/|\/)/.test(t)) return true;   // ./x  ../x  ~/x  /abs/x
      if (t.includes("/")) return true;                     // src/foo.js — a relative path head
    }
    return false;
  },
  /\binstall\s+-m\b/,
  // CRITICAL T1-1 (audit 2026-08-14): the deny-list missed a whole family of ordinary write
  // primitives, so they classified as READ-ONLY and ran pre-OKAY in any phase. Chained with
  // unauthenticated run discovery (see findActiveRun) this was the forged-run takeover: a
  // prompt-injected executor writes a decoy run-state with `sort -o` or `touch`, and the forged
  // run then governs the review gate, the scope gate, and the tamper guard. Reproduced end-to-end
  // by the auditor. Every entry below was verified absent from this list before being added.
  /\bsort\b[^&;\n]*\s-o\b/,                       // sort -o FILE (writes anywhere)
  /\btouch\b/,                                     // creates/updates files
  /\bsponge\b/,                                    // moreutils: soaks stdin then writes the file
  /\b(?:g|busybox\s+)sed\s+[^&;\n]*-i\b/,          // gsed/busybox sed -i (the bare `sed -i` is above)
  /\bcrontab\b/,                                   // installs a crontab from a file/stdin
  /\b(?:scp|sftp)\b/,                              // remote copy writes local paths too
  /\bsqlite3\s+\S+\s+\S/,                          // sqlite3 <db> <sql> mutates a file
  /\b(?:at|batch)\b/,                              // schedules a command to run later
  // The next four were NOT gaps — v0.4.1 already blocked every one (verified by running each
  // command against both builds). They are kept as explicit, narrower-to-read duplicates of
  // patterns that block them incidentally: `dd of=` and `truncate` were already enumerated,
  // `busybox sed -i` is caught by the bare `sed …-i` rule, and `xargs rm` by `rm`. Listing them
  // by name means a future edit to those broader rules cannot silently reopen them.
  /\bdd\b/,                                        // (already covered by the `dd …of=` rule above)
  /\btruncate\b/,                                  // (already covered by the mv|cp|rm|… rule above)
  /\bxargs\b/,                                     // xargs can drive a writer the operand scan misses
];

// Heuristic: does this Bash command ONLY read? If so, allow it even pre-review.
// We allow a command if it contains NO write-capable construct. This is deliberately
// conservative — when in doubt, gate it (require OKAY).
function looksReadOnly(cmd) {
  for (const re of WRITE_PATTERNS) {
    if (typeof re === "function") { if (re(cmd)) return false; }
    else if (re.test(cmd)) return false;
  }
  return true;
}

// SEC-H5 (external audit #7): post-OKAY Bash short-circuited with NO scope check, so write-capable
// shell commands (sed -i, tee, >, cp/mv, git checkout --) could mutate files outside the plan's
// declared scope — the iqraa-style isolation failure reopened by changing tool. This parses
// best-effort write targets out of a Bash command. Returns {targets: [...], confident: bool}:
// confident=false means the command is write-capable but we could not extract a clear target → the
// caller must FAIL CLOSED (gate it), never silently allow. Targets are raw strings (cwd-relative or
// absolute); the caller resolves+classifies each.
function bashWriteTargets(cmd) {
  const targets = [];
  let confident = true;
  const clean = cmd.replace(/\s+\d*>&\d/g, " "); // strip fd-dup (2>&1) so it isn't seen as a redirect target
  // 1. redirection targets: `> FILE`, `>> FILE`, `>FILE`
  for (const m of clean.matchAll(/(?:^|[\s;&|])\S+(\.\w+)?\s*>>?\s*(\S+)/g)) {
    const t = m[2];
    if (t && !/^&\d/.test(t)) targets.push(t);
  }
  // 2. tee FILE... — HIGH T1-3: tee writes EVERY file operand, but only the first was captured,
  // so `tee in-scope.js out-of-scope.js` passed the scope check on the first and silently wrote
  // the second. Push them all; over-blocking here is safe (the operator can split the command).
  for (const m of clean.matchAll(/\btee((?:\s+-\w+)*(?:\s+[^\s;&|<>]+)+)/g)) {
    for (const tok of m[1].trim().split(/\s+/)) if (tok && !tok.startsWith("-")) targets.push(tok);
  }
  // 3. sed -i / awk -i inplace: the file is the trailing non-flag arg(s). Extract them; only fall
  // back to fail-closed if there's no file arg at all (just `-i` with no operand).
  for (const m of clean.matchAll(/\b(?:sed|awk|gawk)\s+([^&;|\n]+)/g)) {
    if (!/-i\b/.test(m[1])) continue; // only the inplace forms write
    const toks = m[1].trim().split(/\s+/).filter((t) => t && !t.startsWith("-"));
    // sed's script may be a quoted expression; ignore quoted tokens, the rest are FILES.
    const fileToks = toks.filter((t) => !/^['"].*['"]$/.test(t));
    // HIGH T1-3: only the LAST file was pushed, so `sed -i 's/a/b/' out-of-scope.js in-scope.js`
    // passed the scope check on the in-scope file and mutated both. sed -i edits every operand —
    // push them all. An unquoted script (e.g. `sed -i s/a/b/ f.js`) shows up as a leading token
    // that is not a real path; it will simply fail the scope check, which is the safe direction.
    if (fileToks.length) for (const t of fileToks) targets.push(t);
    else confident = false; // -i with no discernible file → fail closed
  }
  // 4. cp/mv/install: last positional is the DESTINATION (conservative: take the last two tokens' latter)
  for (const m of clean.matchAll(/\b(?:cp|mv|install|rsync)\b([^&;|\n]*)/g)) {
    const toks = m[1].trim().split(/\s+/).filter((t) => t && !t.startsWith("-"));
    if (toks.length >= 2) targets.push(toks[toks.length - 1]);
  }
  // 5. git checkout -- PATH / git restore PATH / git apply PATCH
  for (const m of clean.matchAll(/\bgit\s+(?:checkout|restore|apply|reset)\b([^&;|\n]*)/g)) {
    const toks = m[1].trim().split(/\s+/).filter((t) => t && !t.startsWith("-") && t !== "--");
    if (toks.length) for (const t of toks) targets.push(t);
    else confident = false;
  }
  return { targets: [...new Set(targets)], confident };
}
// SEC-H5: lightweight classifier for Bash write-targets. abs is realpath'd; runRepo is the run's
// repo root.
//
// This used to return only { rel, bookkeeping }, on the stated reasoning that the state-vs-product
// distinction was unnecessary "because the Bash path blocks anything non-bookkeeping that isn't in
// declared scope". That reasoning is false in the one case that matters: a plan which DECLARES
// `.zcode/state/t.json` in Files: puts it IN declared scope, so the scope gate passes it and
// nothing else looked at it — `sed -i 's/OKAY/X/' .zcode/state/t.json` was allowed.
//
// This is T1-5 on the Bash path. The v0.5.0 fix for T1-5 armed `isState` on the Edit path only,
// which is the very Class A shape this release exists to close — a guard added to one path and not
// its Bash twin. Caught re-verifying the release against 0.4.1.
function quickClassify(abs, runRepo) {
  const runPrefix = runRepo + sep;
  if (abs === runRepo || abs.startsWith(runPrefix)) {
    const rel = abs === runRepo ? "" : abs.slice(runPrefix.length);
    const bookkeeping = rel.startsWith(".zcode/plans/") || rel.startsWith(".zcode/notepads/") || rel.startsWith(".zcode/staging/");
    const isState = rel.startsWith(".zcode/state/") || rel.startsWith(".zcode/reviews/");
    return { rel, bookkeeping, isState };
  }
  // outside the run repo entirely → treat as product code (will fail the inScope check, blocking it)
  return { rel: abs, bookkeeping: false, isState: false };
}

// SEC-H5: extract the plan's declared editable-file set (shared by the Edit scope gate and the
// post-OKAY Bash scope gate so they can't disagree). Mirrors the in-block logic at the edit path.
// I3 (audit 2026-08-20): repoRoot is the PER-CALL run's own repo (pathResolve(RUN_STATE_DIR,
// "..", "..") — selection above may have swapped the governing run). plan_path is resolved
// through the shared plan-path.mjs helper: a plan_path pointing into ANOTHER repo is a named
// violation and the declared scope is EMPTY — a foreign plan must block, never widen, and its
// filenames must never reach a block message.
function declaredScopeForRun(st, repoRoot) {
  const { planPath, violation } = resolvePlanPath(st, repoRoot);
  if (violation) return { declared: new Set(), planText: null, planPath, violation };
  let planText;
  try { planText = readFileSync(planPath, "utf8"); } catch { return { declared: new Set(), planText: null, planPath }; }
  const declared = new Set();
  for (const m of planText.matchAll(/Files:\s*\[([^\]]+)\]/g)) {
    const content = m[1];
    for (const bm of content.matchAll(/`([^`]+)`/g)) {
      const p = bm[1].trim();
      if (p && /[/.]/.test(p) && !/\s/.test(p)) declared.add(p);
    }
    if (!content.includes("`")) {
      for (let p of content.split(",")) {
        p = p.trim().replace(/^`|`$/g, "");
        if (p && /[/.]/.test(p) && !/\s/.test(p)) declared.add(p);
      }
    }
  }
  // SEC-M7c (2026-08-12): the `## Scope` prose harvest is GONE. `Files:` is now the single source
  // of truth for the declared set, in both this gate and F1.
  //
  // Its history is the argument against it. SEC-M7 narrowed a whole-plan harvest to `## Scope`
  // after a prohibition granted access; SEC-M7b then had to strip Must-NOT subsections *inside*
  // `## Scope` after the same bug reappeared one level down. Two fixes, same shape, because
  // harvesting paths out of prose cannot tell "edit this" from "do not edit this" or from
  // "this is what the style looks like".
  //
  // The second shakedown run made the cost concrete: a plan that mentioned `test/text.test.js` as
  // a STYLE REFERENCE thereby granted write access to it. And F1 never honoured this harvest at
  // all — it derives `declared` from `Files:` only. So a Scope-granted file passed the gate and
  // then guaranteed an F1 failure at the end of the run. The gate authorised precisely what the
  // final wave would reject.
  //
  // A plan that needs a file in scope declares it in `Files:` — which F1 requires anyway. One
  // source, two consumers, no disagreement, and prose goes back to being prose.
  return { declared, planText, planPath };
}
// --- parallel-dispatch ledger (audit gap #3) ---
// The orchestrator CANNOT bump state.in_flight_dispatches between tool calls in one turn,
// so the hook must count. Ledger = .zcode/state/<slug>.inflight.json: [{id, at}].
// Entries older than INFLIGHT_TTL_MS are pruned (orphan self-expiry after a crash).
function ledgerPath(dir, slug) {
  return join(dir, `${slug}.inflight.json`);
}
function readLedger(dir, slug) {
  const p = ledgerPath(dir, slug);
  if (!existsSync(p)) return [];
  try {
    const arr = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
// W5-minor: ACTUALLY atomic write — temp file in the run's state dir (same-dir rename is atomic on
// POSIX), then renameSync. The old mkdtempSync-based version leaked a /tmp dir per dispatch and
// wasn't atomic.
function writeLedgerAtomic(dir, slug, arr) {
  const final = ledgerPath(dir, slug);
  const tmp = final + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(arr, null, 0));
  try { renameSync(tmp, final); } catch { try { unlinkSync(tmp); } catch {} }
}
function pruneStale(arr, now = Date.now()) {
  return arr.filter((e) => typeof e.at === "number" && now - e.at < INFLIGHT_TTL_MS);
}

// --- read stdin (the hook payload) ---
let payload = {};
try {
  const raw = readFileSync(0, "utf8");
  payload = raw.trim() ? JSON.parse(raw) : {};
} catch {
  exit(0); // malformed stdin: pass, don't break normal work
}

const toolName = payload.tool_name || payload.tool || "";
const toolInput = payload.tool_input || payload.input || {};

// --- find the active orchestration run, if any ---
// Pilot-herdr fix (2026-08-03): the harness may set CLAUDE_PROJECT_DIR to a workspace root that
// CONTAINS the actual repo as a (possibly deeply) nested subdirectory (e.g. PROJECT_DIR is the
// user's ~/.zcode but the run lives in <~/.zcode>/v2/herdr/.zcode/state/). The old version
// scanned only the flat top-level STATE_DIR, so a nested-repo run was never found → the hook exited
// at `if (!state) exit(0)` before reaching the dispatch branch → nonce never minted → review→execute
// deadlock. Fix: recursively discover every `.zcode/state/` dir under PROJECT_DIR (bounded depth +
// generated-dir skip to keep per-tool-call cost negligible), and pick the most-recently-updated
// active run among them. Additive (finds more runs), never loosens a gate.
//
// PERF (memory fix 2b): the DFS discovers which dirs are state dirs — that discovery is the
// expensive part (662 dirs visited on a wide repo). The active run itself changes rarely. So we
// cache the DISCOVERY (the stateDirs list + the result) keyed on a fingerprint of the state files'
// mtimes. On a cache hit we skip the DFS entirely (a handful of statSync calls instead of a full
// tree walk). Invalidation is automatic: any state file add/remove/modify changes the fingerprint.
// The cache NEVER loosens the gate — on any doubt (fingerprint mismatch, read error, parse error)
// we fall through to a full DFS. Cache disabled via ZODYSSEY_NO_FIND_CACHE=1 for debugging.
const FIND_CACHE_PATH = join(STATE_DIR, ".find-active-run.cache");
const FIND_CACHE_DISABLE = !!process.env.ZODYSSEY_NO_FIND_CACHE;
// I1 (oracle-r1 blocker 2): fingerprintStateDirs stats only files in the CACHED stateDirs, so a
// sibling `.zcode/state` created mid-window is invisible on every hit — a quiet first run plus a
// new second project was unbounded staleness (its state undefended, its run never governing).
// A cache hit now ADDITIONALLY requires the entry to be younger than this bound; an aged entry
// falls through to the full DFS below, which refreshes it. The mtime fingerprint stays the
// hot-path check; this is the bound that makes "never loosens the gate" survive new projects.
const FIND_CACHE_TTL_MS = 60 * 1000;
// I1/I2: every ACTIVE run discovered for THIS tool call, [{state, stateDir, statePath}]. Per-call
// selection (the block after RUN_STATE_DIR) and the union protectedDirs (the non-native guard)
// both derive from this one list — cache-backed, so hits need no re-walk. Set by findActiveRun().
let DISCOVERED_RUNS = [];

// Compute a fingerprint of the current state files across a candidate stateDirs list.
// Returns null if any state dir is unreadable (→ treat as cache miss / fall to full DFS).
function fingerprintStateDirs(stateDirs) {
  let fp = "";
  for (const dir of stateDirs) {
    let entries;
    try { entries = readdirSync(dir); } catch { return null; }
    for (const f of entries) {
      if (!f.endsWith(".json")) continue;
      if (f.endsWith(".inflight.json")) continue;
      const p = join(dir, f);
      let st;
      try { st = statSync(p); } catch { continue; }
      fp += p + ":" + st.mtimeMs + ";";
    }
  }
  return fp;
}

function readFindCache() {
  if (FIND_CACHE_DISABLE) return null;
  try {
    const c = JSON.parse(readFileSync(FIND_CACHE_PATH, "utf8"));
    if (!c || c.projectDir !== PROJECT_DIR) return null;
    return c;
  } catch { return null; }
}

function writeFindCache(cache) {
  if (FIND_CACHE_DISABLE) return;
  try {
    const tmp = FIND_CACHE_PATH + ".tmp." + process.pid;
    writeFileSync(tmp, JSON.stringify(cache));
    renameSync(tmp, FIND_CACHE_PATH);
  } catch { /* cache is advisory; never fail the gate on a cache write error */ }
}

function findActiveRun() {
  const now = Date.now();
  // FAST PATH: validate the cached discovery against the live state-file mtimes. The cache holds
  // the FULL runs list (not just the recency winner) so per-call selection and the union
  // protectedDirs work on hits. A hit needs ALL of: fingerprint match (hot-path check, unchanged),
  // a cached runs array, and an `at` no older than FIND_CACHE_TTL_MS (oracle-r1 blocker 2 — the
  // fingerprint stats only files in the CACHED stateDirs, so it cannot see a newly CREATED
  // sibling `.zcode/state`; without the bound, that staleness is unbounded). Any doubt → full
  // DFS below, which refreshes the cache. The cache NEVER loosens the gate: the same
  // terminal/stale filters are re-applied to the cached list (belt and suspenders, since phase
  // transitions DO write state).
  const cached = readFindCache();
  if (cached && Array.isArray(cached.stateDirs)) {
    const fp = fingerprintStateDirs(cached.stateDirs);
    if (fp !== null && fp === cached.fingerprint && Array.isArray(cached.runs) &&
        typeof cached.at === "number" && now - cached.at <= FIND_CACHE_TTL_MS) {
      const runs = cached.runs.filter((r) => {
        if (!r || !r.state || !r.state.phase || TERMINAL.has(r.state.phase)) return false;
        const updated = r.state.updated_at ? new Date(r.state.updated_at).getTime() : 0;
        return !updated || now - updated <= STALE_MS;
      });
      DISCOVERED_RUNS = runs;
      const best = mostRecent(runs);
      return best ? { run: best.state, dir: best.stateDir } : null;
    }
  }
  // Discover every `.zcode/state` dir under PROJECT_DIR. I6 (project-isolation audit
  // 2026-08-20): the DFS lives in ONE place — find-run.mjs's exported discoverStateDirs. The
  // private twin this replaced still pushed the as-passed `dir` at the isZcodeChild branch while
  // the shared copy pushes the realpath'd form (the Class-B fix), so RUN_STATE_DIR could carry
  // symlink components the re-selection path normalized away. Equality of both consumers is
  // pinned by lib/find-run.pin.test.mjs. SKIP_NAMES/MAX_DEPTH/the symlink-dir skip now live ONLY
  // in the shared copy — never reintroduce local constants here.
  const stateDirs = discoverStateDirs(PROJECT_DIR);
  // Also always consider the top-level STATE_DIR even if discovery missed it.
  if (!stateDirs.includes(STATE_DIR)) stateDirs.push(STATE_DIR);
  const runs = [];
  for (const dir of stateDirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith(".json")) continue;
      if (f.endsWith(".inflight.json")) continue; // parallel-cap ledger, not a run state file
      let st;
      try {
        st = JSON.parse(readFileSync(join(dir, f), "utf8"));
      } catch {
        continue;
      }
      // CRITICAL T1-7 (audit 2026-08-14): discovery used to trust ANY parseable .json here, so a
      // dropped `decoy.json` carrying review.verdict:"OKAY" became the governing run and defeated
      // the review gate, scope gate and tamper guard at once. Require the authenticity marker that
      // scaffold/trusted writers mint. Fail CLOSED: an unmarked file is not a run.
      // Legitimate pre-v0.5.0 runs are adopted once via `scaffold.mjs <repo> <slug> --adopt`;
      // the warning names that command so an operator whose run stopped being discovered is not
      // left guessing (silence here would look identical to "no run active").
      {
        const auth = verifyMarker(st, st.slug || f.replace(/\.json$/, ""));
        if (!auth.ok) {
          if (env.ZODYSSEY_DEBUG) {
            process.stderr.write(
              `ZOdyssey: ignoring run state ${join(dir, f)} — ${auth.reason}. ${adoptHint("<repo>", st.slug || f.replace(/\.json$/, ""))}\n`
            );
          }
          continue;
        }
      }
      // I4 (project-isolation audit 2026-08-20): a BOUND run belongs to the repo it was
      // scaffolded in. The marker alone is project-blind (it proves "minted by this install's
      // key", never "belongs here"), so when the optional project_dir field is present,
      // discovery additionally requires it to name THIS state dir's repo root (sameFile —
      // mount-spelling tolerant). Absent field → no rejection: every pre-v0.6.16 run must keep
      // loading (backward-compat state.json rule). The predicate is shared with find-run.mjs's
      // loop (state-auth.mjs) so the two walks cannot drift. Cache-safe by construction: the
      // cached runs list is only ever written from this full-DFS path, and any later edit to a
      // state file changes its mtime → fingerprint miss → re-scan re-applies this check.
      if (!projectBindingHolds(st, dir)) {
        if (env.ZODYSSEY_DEBUG) {
          process.stderr.write(
            `ZOdyssey: ignoring run state ${join(dir, f)} — project binding mismatch (state is bound to ${st.project_dir}, found under a different repo). ${adoptHint(PROJECT_DIR, st.slug || f.replace(/\.json$/, ""))}\n`
          );
        }
        continue;
      }
      if (!st.phase || TERMINAL.has(st.phase)) continue;
      const updated = st.updated_at ? new Date(st.updated_at).getTime() : 0;
      if (updated && now - updated > STALE_MS) continue;
      runs.push({ state: st, stateDir: dir, statePath: join(dir, f) });
    }
  }
  DISCOVERED_RUNS = runs;
  // The recency winner is what no-anchor paths fall back to; the per-call selection block below
  // swaps in the run that actually encloses this call's target/cwd. mostRecent applies the same
  // updated_at string-compare the old inline tracker used, so the winner is byte-identical.
  const best = mostRecent(runs);
  const result = best ? { run: best.state, dir: best.stateDir } : null;
  // Persist the discovery so the next call can skip the DFS. Fingerprint keyed on state-file
  // mtimes; any add/remove/modify invalidates. The FULL runs list is cached alongside `result`
  // (I1: per-call selection and the union protectedDirs must work on hits — and with the TTL
  // bound above, a hit can never keep serving a list that predates a newly created sibling
  // project indefinitely). result may be null (no active run) — caching that is fine and useful
  // (avoids re-walking when no run is active at all).
  const fp = fingerprintStateDirs(stateDirs);
  if (fp !== null) writeFindCache({ projectDir: PROJECT_DIR, stateDirs, fingerprint: fp, runs, result, at: now });
  return result;
}

function block(reason) {
  // Prefix with a fixed token so run-report.mjs can machine-count blocks by kind
  // (audit gap #9: the old free-text reasons weren't greppable).
  console.log(JSON.stringify({ decision: "block", reason: `ZODYSSEY_BLOCK gate: ${reason}` }));
  exit(2);
}

const _found = findActiveRun();
if (!_found) exit(0); // no active run — normal editing, pass.
let state = _found.run;
// RUN_STATE_DIR: the dir where THIS run's state.json actually lives. Equals STATE_DIR for a
// top-level run, but a nested-repo run (CLAUDE_PROJECT_DIR is a workspace root containing the repo
// as a subdirectory) needs writes to land in the nested repo's .zcode/state/, not the workspace's.
let RUN_STATE_DIR = _found.dir;

const isEdit = ["Write", "Edit", "ApplyPatch", "MultiEdit", "NotebookEdit"].includes(toolName);
// Test-file conventions, kept in sync with record-final-wave.mjs's TEST_PATH. Conservative: a
// false positive blocks a legitimate edit, so only unambiguous conventions are matched.
const TEST_PATH_RE = /(^|\/)(tests?|spec|__tests__)\/|(^|\/)test_[^/]+\.py$|[._-](test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb)$|Test[s]?\.(java|kt|cs)$/;
const isBash = toolName === "Bash";
const isDispatch = ["Task", "Agent", "dispatch_agent"].includes(toolName);

// SEC-H6 (external audit #8): the cached findActiveRun picks the globally most-recent active run,
// which lets a SIBLING repo's run govern an edit in THIS repo (its Files: scope can never match
// → every edit SCOPE VIOLATION; if that run's verdict is null, every product edit is blocked).
// For EDIT tools (which carry a target path), re-select among ALL active runs by target-path
// ancestry — the run whose repo root is the nearest ancestor of the target wins.
//
// I1 (project-isolation audit 2026-08-20): that re-selection existed on the edit path ONLY.
// Every other tool — Bash, mcp__*/non-native, anything unnamed — kept the global-recency pick,
// so in a workspace whose PROJECT_DIR contains several projects the freshest project's run
// silently governed every call in the others (their edits judged against a foreign plan, their
// shell activity ledgered into the neighbour's records, only the governing project defended).
// Selection is now PER-CALL on every tool path, always over the same DISCOVERED_RUNS list
// (cache-backed — the full list ships with the 2b cache, so hits need no re-walk):
//   · Edit          → the tool's target path (SEC-H6, unchanged).
//   · Task/dispatch → the dispatch's cwd (SEC audit M8, unchanged).
//   · Bash          → the call's cwd (I5: the ungated ledger and every Bash gate below follow
//                     the project the shell actually runs in).
//   · everything else (mcp__*, unknown non-native) → the DEEPEST run whose repo root encloses
//     any path-shaped string in tool_input, then cwd, then mostRecent. This anchor is
//     steerable by the very payload the non-native guard below defends against — deliberately,
//     because no better anchor exists for path-less tools — which is exactly why that guard
//     protects ALL discovered runs, not just the selected one.
// selectByTarget breaks equal-depth ties by updated_at (recency at every level, I1) and its
// no-enclosure fallback is mostRecent — NEVER "no run encloses it → exit 0" (fail-open trap).
if (isEdit) {
  const _tp = toolInput.file_path || toolInput.path || toolInput.notebook_path || "";
  if (_tp) {
    const _sel = selectByTarget(DISCOVERED_RUNS, _tp);
    if (_sel && _sel.state.slug !== state.slug) { state = _sel.state; RUN_STATE_DIR = _sel.stateDir; }
  }
} else if (isDispatch) {
  // SEC (audit M8): a Task dispatch carries no file target, so run-selection fell back to the
  // globally most-recent active run. In a workspace with 2+ active runs, a legit momus dispatch
  // could mint its review nonce into the WRONG run — deadlocking the intended one (its
  // record-momus-artifact finds no pending_nonce → exit 6) while the other accrues a stray nonce.
  // Re-select by the dispatch's working directory: the run whose repo root encloses cwd wins.
  const _cwd = payload.cwd || process.cwd();
  const _sel = selectByTarget(DISCOVERED_RUNS, _cwd);
  if (_sel && _sel.state.slug !== state.slug) { state = _sel.state; RUN_STATE_DIR = _sel.stateDir; }
} else if (isBash) {
  // I5: the same cwd anchor as dispatch — an ungated Bash call's ledger row (and every Bash
  // gate below) must attribute to the project the shell is running in, not the workspace's
  // recency winner. Bash write TARGETS keep being classified by quickClassify against the
  // selected run's repo, so cross-repo targets still fail closed via scope.
  const _cwd = payload.cwd || process.cwd();
  const _sel = selectByTarget(DISCOVERED_RUNS, _cwd);
  if (_sel && _sel.state.slug !== state.slug) { state = _sel.state; RUN_STATE_DIR = _sel.stateDir; }
} else {
  // I1: MCP/non-native tools carry no single target field, but their payloads are full of path
  // strings. Collect them (the same walk the non-native guard below uses on tool_input), then
  // anchor on the deepest run root enclosing ANY of them — depth first, recency among equal
  // depths — falling back to cwd, then mostRecent via selectByTarget's own fallback.
  const _strings = [];
  (function collect(v, depth) {
    if (depth > 4 || v == null || _strings.length > 200) return;
    if (typeof v === "string") { _strings.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) collect(x, depth + 1); return; }
    if (typeof v === "object") { for (const k of Object.keys(v)) collect(v[k], depth + 1); }
  })(toolInput, 0);
  let _anchor = null, _anchorLen = -1, _anchorAt = "";
  for (const s of _strings) {
    if (typeof s !== "string" || s.length > 4096) continue;
    if (!s.includes("/") && !s.includes(sep)) continue; // not path-shaped
    let _abs;
    try { _abs = realpathSync.native(pathResolve(PROJECT_DIR, s)); } catch { _abs = pathResolve(PROJECT_DIR, s); }
    for (const _r of DISCOVERED_RUNS) {
      const _root = pathResolve(_r.stateDir, "..", "..");
      if (_abs !== _root && !_abs.startsWith(_root + sep)) continue;
      const _at = String(_r.state.updated_at || "");
      if (_root.length > _anchorLen || (_root.length === _anchorLen && _at > _anchorAt)) {
        _anchor = s; _anchorLen = _root.length; _anchorAt = _at;
      }
    }
  }
  const _sel = selectByTarget(DISCOVERED_RUNS, _anchor || payload.cwd || process.cwd());
  if (_sel && _sel.state.slug !== state.slug) { state = _sel.state; RUN_STATE_DIR = _sel.stateDir; }
}

// W7-stall self-test: dump the real hook payload shape ONCE per run, so the owner-identity
// assumption (does the harness actually send agent_id/session_id/tool_use_id?) becomes VERIFIED
// rather than guessed (rounds 4-7 all assumed fields that may not exist). Writes to
// .zcode/state/<slug>.payload-probe.json, idempotent per run.
// PERF (memory fix 3a): the probe already served its purpose (proved agent_id is absent — see
// external-audit finding). Skip the write in production unless ZODYSSEY_DEBUG=1 is set.
// I1: this block sits BELOW the per-call selection (it used to sit above the edit-path
// re-selection, so the probe always landed in the recency winner's dir) — the probe destination
// is a witness of which run governs THIS call, and the project-isolation suite asserts on it.
{
  const probePath = join(RUN_STATE_DIR, `${state.slug}.payload-probe.json`);
  if (process.env.ZODYSSEY_DEBUG && !existsSync(probePath)) {
    try {
      const known = ["tool_name", "tool", "tool_input", "input", "session_id", "agent_id",
        "tool_use_id", "transcript_path", "cwd", "hook_event_name", "parent_tool_use_id"];
      const present = known.filter((k) => payload[k] !== undefined);
      const extra = Object.keys(payload).filter((k) => !known.includes(k));
      writeFileSync(probePath, JSON.stringify({
        slug: state.slug, at: new Date().toISOString(),
        tool_name: toolName,
        top_level_keys: Object.keys(payload),
        identity_fields_present: present,
        identity_fields_absent: known.filter((k) => payload[k] === undefined),
        extra_fields: extra,
        note: "Read this to know which owner-identity field pre-tool.mjs can rely on for file-lock attribution. If agent_id is absent, the H4 per-owner map collapses to session_id (identical across parallel sub-agents) and the lock never fires — the round-4/5 bug.",
      }, null, 2) + "\n");
    } catch {}
  }
}

// MAJOR-3 (operational-consult): capability recording. The old path was circular —
// record-capability.mjs was called by the agent that CLAIMED the capability, so state.capabilities
// was self-declared. The hook sees real Skill/MCP tool calls as they happen.
// SEC (audit M7): PreToolUse fires on tool ATTEMPT, before the skill actually loads (a nonexistent
// skill would still stamp here). So the PRE hook records only `attempted:true`; the successful-load
// `observed:true` — the one F5 trusts — is stamped by post-tool.mjs after the load returns.
if (toolName === "Skill" || toolName.startsWith("mcp__")) {
  try {
    const cap = toolName === "Skill" ? `skill:${toolInput.skill || toolInput.name || "unknown"}` : toolName;
    const capStatePath = join(RUN_STATE_DIR, `${state.slug}.json`);
    const capLock = capStatePath + ".lock";
    const CAP_LOCK_STALE = 60 * 1000;
    function capAcquire() {
      try { return openSync(capLock, "wx"); } catch {
        try { if (Date.now() - statSync(capLock).mtimeMs > CAP_LOCK_STALE) { unlinkSync(capLock); try { return openSync(capLock, "wx"); } catch { return null; } } } catch {}
        return null;
      }
    }
    const lf = capAcquire();
    if (lf !== null) {
      try {
        let cs; try { cs = JSON.parse(readFileSync(capStatePath, "utf8")); } catch { cs = state; }
        cs.capabilities = Array.isArray(cs.capabilities) ? cs.capabilities : [];
        cs.capabilities.push({ at: new Date().toISOString(), phase: state.phase, capability: cap, attempted: true });
        cs.updated_at = new Date().toISOString();
        const ct = capStatePath + ".tmp." + process.pid;
        writeFileSync(ct, JSON.stringify(cs, null, 2) + "\n");
        renameSync(ct, capStatePath);
      } catch {} finally { try { closeSync(lf); unlinkSync(capLock); } catch {} }
    }
  } catch {}
}

function targetPath() {
  return toolInput.file_path || toolInput.path || toolInput.notebook_path || "";
}

// Resolve a target path to a normalized repo-relative string and decide if it's bookkeeping.
// audit gap #1b+#1c: must (a) NOT classify .zcode/state/ as bookkeeping (state writes go
// through the gate), (b) use resolved-path prefix matching (no substring includes, no
// ../ survivors). Plans + notepads stay writable (they're the planner's + executor's scratchpad);
// state does not (it carries the verdict).
//
// Pilot-herdr nested-repo fix (2026-08-03): bookkeeping/state prefixes must be matched against the
// RUN's repo root (derived from RUN_STATE_DIR), not only PROJECT_DIR. A nested-repo run lives under
// <PROJECT_DIR>/<sub>/<...>/.zcode/, so its `.zcode/notepads/...` path resolves to "<sub>/.../.zcode/..."
// relative to PROJECT_DIR and would miss the bookkeeping prefix → misclassified as product code →
// gated, deadlocking verdict recording. We now classify against the run repo first, PROJECT_DIR second.
function classifyTarget(p) {
  if (!p) return { rel: "", bookkeeping: false };
  let abs;
  try {
    // Resolve relative to PROJECT_DIR, then realpath to collapse .. and symlinks.
    abs = realpathSync.native(pathResolve(PROJECT_DIR, p));
  } catch {
    // realpathSync fails if the file doesn't exist yet (Write to a new file). Fall back
    // to resolve-only (still collapses .. lexically) and a PROJECT_DIR containment check.
    abs = pathResolve(PROJECT_DIR, p);
  }
  let bookkeeping = false;
  let isState = false;
  let rel = "";
  let inRunRepo = false; // set by branch (1), read by the (3) fall-through below
  // (1) Run-repo-relative classification (handles nested-repo runs). RUN_STATE_DIR is .../.zcode/state;
  // the repo root is two levels up. Match bookkeeping/state prefixes against that.
  if (RUN_STATE_DIR) {
    const runZcode = pathResolve(RUN_STATE_DIR, "..");          // .../.zcode
    const runRepo = pathResolve(runZcode, "..");                 // the repo root containing .zcode
    const runPrefix = runRepo + sep;
    inRunRepo = abs === runRepo || abs.startsWith(runPrefix);
    if (inRunRepo) {
      const runRel = abs === runRepo ? "" : abs.slice(runPrefix.length);
      rel = runRel;
      if (runRel.startsWith(".zcode/plans/") || runRel.startsWith(".zcode/notepads/") || runRel.startsWith(".zcode/staging/")) bookkeeping = true;
      if (runRel.startsWith(".zcode/state/")) isState = true;
    }
  }
  // (2) PROJECT_DIR-relative classification (top-level runs + workspace bookkeeping).
  const inside = abs === PROJECT_DIR || abs.startsWith(PROJECT_PREFIX);
  if (inside) {
    const projRel = abs === PROJECT_DIR ? "" : abs.slice(PROJECT_PREFIX.length);
    if (!rel) rel = projRel; // prefer the run-relative rel, fall back to PROJECT_DIR-relative
    // SEC-6b (2026-08-12): `.zcode/staging/` exists to break a total deadlock, found by the first
    // end-to-end shakedown run. Pre-OKAY the ONLY writable paths were plans/ and notepads/ — and
    // those are exactly the two SEC-6 refuses as `--from` sources for a verdict, while the Bash
    // gate rejects any stdin pipe (a metachar means the command is not a trusted-script invoke, so
    // it falls through to the write-capable gate and is blocked pre-OKAY). Every route to
    // recording an OKAY was closed, so no gated run could leave phase 3 at all.
    //
    // It had never surfaced because the Bash gate was DELETED from v0.1.1 through v0.3.1; SEC-6
    // landed 2026-08-04 while it was off, so the two had never been armed at the same time until
    // the gate was restored on 2026-08-11.
    //
    // What this preserves and what it does not: SEC-6 stops a verdict being pre-staged in the
    // dirs the PLANNER writes (plans/, notepads/), which is where a forged verdict would most
    // cheaply be planted. `staging/` is not one of those. It is NOT a security boundary on its own
    // — the artifact's real protection is the hook-minted nonce plus the sha binding, and
    // record-momus-artifact.mjs's own header already concedes the content is caller-supplied
    // ("the full fix needs the harness to hand momus's transcript hash to the hook").
    if (projRel.startsWith(".zcode/plans/") || projRel.startsWith(".zcode/notepads/") || projRel.startsWith(".zcode/staging/")) bookkeeping = true;
    if (projRel.startsWith(".zcode/state/")) isState = true;
  }
  // (3) Outside BOTH the run repo and PROJECT_DIR → treat as product code (will fail the inScope
  // check, blocking it) — the same fall-through quickClassify uses for the Bash twin. Until
  // 2026-08-16 (docs/impl/01) an outside target kept rel: "" here, so every guard below hanging
  // off `if (rel)` — plan-sha tamper check, Files: containment, the fail-closed catch, the file
  // lock — silently skipped and the edit fell through to the unconditional allow: the post-OKAY
  // Edit-path scope escape. Root equality (a target exactly equal to a repo root) still yields
  // rel: "" on both twins; the tools themselves reject directory targets.
  if (!inRunRepo && !inside) rel = abs;
  return { rel, bookkeeping, isState };
}

if (isEdit) {
  const { rel, bookkeeping, isState } = classifyTarget(targetPath());

  // T1-5 (audit 2026-08-14): `isState` was computed here and at the projRel branch, returned from
  // classifyTarget — and then never used in a single conditional. The file header's claim that
  // "an agent cannot self-authorize a verdict by writing state.json" held only incidentally,
  // because plans do not normally declare `.zcode/state/` in Files:. A plan that DOES declare it
  // made verdict, phase and acceptance directly rewritable with the Edit tool. (v0.4.1's H3 guard
  // closed this for MCP/non-native tools but not for the native Edit path.) State is written only
  // by the trusted scripts; there is no legitimate direct edit.
  if (isState) {
    block(
      `run state is not directly editable: ${rel} holds the review verdict, phase and acceptance ` +
        `records, which are exactly what the gate reads to decide whether to allow anything. Use the ` +
        `trusted writers (record-review / set-phase / record-todo / record-verify) — they are the only ` +
        `sanctioned path and they bind their writes to hook-minted evidence. (slug=${state.slug})`
    );
  }

  // B2 — APPEND-ONLY NOTEPADS. Notepads are the evidence F1-F4 consume, and until 2026-08-11
  // `if (bookkeeping) exit(0)` let ANY agent replace one wholesale, in any phase, before or
  // after the verdict. ZOdyssey went to real trouble making verdicts non-forgeable (hook-minted
  // nonces, one-time consumption, sha-anchoring) and left the INPUTS to those verdicts freely
  // destroyable — the lock on the vault with the wall left open.
  //
  // Write replaces a file; Edit modifies it in place. Blocking Write while allowing Edit keeps
  // notepads accumulating (the intended usage: append findings as you go) while making
  // "overwrite the record of what actually happened" a blocked operation. Creating a NEW
  // notepad is still Write, so the first write to a not-yet-existing path is allowed.
  if (bookkeeping) {
    const isNotepad = typeof rel === "string" && rel.startsWith(".zcode/notepads/");
    if (isNotepad && toolName === "Write") {
      const tp = targetPath();
      let exists = false;
      try { exists = !!tp && existsSync(tp); } catch { exists = false; }
      if (exists) {
        block(
          `notepads are APPEND-ONLY: Write would replace ${rel} wholesale, destroying evidence the ` +
          `final wave (F1-F4) reads. Use Edit to add to it, or write a new notepad file. ` +
          `(slug=${state.slug})`
        );
      }
    }
    exit(0); // plans, and non-destructive notepad writes, remain free
  }

  // B5 — TESTS ARE READ-ONLY ONCE THE WORK IS BEING JUDGED.
  //
  // The cheapest way to turn a failing acceptance criterion green is to weaken the test. Measured
  // rates for exactly this: 76% (GPT-5) / 46% (Claude Opus 4.1) on ImpossibleBench, where
  // restricting test access drops it to near zero and prompting does not help at all — and where
  // STRONGER models cheat MORE.
  //
  // Deliberately scoped to verify/final rather than blanket read-only: during `execute`, writing
  // tests is the job (this project mandates TDD, so a blanket ban would forbid the correct
  // workflow). Once we move to VERIFY, the criteria are being executed and the code is being
  // judged — editing a test at that moment is not test-writing, it is moving the goalposts.
  // Post-hoc weakening across the whole run is caught separately by F1's test-integrity guard.
  if ((state.phase === "verify" || state.phase === "final") && typeof rel === "string" && TEST_PATH_RE.test(rel)) {
    block(
      `test files are read-only during phase=${state.phase}: ${rel} is a test, and the acceptance ` +
      `criteria are being evaluated right now. Editing a test at this point changes the standard ` +
      `rather than meeting it. If the test is genuinely wrong, say so and re-plan — do not edit it ` +
      `here. (slug=${state.slug})`
    );
  }

  // Outside PROJECT_DIR entirely and not bookkeeping → treat as product code (gated).
  // Review gate: product-code edits require verdict == OKAY.
  if (state.review?.verdict !== "OKAY") {
    block(
      `edits to product code are blocked until the plan passes review ` +
        `(current verdict: ${state.review?.verdict ?? "none"}, round ${state.review?.round ?? 0}/${state.review?.max_rounds ?? 3}). ` +
        `Complete the review phase first. (slug=${state.slug})`
    );
  }
  // Verdict is OKAY. SCOPE BOUNDARY (critical isolation fix 2026-08-02): once the gate is open,
  // the executor may ONLY edit files declared in the plan's Files: union. Without this, an executor
  // can write to ANY file in the repo (the iqraa-library.net isolation failure: an ai-agents roundup
  // run edited devto-bedrock-article.md — completely unrelated). The hook reads the plan at edit
  // time, extracts the declared file set, and blocks anything outside it + .zcode/ bookkeeping.
  // SEC-5 (external audit 2026-08-04): the old `state.phase !== "final"` carve-out disabled the
  // scope check for the ENTIRE final phase, so a plain Write to .zcode/reviews/*.json succeeded —
  // exactly where the F2/F4 evidence lives. The carve-out is removed: the scope gate now applies
  // in final too. This is safe because F3 checklists live under .zcode/notepads/ (bookkeeping,
  // always writable) and F2/F4 artifacts must go through the trusted writers
  // (record-momus-artifact / record-final-wave), never a direct Write. .zcode/reviews/ stays
  // gated in every phase.
  if (rel) {
    // I3: the plan root is the run's OWN repo (per-call — selection may have swapped it), and
    // a plan_path escaping that repo is refused before a single foreign byte is read.
    const runRepo = RUN_STATE_DIR ? pathResolve(pathResolve(RUN_STATE_DIR, ".."), "..") : PROJECT_DIR;
    const { planPath, violation } = resolvePlanPath(state, runRepo);
    if (violation) {
      block(
        `SCOPE VIOLATION (plan isolation): ${violation}. ` +
        `The declared scope for ${rel} cannot be verified — the edit is refused rather than judged ` +
        `by a plan outside this run's repo. Fix state.plan_path or re-scaffold. (slug=${state.slug})`
      );
    }
    try {
      const planText = readFileSync(planPath, "utf8");
      // SEC-4 (external audit 2026-08-04): the plan is agent-writable (.zcode/plans/ is bookkeeping)
      // and was re-read here WITHOUT re-hashing against state.review.plan_sha256. So an executor
      // could widen its own scope by editing the plan post-OKAY. Now: once a verdict is bound to a
      // plan-sha, ANY drift between the on-disk plan and that sha blocks the edit. The plan must be
      // re-reviewed (record-review re-binds the sha) to change scope legitimately.
      const boundSha = state.review && state.review.plan_sha256;
      if (boundSha) {
        const diskSha = createHash("sha256").update(planText).digest("hex");
        if (diskSha !== boundSha) {
          block(
            `PLAN TAMPERED: the on-disk plan (${planPath}) no longer matches the plan-sha bound to ` +
            `the OKAY verdict (expected ${boundSha.slice(0,12)}, got ${diskSha.slice(0,12)}). ` +
            `.zcode/plans/ is writable, so scope must be re-authorized by re-running momus + ` +
            `record-review (which re-binds the sha). (slug=${state.slug})`
          );
        }
      }
      // extract declared paths via the shared helper (SEC-M7: the anywhere-in-plan harvest that
      // granted forbidden Must-NOT-do paths is removed there; restricted to Files: + ## Scope).
      const { declared } = declaredScopeForRun(state, runRepo);
      // check: is the target file (or a parent dir) in the declared set?
      // allow exact match or prefix match (declared dir contains the file).
      // FAIL CLOSED on empty declared set: a plan that declares no editable files must not
      // silently allow edits to ANY product file — that's the iqraa-library.net isolation failure
      // mode (an executor touched unrelated files because nothing constrained it). The old code
      // short-circuited with `declared.size === 0 → allow`, which is the opposite of safe.
      // (Verified+fixed 2026-08-02.) If a todo genuinely edits no files, the executor won't issue
      // a Write for it; a Write to product code when zero files are declared is definitionally
      // out of scope. parse-plan --lint also rejects empty Files: so the planner is told early.
      const inScope = declared.size > 0 &&
        [...declared].some((d) => rel === d || rel.startsWith(d + "/") || d.startsWith(rel + "/"));
      if (!inScope) {
        const tail = declared.size > 0
          ? `declared: ${[...declared].slice(0, 5).join(", ")}${declared.size > 5 ? "..." : ""}`
          : `plan declares NO editable files (Files: is empty/absent) — add the file to the plan's Files: list and re-review`;
        block(
          `SCOPE VIOLATION: ${rel} is not in the plan's declared Files: scope. ` +
            `The executor may only edit files the plan declares. (slug=${state.slug}, ${tail})`
        );
      }
    } catch (e) {
      // fail CLOSED for product code — do NOT silently allow everything. Without this, an
      // unreadable/missing plan (ENOENT, permissions, corruption) makes the declared scope
      // unknowable, so the only safe answer is to refuse the edit. (Verified broken then fixed
      // 2026-08-02: the old empty catch let execution fall through to the file-lock exit(0),
      // which ALLOWED edits the comment claimed to block.)
      block(
        `SCOPE VIOLATION: plan could not be read at ${planPath} — cannot verify ${rel} is in the declared scope. ` +
          `Fix the plan path/permissions or re-scaffold before editing product code. ` +
          `(slug=${state.slug}, error: ${e && (e.code || e.message) ? (e.code || e.message) : "unknown"})`
      );
    }
  }

  // Verdict is OKAY. File-lock check (W7-1 v3): prevent two concurrent executors editing the
  // SAME file. Owner identity must be STABLE across one executor's calls but DISTINCT between
  // parallel executors. Each in-flight executor registers in state.active_todos (a MAP, keyed by
  // owner → todo id) via record-todo.mjs. Self-ownership requires the SAME owner.
  // SEC (audit M9): agent_id is absent in this harness (payload probe), so the owner used to
  // collapse to session_id — IDENTICAL across parallel sub-agents, so two executors editing the
  // same file both saw the lock as self-owned and clobbered. parent_tool_use_id is the dispatching
  // Task's id: shared by all of ONE executor's tool calls, distinct between parallel executors.
  // Prefer it so parallel executors serialize; fall back to session_id when it is absent (no
  // regression from the prior behavior).
  const owner = payload.agent_id || payload.parent_tool_use_id || payload.session_id || state.active_executor_session || "orchestrator";
  const activeTodos = (state.active_todos && typeof state.active_todos === "object") ? state.active_todos : {};
  const myTodo = activeTodos[owner] || null;
  const locks = (state.file_locks && typeof state.file_locks === "object") ? state.file_locks : {};
  const existing = locks[rel];
  // Self-ownership (W7-1): the existing lock is mine iff the SAME owner holds it. The todo-field
  // check is additional confirmation but the owner match is what makes parallel executors distinct.
  const selfOwned = existing && existing.session === owner;
  if (existing && existing.session && !selfOwned) {
    const age = Date.now() - new Date(existing.acquired_at || 0).getTime();
    if (age >= 0 && age < INFLIGHT_TTL_MS) {
      block(
        `file lock held by another in-flight todo: ${rel} (owner=${existing.session}, ` +
          `acquired ${Math.round(age / 1000)}s ago). Sequence these todos or wait. (slug=${state.slug})`
      );
    }
  }
  // Acquire/refresh the lock for this session. (Lock release happens when the todo is marked
  // done — out of scope for the hook; reaped by TTL otherwise.)
  if (rel) {
    const lockEntry = {
      session: owner,
      todo: myTodo, // W7-1: from the per-owner map; record-todo releases by todo+owner
      acquired_at: new Date().toISOString(),
    };
    // atomic state write under a lockfile (audit gap #5c: last-writer-safe vs stop.mjs/consult.mjs).
    const statePath = join(RUN_STATE_DIR, `${state.slug}.json`);
    const lockPath = statePath + ".lock";
    const LOCK_STALE_MS = 60 * 1000;
    // Reap stale locks (a crashed previous writer) before giving up.
    function acquireLock() {
      try { return openSync(lockPath, "wx"); } catch {
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
            unlinkSync(lockPath);
            try { return openSync(lockPath, "wx"); } catch { return null; }
          }
        } catch {}
        return null;
      }
    }
    const lockFd = acquireLock();
    if (lockFd === null) exit(0); // live lock elsewhere; don't block the work.
    try {
      // W5-H3: RE-READ state.json fresh after acquiring the lock, then merge ONLY the new
      // file_locks[rel] entry. The old code serialized the pre-lock `state` snapshot, which
      // silently rewound any record-todo/record-review/set-phase write that landed meanwhile
      // (and resurrected locks record-todo had just released) — the common case under 4-way parallel execute.
      let fresh;
      try { fresh = JSON.parse(readFileSync(statePath, "utf8")); } catch { fresh = state; }
      fresh.file_locks = (fresh.file_locks && typeof fresh.file_locks === "object") ? fresh.file_locks : {};
      fresh.file_locks[rel] = lockEntry;
      fresh.updated_at = lockEntry.acquired_at;
      const tmp = statePath + ".tmp." + process.pid;
      writeFileSync(tmp, JSON.stringify(fresh, null, 2) + "\n");
      renameSync(tmp, statePath);
    } catch {
      // best-effort: if we can't record the lock, don't block the work.
    } finally {
      try { closeSync(lockFd); unlinkSync(lockPath); } catch {}
    }
  }

  // ─── NEW ARM: first-touch lint-baseline capture (item 07 / B10, todo 2) ──────
  // The post-edit lint arm needs a "before" reading or it cannot tell diagnostics
  // this edit introduced from noise the file already carried — both directions
  // produced a byte-identical block. So: on the FIRST Edit/Write/MultiEdit to a
  // given target — allow path only (an edit any gate above blocked never
  // baselines), phase execute/verify/final only (same phase guard and rationale
  // as post-tool's diagnostics arm: planner/reviewer scratch is not a product
  // edit), run selected by edit target (the SEC-H6 re-selection above, same
  // policy as every other gate in this block) — run the target repo's own
  // lint_cmd once via the shared module and freeze the exit status into
  // .zcode/state/<slug>.lint-baseline.json, keyed by repo-relative target path,
  // atomic tmp+rename. Rules:
  //   · Write creating a file that did not exist → implicit "clean" (a file this
  //     run created owes ALL its diagnostics to this run; linting a file that
  //     does not exist yet is meaningless, so nothing is spawned);
  //   · capture capability failure (no lint_cmd, spawn error, 5s timeout) →
  //     "inert", never a diagnostic;
  //   · FROZEN at first touch — a second edit to a baselined target spawns no
  //     second capture, so "new" always means "not present when the run first
  //     touched this file".
  // This arm NEVER blocks and never prints a decision — over-blocking is the
  // failure mode this change exists to remove; a baseline that cannot even be
  // recorded is swallowed and the edit proceeds.
  try {
    const _lbTarget = targetPath();
    if (_lbTarget && ["Edit", "Write", "MultiEdit"].includes(toolName) &&
        ["execute", "verify", "final"].includes(state.phase)) {
      const _lbRepoRoot = pathResolve(RUN_STATE_DIR, "..", ".."); // same root derivation as post-tool's arm
      const _lbKey = baselineKey(_lbRepoRoot, _lbTarget);
      if (_lbKey) {
        const _lbMap = readBaselineMap(RUN_STATE_DIR, state.slug);
        if (!_lbMap || !(_lbKey in _lbMap)) { // first touch only — frozen afterwards
          let _lbVal;
          let _lbNewFile = false;
          try { _lbNewFile = toolName === "Write" && !existsSync(_lbTarget); } catch { _lbNewFile = false; }
          if (_lbNewFile) {
            _lbVal = "clean";
          } else {
            const _lb = lintTarget(_lbRepoRoot, _lbTarget);
            _lbVal = (!_lb.spawned || _lb.timedOut || _lb.status === null)
              ? "inert" : (_lb.status === 0 ? "clean" : "failing");
          }
          writeBaselineMap(RUN_STATE_DIR, state.slug,
            _lbMap ? { ..._lbMap, [_lbKey]: _lbVal } : { [_lbKey]: _lbVal });
        }
      }
    }
  } catch {} // capture is best-effort BY DESIGN: never block, never print on failure
  exit(0);
}

// Shared lint invocation for the capture arm above (item 07 / B10) — imported HERE,
// adjacent to the arm, NOT at the file top: ESM hoists import declarations, and this
// way zero lines are added above the capture-arm insertion region, so every citation
// pinned above it (e.g. docs/ROADMAP.md → pre-tool.mjs:553) cannot drift inside this
// run. Byte-identical invocation with post-tool's comparison arm is the whole point
// of the shared module.
import { lintTarget, baselineKey, readBaselineMap, writeBaselineMap } from "./lib/lint-invocation.mjs";

// ============================================================================
// ZOdyssey ships with Bash GATED, mirroring the Edit/Write gate above. Write-capable Bash
// commands (sed -i, tee, >, cp/mv/rm, git apply/commit/restore/checkout, ln, tar/unzip,
// interpreter -e/--eval/-c, curl|sh, compilers, docker run, script indirection, etc. — see
// WRITE_PATTERNS) require review.verdict == OKAY AND must land in the plan's declared Files:
// scope (or .zcode/ bookkeeping). This closes the shell-escape bypass: without it an executor
// sub-agent could mutate files via `sed -i` / `>` / `git checkout --` before review passes, or
// outside the declared scope after it does — defeating the Edit gate by changing tools.
//
// DECISION TREE (first match wins; every other branch BLOCKS):
//   1. Read-only Bash (no write-capable construct)           -> allow, any phase.
//      looksReadOnly is conservative: when in doubt it returns false -> fall through.
//   2. Trusted recorder-script invoke (node <odyssey-scripts/...>) -> allow, any phase.
//      These implement the review/phase/todo machinery and write .zcode/{state,plans}/
//      bookkeeping; blocking them would deadlock the run itself. Strict allowlist (see
//      isTrustedScriptInvoke): the node operand must realpath INSIDE skills/odyssey/scripts/
//      AND the command must contain NO shell metacharacters. Fail closed on both.
//   3. Any other write-capable Bash command:
//      a. state.review.verdict != OKAY                       -> BLOCK (review gate).
//      b. verdict OKAY: re-hash the plan against state.review.plan_sha256 (SEC-4 tamper
//         guard) — drift -> BLOCK. Then parse write-targets (bashWriteTargets):
//         - confident == false OR targets empty              -> BLOCK (fail closed; the
//           command is write-capable but scope is unverifiable — e.g. make/gcc/docker run/
//           patch/ed, or an unparseable explicit-target form).
//         - For each target: quickClassify; bookkeeping -> ok, else must be in
//           declaredScopeForRun(state).declared (FAIL CLOSED on empty/missing plan,
//           mirroring the Edit scope gate). ANY target out of scope -> BLOCK.
//         - All targets in-scope/bookkeeping                  -> allow.
//
// PLAN-TAMPER GUARD (mirrors SEC-4 on the Edit path): the plan is agent-writable
// (.zcode/plans/ is bookkeeping), so once a verdict is bound to a plan-sha we re-hash the
// on-disk plan and BLOCK on drift. Without this, Bash is the bypass: write the plan to add a
// file to Files:, then `sed -i` that file — all post-OKAY, all "in scope" of the tampered plan.
//
// POWER-USER ESCAPE HATCH: set ZODYSSEY_UNGATE_BASH=1 to bypass this gate entirely (all Bash
// calls pass regardless of verdict/scope). This is the original author's personal setup; it is
// OPT-IN and off by default. Edit/Write tools remain gated either way. Know the tradeoff:
// ungated Bash lets any agent mutate ANY file via shell regardless of review or declared scope.
//
// Item 04 (2026-08-18): the hatch still opens, but it is no longer SILENT. Both historical gate
// deletions (v0.1.1, v0.2.0) were caused by this variable's ambient presence going unnoticed —
// the silence was the failure mode, never the openness. Every call that walks through this exit
// now appends one JSON line {at, command} to .zcode/state/<slug>.ungated.jsonl, counted as
// ungated_bash_calls by run-report.mjs. The .jsonl suffix keeps run discovery — which matches
// *.json — from ever loading it as state. Recording is unconditional (read-only calls included:
// filtering by write-capability would re-run the gate analysis the hatch exists to skip) and
// best-effort BY DESIGN — the one place in this repo where fail-open is correct, because the
// operator has explicitly disabled enforcement and a recording failure must not silently re-gate
// the call they ungated. Degrades to one stderr line; exit 0 regardless.
function recordUngatedBash(cmd) {
  try {
    appendFileSync(join(RUN_STATE_DIR, `${state.slug}.ungated.jsonl`),
      JSON.stringify({ at: new Date().toISOString(), command: cmd }) + "\n");
  } catch (e) {
    process.stderr.write(`ZOdyssey: WARNING — ungated Bash call passed but was NOT recorded (ledger ${state.slug}.ungated.jsonl: ${(e && e.message || String(e)).slice(0, 120)}). This is a witness failure, not a block.\n`);
  }
}
if (isBash && process.env.ZODYSSEY_UNGATE_BASH === "1") { recordUngatedBash(typeof toolInput.command === "string" ? toolInput.command : ""); exit(0); }

// Trusted-script allowlist for the recorder machinery (G1 + SEC-H3). Returns true ONLY for a
// `node <path-under-skills/odyssey/scripts/>` invocation with no shell metacharacters. Any
// metachar (; & | ` $ < > ( ) — command separators, pipes, command-sub, redirection, subshell)
// -> NOT trusted, because it could chain a second, un-vetted command. realpath containment
// (NOT a string prefix) defeats `node scripts/../hooks/evil.mjs` path-traversal. Fail closed on
// any doubt (missing file, unreadable, outside the scripts dir, non-node command word).
// SELF-RELATIVE, single source. This hook always lives at
// <install-root>/skills/odyssey/hooks/pre-tool.mjs, so the recorder scripts are always
// ../scripts. Layout-independent by construction: a repo checkout, the pre-v0.3.0
// ~/.zcode/skills/ install, and the plugin cache
// (~/.zcode/cli/plugins/cache/<marketplace>/zodyssey/<version>/) all resolve correctly, and any future
// relocation keeps working because the plugin ships hooks/ and scripts/ together.
//
// TWO GUESSES DELIBERATELY REMOVED (2026-08-11):
//   join(PROJECT_DIR, "skills/odyssey/scripts")  — PROJECT_DIR is the USER'S repo, i.e.
//     attacker-controlled content. A hostile repo shipping skills/odyssey/scripts/evil.mjs
//     would have had that script allowlisted straight past the Bash gate. Trusting a path
//     inside the audited repo to decide what bypasses the audit is backwards.
//   join(HOME, ".zcode/skills/odyssey/scripts")  — the pre-v0.3.0 install location. Under
//     v0.3.0's plugin-cache layout it no longer exists, and a stale copy left there from an
//     older install would be trusted over the running one.
// Both were unreachable anyway once the self-relative path resolves (it always does — this
// very file proves the directory exists), so removing them costs nothing and closes the hole.
const SCRIPTS_DIR = pathResolve(new URL(".", import.meta.url).pathname, "..", "scripts");
// Quote-aware metacharacter scan for the trusted-script allowlist. Returns false (untrusted) on
// anything the SHELL could act on to start a second command, substitute output, or redirect.
// Deliberately conservative: any doubt returns false, and it is only ever used to GRANT trust to
// an already-narrow form (`node <path-inside-scripts-dir> ...`).
function shellSafeForTrustedInvoke(cmd) {
  if (typeof cmd !== "string" || !cmd) return false;
  let quote = null; // null | "'" | '"'
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    // SEC (audit C1): any control char (newline/CR/tab/…) is untrusted. The operand regex below
    // only inspects the first line, so `node <script>\n<second-command>` would otherwise pass the
    // scan and the shell would run the second command ungated. Reject the whole class up front —
    // a trusted `node <script> <args>` invoke never legitimately contains a control character.
    if (c.charCodeAt(0) < 0x20) return false;
    if (c === "\\" && quote !== "'") { i++; continue; } // escaped char (not special inside '')
    if (quote === null) {
      if (c === "'" || c === '"') { quote = c; continue; }
      if (";&|`$<>()".includes(c)) return false;          // live metacharacter
    } else if (quote === '"') {
      if (c === '"') { quote = null; continue; }
      if (c === "$" || c === "`") return false;            // expansion / substitution inside ""
    } else { // inside '' — nothing is special except the closing quote
      if (c === "'") { quote = null; continue; }
    }
  }
  return quote === null; // unterminated quote → untrusted
}

// (audit F1, 2026-08-25) Env-assignment prefixes that hijack the trusted node process before the
// script runs: NODE_OPTIONS accepts --require/--import (attacker JS preload), NODE_PATH redirects
// module resolution, LD_*/DYLD_* inject shared objects, PYTHON*/PERL*/RUBY* reach other
// interpreters, and BASH_ENV/ENV/SHELLOPTS steer any shell the script spawns. A prefix carrying
// one of these keys is refused outright — it must never reach the strip below, where it would
// become invisible to the command-word scan. Benign prefixes (FOO=bar node …) stay allowed.
const ENV_INJECT_KEYS = new Set([
  "NODE_OPTIONS", "NODE_PATH",
  "LD_PRELOAD", "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH",
  "PYTHONPATH", "PYTHONHOME", "PERL5OPT", "RUBYOPT", "GEM_HOME",
  "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS",
]);
function isTrustedScriptInvoke(cmd) {
  if (!SCRIPTS_DIR) return false;
  // Metacharacters are dangerous where the SHELL will act on them — not where they are quoted
  // data. The original rule tested the whole string, so a metachar inside a quoted argument
  // rejected the invoke even though the shell would never interpret it.
  //
  // Shakedown round 3 paid for that: `record-verify.mjs --criterion "node -e 'process.exit(0)'"`
  // was blocked because of the parens INSIDE the criterion. The tester could record only 1 of 4
  // acceptance criteria, so the run reached `done` with acceptance {pass:false, criteria_run:1,
  // criteria_declared:4}. A hook rule meant to protect the evidence chain was degrading it, and it
  // silently rules out every criterion containing (), $, quotes — a large share of real ones.
  //
  // The rule now follows actual shell quoting semantics:
  //   · unquoted      — every metachar is live: ; & | ` $ < > ( )
  //   · double quotes — only $ and ` are live (command substitution / expansion). ( ) ; & | < >
  //                     are literal characters there, and cannot start a second command.
  //   · single quotes — nothing is live.
  // Backslash escapes are honoured outside single quotes. An unterminated quote is untrusted:
  // the shell would consume the following text in ways this scan cannot predict.
  if (!shellSafeForTrustedInvoke(cmd)) return false;
  // Env-prefix injection gate (audit F1, 2026-08-25) — see ENV_INJECT_KEYS above.
  const envPrefix = cmd.match(/^\s*((?:[A-Za-z_]\w*=\S+\s+)+)/);
  if (envPrefix) {
    const keys = [...envPrefix[1].matchAll(/([A-Za-z_]\w*)=/g)].map((m) => m[1]);
    if (keys.some((k) => ENV_INJECT_KEYS.has(k))) return false;
  }
  // Strip a leading env-var assignment prefix (FOO=bar node ...) so the command-word scan sees node.
  const stripped = cmd.replace(/^\s*(?:[A-Za-z_]\w*=\S*\s+)*/, "");
  // Must START with `node` (optional flags) then a single positional operand. Anchoring ^node
  // defeats both `echo node ...` (node is an arg) and `mynode ...` (different command word).
  const m = stripped.match(/^node(?:\s+[-\w]+)*\s+(\S+)/);
  if (!m) return false;
  const operand = m[1].replace(/^['"]|['"]$/g, "");
  // A bare basename is anchored in SCRIPTS_DIR; anything with a slash is resolved relative to
  // PROJECT_DIR (so `node ./scripts/x.mjs` from the repo resolves consistently).
  const start = (!operand.includes(sep) && !operand.includes("/"))
    ? join(SCRIPTS_DIR, operand)
    : pathResolve(PROJECT_DIR, operand);
  // realpath containment test (defeats ../ traversal and symlink escape). If the file doesn't
  // exist yet we can't canonicalize it -> NOT trusted (fail closed).
  let candidate;
  try { candidate = realpathSync.native(start); } catch { return false; }
  const prefix = SCRIPTS_DIR + sep;
  return candidate === SCRIPTS_DIR || candidate.startsWith(prefix);
}

if (isBash) {
  const cmd = typeof toolInput.command === "string" ? toolInput.command : "";

  // (1) Read-only Bash is always allowed, in any phase (ls, cat, grep, git status, npm test, etc.).
  //     looksReadOnly is conservative — when in doubt it returns false and we fall through to (2)/(3).
  if (looksReadOnly(cmd)) exit(0);

  // (2) Trusted recorder-script invoke (the review/phase/todo machinery). Must run pre-OKAY or
  //     the run cannot progress: record-review writes the verdict, set-phase advances phases,
  //     record-todo updates the active-todo map. Strict allowlist — see isTrustedScriptInvoke.
  if (isTrustedScriptInvoke(cmd)) exit(0);

  // (3) Everything else is a write-capable Bash command. Apply the SAME gates as Edit/Write:
  //     review verdict, then plan-sha tamper guard, then per-target scope check.
  if (state.review?.verdict !== "OKAY") {
    block(
      `write-capable Bash command is blocked until the plan passes review ` +
        `(current verdict: ${state.review?.verdict ?? "none"}, round ${state.review?.round ?? 0}/${state.review?.max_rounds ?? 3}). ` +
        `Command: ${cmd.slice(0, 120)}${cmd.length > 120 ? "..." : ""}. Complete the review phase first, or use a read-only command. (slug=${state.slug})`
    );
  }

  // Derive the run's repo root (mirrors classifyTarget lines 522-524): RUN_STATE_DIR is
  // .../.zcode/state -> up two levels is the repo root containing .zcode.
  const runRepo = RUN_STATE_DIR ? pathResolve(pathResolve(RUN_STATE_DIR, ".."), "..") : PROJECT_DIR;
  // I3 (audit 2026-08-20): plan_path is contained against the PER-CALL run's repo via the
  // shared plan-path.mjs resolver. A plan_path pointing into another repo must block here —
  // never be read, never hash a foreign plan, never quote its filenames.
  const { planPath, violation } = resolvePlanPath(state, runRepo);
  if (violation) {
    block(
      `SCOPE VIOLATION (Bash, plan isolation): ${violation}. ` +
      `Cannot verify the write targets of: ${cmd.slice(0, 120)}${cmd.length > 120 ? "..." : ""}. ` +
      `Fix state.plan_path or re-scaffold. (slug=${state.slug})`
    );
  }

  // PLAN-TAMPER GUARD (SEC-4 mirror — see block comment above). Re-hash the on-disk plan against
  // the sha bound to this OKAY verdict. Unreadable plan or sha drift -> BLOCK (fail closed).
  const boundSha = state.review && state.review.plan_sha256;
  if (boundSha) {
    let planText;
    try { planText = readFileSync(planPath, "utf8"); }
    catch (e) {
      block(
        `SCOPE VIOLATION (Bash): plan could not be read at ${planPath} — cannot verify the write targets of: ${cmd.slice(0, 120)}. ` +
          `Fix the plan path/permissions or re-scaffold. (slug=${state.slug}, error: ${e && (e.code || e.message) ? (e.code || e.message) : "unknown"})`
      );
    }
    const diskSha = createHash("sha256").update(planText).digest("hex");
    if (diskSha !== boundSha) {
      block(
        `PLAN TAMPERED (Bash): the on-disk plan (${planPath}) no longer matches the plan-sha bound to ` +
          `the OKAY verdict (expected ${boundSha.slice(0, 12)}, got ${diskSha.slice(0, 12)}). ` +
          `.zcode/plans/ is writable, so scope must be re-authorized by re-running momus + record-review ` +
          `(which re-binds the sha). (slug=${state.slug})`
      );
    }
  }

  // Extract best-effort write targets. FAIL CLOSED when scope is unverifiable:
  //   - confident=false: write-capable with an un-parseable explicit-target form (sed -i with no
  //     file, git checkout with no path).
  //   - targets empty: write-capable via a construct bashWriteTargets does not extract targets
  //     from at all (make, gcc, docker run, patch, ed, tar -x, ln, …). These can write to ANY
  //     path, so allowing them post-OKAY with no scope check IS the SEC-H5 isolation failure.
  // Both cases -> BLOCK; ask for an explicit-target form or the (scope-checked) Edit/Write tool.
  const { targets, confident } = bashWriteTargets(cmd);
  if (!confident || targets.length === 0) {
    block(
      `SCOPE VIOLATION (Bash): write-capable command has no parseable, in-scope write target — cannot verify it stays in the declared scope. ` +
        `Use an explicit-target form (\`sed -i ... FILE\`, \`cmd > FILE\`, \`cp src dst\`, \`git checkout -- FILE\`) or the Edit/Write tool (which is scope-checked directly). ` +
        `Command: ${cmd.slice(0, 120)}${cmd.length > 120 ? "..." : ""}. (slug=${state.slug})`
    );
  }

  // Resolve + classify each target. Bookkeeping targets (.zcode/plans/, .zcode/notepads/) are
  // always fine; every other target must be in the declared Files: scope. declaredScopeForRun
  // returns declared.size===0 on plan read failure -> nothing is in scope -> BLOCK (fail closed).
  const { declared } = declaredScopeForRun(state, runRepo);
  for (const t of targets) {
    let abs;
    try {
      abs = realpathSync.native(pathResolve(PROJECT_DIR, t));
    } catch {
      // Target doesn't exist yet (e.g. `cmd > newfile`). Fall back to lexical resolve so we can
      // still classify it; quickClassify's prefix test catches ../ escape lexically too.
      abs = pathResolve(PROJECT_DIR, t);
    }
    const { rel, bookkeeping, isState } = quickClassify(abs, runRepo);

    // HIGH T1-5, Bash path. State is written ONLY by the trusted writers, which bind their writes
    // to hook-minted evidence. This check must come BEFORE the scope gate, because the bypass is
    // precisely that a plan declaring `.zcode/state/t.json` in Files: puts it IN declared scope —
    // so the scope gate passes it and, until now, nothing else looked. Trusted-writer invocations
    // never reach here: isTrustedScriptInvoke returns earlier.
    if (isState) {
      block(
        `run state is not directly writable: this command would modify ${rel}, which holds the ` +
          `review verdict, phase and acceptance records — exactly what the gate reads to decide ` +
          `whether to allow anything. Declaring it in the plan's Files: does not make it writable. ` +
          `Use the trusted writers (record-review / set-phase / record-todo / record-verify). ` +
          `Command: ${cmd.slice(0, 120)}${cmd.length > 120 ? "..." : ""}. (slug=${state.slug})`
      );
    }

    if (bookkeeping) {
      // HIGH T1-2/T1-6 (audit 2026-08-14): "bookkeeping is always writable" was true for the Write
      // tool only because the Write path applies its own guards first. The Bash path skipped them
      // entirely, so `echo x > notepad.md` clobbered evidence the final wave reads, and
      // `echo x > plan.md` rewrote the plan's Files: — the tamper guard only notices on the NEXT
      // gated call, by which time the command has already run. Mirror both Edit/Write guards here.
      const isNotepad = typeof rel === "string" && rel.startsWith(".zcode/notepads/");
      const isPlan = typeof rel === "string" && rel.startsWith(".zcode/plans/");
      // Append is the INTENDED way to grow a notepad (the Edit tool is allowed on the Write path
      // for exactly this reason), so only clobber-shaped writes are blocked. Recognise `>> tok`
      // and `tee -a`; anything else touching an existing notepad is treated as a replace.
      const tokRe = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const isAppend = new RegExp(`>>\\s*['"]?${tokRe}`).test(cmd) ||
        /\btee\s+(?:-\w+\s+)*-a\b/.test(cmd) || /\btee\s+-\w*a/.test(cmd);
      if (isNotepad && existsSync(abs) && !isAppend) {
        block(
          `notepads are APPEND-ONLY: this command would replace ${rel} wholesale, destroying evidence ` +
            `the final wave (F1-F4) reads. Append instead (\`>>\`), use the Edit tool, or write a new ` +
            `notepad file. Command: ${cmd.slice(0, 120)}${cmd.length > 120 ? "..." : ""}. (slug=${state.slug})`
        );
      }
      if (isPlan && state.review?.verdict === "OKAY") {
        block(
          `the plan is FROZEN after review: this command would rewrite ${rel}, which is what the ` +
            `review verdict is bound to (plan_sha256). Changing the plan post-OKAY re-scopes the run ` +
            `without re-review. Send it back to the planner and re-review instead. ` +
            `Command: ${cmd.slice(0, 120)}${cmd.length > 120 ? "..." : ""}. (slug=${state.slug})`
        );
      }
      continue; // otherwise bookkeeping stays freely writable
    }
    // HIGH T1-4: B5 test-freeze was enforced on the Edit path only (TEST_PATH_RE had exactly one
    // use, at the Edit branch), so `sed -i` on a test file in verify/final sailed through. Same
    // ImpossibleBench rationale: weakening a failing test is the cheapest way to turn it green.
    if ((state.phase === "verify" || state.phase === "final") && typeof rel === "string" && TEST_PATH_RE.test(rel)) {
      block(
        `test files are FROZEN in phase=${state.phase}: this command would modify ${rel}. ` +
          `Acceptance criteria are being evaluated against the tests as written — fix the code, not the test. ` +
          `Command: ${cmd.slice(0, 120)}${cmd.length > 120 ? "..." : ""}. (slug=${state.slug})`
      );
    }
    // Same inScope test as the Edit gate (exact match, or either contains the other as a dir).
    const inScope = declared.size > 0 &&
      [...declared].some((d) => rel === d || rel.startsWith(d + "/") || d.startsWith(rel + "/"));
    if (!inScope) {
      const tail = declared.size > 0
        ? `declared: ${[...declared].slice(0, 5).join(", ")}${declared.size > 5 ? "..." : ""}`
        : `plan declares NO editable files (Files: is empty/absent) — add the target to the plan's Files: list and re-review`;
      block(
        `SCOPE VIOLATION (Bash): write target ${t}${rel && rel !== t ? ` (${rel})` : ""} is not in the plan's declared Files: scope and is not bookkeeping. ` +
          `The executor may only mutate files the plan declares (or .zcode/plans/, .zcode/notepads/). ` +
          `${tail}. Command: ${cmd.slice(0, 120)}${cmd.length > 120 ? "..." : ""}. (slug=${state.slug})`
      );
    }
  }
  // All targets in scope or bookkeeping — allow. (No file-lock acquisition for Bash: the
  // Edit-path lock is keyed on Edit-tool targets and is out of scope for this reconstruction.)
  exit(0);
}

if (isDispatch) {
  // Phase-gate (audit gap #4): DESIGN §6 says "dispatches only allowed in execute/verify/final",
  // but SKILL.md's consult/plan phases legitimately dispatch read-only research agents
  // (explore/librarian/oracle). So: block EXECUTOR dispatches (sisyphus-junior) outside the
  // execution phases, allow read-only research agents anywhere. This stops a runaway executor
  // during planning without breaking the documented consult-time research fan-out.
  // v0.3.0 namespacing normalization (SINGLE-SEAM FIX, safety-critical): the harness now passes
  // `subagent_type: "zodyssey:momus"` (namespaced form) on dispatch, but every downstream matcher
  // here is a bare-string comparison (`=== "momus"`, `=== "oracle"`, READONLY_AGENTS.has(...),
  // PLANNER_AGENTS.has(...)). Without this normalization a namespaced dispatch silently misses
  // every matcher → review nonce never minted → verdict unrecordable → full run deadlock (the
  // 2026-08-03 regression relived). Strip a leading `zodyssey:` prefix ONCE at extraction so all
  // existing matchers keep working byte-unchanged. Scoped to `zodyssey:` ONLY — must NOT strip
  // `feature-dev:` (external, e.g. `feature-dev:code-reviewer` at line ~881) or any other prefix.
  const _rawSubagent = toolInput.subagent_type || toolInput.agent_type || toolInput.type || "";
  const subagent = _rawSubagent.replace(/^zodyssey:/, "");
  // Class C fix (audit 2026-08-14): the nonce minters below matched by bare equality with a single
  // hard-coded `feature-dev:code-reviewer` special case, so ANY other namespace (someplugin:oracle,
  // a differently-packaged code-reviewer) minted NO nonce — and the failure is silent until the
  // final wave rejects the artifact, by which point the reviewer round has been spent. isAgent
  // compares the final name segment, which fixed that availability hole but over-corrected into
  // authority (item 03, 2026-08-17): a lookalike `evil:momus` minted a real nonce, because the
  // nonce lane consumed a ROUTING-grade matcher. Minting is now decided by EXACT dispatch type
  // against NONCE_MINTERS at every nonce-lane site; the minters and the round-cap twin below share
  // one Set, so they cannot disagree on what counts as the reviewer — the rule audit-3 finding 7
  // stated ("or the guard is decorative"), settled upward this time. isAgent survives only as the
  // near-miss detector that earns the warning. The extractor above normalizes `zodyssey:x` → `x`,
  // so one exact entry covers both canonical forms; `feature-dev:code-reviewer` stays its own
  // entry — a declared packaging, not a substring accident. sameName itself is untouched: the
  // phase gate (inSet above) and F5 capability matching keep their deliberate tolerance.
  const isAgent = (want) => sameName(want, subagent);
  const NONCE_MINTERS = {
    review: new Set(["momus"]),
    final_f2: new Set(["code-reviewer", "feature-dev:code-reviewer"]),
    final_f4: new Set(["oracle"]),
  };
  const isDeclaredMinter = (lane) => NONCE_MINTERS[lane].has(subagent);
  const READONLY_AGENTS = new Set([
    "explore", "librarian", "oracle", "metis", "momus", "multimodal-looker",
    "code-explorer", "code-architect", "code-reviewer", "feature-dev:code-explorer",
    "feature-dev:code-architect", "feature-dev:code-reviewer",
  ]);
  // Planner agents (G3): prometheus is markdown-only (DESIGN §2) and is re-dispatched by the
  // review-revise loop during plan/review — must be allowed there or the gate can't cycle.
  const PLANNER_AGENTS = new Set(["prometheus"]);
  const EXEC_PHASES = new Set(["execute", "verify", "final", "remediate"]);
  const PLANNING_PHASES = new Set(["plan", "review", "consult"]);

  // Class C, second site. These were `.has(subagent)` — bare-set membership with three hard-coded
  // `feature-dev:` entries, i.e. the same "exact match plus one special case" shape the nonce
  // minters had. It runs BEFORE the minters, so a third-party-namespaced read-only agent
  // (`someplugin:momus`) was blocked here as an "executor" and never reached the fixed minter at
  // all — the minter fix alone did not deliver the outcome. Found re-verifying against 0.4.1.
  //
  // This widens who counts as read-only to any packaging of a known read-only agent. That grants
  // no write capability: the phase gate governs DISPATCH only, and every file write the dispatched
  // agent then attempts goes through this same hook with the same scope and verdict gates.
  const inSet = (set) => [...set].some((member) => sameName(member, subagent));
  const isReadonlyAgent = inSet(READONLY_AGENTS);
  const isPlanner = inSet(PLANNER_AGENTS);
  if (!EXEC_PHASES.has(state.phase) && !isReadonlyAgent && !(isPlanner && PLANNING_PHASES.has(state.phase))) {
    block(
      `dispatch of ${subagent || "executor"} blocked in phase=${state.phase} ` +
        `(executors may only dispatch in execute/verify/final; planners in plan/review/consult). ` +
        `Read-only research agents are allowed in any phase. (slug=${state.slug})`
    );
  }

  // Parallel cap — bites in every executor-dispatch phase (execute, verify, final, remediate),
  // where worker dispatches fan out. (W6-minor: was `=== "execute"` only, so remediate/verify/final
  // were uncapped despite EXEC_PHASES listing them. audit gap #3: the model can't count itself
  // between tool calls in one turn, so the hook counts.)
  // SEC-1s (bounded-recursion guard, prime-agent backlog row #4, 2026-08-10): NEW ADDITIVE
  // dispatch-gate enforcement — a SIBLING to SEC-1 (the review-nonce dispatch gate), NOT SEC-7.
  // (SEC-7 = persistence/messaging/cron/daemon SURFACE per the prime-agent fit study taxonomy; this
  // is none of those.) Does NOT modify SEC-1..6's existing members.
  //
  // THREAT MODEL: ZOdyssey sub-agents physically CANNOT dispatch other Task() calls — the harness
  // grants the Task tool only to the orchestrator thread (VERIFIED 2026-08-02, agents/sisyphus-junior.md).
  // So the PRIMARY control is the harness tool-grant boundary. This guard is DEFENSE-IN-DEPTH against
  // the residual prompt-injection failure mode where a Task()'s own payload (prompt/message/description)
  // embeds a serialized nested tool invocation, attempting to coerce a downstream agent into emitting
  // a forged tool call. The orchestrator's legitimate dispatch payloads never contain a serialized
  // Task() invocation, so presence of one is a signature, not a false positive.
  //
  // WHAT THIS GUARD ACTUALLY DETECTS (honest, post-audit): a payload-PATTERN match against embedded
  // serialized tool invocations, NOT a real recursion-depth counter. ZODYSSEY_RECURSION_CAP is read
  // for use in the block message and reserved for a future depth counter if the harness ever exposes
  // parent-depth. The regex matches two shapes: the generic {"tool_name":"Task"/"tool":"Task"}
  // AND the Claude/ZCode-native {"type":"tool_use","name":"Task"}. Single-quote and
  // backslash-escaped variants still slip past — accepted as defense-in-depth.
  //
  // ORDERING (audit advisory #5): runs BEFORE the parallel-cap ledger push below, so a blocked
  // dispatch never consumes an in-flight slot (the prior ordering leaked a slot until TTL).
  //
  // Read-only research agents (explore/librarian/oracle/etc.) are EXEMPT — they may legitimately
  // be prompted with example Task() payloads while auditing or documenting the orchestrator.
  const RECURSION_CAP = (() => {
    const n = parseInt(env.ZODYSSEY_RECURSION_CAP || "1", 10);
    return Number.isInteger(n) && n > 0 ? n : 1;
  })();
  if (!isReadonlyAgent) {
    // Scan only attacker-controlled prose fields, NOT the whole toolInput (which legitimately
    // carries subagent_type/agent_type keys). Match either the generic JSON tool_name/tool spelling
    // OR the Claude/ZCode-native tool_use "name" spelling, allowing arbitrary whitespace.
    const _proseFields = ["prompt", "message", "description", "input", "task"];
    const _blob = _proseFields
      .map((f) => (toolInput[f] && typeof toolInput[f] === "string") ? toolInput[f] : "")
      .join("\n");
    const _NESTED_DISPATCH_RE = /(?:\"\s*tool(?:_name)?\s*\"\s*:\s*\"\s*(?:Task|Agent|dispatch_agent)\"|\"\s*type\"\s*:\s*\"\s*tool_use\"[^}]*?\"\s*name\"\s*:\s*\"\s*(?:Task|Agent|dispatch_agent)\")/i;
    if (_NESTED_DISPATCH_RE.test(_blob)) {
      block(
        `SEC-1s RECURSION GUARD (cap=${RECURSION_CAP}): blocked a Task() dispatch of ${subagent || "executor"} ` +
          `whose prompt/message payload embeds a serialized nested tool invocation (tool_name/tool=Task/Agent ` +
          `or Claude-native type=tool_use+name=Task). This guard is a PAYLOAD-PATTERN MATCH (defense-in-depth), ` +
          `NOT a real depth counter — the primary control is that sub-agents are not granted the Task tool by ` +
          `the harness. An embedded dispatch is a prompt-injection signature, not a legitimate call chain. ` +
          `Have the orchestrator rephrase the prompt without the embedded tool invocation. (slug=${state.slug})`
      );
    }
  }

  if (EXEC_PHASES.has(state.phase)) {
    const now = Date.now();
    let arr = pruneStale(readLedger(RUN_STATE_DIR, state.slug), now);
    if (arr.length >= CAP) {
      block(
        `parallel cap reached (${arr.length}/${CAP} in flight). ` +
          `Wait for in-flight todos to settle before dispatching more. (slug=${state.slug})`
      );
    }
    // Allowed — register this dispatch so subsequent calls in the same turn see it.
    const id =
      payload.tool_use_id ||
      `${toolName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    arr.push({ id, at: now });
    writeLedgerAtomic(RUN_STATE_DIR, state.slug, arr);
  }
  // W7-2 + CRIT-2: issue a one-time nonce for any review-bearing dispatch the hook observes, so
  // the resulting artifact is bound to a real Task() call (not forgeable from Bash). momus→review,
  // code-reviewer→F2, oracle→F4. The nonce lands in the matching state lane; the recorder script
  // (record-momus-artifact / record-final-wave) must present it to place a valid artifact.
  function mintNonceFor(field) {
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const statePath = join(RUN_STATE_DIR, `${state.slug}.json`);
    const lockPath = statePath + ".lock";
    const LOCK_STALE_MS = 60 * 1000;
    function acquireLock() {
      try { return openSync(lockPath, "wx"); } catch {
        try {
          if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
            unlinkSync(lockPath);
            try { return openSync(lockPath, "wx"); } catch { return null; }
          }
        } catch {}
        return null;
      }
    }
    const lockFd = acquireLock();
    if (lockFd === null) return;
    try {
      let fresh;
      try { fresh = JSON.parse(readFileSync(statePath, "utf8")); } catch { fresh = state; }
      fresh[field] = fresh[field] || {};
      fresh[field].pending_nonce = { nonce, at: new Date().toISOString() };
      fresh.updated_at = new Date().toISOString();
      const tmp = statePath + ".tmp." + process.pid;
      writeFileSync(tmp, JSON.stringify(fresh, null, 2) + "\n");
      renameSync(tmp, statePath);
      process.stderr.write(`ZOdyssey: ${subagent} dispatched — nonce ${nonce} written to state.${field}.pending_nonce. Pass it to the recorder script.\n`);
    } catch {} finally { try { closeSync(lockFd); unlinkSync(lockPath); } catch {} }
  }
  // Item 03 near-miss branch: a lookalike namespace (evil:momus, someplugin:oracle) still
  // DISPATCHES — read-only routing tolerance grants no authority, and every write the dispatched
  // agent attempts stays scope- and verdict-gated — but mints nothing, and is told so loudly at
  // dispatch time. That loudness is what lets this change keep the Class C availability fix without
  // its authority cost: a packaging mistake surfaces here, immediately, instead of as the silent
  // final-wave deadlock the tolerance was originally written to avoid.
  const warnNearMissMinter = (lane) => process.stderr.write(
    `ZOdyssey WARNING: dispatch type '${subagent}' resembles the ${lane} lane's reviewer but is ` +
    `not one of its declared exact minters (${[...NONCE_MINTERS[lane]].join(" / ")}) — no nonce ` +
    `minted, so no ${lane} artifact can be recorded from this dispatch. The dispatch itself is ` +
    `allowed; if this packaging is an intended reviewer, add it to NONCE_MINTERS in pre-tool.mjs. (slug=${state.slug})\n`
  );
  // REVIEW-ROUND RESIDUAL CAP (todo 13, 2026-08-10): record-review.mjs:168 ALREADY refuses an
  // OKAY verdict once round > max_rounds, so an accepted plan can never overrun the round budget.
  // The residual gap is the REJECT path: a REJECT at round >= max_rounds is recorded normally
  // (record-review has no max check on REJECT — by design, a "send back to planner" is always a
  // valid signal), and the orchestrator's REJECT-replan loop would then dispatch momus AGAIN for
  // round max+1, restarting a cycle the round budget was meant to terminate. Block that re-dispatch
  // HERE: once state.review.round has reached state.review.max_rounds, no further momus dispatch is
  // allowed — the situation must surface to the user rather than loop silently. This is the only
  // place a new review round can begin (record-review increments from a hook-witnessed momus run),
  // so gating the dispatch closes the loop. Non-momus dispatches are NOT affected. No-active-run
  // already exited at the top (AC3). Reads the same state.* fields record-review uses, so the two
  // agree on the cap.
  // AUDIT-3 FINDING 7: this was a bare `subagent === "momus"` while the nonce minter below uses
  // isAgent() (final-segment matching). So `evil:momus` skipped the round cap AND the pre-dispatch
  // lint here, then minted a review nonce down there — the same one-path-not-its-twin shape this
  // release was written to hunt, left in the file by the release that hunted it. Bounded in impact
  // (record-review enforces the cap independently), but the two sites must agree on what counts as
  // momus or the guard is decorative. Item 03 settles the agreement upward: this twin and the
  // minter below share NONCE_MINTERS, so a lookalike is neither capped, nor linted, nor minted —
  // it is simply not the reviewer.
  if (isDeclaredMinter("review")) {
    const _rr = (state.review && typeof state.review === "object") ? state.review : {};
    const _round = Number.isFinite(_rr.round) ? _rr.round : 0;
    const _max = Number.isFinite(_rr.max_rounds) ? _rr.max_rounds : 3;
    if (_round >= _max) {
      block(
        `review round ${_round} has reached max_rounds ${_max} — surface to user; the REJECT-replan loop cannot continue. ` +
          `record-review.mjs already caps the OKAY path; this blocks the residual where a REJECT at the round budget would otherwise trigger another momus cycle. ` +
          `(slug=${state.slug})`
      );
    }

    // LINT BEFORE THE DISPATCH, NOT AFTER (2026-08-12, shakedown round 3).
    //
    // record-review.mjs gates OKAY on a clean `parse-plan --lint`, but the lint ran at the END of
    // the review — after momus had been dispatched, read the plan, and returned a verdict. Round 3
    // hit it: momus approved, record-review rejected the plan on criteria that were not executable
    // commands, the plan had to be rewritten, which changed the plan-sha, which invalidated the
    // review, which required dispatching momus AGAIN. A whole review round spent discovering
    // something a parser knew before it started.
    //
    // Checking here costs one fast subprocess on a rare call and converts a wasted agent round
    // into an immediate, specific error. Fails OPEN: if the lint cannot be run at all (missing
    // plan, parser error, timeout) the dispatch proceeds, because this is an ergonomic guard and
    // record-review still enforces the real gate.
    try {
      // I3: resolve through the shared helper. On a plan_path violation the lint is SKIPPED
      // (this guard fails open by design; record-review.mjs hard-exits on the violation), so
      // no foreign plan bytes are ever parsed or quoted into a block message here.
      const runRepo = RUN_STATE_DIR ? pathResolve(pathResolve(RUN_STATE_DIR, ".."), "..") : PROJECT_DIR;
      const { planPath, violation } = resolvePlanPath(state, runRepo);
      if (!violation && existsSync(planPath)) {
        const r = spawnSync(process.execPath, [PARSE_PLAN_PATH, planPath, "--lint"],
          { encoding: "utf8", timeout: 10000 });
        if (r.status === 6) {
          let problems = [];
          try { problems = (JSON.parse(r.stdout || "{}").problems || []); } catch {}
          const lines = problems.slice(0, 6).map((p) =>
            `    - todo ${p.todo}${p.criterion_index ? ` criterion ${p.criterion_index}` : ""}: ${p.issue}`);
          block(
            `the plan does not pass \`parse-plan --lint\`, so record-review would REJECT this verdict even if momus approves it.\n` +
            `  Fix the plan first — dispatching momus now spends a review round to learn something the parser already knows,\n` +
            `  and the fix changes the plan-sha, which invalidates the review anyway.\n` +
            (lines.length ? `  Problems:\n${lines.join("\n")}\n` : "") +
            `  Re-check with: node ${PARSE_PLAN_PATH} ${planPath} --lint   (slug=${state.slug})`
          );
        }
      }
    } catch { /* lint unavailable → let the dispatch through; record-review still gates OKAY */ }
  }
  // BUG FIX 2026-08-03 (run upgrade-lifecycle-validation on IMS): the phase condition here
  // deadlocked runs where momus was dispatched while state.phase was still "plan" (e.g. when no
  // prometheus agent exists and the orchestrator writes the plan directly, skipping the plan→review
  // transition). momus ∈ READONLY_AGENTS permits the dispatch in any phase, but this mint was gated
  // on phase==="review" — so the dispatch succeeded, momus returned a genuine verdict, and no nonce
  // was ever minted → record-momus-artifact exit 6 → verdict unrecordable → full run deadlock with
  // no in-run recovery. The phase was never a security boundary: non-forgeability only needs the
  // nonce bound to a real, hook-witnessed dispatch. Drop the phase condition; keep a loud warning
  // so a dispatch in the wrong phase is visible rather than silently accepted.
  if (isDeclaredMinter("review")) {
    if (state.phase !== "review") {
      process.stderr.write(
        `ZOdyssey WARNING: momus dispatched in phase=${state.phase} (expected "review") — nonce minted anyway so the verdict is recordable, but the phase was not transitioned. Run 'node ${SET_PHASE_PATH} <repo> <slug> review' to reconcile, or the recorded verdict will not auto-advance to execute.\n`
      );
    }
    mintNonceFor("review");
  } else if (isAgent("momus")) {
    warnNearMissMinter("review");
  }
  if (isDeclaredMinter("final_f2")) {
    if (state.phase !== "final") {
      process.stderr.write(
        `ZOdyssey WARNING: code-reviewer dispatched in phase=${state.phase} (expected "final" for F2) — nonce minted anyway; reconcile the phase if this was not intended.\n`
      );
    }
    mintNonceFor("final_f2");
  } else if (isAgent("code-reviewer")) {
    warnNearMissMinter("final_f2");
  }
  if (isDeclaredMinter("final_f4")) {
    if (state.phase !== "final") {
      process.stderr.write(
        `ZOdyssey WARNING: oracle dispatched in phase=${state.phase} (expected "final" for F4) — nonce minted anyway; reconcile the phase if this was not intended.\n`
      );
    }
    mintNonceFor("final_f4");
  } else if (isAgent("oracle")) {
    warnNearMissMinter("final_f4");
  }
  exit(0);
}

// SEC (audit H3): the gate natively classifies only Write/Edit/…/Bash/Task. Every OTHER tool —
// all mcp__* tools and any unknown write-capable tool — otherwise reaches this exit(0) ungated. A
// local-filesystem MCP could rewrite the gate itself, or forge a verdict, with NONE of the gates
// firing. Protect the enforcement surface — a closed set — from any non-native tool: the plugin's
// enforcement subtree, the host hook registry, this run's .zcode/state and .zcode/reviews.
// (Native Edit/Bash writes there are already gated by verdict+scope above; the trusted-writer
// scripts reach these dirs only through the Bash allowlist. A read-only MCP that never names those
// paths is unaffected — this is a targeted forge-surface guard, not a blanket MCP block.)
if (!isEdit && !isBash && !isDispatch) {
  try {
    // Class B fix (audit 2026-08-14): this guard — added in v0.4.1 to close the MCP write hole —
    // had the same defect it was written to close. `protectedDirs` came from a pathResolve'd
    // RUN_STATE_DIR and the candidate below was pathResolve'd with no realpath at all, so a
    // symlinked path (or one an MCP server resolves against its own cwd) walked straight past.
    // containedIn normalizes both sides.
    const runRepo = resolvePath(pathResolve(RUN_STATE_DIR, "..", ".."));
    // Item 16: the two run dirs below were the whole set until the Edit twin (item 01) and the
    // Bash twin closed — right when written (v0.4.1: Edit and Bash were the load-bearing
    // writers), the weak link once the neighbours were fixed. Complete the set to the full
    // enforcement surface.
    // The install root is derived self-relative exactly the way SCRIPTS_DIR is: this hook lives
    // at <install-root>/skills/odyssey/hooks/, so the root is three levels above SCRIPTS_DIR —
    // layout-independent by construction, and nothing inside the audited repo is trusted to
    // derive it. (Computed here, beside its only use, rather than up beside SCRIPTS_DIR: same
    // value, but a module-scope insertion would shift the ~50 pinned citations above this
    // point for no functional gain.)
    // But the ROOT itself is not the boundary. In a dev checkout the plugin root IS the user's
    // repo, and the first cut of this fix — protecting the whole root — blocked every MCP write
    // into that repo, declared files and ordinary docs included: exactly the availability
    // regression the closed-set design exists to avoid. No suite fixture could catch it (every
    // fixture ran the real install's hook against a fresh mkdtemp PROJECT_DIR, so installRoot
    // and PROJECT_DIR were disjoint by construction; the scope suite now ships a dogfood-
    // topology fixture that runs a copy of the hook from inside the temp repo). Draw the
    // boundary at the enforcement subtree instead:
    //   · skills/odyssey/ — the conductor SKILL.md, hooks/, the trusted scripts, and
    //     references/ (momus-prompt.md and auditor-prompt.md shape verdicts; prompts are
    //     enforcement, the T4-4 principle). Nothing ordinary lives under it.
    //   · agents/, commands/ — sub-agent prompts and slash-command definitions (T4-4 again).
    //   · .zcode-plugin/ — the manifest that declares which hooks run at all.
    // docs/, README.md, CHANGELOG.md and any user work inside a checkout stay ordinary.
    const installRoot = pathResolve(SCRIPTS_DIR, "..", "..", "..");
    const enforcementDirs = [
      join(installRoot, "skills", "odyssey"),
      join(installRoot, "agents"),
      join(installRoot, "commands"),
      join(installRoot, ".zcode-plugin"),
    ];
    // The host hook registry — the file the host reads to decide which hooks run at all. Not
    // derivable from this file's location (it belongs to the host, not the plugin), so it is a
    // named constant with the reason stated here. Precisely the file, not the ~/.zcode/cli
    // directory: session transcripts, rollout logs, and the plugin caches share that directory
    // and must stay unaffected. env.HOME follows the repo's existing idiom; no HOME means no
    // registry to protect, and the empty string is filtered out below.
    const HOST_HOOK_REGISTRY = env.HOME ? join(env.HOME, ".zcode", "cli", "config.json") : "";
    // I2 + oracle-r1 blocker 1: protection must NOT derive from the per-call selection. That
    // selection is steerable by the very payload this guard defends against (deepest-enclosing
    // + recency is attacker-determined whenever a sibling run's root is longer or nested), so a
    // decoy path under project-b alongside a write target in project-a would otherwise leave a's
    // state undefended while the write proceeds. Protect the UNION of ALL discovered active
    // runs' .zcode/state + .zcode/reviews — the same DISCOVERED_RUNS list per-call selection
    // used, so no extra scan (on find-cache hits that is the cached list, which is why the
    // cache's TTL bound above is load-bearing here too). Zero availability cost: no sanctioned
    // non-native writer targets ANY run's state. runRepo above stays the base for resolving
    // RELATIVE payload strings below — normalization only, never the protection set. Pinned by
    // the DECOY case in pre-tool.project-isolation.test.mjs.
    const runProtected = [];
    for (const _r of DISCOVERED_RUNS) {
      const _root = pathResolve(_r.stateDir, "..", "..");
      runProtected.push(join(_root, ".zcode", "state"), join(_root, ".zcode", "reviews"));
    }
    const protectedDirs = [
      ...new Set(runProtected),
      ...enforcementDirs,
      HOST_HOOK_REGISTRY,
    ].filter(Boolean);
    const strings = [];
    (function collect(v, depth) {
      if (depth > 4 || v == null || strings.length > 200) return;
      if (typeof v === "string") { strings.push(v); return; }
      if (Array.isArray(v)) { for (const x of v) collect(x, depth + 1); return; }
      if (typeof v === "object") { for (const k of Object.keys(v)) collect(v[k], depth + 1); }
    })(toolInput, 0);
    for (const s of strings) {
      if (typeof s !== "string" || s.length > 4096) continue;
      if (!s.includes("/") && !s.includes(sep)) continue; // not path-shaped
      for (const d of protectedDirs) {
        // containedIn realpaths both sides, so a symlinked repo root or a symlinked .zcode no
        // longer slips past. Relative strings resolve against the run's repo, not the caller's cwd.
        if (containedIn(pathResolve(runRepo, s), d)) {
          block(
            `tool ${toolName} targets the enforcement surface (${s.slice(0, 120)}). The plugin's ` +
              `enforcement dirs, the host hook registry, and this run's .zcode/state + .zcode/reviews are ` +
              `reserved for the trusted machinery — a ` +
              `${toolName.startsWith("mcp__") ? "MCP" : "non-native"} tool cannot write there from ` +
              `inside a run. (slug=${state.slug})`
          );
        }
      }
    }
  } catch { /* best-effort guard; never crash the hook on a weird tool_input shape */ }
}

exit(0); // any other tool: pass

