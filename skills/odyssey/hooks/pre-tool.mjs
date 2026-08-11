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

import { readFileSync, readdirSync, existsSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, statSync } from "node:fs";
import { join, dirname, resolve as pathResolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { exit, env } from "node:process";
import { createHash } from "node:crypto";
import { findActiveRuns, selectByTarget } from "./lib/find-run.mjs";

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
const FD_DUP = /\d*>&\d/; // 2>&1, 1>&2, etc. — fd duplication, NOT a file write
const WRITE_PATTERNS = [
  // Redirection to a file. Strip fd-duplication first so `2>&1`/`1>&2` don't false-trip, then
  // match `> f`/`>f`/`>> f` that write to a real target.
  (cmd) => /(^|[\s;&|])\S+(\.\w+)?\s*>>?\s*\S/.test(cmd.replace(FD_DUP, " ")),
  /\btee\b/,
  /\bsed\s+[^&;\n]*-i\b/, // sed -i (in-place)
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
  /\b(?:mv|cp|rm|install|truncate|chmod|chown|mkdir|cpio)\b/,
  /\bln\b/, // SEC-2: hard/symlinks — `ln src dst` places a file under dst (the reviews/ attack)
  /\b(?:tar|unzip|zip|7z|7za|gzip|gunzip|zstd|unzstd|xz|unxz|bz2|bunzip2)\b/, // SEC-2: archive extract/write
  /\brsync\b/, // SEC-2: rsync copies files into arbitrary paths
  /\bmake\b/, // SEC-2: arbitrary build output
  /\b(?:gcc|g\+\+|cc|clang|clang\+\+|rustc|cargo|go\s+build|go\s+install)\b/, // SEC-2: compilers emit binaries
  /\bdocker\s+run\b/, // SEC-2: -v bind-mount writes; gate the whole verb (conservative)
  // interpreter eval flags (NOT just -c): -c, -e, --eval, -pi. node's is -e/--eval.
  /\b(?:python|python3|node|ruby|perl)\s+(?:-[ce]|--eval|--exec|-[pi]\w*)\b/,
  // script indirection: running ANY file via an interpreter can do anything the interpreter can.
  // W7-3: extension-INDEPENDENT (the old pattern required .mjs/.sh/etc, so an extensionless
  // file under agent-writable notepads/ bypassed the gate). Match a positional operand unless
  // it starts with - (a flag) — the trusted-script allowlist (isTrustedScriptInvoke) handles
  // the sanctioned node <odyssey-script> case separately.
  /\b(?:node|bash|sh|zsh|python|python3|ruby|perl)\s+(?!-)\S+/,
  /\bcurl\b[^&;\n]*\|\s*(?:sh|bash|zsh)\b/,
  /\bwget\b[^&;\n]*\|\s*(?:sh|bash|zsh)\b/,
  /\binstall\s+-m\b/,
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
  // 2. tee FILE
  for (const m of clean.matchAll(/\btee(?:\s+-\w+)*\s+(\S+)/g)) targets.push(m[1]);
  // 3. sed -i / awk -i inplace: the file is the trailing non-flag arg(s). Extract them; only fall
  // back to fail-closed if there's no file arg at all (just `-i` with no operand).
  for (const m of clean.matchAll(/\b(?:sed|awk|gawk)\s+([^&;|\n]+)/g)) {
    if (!/-i\b/.test(m[1])) continue; // only the inplace forms write
    const toks = m[1].trim().split(/\s+/).filter((t) => t && !t.startsWith("-"));
    // sed's last non-flag token is the file (the `-i` script may be quoted prose; ignore quoted)
    const fileToks = toks.filter((t) => !/^['"].*['"]$/.test(t));
    if (fileToks.length) targets.push(fileToks[fileToks.length - 1]);
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
// SEC-H5: lightweight classifier for Bash write-targets (we only need rel + bookkeeping here,
// not the full state-vs-product distinction, because the Bash path blocks anything non-bookkeeping
// that isn't in declared scope). abs is realpath'd; runRepo is the run's repo root.
function quickClassify(abs, runRepo) {
  const runPrefix = runRepo + sep;
  if (abs === runRepo || abs.startsWith(runPrefix)) {
    const rel = abs === runRepo ? "" : abs.slice(runPrefix.length);
    const bookkeeping = rel.startsWith(".zcode/plans/") || rel.startsWith(".zcode/notepads/");
    return { rel, bookkeeping };
  }
  // outside the run repo entirely → treat as product code (will fail the inScope check, blocking it)
  return { rel: abs, bookkeeping: false };
}

// SEC-H5: extract the plan's declared editable-file set (shared by the Edit scope gate and the
// post-OKAY Bash scope gate so they can't disagree). Mirrors the in-block logic at the edit path.
function declaredScopeForRun(st) {
  const planPath = st.plan_path || join(PROJECT_DIR, ".zcode", "plans", `${st.slug}.md`);
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
  // SEC-M7 (external audit #9): the OLD second pass harvested backtick paths from the ENTIRE plan,
  // so a prohibition (`Must NOT do: touch \`config/prod.yaml\``) GRANTED access to that forbidden
  // file. Now restricted to the `## Scope` section only (Must-have deliverables live there); the
  // `Must NOT do`/`MUST NOT DO` lines under each todo are excluded, so a forbidden path can no
  // longer widen scope.
  const scopeSection = extractSection(planText, "Scope");
  if (scopeSection) {
    for (const m of scopeSection.matchAll(/`([^`]+\.(?:md|py|ts|js|sh|json|yaml|yml|toml|html|css|png|jpg|webp))`/g)) {
      const p = m[1].trim();
      if (p && !/\s/.test(p)) declared.add(p);
    }
  }
  return { declared, planText, planPath };
}
// helper: return the body of a `## <name>` section (up to the next `## ` header)
function extractSection(text, name) {
  const re = new RegExp(`^## ${name}\\s*$`, "m");
  const start = text.search(re);
  if (start === -1) return "";
  const after = text.slice(start + text.slice(start).indexOf("\n") + 1);
  const next = after.search(/^## /m);
  return (next === -1 ? after : after.slice(0, next)).trim();
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
  // FAST PATH: validate the cached discovery against the live state-file mtimes.
  const cached = readFindCache();
  if (cached && Array.isArray(cached.stateDirs)) {
    const fp = fingerprintStateDirs(cached.stateDirs);
    if (fp !== null && fp === cached.fingerprint && cached.result) {
      // Cache hit. Re-apply the staleness + terminal filter on the cached result (cheap, and
      // defends against a cached run that went stale/terminal without a state-file mtime bump
      // — belt and suspenders, since phase transitions DO write state).
      const r = cached.result.run;
      if (r && r.phase && !TERMINAL.has(r.phase)) {
        const updated = r.updated_at ? new Date(r.updated_at).getTime() : 0;
        if (!updated || now - updated <= STALE_MS) return cached.result;
      }
      // cached result no longer active → fall through to full DFS (refreshes the cache)
    }
  }
  let active = null;
  let activeDir = null;
  // Discover every `.zcode/state` dir under PROJECT_DIR (bounded DFS).
  const SKIP_NAMES = new Set([".git", ".codegraph", "node_modules", "vendor", "target", "dist",
    "build", ".next", ".nuxt", ".cache", ".turbo", "coverage", "__pycache__", ".venv", "venv",
    "bower_components", "jspm_packages"]);
  const MAX_DEPTH = 5;
  const stateDirs = [];
  const stack = [[PROJECT_DIR, 0, false]]; // [dir, depth, isZcodeChild]
  const seen = new Set();
  while (stack.length) {
    const [dir, depth, isZcodeChild] = stack.pop();
    let real;
    try { real = realpathSync.native(dir); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    // If we entered a `.zcode` directory, its `./state` is a candidate; don't recurse further in.
    if (isZcodeChild) {
      stateDirs.push(join(dir, "state"));
      continue;
    }
    if (depth >= MAX_DEPTH) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".") && e.name !== ".zcode") continue; // only recurse into .zcode
      if (SKIP_NAMES.has(e.name)) continue;
      stack.push([join(dir, e.name), depth + 1, e.name === ".zcode"]);
    }
  }
  // Also always consider the top-level STATE_DIR even if discovery missed it.
  if (!stateDirs.includes(STATE_DIR)) stateDirs.push(STATE_DIR);
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
      if (!st.phase || TERMINAL.has(st.phase)) continue;
      const updated = st.updated_at ? new Date(st.updated_at).getTime() : 0;
      if (updated && now - updated > STALE_MS) continue;
      if (!active || (st.updated_at || "") > (active.updated_at || "")) {
        active = st;
        activeDir = dir;
      }
    }
  }
  const result = active ? { run: active, dir: activeDir } : null;
  // Persist the discovery so the next call can skip the DFS. Fingerprint keyed on state-file
  // mtimes; any add/remove/modify invalidates. result may be null (no active run) — caching that
  // is fine and useful (avoids re-walking when no run is active at all).
  const fp = fingerprintStateDirs(stateDirs);
  if (fp !== null) writeFindCache({ projectDir: PROJECT_DIR, stateDirs, fingerprint: fp, result, at: now });
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


// W7-stall self-test: dump the real hook payload shape ONCE per run, so the owner-identity
// assumption (does the harness actually send agent_id/session_id/tool_use_id?) becomes VERIFIED
// rather than guessed (rounds 4-7 all assumed fields that may not exist). Writes to
// .zcode/state/<slug>.payload-probe.json, idempotent per run.
// PERF (memory fix 3a): the probe already served its purpose (proved agent_id is absent — see
// external-audit finding). Skip the write in production unless ZODYSSEY_DEBUG=1 is set.
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
// ancestry — the run whose repo root is the nearest ancestor of the target wins. Dispatch/read/Bash
// tools keep the recency pick. This re-runs discovery (cheap, and the cache only covers the
// recency winner), but only on the edit path.
if (isEdit) {
  const _tp = toolInput.file_path || toolInput.path || toolInput.notebook_path || "";
  if (_tp) {
    const _all = findActiveRuns({ projectDir: PROJECT_DIR, staleMs: STALE_MS });
    const _sel = selectByTarget(_all, _tp);
    if (_sel && _sel.state.slug !== state.slug) { state = _sel.state; RUN_STATE_DIR = _sel.stateDir; }
  }
}

// MAJOR-3 (operational-consult): OBSERVED capability recording. The old path was circular —
// record-capability.mjs was called by the agent that CLAIMED the capability, so state.capabilities
// was self-declared. The hook sees real Skill/MCP tool calls as they happen, so record them here
// (best-effort append to state.capabilities; never blocks). This converts "TDD was used" from an
// assertion into an observation.
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
        cs.capabilities.push({ at: new Date().toISOString(), phase: state.phase, capability: cap, observed: true });
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
  // (1) Run-repo-relative classification (handles nested-repo runs). RUN_STATE_DIR is .../.zcode/state;
  // the repo root is two levels up. Match bookkeeping/state prefixes against that.
  if (RUN_STATE_DIR) {
    const runZcode = pathResolve(RUN_STATE_DIR, "..");          // .../.zcode
    const runRepo = pathResolve(runZcode, "..");                 // the repo root containing .zcode
    const runPrefix = runRepo + sep;
    if (abs === runRepo || abs.startsWith(runPrefix)) {
      const runRel = abs === runRepo ? "" : abs.slice(runPrefix.length);
      rel = runRel;
      if (runRel.startsWith(".zcode/plans/") || runRel.startsWith(".zcode/notepads/")) bookkeeping = true;
      if (runRel.startsWith(".zcode/state/")) isState = true;
    }
  }
  // (2) PROJECT_DIR-relative classification (top-level runs + workspace bookkeeping).
  const inside = abs === PROJECT_DIR || abs.startsWith(PROJECT_PREFIX);
  if (inside) {
    const projRel = abs === PROJECT_DIR ? "" : abs.slice(PROJECT_PREFIX.length);
    if (!rel) rel = projRel; // prefer the run-relative rel, fall back to PROJECT_DIR-relative
    if (projRel.startsWith(".zcode/plans/") || projRel.startsWith(".zcode/notepads/")) bookkeeping = true;
    if (projRel.startsWith(".zcode/state/")) isState = true;
  }
  return { rel, bookkeeping, isState };
}

if (isEdit) {
  const { rel, bookkeeping, isState } = classifyTarget(targetPath());

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
    const planPath = state.plan_path || join(PROJECT_DIR, ".zcode", "plans", `${state.slug}.md`);
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
      const { declared } = declaredScopeForRun(state);
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
  // SAME file. Owner = payload.agent_id || payload.session_id (stable per-dispatch; NOT
  // tool_use_id which is per-call). Each in-flight executor registers in state.active_todos
  // (a MAP, keyed by owner → todo id) via record-todo.mjs. The hook resolves myTodo from that
  // map, stamps file_locks[rel].todo with it. Self-ownership requires the SAME owner (a shared
  // global todo id was the W6 bug — every concurrent executor matched it).
  const owner = payload.agent_id || payload.session_id || state.active_executor_session || "orchestrator";
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
  exit(0);
}

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
if (isBash && process.env.ZODYSSEY_UNGATE_BASH === "1") exit(0);

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
function isTrustedScriptInvoke(cmd) {
  if (!SCRIPTS_DIR) return false;
  // Fail closed on ANY shell metacharacter that could inject a second command or redirect.
  if (/[;&|`$<>()]/.test(cmd)) return false;
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

  // PLAN-TAMPER GUARD (SEC-4 mirror — see block comment above). Re-hash the on-disk plan against
  // the sha bound to this OKAY verdict. Unreadable plan or sha drift -> BLOCK (fail closed).
  const boundSha = state.review && state.review.plan_sha256;
  if (boundSha) {
    const planPath = state.plan_path || join(PROJECT_DIR, ".zcode", "plans", `${state.slug}.md`);
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

  // Derive the run's repo root (mirrors classifyTarget lines 522-524): RUN_STATE_DIR is
  // .../.zcode/state -> up two levels is the repo root containing .zcode.
  const runRepo = RUN_STATE_DIR ? pathResolve(pathResolve(RUN_STATE_DIR, ".."), "..") : PROJECT_DIR;

  // Resolve + classify each target. Bookkeeping targets (.zcode/plans/, .zcode/notepads/) are
  // always fine; every other target must be in the declared Files: scope. declaredScopeForRun
  // returns declared.size===0 on plan read failure -> nothing is in scope -> BLOCK (fail closed).
  const { declared } = declaredScopeForRun(state);
  for (const t of targets) {
    let abs;
    try {
      abs = realpathSync.native(pathResolve(PROJECT_DIR, t));
    } catch {
      // Target doesn't exist yet (e.g. `cmd > newfile`). Fall back to lexical resolve so we can
      // still classify it; quickClassify's prefix test catches ../ escape lexically too.
      abs = pathResolve(PROJECT_DIR, t);
    }
    const { rel, bookkeeping } = quickClassify(abs, runRepo);
    if (bookkeeping) continue; // .zcode/plans/, .zcode/notepads/ — always writable
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
  const isReadonlyAgent = READONLY_AGENTS.has(subagent);
  const isPlanner = PLANNER_AGENTS.has(subagent);
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
  if (subagent === "momus") {
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
  if (subagent === "momus") {
    if (state.phase !== "review") {
      process.stderr.write(
        `ZOdyssey WARNING: momus dispatched in phase=${state.phase} (expected "review") — nonce minted anyway so the verdict is recordable, but the phase was not transitioned. Run 'node ${SET_PHASE_PATH} <repo> <slug> review' to reconcile, or the recorded verdict will not auto-advance to execute.\n`
      );
    }
    mintNonceFor("review");
  }
  if (subagent === "code-reviewer" || subagent === "feature-dev:code-reviewer") {
    if (state.phase !== "final") {
      process.stderr.write(
        `ZOdyssey WARNING: code-reviewer dispatched in phase=${state.phase} (expected "final" for F2) — nonce minted anyway; reconcile the phase if this was not intended.\n`
      );
    }
    mintNonceFor("final_f2");
  }
  if (subagent === "oracle") {
    if (state.phase !== "final") {
      process.stderr.write(
        `ZOdyssey WARNING: oracle dispatched in phase=${state.phase} (expected "final" for F4) — nonce minted anyway; reconcile the phase if this was not intended.\n`
      );
    }
    mintNonceFor("final_f4");
  }
  exit(0);
}

exit(0); // any other tool: pass

