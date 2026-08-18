#!/usr/bin/env node
// run-report.test.mjs — unit tests for run-report.mjs.
//
// WHY THIS EXISTS: run-report.mjs had no test file at all (confirmed by ls — the only scripts
// without suites were this one and the recall twins' siblings got theirs), while set-phase.mjs
// auto-appends its --json output to the eval trend log on every done|audited transition
// (set-phase.mjs:430-446). The trend corpus is therefore written by an untested writer. The
// immediate trigger is the verify_origin field (ISNAD R4 independence labeling, queue row 18):
// whether "success" stands on an external audit or on in-session-only verification is now a
// reported fact, and a fact reported into the corpus by an untested writer is exactly the
// doc-claim class this repo pins elsewhere.
//
// Cases (a)-(h), black-box subprocess style (no internal imports; spawnSync over execFileSync
// so stderr on the success path is not discarded):
//   (a) bad args → exit 2
//   (b) missing state file → exit 3
//   (c) done, no consult lane → JSON verify_origin "in-session-only", consult_rounds null, exit 0
//   (d) audited + consult lane (2 history rounds) → "external-audit", consult_rounds 2, exit 0
//   (e) done + consult history but no rounds field → consult_rounds falls back to history length
//   (f) text mode prints the origin line for both grades
//   (g) legacy state (no final, no consult, phase done) still reports and exits 0
//   (h) no crash output (no SyntaxError / stack) in any successful invocation
//   (i)/(j) item 06: a tiny far-past-window tmpdir fixture makes tokens deterministically inert —
//       tokens.inert true with a non-empty reason (never bare null), tokens_per_todo null, exit 0
//       in both --json and text mode, no crash output (an inert is truthy; unguarded
//       tokens.totals.total would crash run-report — the defect class item 06 closes)
//
// Run:  node run-report.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const RR = join(SCRIPT_DIR, "run-report.mjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "zod-rr-"));
  mkdirSync(join(dir, ".zcode", "state"), { recursive: true });
  return dir;
}
function writeState(dir, slug, obj) {
  writeFileSync(join(dir, ".zcode", "state", `${slug}.json`), JSON.stringify(obj, null, 2));
}
function run(args) {
  const r = spawnSync("node", [RR, ...args], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
const baseState = (over = {}) => ({
  slug: "t", intent: "standard", phase: "done",
  started_at: "2026-08-17T10:00:00.000Z", updated_at: "2026-08-17T10:05:00.000Z",
  review: { verdict: "OKAY", round: 1 }, todos: {}, checkpoints: [], ...over,
});

console.log("run-report.mjs — verify_origin (ISNAD R4 independence labeling)\n");

// --- (a) bad args → 2 --------------------------------------------------------
{
  const r = run([]);
  check("(a) no args → exit 2", r.code === 2, `got ${r.code}`);
}

// --- (b) missing state → 3 ---------------------------------------------------
{
  const dir = makeRepo();
  try {
    const r = run([dir, "ghost"]);
    check("(b) missing state file → exit 3", r.code === 3, `got ${r.code}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// --- (c) done, no consult lane → in-session-only ------------------------------
{
  const dir = makeRepo();
  try {
    writeState(dir, "t", baseState({ final: { verdict: "pass" } }));
    const r = run([dir, "t", "--json"]);
    check("(c) exits 0", r.code === 0, `got ${r.code}`);
    const j = JSON.parse(r.stdout);
    check('(c) verify_origin === "in-session-only"', j.verify_origin === "in-session-only", `got ${JSON.stringify(j.verify_origin)}`);
    check("(c) consult_rounds === null", j.consult_rounds === null, `got ${JSON.stringify(j.consult_rounds)}`);
    check("(h) no crash output", !/SyntaxError|node:internal|\n {4}at /.test(r.stdout + r.stderr));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// --- (d) audited + consult lane → external-audit -------------------------------
{
  const dir = makeRepo();
  try {
    writeState(dir, "t", baseState({
      phase: "audited",
      consult: { rounds: 2, verdict: "ACCEPT", last_gaps: [], history: [
        { round: 1, at: "2026-08-17T10:10:00.000Z", verdict: "REJECT", summary: "", gaps: [{ category: "bug", severity: "major", issue: "x", fix: "y" }], advisories: [] },
        { round: 2, at: "2026-08-17T10:20:00.000Z", verdict: "ACCEPT", summary: "", gaps: [], advisories: [] },
      ] },
    }));
    const r = run([dir, "t", "--json"]);
    check("(d) exits 0", r.code === 0, `got ${r.code}`);
    const j = JSON.parse(r.stdout);
    check('(d) verify_origin === "external-audit"', j.verify_origin === "external-audit", `got ${JSON.stringify(j.verify_origin)}`);
    check("(d) consult_rounds === 2", j.consult_rounds === 2, `got ${JSON.stringify(j.consult_rounds)}`);
    check("(h) no crash output", !/SyntaxError|node:internal|\n {4}at /.test(r.stdout + r.stderr));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// --- (e) consult history without rounds field → fallback to length -------------
{
  const dir = makeRepo();
  try {
    writeState(dir, "t", baseState({
      consult: { history: [
        { round: 1, at: "2026-08-17T10:10:00.000Z", verdict: "ACCEPT", summary: "", gaps: [], advisories: [] },
      ] },
    }));
    const j = JSON.parse(run([dir, "t", "--json"]).stdout);
    check("(e) consult_rounds falls back to history length (1)", j.consult_rounds === 1, `got ${JSON.stringify(j.consult_rounds)}`);
    check('(e) history alone still grades "external-audit"', j.verify_origin === "external-audit");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// --- (f) text mode prints the origin line --------------------------------------
{
  const dir = makeRepo();
  try {
    writeState(dir, "t", baseState({ final: { verdict: "pass" } }));
    const txt = run([dir, "t"]);
    check('(f) text: in-session line present', txt.stdout.includes("in-session only — never externally audited"));
    writeState(dir, "t2", baseState({
      phase: "audited",
      consult: { rounds: 2, verdict: "ACCEPT", last_gaps: [], history: [
        {}, {}] },
    }));
    const txt2 = run([dir, "t2"]);
    check('(f) text: external audit line with round count', txt2.stdout.includes("external audit (2 rounds)"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// --- (g) legacy state (pre-final-wave, pre-consult) still reports ---------------
{
  const dir = makeRepo();
  try {
    writeState(dir, "old", { slug: "old", intent: "standard", phase: "done", started_at: "2026-01-01T00:00:00.000Z", todos: {} });
    const r = run([dir, "old", "--json"]);
    check("(g) legacy state exits 0", r.code === 0, `got ${r.code}`);
    const j = JSON.parse(r.stdout);
    check('(g) legacy grades "in-session-only"', j.verify_origin === "in-session-only");
    check("(h) no crash output", !/SyntaxError|node:internal|\n {4}at /.test(r.stdout + r.stderr));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// --- token inert invariants (item 06) --------------------------------------------
// Machine-independent by construction: the fixture's started_at/last checkpoint span a tiny window
// far in the past (2020-01-01), so collectRunTokens finds zero usage rows on EVERY machine (or no
// DB at all) — post-fix that deterministically yields an inert object, never a bare null and never
// a crash: tokens_per_todo stays null and text mode prints no stack. Pre-fix (todo 1, RED) these
// fail because tokens === null. Post-fix WITHOUT the :113/:176 guards they fail because an inert
// object is TRUTHY, reaches tokens.totals.total, and run-report dies — exactly the consult-found
// defect class item 06 closes. No live-DB rows, no real-session data, no row counts are asserted.
{
  const dir = makeRepo();
  try {
    writeState(dir, "inert", baseState({
      started_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-01T00:05:00.000Z",
      checkpoints: [{ at: "2020-01-01T00:05:00.000Z", note: "done" }],
    }));
    const r = run([dir, "inert", "--json"]);
    check("(i) inert fixture exits 0 (--json)", r.code === 0, `got ${r.code}`);
    let j = null;
    try { j = JSON.parse(r.stdout); } catch { /* leave null — the checks below report it */ }
    check("(i) tokens.inert === true (populated or stamped, never bare null)",
      j !== null && j.tokens !== null && typeof j.tokens === "object" && j.tokens.inert === true,
      `got ${JSON.stringify(j && j.tokens)}`);
    check("(i) tokens.reason is a non-empty string",
      j !== null && typeof j.tokens?.reason === "string" && j.tokens.reason.length > 0,
      `got ${JSON.stringify(j && j.tokens && j.tokens.reason)}`);
    check("(i) tokens_per_todo === null when tokens are inert", j !== null && j.tokens_per_todo === null, `got ${JSON.stringify(j && j.tokens_per_todo)}`);
    check("(h) no crash output (--json)", !/SyntaxError|node:internal|\n {4}at /.test(r.stdout + r.stderr));
    const txt = run([dir, "inert"]);
    check("(j) inert fixture exits 0 (text mode)", txt.code === 0, `got ${txt.code}`);
    check("(h) no crash output (text mode — an inert must never reach tokens.totals)", !/SyntaxError|node:internal|\n {4}at /.test(txt.stdout + txt.stderr));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
