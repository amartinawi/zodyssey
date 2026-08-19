#!/usr/bin/env node
// check-anchors.mjs — a cited line must still say what the citation claims.
//
// WHY THIS EXISTS: this repo documents itself by `file:line`. Measured 2026-08-16: 761 citations
// across 28 documents pointing into 68 files. `docs/implementation-prompt.md:34` makes it a rule —
// "Cite `file:line` for every load-bearing claim … A claim without an anchor is a claim you did not
// check." Nothing verified that a cited line still says what the citation claimed, so a one-line
// insertion into a cited file silently invalidated every anchor below it.
//
// Three instances inside one week, two of them caused while fixing the first:
//   · agents/sisyphus-junior.md:93 cited pre-tool.mjs:896-952 for the Bash gate and :807 for the
//     UNGATE hatch. Both had drifted; :807 had become the unrelated `if (rel)` containment escape.
//   · An edit to references/scripts.md inserted one line, shifting check-imports from :45 to :46,
//     invalidating nine citations — seven in docs/ideation-report.md, a committed audit artifact.
//   · A status addendum inserted at the top of docs/ROADMAP.md broke fourteen more.
//
// WHAT IT PINS: not the line NUMBER but the line CONTENT. A whitespace-normalized hash of the cited
// line is recorded in scripts/anchors.lock.json. That catches an in-place edit that keeps the line
// count — which is exactly how the sisyphus-junior anchors went wrong, plausible numbers pointing
// at moved content.
//
// EVERY NUMBER OF A CITATION, not just its first (impl-21). Docs cite one path with several
// numbers: comma chains (`harness.mjs:88,62`, `:69-70,19,128-131`), slash continuations
// (`CHANGELOG.md:578/:696`), and bare-colon continuations (`…pre-tool.mjs:875 … and :905-930`)
// that bind to the nearest preceding path-form cite on the SAME line. Every number gets its own
// range check, contentless check, pin, and drift check, and every `a-b` range is validated a ≤ b
// at parse time — a reversed pair is its own problem kind `backwards-range`, because
// `lines.slice(a-1, b)` with a > b is EMPTY and an empty span used to slide through the
// contentless check vacuously.
//
// CHANGELOG.md, formerly exempt from scanning and unpinned as a target, is now a full citizen
// under a SCAN WINDOW (operator-proxy decision, OVERRIDABLE — the fallback is re-adding it to
// EXEMPT_DOCS below; content-pinning stays either way): citations INTO it are content-pinned like
// any other target, and it is scanned as a citing document from line 1 to just before the second
// `## [version]` heading, so released history is never rescanned and never rewritten.
//
// WHAT IT DOES NOT DO: it verifies a line is UNCHANGED, not that it SUPPORTS the claim citing it.
// A citation can be perfectly anchored and still be wrong about what the code does. That is a
// judgment call, and judgment calls need a judge. The discovery grammar is also deliberately
// conservative: a bare `:N` with no same-line path-form antecedent is NOT discovered, so some
// real continuations stay invisible — under-coverage is accepted where inventing citations is not.
//
// Enforcement lives in check-anchors.test.mjs, discovered automatically by run-tests.mjs. This
// script has no other caller BY DESIGN — see that file's header.
//
// Usage:
//   check-anchors.mjs [--root <dir>] [--json]        verify against the lock
//   check-anchors.mjs [--root <dir>] --update        deliberate re-baseline
//   exit: 0 clean · 2 bad args · 4 zero citations discovered · 9 problems found

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative, basename, dirname } from "node:path";
import { argv, exit } from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO_DEFAULT = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

const args = argv.slice(2);
const rootIdx = args.indexOf("--root");
if (rootIdx !== -1 && !args[rootIdx + 1]) { console.error("check-anchors.mjs: --root requires a directory"); exit(2); }
const ROOT = rootIdx !== -1 ? args[rootIdx + 1].replace(/\/$/, "") : REPO_DEFAULT;
const UPDATE = args.includes("--update");
const AS_JSON = args.includes("--json");
const LOCK_PATH = join(ROOT, "scripts", "anchors.lock.json");

if (!existsSync(ROOT)) { console.error(`check-anchors.mjs: no such root: ${ROOT}`); exit(2); }

// Same skip list as run-tests.mjs, plus the run-artifact dirs. `.zcode/` holds per-run notepads,
// verify artifacts and audit reports — historical records of what a run saw, not standing claims,
// and its filenames collide by design (1-1.json in every run). CHANGELOG.md is NOT skipped as a
// citing document — since impl-21 it is scanned under the top-section window (see the scan loop).
const SKIP_DIRS = new Set(["node_modules", ".git", ".zcode", "dist", "build", "coverage",
  ".claude-flow", ".swarm", ".zcode-cache"]);
// Documents never scanned as citing documents. Intentionally EMPTY since impl-21: CHANGELOG.md
// used to sit here as a whole-file exemption, but it is now scanned for its top section under the
// scan window, and nothing else has ever needed a whole-file pass. Re-adding a doc here is the
// operator override that reverses the CHANGELOG scan decision (pinning of CHANGELOG targets stays
// either way). Per-document opt-out remains available via IGNORE_MARKER below.
const EXEMPT_DOCS = new Set();
// A document may opt out entirely with this marker anywhere in its body.
const IGNORE_MARKER = "<!-- anchor-lock: ignore -->";

const DOC_EXT = /\.md$/;
// Extensions a citation may point at. `.zcode-plugin/plugin.json:44` must keep its leading dot, so
// the head of the pattern admits an optional one; a naive [A-Za-z]-anchored class drops it and the
// path silently fails to resolve.
const CITE = /(?<![\w/.\-])(\.?[A-Za-z0-9_][A-Za-z0-9_./\-]*\.(?:mjs|md|json|jsonl|js|cjs|yml|yaml|sh|py|toml|ts))[:](\d+)(?:\s*[-–]\s*(\d+))?/g;
// A citation may continue past its first number. The rule is STRUCTURAL, not an enumeration of
// today's separator shapes: after a path-form cite, a contiguous run of further number elements —
// each `N` or `N-M` (en dash included), each joined to the previous element by `,` or `/` with
// optional whitespace and an optional leading `:` — belongs to the same path. Live dialects this
// covers: `harness.mjs:88,62`, `:69-70,19,128-131`, `CHANGELOG.md:578/:696`. Sticky-flagged so it
// can only ever match exactly where the preceding element ended.
const CHAIN_ELEMENT = /\s*[,/]\s*:?\s*(\d+)(?:\s*[-–]\s*(\d+))?/y;
// A bare `:N`/`:N-M` whose colon is not preceded by a word char, dot, or dash — so `12:30`,
// `impl/05:162`, and `md:65,63` never match — binds to the NEAREST preceding path-form cite on
// the SAME line; it never reaches past a nearer cite to a farther one. With no same-line
// path-form antecedent it is not a citation at all. Discovery never crosses a line boundary.
const BARE_CONTINUATION = /(?<![\w.\-]):(\d+)(?:\s*[-–]\s*(\d+))?/g;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".zcode-plugin" && e.name !== ".github") continue;
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const allFiles = walk(ROOT).map((p) => relative(ROOT, p));

// ── resolution ────────────────────────────────────────────────────────────────
// Seven citation dialects are in live use. A first-cut resolver that handled only
// repo-root-relative paths reported 25 FALSE failures on this repo, every one of which resolves
// correctly under the right root. A noisy gate gets switched off, so the resolver has to match how
// people actually write, and AMBIGUITY MUST FAIL rather than guess.
//
//   skills/odyssey/references/scripts.md  → itself                       (exact)
//   references/scripts.md                 → skills/odyssey/references/…  (path suffix)
//   scripts.md · capabilities.md          → skills/odyssey/references/…  (path suffix)
//   SKILL.md                              → skills/odyssey/SKILL.md      (path suffix)
//   trusted-invoke.test.mjs               → pre-tool.trusted-invoke.…    (basename suffix)
//   .zcode-plugin/plugin.json             → itself                       (exact, leading dot)
//   pre-tool.mjs · set-phase.mjs          → hooks/ · scripts/            (path suffix)
const byPath = new Set(allFiles);
function resolveCitation(cited) {
  if (byPath.has(cited)) return { path: cited };
  const sufMatches = allFiles.filter((f) => f.endsWith("/" + cited));
  if (sufMatches.length === 1) return { path: sufMatches[0] };
  if (sufMatches.length > 1) return { ambiguous: sufMatches };
  if (!cited.includes("/")) {
    const baseMatches = allFiles.filter((f) => basename(f).endsWith(cited));
    if (baseMatches.length === 1) return { path: baseMatches[0] };
    if (baseMatches.length > 1) return { ambiguous: baseMatches };
  }
  return { missing: true };
}

// ── fingerprinting ────────────────────────────────────────────────────────────
// Normalize before hashing so a reflow or an indentation change does not read as drift, while any
// change to the actual tokens does. A range hashes its whole span, so an insertion INSIDE the range
// is caught too.
const norm = (s) => s.replace(/\s+/g, " ").trim();

// A citation whose target carries NO CONTENT is worse than a broken one: it resolves, it stays in
// range, its hash never changes, so the check certifies it forever while it points at nothing.
//
// Found by an external verification pass: `scripts/run-tests.mjs:22` was cited three times in
// docs/impl/08 for the exit-4 contract — but :22 is a bare `//` and the contract is at :25. It was
// pinned, and the pin was stable, so nothing would ever have flagged it. Auditing for the shape
// turned up seven such citations across the repo (four blank lines, three bare comment markers).
//
// This is the mechanical third of the "the lock says unchanged, not correct" boundary. It cannot
// tell a WRONG comment line from a RIGHT one — :25 is also a comment — but it can refuse to pin a
// line that says nothing at all, and every one of the seven was of that kind.
const CONTENTLESS = /^\s*(?:\/\/+|#+|\*+|\/\*|\*\/|<!--|-->|-{3,}|={3,})?\s*$/;
const isContentless = (span) => span.every((s) => CONTENTLESS.test(s));
const linesOf = (() => {
  const cache = new Map();
  return (p) => {
    if (!cache.has(p)) {
      try { cache.set(p, readFileSync(join(ROOT, p), "utf8").split("\n")); } catch { cache.set(p, null); }
    }
    return cache.get(p);
  };
})();
function fingerprint(path, a, b) {
  const lines = linesOf(path);
  if (!lines) return null;
  const hi = b || a;
  if (a < 1 || hi > lines.length) return { outOfRange: lines.length };
  const raw = lines.slice(a - 1, hi);
  const span = raw.map(norm).join("\n");
  return { hash: createHash("sha256").update(span).digest("hex").slice(0, 12), text: lines[a - 1], raw };
}

// ── scan ──────────────────────────────────────────────────────────────────────
// Discovery runs per LINE: first every path-form cite (the seven-dialect regex above), then the
// contiguous number chain hanging off each, then bare-colon continuations bound to their nearest
// same-line antecedent. A number-only continuation with no same-line path-form cite is simply not
// discovered — see the header's under-coverage statement.
const found = new Map();   // key "path:a" or "path:a-b" → {path,a,b,citedAs,sites:[{doc,line}]}
const record = (doc, lineNo, citedAs, a, b) => {
  const res = resolveCitation(citedAs);
  const key = res.path ? `${res.path}:${a}${b ? "-" + b : ""}` : `?${citedAs}:${a}`;
  if (!found.has(key)) found.set(key, { ...res, citedAs, a, b, sites: [] });
  found.get(key).sites.push({ doc, line: lineNo + 1 });
};
let scannedDocs = 0;
for (const rel of allFiles) {
  if (!DOC_EXT.test(rel)) continue;
  if (EXEMPT_DOCS.has(rel)) continue;
  let body;
  try { body = readFileSync(join(ROOT, rel), "utf8"); } catch { continue; }
  if (body.includes(IGNORE_MARKER)) continue;
  scannedDocs++;
  const docLines = body.split("\n");
  // CHANGELOG scan window (the operator-proxy decision from the header): CHANGELOG.md is a citing
  // document for its TOP SECTION only — line 1 through the line BEFORE the second `## [version]`
  // heading — so the in-progress section is checked while released history below it is never
  // rescanned and never rewritten. A file with fewer than two such headings is scanned whole.
  // The boundary counter is FENCE-AWARE: a column-0 `## [x.y.z]` line inside a ``` fence is an
  // illustration, not a heading. Counting it made the fence the second heading and silently
  // truncated the window above every cite below it (oracle, impl-21 final wave) — an under-sized
  // window is the silent failure direction, so heading detection errs toward NOT matching.
  let scanEnd = docLines.length;
  if (rel === "CHANGELOG.md") {
    let versionHeadings = 0;
    let inFence = false;
    for (let i = 0; i < docLines.length; i++) {
      if (/^\s{0,3}```/.test(docLines[i])) { inFence = !inFence; continue; }
      if (inFence) continue;
      if (/^## \[/.test(docLines[i]) && ++versionHeadings === 2) { scanEnd = i; break; }
    }
  }
  for (let i = 0; i < scanEnd; i++) {
    const line = docLines[i];
    const anchors = [];   // every path-form cite on this line: {start, end, citedAs}, in order
    CITE.lastIndex = 0;
    let m;
    while ((m = CITE.exec(line)) !== null) {
      record(rel, i, m[1], parseInt(m[2], 10), m[3] ? parseInt(m[3], 10) : null);
      // Absorb the contiguous chain of further number elements, if any.
      let end = CITE.lastIndex;
      for (;;) {
        CHAIN_ELEMENT.lastIndex = end;
        const cm = CHAIN_ELEMENT.exec(line);
        if (!cm) break;
        record(rel, i, m[1], parseInt(cm[1], 10), cm[2] ? parseInt(cm[2], 10) : null);
        end = CHAIN_ELEMENT.lastIndex;
      }
      anchors.push({ start: m.index, end, citedAs: m[1] });
      CITE.lastIndex = end;
    }
    // Bare-colon continuations (`:545, :637`, `…at :1105` with an antecedent): bind each to the
    // nearest PRECEDING path-form cite on this line — the last anchor that starts before it, so a
    // nearer cite is never skipped in favor of a farther one.
    BARE_CONTINUATION.lastIndex = 0;
    let bm;
    while ((bm = BARE_CONTINUATION.exec(line)) !== null) {
      if (anchors.some((an) => bm.index >= an.start && bm.index < an.end)) continue;  // already parsed as a chain element
      let antecedent = null;
      for (const an of anchors) if (an.start < bm.index) antecedent = an;
      if (!antecedent) continue;   // no same-line path-form cite → not a citation
      record(rel, i, antecedent.citedAs, parseInt(bm[1], 10), bm[2] ? parseInt(bm[2], 10) : null);
      // A bound bare token can carry its own comma chain (`…pre-tool.mjs:875 … and :905-930,42`):
      // absorb it with the same loop shape as the path-form branch above, or the tail is silently
      // dropped (F2 low, impl-21 final wave). Advancing lastIndex keeps absorbed elements from
      // being re-parsed as fresh bare tokens — the same hygiene the CITE branch applies.
      let bareEnd = BARE_CONTINUATION.lastIndex;
      for (;;) {
        CHAIN_ELEMENT.lastIndex = bareEnd;
        const cm = CHAIN_ELEMENT.exec(line);
        if (!cm) break;
        record(rel, i, antecedent.citedAs, parseInt(cm[1], 10), cm[2] ? parseInt(cm[2], 10) : null);
        bareEnd = CHAIN_ELEMENT.lastIndex;
      }
      BARE_CONTINUATION.lastIndex = bareEnd;
    }
  }
}

// ZERO CITATIONS DISCOVERED IS A FAILURE. Same rule run-tests.mjs:20 states for zero test suites:
// a runner reporting success over an empty set is a false green. If the walk breaks, a directory is
// renamed, or the regex stops matching, this must go red rather than quietly pass.
if (found.size === 0) {
  console.error(
    `check-anchors: ZERO citations discovered under ${ROOT} (${scannedDocs} document(s) scanned).\n` +
    `This is a FAILURE, not a pass — a check reporting success over an empty set is the defect it\n` +
    `exists to catch. Either the document walk is broken or the citation pattern stopped matching.`
  );
  exit(4);
}

// ── compare against the lock ─────────────────────────────────────────────────
let lock = { citations: {} };
if (existsSync(LOCK_PATH)) {
  try { lock = JSON.parse(readFileSync(LOCK_PATH, "utf8")); } catch {
    console.error(`check-anchors: ${LOCK_PATH} is unparseable. Re-baseline deliberately with --update.`);
    exit(9);
  }
}
if (!lock.citations || typeof lock.citations !== "object") lock.citations = {};
// Deliberate non-anchors: illustrative paths inside template/grammar blocks that are not meant to
// resolve (e.g. `- References: src/auth.ts:42` in DESIGN.md's task-grammar example). Kept as an
// explicit, reviewable list rather than a silent "unresolved is fine" rule — treating unresolved as
// benign would reopen the class this check exists to close. Entries are `<citedAs>:<line>`.
const exempt = new Set(Array.isArray(lock.exempt) ? lock.exempt : []);

const problems = [];
const nextLock = {};
for (const [key, c] of [...found.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
  const where = c.sites.map((s) => `${s.doc}:${s.line}`).join(", ");
  if (exempt.has(`${c.citedAs}:${c.a}${c.b ? "-" + c.b : ""}`)) continue;
  if (c.ambiguous) {
    problems.push({ kind: "ambiguous", key, citedAs: c.citedAs, where,
      detail: `matches ${c.ambiguous.length} files: ${c.ambiguous.join(", ")}` });
    continue;
  }
  if (c.missing) {
    problems.push({ kind: "unresolved", key, citedAs: c.citedAs, where,
      detail: `no file in the tree matches \`${c.citedAs}\`` });
    continue;
  }
  // Range sanity, validated on the parsed pair BEFORE any slicing or fingerprinting: a reversed
  // range made `lines.slice(a-1, b)` EMPTY, and an empty span passed the contentless check
  // vacuously — the defect was real but the label was a lie, so it gets its own kind.
  if (c.b !== null && c.b < c.a) {
    problems.push({ kind: "backwards-range", key, citedAs: c.citedAs, where,
      detail: `the range \`${c.a}-${c.b}\` is reversed — lines.slice(${c.a - 1}, ${c.b}) is empty, ` +
        `so the span was never actually checked (it used to pass the contentless check vacuously). ` +
        `Swap the pair so the smaller line comes first.` });
    continue;
  }
  const fp = fingerprint(c.path, c.a, c.b);
  if (!fp) { problems.push({ kind: "unreadable", key, citedAs: c.citedAs, where, detail: `cannot read ${c.path}` }); continue; }
  if (fp.outOfRange !== undefined) {
    problems.push({ kind: "out-of-range", key, citedAs: c.citedAs, where,
      detail: `${c.path} has ${fp.outOfRange} lines; citation points past the end` });
    continue;
  }
  if (isContentless(fp.raw)) {
    problems.push({ kind: "contentless", key, citedAs: c.citedAs, where,
      detail: `the cited line carries no content (blank, or a bare comment marker). A pin on it ` +
        `would never change, so the check would certify it forever while it points at nothing. ` +
        `Re-anchor to the line that actually carries the claim.` });
    continue;
  }
  // Resolved, in range, and carrying content: pin it. Every target is treated alike — CHANGELOG.md
  // included since impl-21; the exemption that used to stop here is gone by design.
  nextLock[key] = fp.hash;
  if (UPDATE) continue;
  const pinned = lock.citations[key];
  if (pinned === undefined) {
    problems.push({ kind: "unlocked", key, citedAs: c.citedAs, where,
      detail: `not in the lock. An unlocked citation is an unchecked one — run --update once you have verified it points where you mean.` });
  } else if (pinned !== fp.hash) {
    problems.push({ kind: "drift", key, citedAs: c.citedAs, where,
      detail: `the cited line changed. It now reads:\n      ${fp.text.trim().slice(0, 160)}` });
  }
}

// NOTE ON EXIT: `process.exit()` tears the process down without flushing buffered stdout, so a
// large report piped to another process is TRUNCATED mid-write. The --json report is ~65KB and was
// silently cut at 65051 bytes the first time this ran under a pipe. Set `process.exitCode` and fall
// off the end instead — Node flushes, then exits with that code. Every early exit above writes at
// most a few lines to stderr (unbuffered to a terminal, and small enough not to matter), so only
// the report paths need this treatment.
if (UPDATE) {
  const out = {
    _comment: "Content fingerprints for every `file:line` citation in tracked docs. Generated by " +
      "scripts/check-anchors.mjs --update; enforced by scripts/check-anchors.test.mjs via npm test. " +
      "Re-baselining is a DELIBERATE act: if a citation drifted, the cheaper fix is usually to " +
      "correct the citation, not to re-pin it.",
    exempt: [...exempt].sort(),
    citations: Object.fromEntries(Object.entries(nextLock).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(LOCK_PATH, JSON.stringify(out, null, 2) + "\n");
  const stale = Object.keys(lock.citations).filter((k) => !(k in nextLock)).length;
  console.log(`check-anchors: wrote ${Object.keys(nextLock).length} citation fingerprints to ${relative(ROOT, LOCK_PATH)}` +
    (stale ? ` (${stale} stale entr${stale === 1 ? "y" : "ies"} dropped)` : ""));
  if (problems.length) {
    console.error(`\ncheck-anchors: ${problems.length} citation(s) could not be fingerprinted and were NOT locked:`);
    for (const p of problems) console.error(`  [${p.kind}] ${p.key}\n      cited at ${p.where}\n      ${p.detail}`);
    process.exitCode = 9;
  }
} else if (AS_JSON) {
  console.log(JSON.stringify({ checked: found.size, documents: scannedDocs, problems }, null, 2));
  process.exitCode = problems.length ? 9 : 0;
} else if (problems.length === 0) {
  console.log(`check-anchors: ${found.size} citations across ${scannedDocs} documents — all resolve and match the lock`);
} else {
  // The message has to name the citing document, the cited file, the line, and what the line now
  // holds. A bare "anchor drift" would be worse than nothing — the reader has to be able to decide
  // whether the citation or the code is wrong, and that decision needs the current text.
  console.error(`check-anchors: ${problems.length} problem(s) across ${found.size} citations in ${scannedDocs} documents\n`);
  const order = { drift: 0, contentless: 1, "out-of-range": 2, "backwards-range": 3, unresolved: 4, ambiguous: 5, unlocked: 6, unreadable: 7 };
  for (const p of problems.sort((x, y) => (order[x.kind] ?? 9) - (order[y.kind] ?? 9))) {
    console.error(`  [${p.kind}] ${p.key}`);
    console.error(`      cited as \`${p.citedAs}\` at ${p.where}`);
    console.error(`      ${p.detail}\n`);
  }
  console.error(
    `Fix the citation if the code moved; fix the code if the citation was right.\n` +
    `Re-baseline only when the change is intended: node scripts/check-anchors.mjs --update`
  );
  process.exitCode = 9;
}
