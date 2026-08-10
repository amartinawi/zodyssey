#!/usr/bin/env node
// record-verify.test.mjs — unit tests for record-verify.mjs (todo 8: flake detection).
//
// Covers three behaviors:
//   (a) WITHOUT --flake-check: single-run semantics preserved (executes the criterion, exit 0
//       on pass, exit 6 on fail; artifact has no `flaky`/`exit_code_2` fields; status is
//       "passed"/"failed").
//   (b) WITH --flake-check + two agreeing-0 runs → passed (status "passed", flaky false,
//       artifact carries exit_code_2: 0).
//   (c) WITH --flake-check + run-1 exit 0, run-2 exit 1 → FLAKY (status "flaky", flaky true,
//       distinct from failed; script exits 7; state.verify.flaky incremented; state.verify.failed
//       NOT incremented).
//
// Fixtures: a tmp repo with a minimal state.json (so the "no state file" exit-3 path is avoided),
// plus a tiny shell criterion whose exit code is controlled by a flag file written between runs.
// All fixture dirs are torn down with rmSync.
//
// Run:  node record-verify.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const RECORD = join(SCRIPT_DIR, "record-verify.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  \u2713 ${name}`); pass++; }
  else { console.log(`  \u2717 ${name} ${detail}`); fail++; }
}

// Minimal state.json skeleton — record-verify only needs the file to exist + parse; it lazily
// creates state.verify on first write.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "zod-verify-test-"));
  mkdirSync(join(dir, ".zcode", "state"), { recursive: true });
  writeFileSync(join(dir, ".zcode", "state", "test-slug.json"),
    JSON.stringify({ slug: "test-slug", phase: "verify", verify: { total: 0, passed: 0, failed: 0, history: [] } }, null, 2) + "\n");
  return dir;
}

// Run record-verify.mjs as a child process; return { status, stdout, stderr }.
// Uses spawnSync (not execFileSync) so we can observe non-zero exits without throwing.
function runRecord(args, cwd) {
  const r = spawnSync("node", [RECORD, ...args], { encoding: "utf8", cwd });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function readState(repo) {
  return JSON.parse(readFileSync(join(repo, ".zcode", "state", "test-slug.json"), "utf8"));
}
function readArtifact(repo, todoId, idx = 1) {
  return JSON.parse(readFileSync(join(repo, ".zcode", "verify", "test-slug", `${todoId}-${idx}.json`), "utf8"));
}

console.log("record-verify.mjs unit tests (flake detection)\n");

// --- (a) WITHOUT --flake-check: single-run pass preserved ---
{
  const repo = makeRepo();
  try {
    // A criterion that exits 0 (executed by default — SEC-H2 path).
    const r = runRecord([repo, "test-slug", "todo-a", "--criterion", "exit 0"], repo);
    check("(a) no flake-check: exit 0 on pass", r.status === 0, `(got status ${r.status}, stderr: ${r.stderr.trim()})`);
    const out = JSON.parse(r.stdout.trim());
    check("(a) stdout status 'passed'", out.status === "passed", `(got ${JSON.stringify(out)})`);
    check("(a) stdout passed true", out.passed === true);
    check("(a) stdout no flaky field", out.flaky === undefined, `(got ${JSON.stringify(out)})`);
    const art = readArtifact(repo, "todo-a");
    check("(a) artifact status 'passed'", art.status === "passed");
    check("(a) artifact flaky false", art.flaky === false);
    check("(a) artifact flake_check false", art.flake_check === false);
    check("(a) artifact has NO exit_code_2", art.exit_code_2 === undefined);
    const st = readState(repo);
    check("(a) state.verify.passed === 1", st.verify.passed === 1, `(got ${st.verify.passed})`);
    check("(a) state.verify.failed === 0", st.verify.failed === 0);
    check("(a) state.verify.flaky === 0", st.verify.flaky === 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (a2) WITHOUT --flake-check: single-run FAIL preserved (exit 6) ---
{
  const repo = makeRepo();
  try {
    const r = runRecord([repo, "test-slug", "todo-a2", "--criterion", "exit 3"], repo);
    check("(a2) no flake-check: exit 6 on fail", r.status === 6, `(got status ${r.status})`);
    const out = JSON.parse(r.stdout.trim());
    check("(a2) stdout status 'failed'", out.status === "failed", `(got ${JSON.stringify(out)})`);
    check("(a2) stdout passed false", out.passed === false);
    const art = readArtifact(repo, "todo-a2");
    check("(a2) artifact status 'failed' (NOT flaky)", art.status === "failed");
    check("(a2) artifact flaky false", art.flaky === false);
    const st = readState(repo);
    check("(a2) state.verify.failed === 1", st.verify.failed === 1);
    check("(a2) state.verify.flaky === 0", st.verify.flaky === 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (b) WITH --flake-check + two agreeing-0 runs → PASSED ---
// Use --trust-argv + --exit-code 0 + --exit-code-2 0 so the test is deterministic and does not
// depend on a flaky external process. This exercises the flake-check comparison logic directly.
{
  const repo = makeRepo();
  try {
    const r = runRecord([
      repo, "test-slug", "todo-b",
      "--criterion", "true",
      "--exit-code", "0", "--trust-argv",
      "--flake-check", "--exit-code-2", "0",
    ], repo);
    check("(b) flake-check both-0: exit 0 (passed)", r.status === 0, `(got status ${r.status}, stderr: ${r.stderr.trim()})`);
    const out = JSON.parse(r.stdout.trim());
    check("(b) stdout status 'passed'", out.status === "passed", `(got ${JSON.stringify(out)})`);
    check("(b) stdout flaky absent/false", out.flaky === undefined || out.flaky === false);
    const art = readArtifact(repo, "todo-b");
    check("(b) artifact status 'passed'", art.status === "passed");
    check("(b) artifact flaky false", art.flaky === false);
    check("(b) artifact flake_check true", art.flake_check === true);
    check("(b) artifact exit_code_2 === 0", art.exit_code_2 === 0);
    const st = readState(repo);
    check("(b) state.verify.passed === 1", st.verify.passed === 1);
    check("(b) state.verify.flaky === 0", st.verify.flaky === 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (c) WITH --flake-check + run-1 exit 0, run-2 exit 1 → FLAKY ---
// The headline case: two runs DISAGREE → distinct FLAKY state.
{
  const repo = makeRepo();
  try {
    const r = runRecord([
      repo, "test-slug", "todo-c",
      "--criterion", "true",
      "--exit-code", "0", "--trust-argv",
      "--flake-check", "--exit-code-2", "1",
    ], repo);
    check("(c) flake-check disagree: exit 7 (FLAKY)", r.status === 7, `(got status ${r.status})`);
    const out = JSON.parse(r.stdout.trim());
    check("(c) stdout status 'flaky'", out.status === "flaky", `(got ${JSON.stringify(out)})`);
    check("(c) stdout flaky true", out.flaky === true);
    check("(c) stdout passed false", out.passed === false);
    // Surface message on stderr (the "surface it" requirement).
    check("(c) stderr mentions FLAKY", /FLAKY/i.test(r.stderr), `(stderr was: ${r.stderr.trim()})`);
    const art = readArtifact(repo, "todo-c");
    check("(c) artifact status 'flaky' (NOT 'failed')", art.status === "flaky", `(got ${art.status})`);
    check("(c) artifact flaky true", art.flaky === true);
    check("(c) artifact flake_check true", art.flake_check === true);
    check("(c) artifact exit_code 0 (run 1)", art.exit_code === 0);
    check("(c) artifact exit_code_2 1 (run 2)", art.exit_code_2 === 1);
    const st = readState(repo);
    // The distinct-state invariant: flaky is counted in flaky, NOT in failed.
    check("(c) state.verify.flaky === 1", st.verify.flaky === 1, `(got ${st.verify.flaky})`);
    check("(c) state.verify.failed === 0 (flaky is NOT failed)", st.verify.failed === 0, `(got ${st.verify.failed})`);
    check("(c) state.verify.passed === 0", st.verify.passed === 0);
    check("(c) history entry has status 'flaky'", st.verify.history[0] && st.verify.history[0].status === "flaky");
    check("(c) history entry has flaky true", st.verify.history[0] && st.verify.history[0].flaky === true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (c2) flake-check via EXECUTE path: a genuinely flaky shell criterion ---
// The criterion reads a flag file: run 1 the file is absent (exit 0); we cannot flip it between
// the two in-process spawns, so instead prove the EXECUTE-path second spawn actually happens and
// can produce a flaky result by using a criterion whose own behavior differs across invocations.
// We make the criterion toggle a counter file: even invocations exit 0, odd exit 1. Two spawns
// therefore always disagree → FLAKY.
{
  const repo = makeRepo();
  try {
    // criterion: increments <repo>/.zcode/invoke-counter; exit 0 on even, 1 on odd.
    const counter = join(repo, ".zcode", "invoke-counter");
    // Bootstrap at 0 so first invocation → 1 (odd) exit 1, second → 2 (even) exit 0.
    writeFileSync(counter, "0");
    const criterion = `n=$(cat "${counter}"); n=$((n+1)); echo "$n" > "${counter}"; test $((n % 2)) -eq 0`;
    const r = runRecord([repo, "test-slug", "todo-c2", "--criterion", criterion, "--flake-check"], repo);
    check("(c2) execute-path flake-check disagree: exit 7 (FLAKY)", r.status === 7, `(got status ${r.status}, stderr: ${r.stderr.trim()})`);
    const out = JSON.parse(r.stdout.trim());
    check("(c2) stdout status 'flaky'", out.status === "flaky", `(got ${JSON.stringify(out)})`);
    const art = readArtifact(repo, "todo-c2");
    check("(c2) artifact flaky true", art.flaky === true);
    check("(c2) artifact executed true (this process spawned it)", art.executed === true);
    check("(c2) artifact exit_code_2 present", art.exit_code_2 !== undefined);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (d) argv guards: --flake-check + --trust-argv WITHOUT --exit-code-2 → exit 2 ---
{
  const repo = makeRepo();
  try {
    const r = runRecord([
      repo, "test-slug", "todo-d",
      "--criterion", "true",
      "--exit-code", "0", "--trust-argv",
      "--flake-check", // missing --exit-code-2
    ], repo);
    check("(d) flake-check+trust-argv without --exit-code-2: exit 2", r.status === 2, `(got status ${r.status})`);
    check("(d) error mentions --exit-code-2", /--exit-code-2/.test(r.stderr));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (e) argv guard: --exit-code-2 WITHOUT --flake-check → exit 2 ---
{
  const repo = makeRepo();
  try {
    const r = runRecord([
      repo, "test-slug", "todo-e",
      "--criterion", "true",
      "--exit-code", "0", "--trust-argv",
      "--exit-code-2", "0", // without --flake-check
    ], repo);
    check("(e) --exit-code-2 without --flake-check: exit 2", r.status === 2, `(got status ${r.status})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (f) flake-check + both-non-zero (agree) → FAILED (not flaky) ---
{
  const repo = makeRepo();
  try {
    const r = runRecord([
      repo, "test-slug", "todo-f",
      "--criterion", "false",
      "--exit-code", "1", "--trust-argv",
      "--flake-check", "--exit-code-2", "2",
    ], repo);
    check("(f) flake-check both-non-zero: exit 6 (failed, not flaky)", r.status === 6, `(got status ${r.status})`);
    const out = JSON.parse(r.stdout.trim());
    check("(f) stdout status 'failed'", out.status === "failed", `(got ${JSON.stringify(out)})`);
    const art = readArtifact(repo, "todo-f");
    check("(f) artifact status 'failed'", art.status === "failed");
    check("(f) artifact flaky false (agreeing fails are NOT flaky)", art.flaky === false);
    const st = readState(repo);
    check("(f) state.verify.failed === 1", st.verify.failed === 1);
    check("(f) state.verify.flaky === 0", st.verify.flaky === 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
