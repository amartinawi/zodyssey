#!/usr/bin/env node
// dashboard.test.mjs — unit tests for dashboard.mjs (DESIGN item 21).
//
// Covers the two load-bearing behaviors:
//   (a) on real data (or a fixture mirroring it), renderer exits 0 and stdout
//       contains "win-rate" / "overall" / "seed".
//   (b) on empty/missing eval dir, renderer exits 0 with the no-data message.
//
// Run:  node dashboard.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const DASHBOARD = join(SCRIPT_DIR, "dashboard.mjs");
const REAL_EVAL_DIR = join(process.env.HOME || "", ".zcode", "orchestration", "eval");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  + ${name}`); pass++; }
  else { console.log(`  x ${name} ${detail}`); fail++; }
}

function run(args = []) {
  try {
    const stdout = execFileSync("node", [DASHBOARD, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

// Fixture mirroring the real data shape (results.jsonl + judged.jsonl).
function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "zod-dash-"));
  const results = [
    { slug: "std-01-zodyssey", intent: "standard", phase: "done", verdict: "OKAY", success: true,
      wall_clock_min: 4, review_rounds: 1, todos_total: 1, todos_done: 1, todos_failed: 0,
      todo_retries: 0, resume_events: 0, hook_blocks: 0, capabilities_used: {}, tokens_per_todo: null,
      verify_origin: "external-audit", consult_rounds: 1,
      generated_at: "2026-08-01T20:42:43.442Z" },
    { slug: "std-01-baseline", intent: "standard", phase: "done", verdict: "OKAY", success: false,
      wall_clock_min: 5, review_rounds: 1, todos_total: 1, todos_done: 1, todos_failed: 0,
      todo_retries: 0, resume_events: 0, hook_blocks: 0, capabilities_used: {}, tokens_per_todo: null,
      generated_at: "2026-08-01T20:47:00.000Z" },
    { slug: "arch-01-zodyssey", intent: "architecture", phase: "done", verdict: "OKAY", success: true,
      wall_clock_min: 99.1, review_rounds: 1, todos_total: 1, todos_done: 1, todos_failed: 0,
      todo_retries: 0, resume_events: 0, hook_blocks: 0, capabilities_used: {}, tokens_per_todo: null,
      generated_at: "2026-08-01T22:35:01.873Z" },
  ];
  const judged = [
    { seed_id: "std-01", slug: "std-01-zodyssey", arm: "zodyssey", at: "2026-08-01T20:43:12.652Z",
      overall: 0.83, dimensions: { correctness: 0.95, scope_fidelity: 0.6, verification_rigor: 0.85,
        code_quality: 0.85, efficiency: 0.75 }, criterion_results: [], summary: "", blockers: [] },
    { seed_id: "std-01", slug: "std-01-baseline", arm: "zodyssey", at: "2026-08-01T20:47:01.502Z",
      overall: 0.62, dimensions: { correctness: 0.85, scope_fidelity: 1, verification_rigor: 0.6,
        code_quality: 0.9, efficiency: 1 }, criterion_results: [], summary: "", blockers: [] },
    // (deep audit 2026-08-25, eval finding 3) a judge REFUSAL — overall null, the shape judge.mjs
    // writes when a pass declines to score. The win-rate must exclude it, never launder it as 0.0.
    { seed_id: "std-02", slug: "std-02-zodyssey", arm: "zodyssey", at: "2026-08-01T21:10:00.000Z",
      overall: null, dimensions: {}, criterion_results: [], summary: "", blockers: [] },
  ];
  writeFileSync(join(dir, "results.jsonl"), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(dir, "judged.jsonl"), judged.map((j) => JSON.stringify(j)).join("\n") + "\n");
  return dir;
}

console.log("dashboard.mjs tests\n");

// --- Test 1: fixture data → exit 0 + keywords present ---
{
  const dir = makeFixture();
  try {
    const { code, stdout } = run([dir]);
    check("fixture: exits 0", code === 0, `(got ${code})`);
    check("fixture: contains 'win-rate'", stdout.includes("win-rate"));
    check("fixture: contains 'overall'", stdout.includes("overall"));
    check("fixture: contains 'seed'", stdout.includes("seed"));
    // arm derivation sanity: baseline row appears
    check("fixture: baseline arm derived from -baseline slug", stdout.includes("baseline"));
    // mean overall: zodyssey arm has one judged run at 0.83
    check("fixture: zodyssey mean overall rendered", stdout.includes("0.83"));
    // (eval finding 3) the null-overall refusal is EXCLUDED from win-rate (GAP-1: never a 0.0
    // loss) and disclosed as its own note instead.
    // (the run-log section may still LIST the record with overall "n/a" — a listing is not a
    // score; the win-rate table row shape is `| seed | arm | wins | runs | pct |`.)
    check("fixture: unscored judged record excluded from the win-rate table",
      !/\| std-02 \| zodyssey \| \d+ \| \d+ \|/.test(stdout), "a std-02 win-rate row must not exist");
    check("fixture: unscored disclosure note rendered",
      /1 judged record\(s\) with a non-numeric overall/.test(stdout));
    // verify column (ISNAD R4): the audited record renders its origin, legacy records render "-"
    // (anchored to the FINAL column — verify is the last cell, so a bare .*\| - \| could be
    // satisfied by the overall column rendering "-" and would not witness the verify column)
    check("fixture: verify column header present", stdout.includes("| verify |"));
    check("fixture: audited record shows external-audit in the verify column",
      /std-01-zodyssey[^\n]*\| external-audit \|$/m.test(stdout));
    check("fixture: legacy record (no verify_origin) shows '-' in the verify column",
      /std-01-baseline[^\n]*\| - \|$/m.test(stdout));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Test 2: empty/missing eval dir → exit 0 + no-data message ---
{
  const dir = mkdtempSync(join(tmpdir(), "zod-dash-empty-"));
  try {
    const { code, stdout } = run([dir]);
    check("empty dir: exits 0", code === 0, `(got ${code})`);
    check("empty dir: no-data message", stdout.includes("No eval data yet"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Test 3: missing dir entirely → exit 0 + no-data message ---
{
  const ghost = join(tmpdir(), "zod-dash-ghost-" + Date.now());
  if (existsSync(ghost)) throw new Error("ghost dir should not exist");
  const { code, stdout } = run([ghost]);
  check("missing dir: exits 0", code === 0, `(got ${code})`);
  check("missing dir: no-data message", stdout.includes("No eval data yet"));
}

// --- Test 4: real eval dir (if present) → exit 0 + keywords ---
if (existsSync(REAL_EVAL_DIR)) {
  const { code, stdout } = run([REAL_EVAL_DIR]);
  check("real eval dir: exits 0", code === 0, `(got ${code})`);
  if (code === 0) {
    check("real eval dir: contains 'win-rate'", stdout.includes("win-rate"));
    check("real eval dir: contains 'overall'", stdout.includes("overall"));
  }
} else {
  console.log("  (skipping real-eval-dir test: dir not present)");
}

console.log(`\n${pass} passed, ${fail} failed`);
exit(fail === 0 ? 0 : 1);
