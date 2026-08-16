#!/usr/bin/env node
// check-anchors.test.mjs — the enforcement half of the anchor-drift check.
//
// THIS FILE IS THE WIRING. `run-tests.mjs` discovers `**/*.test.mjs` and CI runs `npm test`, so a
// test file is invoked the moment it exists — there is no caller to add and none to forget.
//
// That is deliberate and it is the whole design. This repo has shipped two mechanisms that were
// built, tested, and then never invoked by anything:
//   · `check-imports.mjs` — zero code callers since v0.3.2; its only "caller" is a prose sentence.
//   · `regression-gate.mjs --check` — zero code callers, and it is the ONLY writer of the
//     `status: "regressed"` field that `set-phase.mjs:131` refuses `done` on. The baseline is
//     snapshotted automatically; the comparison never runs. The gate has never fired.
// A `--check` flag on a script needs something to call it. A test does not. This is not a third.
//
// PAIRED PROBE (the repo's prove-it-fails rule): every assertion below is demonstrated in BOTH
// directions against a hermetic fixture — the defect is shown REAL (the check catches it) and the
// clean case is shown UNCHANGED (no false positive). A drift-detection test that never actually
// drifts anything is indistinguishable from one that passes vacuously.
//
// Run:  node scripts/check-anchors.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./check-anchors.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const cleanup = [];

function run(root, ...extra) {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root, ...extra], { encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// A fixture repo: one source file, one document citing a line in it, and a scripts/ dir for the
// lock. `body` is the source file's content; the doc cites line 3 unless told otherwise.
function fixture(body = "alpha\nbravo\nCHARLIE-the-cited-line\ndelta\n", cite = "src/thing.mjs:3") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "anchors-")));
  cleanup.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "src", "thing.mjs"), body);
  writeFileSync(join(root, "docs", "NOTES.md"), `# Notes\n\nThe important bit lives at \`${cite}\`.\n`);
  return root;
}
const seed = (root) => run(root, "--update");
const lockOf = (root) => JSON.parse(readFileSync(join(root, "scripts", "anchors.lock.json"), "utf8"));

console.log("check-anchors.mjs — a cited line must still say what the citation claims\n");

// ─── the clean case must stay clean (no false positive) ──────────────────────
{
  const root = fixture();
  const s = seed(root);
  check("seeding writes a lock and exits 0", s.code === 0, `(exit ${s.code})`);
  check("the lock contains the resolved citation",
    Object.keys(lockOf(root).citations).includes("src/thing.mjs:3"),
    `(keys: ${Object.keys(lockOf(root).citations).join(",")})`);
  const c = run(root);
  check("an unmodified tree passes", c.code === 0, `(exit ${c.code}) ${c.err.slice(0, 200)}`);
}

// ─── PROBE 1: a line inserted ABOVE the cited line (the shift class) ─────────
// This is the scripts.md and ROADMAP.md incident: an insertion moves every anchor below it.
{
  const root = fixture();
  seed(root);
  check("BEFORE: clean tree passes", run(root).code === 0);
  writeFileSync(join(root, "src", "thing.mjs"), "INSERTED\nalpha\nbravo\nCHARLIE-the-cited-line\ndelta\n");
  const c = run(root);
  check("AFTER an insertion above it: drift is caught", c.code === 9, `(exit ${c.code})`);
  check("  …and the report names the citing document", c.err.includes("docs/NOTES.md:3"), c.err.slice(0, 200));
  check("  …and shows what the line NOW holds", c.err.includes("bravo"), c.err.slice(0, 300));
}

// ─── PROBE 2: content edited IN PLACE, line count unchanged ─────────────────
// The row that matters. A line-number-only check passes this, and it is exactly how the
// agents/sisyphus-junior.md:93 anchors went wrong — plausible numbers, content moved elsewhere.
{
  const root = fixture();
  seed(root);
  writeFileSync(join(root, "src", "thing.mjs"), "alpha\nbravo\nSOMETHING-COMPLETELY-DIFFERENT\ndelta\n");
  const c = run(root);
  check("in-place content change (same line count) is caught", c.code === 9, `(exit ${c.code})`);
  check("  …reported as drift, not as out-of-range", c.err.includes("[drift]"), c.err.slice(0, 200));
}

// ─── whitespace-only reflow must NOT be reported (else the gate gets switched off) ──
{
  const root = fixture();
  seed(root);
  writeFileSync(join(root, "src", "thing.mjs"), "alpha\nbravo\n   CHARLIE-the-cited-line   \ndelta\n");
  check("re-indenting the cited line is NOT drift", run(root).code === 0);
}

// ─── PROBE 3: a new citation that is not in the lock ────────────────────────
{
  const root = fixture();
  seed(root);
  writeFileSync(join(root, "docs", "MORE.md"), "See `src/thing.mjs:1` too.\n");
  const c = run(root);
  check("an unlocked citation fails (unlocked is unchecked)", c.code === 9, `(exit ${c.code})`);
  check("  …reported as unlocked", c.err.includes("[unlocked]"), c.err.slice(0, 200));
}

// ─── PROBE 4: zero citations discovered is a FAILURE, never a pass ──────────
// The harness.mjs rule, restated at run-tests.mjs:20 — a runner reporting success over an empty
// set is the same false green one level up.
{
  const root = realpathSync(mkdtempSync(join(tmpdir(), "anchors-empty-")));
  cleanup.push(root);
  const c = run(root);
  check("an empty tree exits 4, not 0", c.code === 4, `(exit ${c.code})`);
  check("  …and says so explicitly", /ZERO citations/i.test(c.err), c.err.slice(0, 160));
}

// ─── PROBE 5: a citation past the end of the file ──────────────────────────
{
  const root = fixture("only\ntwo\n", "src/thing.mjs:99");
  const c = run(root, "--update");
  check("a citation past EOF is not silently locked", c.code === 9, `(exit ${c.code})`);
  check("  …reported as out-of-range", c.err.includes("[out-of-range]"), c.err.slice(0, 200));
}

// ─── PROBE 6: an unresolvable path ─────────────────────────────────────────
{
  const root = fixture("a\nb\nc\n", "src/nonexistent.mjs:2");
  const c = run(root, "--update");
  check("an unresolvable citation fails", c.code === 9, `(exit ${c.code})`);
  check("  …reported as unresolved", c.err.includes("[unresolved]"), c.err.slice(0, 200));
}

// ─── PROBE 7: ambiguity FAILS rather than guessing ─────────────────────────
// A bare basename matching two files is a citation defect to report, not a coin flip.
{
  const root = fixture("a\nb\nc\n", "dup.mjs:2");
  mkdirSync(join(root, "one"), { recursive: true });
  mkdirSync(join(root, "two"), { recursive: true });
  writeFileSync(join(root, "one", "dup.mjs"), "a\nb\nc\n");
  writeFileSync(join(root, "two", "dup.mjs"), "a\nb\nc\n");
  const c = run(root, "--update");
  check("an ambiguous basename fails instead of guessing", c.code === 9, `(exit ${c.code})`);
  check("  …and names every candidate", c.err.includes("one/dup.mjs") && c.err.includes("two/dup.mjs"),
    c.err.slice(0, 240));
}

// ─── dialects: the seven forms in live use must all resolve ────────────────
{
  const root = realpathSync(mkdtempSync(join(tmpdir(), "anchors-dialect-")));
  cleanup.push(root);
  for (const d of ["scripts", "docs", "skills/odyssey/references", "skills/odyssey/hooks", ".zcode-plugin"]) {
    mkdirSync(join(root, d), { recursive: true });
  }
  const three = "one\ntwo\nthree\n";
  writeFileSync(join(root, "skills/odyssey/references/scripts.md"), three);
  writeFileSync(join(root, "skills/odyssey/SKILL.md"), three);
  writeFileSync(join(root, "skills/odyssey/hooks/pre-tool.trusted-invoke.test.mjs"), three);
  writeFileSync(join(root, "skills/odyssey/hooks/pre-tool.mjs"), three);
  writeFileSync(join(root, ".zcode-plugin/plugin.json"), three);
  writeFileSync(join(root, "docs/D.md"),
    "`skills/odyssey/references/scripts.md:2` `references/scripts.md:2` `scripts.md:2` " +
    "`SKILL.md:2` `trusted-invoke.test.mjs:2` `.zcode-plugin/plugin.json:2` `pre-tool.mjs:2`\n");
  const s = run(root, "--update");
  check("all seven citation dialects resolve", s.code === 0, `(exit ${s.code}) ${s.err.slice(0, 300)}`);
  const keys = Object.keys(lockOf(root).citations);
  check("  …the leading-dot path is not dropped by the regex",
    keys.includes(".zcode-plugin/plugin.json:2"), `(keys: ${keys.join(" ")})`);
  check("  …basename-suffix resolves to the prefixed file",
    keys.includes("skills/odyssey/hooks/pre-tool.trusted-invoke.test.mjs:2"), `(keys: ${keys.join(" ")})`);
}

// ─── exempt list: deliberate template examples do not fail ─────────────────
{
  const root = fixture("a\nb\nc\n", "src/example.ts:42");
  writeFileSync(join(root, "scripts", "anchors.lock.json"),
    JSON.stringify({ exempt: ["src/example.ts:42"], citations: {} }, null, 2));
  const c = run(root, "--update");
  check("an exempt citation does not fail the check", c.code === 0, `(exit ${c.code}) ${c.err.slice(0, 200)}`);
  check("  …and the exempt list survives a re-baseline",
    lockOf(root).exempt.includes("src/example.ts:42"));
}

// ─── stdout must survive a pipe (process.exit truncates buffered writes) ───
// The --json report is ~65KB on the real repo and was silently cut at 65051 bytes the first time it
// ran under a pipe. Regression-locked here.
{
  const r = spawnSync(process.execPath, [SCRIPT, "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* stays null */ }
  check("--json emits complete, parseable JSON under a pipe", parsed !== null,
    `(${(r.stdout || "").length} bytes, exit ${r.status})`);
  check("  …and reports a non-trivial citation count", parsed && parsed.checked > 100,
    parsed ? `(checked ${parsed.checked})` : "(unparseable)");
}

// ─── THE REAL TREE: the repo's own citations must all resolve and match ───
{
  const c = run(REPO);
  check("the repository's own citations all resolve and match the lock", c.code === 0,
    `(exit ${c.code})\n${c.err.slice(0, 1200)}`);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
