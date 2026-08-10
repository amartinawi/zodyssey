#!/usr/bin/env node
// record-verify.mjs — the TRUSTED writer for phase-5 (VERIFY) evidence (operational-consult CRIT-2).
//
// The central operational defect: phase 3 (review) binds OKAY to an unforgeable nonce→artifact→
// plan-sha chain, but phase 5 (verify) — which actually decides if the output is correct — had no
// script, no artifact, no state field. record-todo.mjs recorded only `status`. This script mirrors
// the review-gate pattern: each acceptance criterion's command + exit code + output is recorded as
// evidence under <repo>/.zcode/verify/<slug>/<todo-id>-<n>.json, and the run's state.verify lane
// tracks pass/fail counts. A todo cannot reach `done` without verify evidence (enforced by
// record-todo.mjs's transition guard, added alongside this).
//
// Usage:
//   record-verify.mjs <repo> <slug> <todo-id> --criterion <cmd> [--exit-code <N> --trust-argv] [--output <file>] [--n <idx>] [--flake-check [--exit-code-2 <N>]]
//   exit: 0 ok · 2 bad args · 3 no state file · 6 verification FAILED (exit-code != 0) · 7 FLAKY (flake-check runs disagree)
//
// --flake-check (opt-in, default OFF): runs the criterion a SECOND time and compares exit codes.
//   - default (execute) path: the criterion is spawned twice in this process.
//   - --trust-argv path: the SECOND run's exit code is supplied via --exit-code-2 <N> (mandatory
//     when --flake-check + --trust-argv are combined; the orchestrator ran the criterion twice).
//   If the two exit codes disagree (one 0, the other non-zero) the criterion is recorded as FLAKY
//   — a state DISTINCT from passed/failed — and the script exits 7 with a stderr surface message.
//   When --flake-check is absent, behavior is byte-identical to the single-run path.
//
// Atomic write under O_EXCL lockfile with stale-lock reaping (same pattern as the other writers).

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { spawnSync } from "node:child_process";

const [repo, slug, todoId, ...rest] = argv.slice(2);
if (!repo || !slug || !todoId) {
  console.error("usage: record-verify.mjs <repo> <slug> <todo-id> --criterion <cmd> [--exit-code <N> --trust-argv] [--output <file>] [--n <idx>] [--flake-check [--exit-code-2 <N>]]");
  exit(2);
}
let criterion, exitCodeStr, exitCode2Str, outputFile, nStr, trustArgv = false, flakeCheck = false;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--criterion") criterion = rest[++i];
  else if (rest[i] === "--exit-code") exitCodeStr = rest[++i];
  else if (rest[i] === "--exit-code-2") exitCode2Str = rest[++i];
  else if (rest[i] === "--output") outputFile = rest[++i];
  else if (rest[i] === "--n") nStr = rest[++i];
  else if (rest[i] === "--trust-argv") trustArgv = true;
  else if (rest[i] === "--flake-check") flakeCheck = true;
}
if (!criterion) {
  console.error("record-verify.mjs: --criterion <cmd> is required");
  exit(2);
}
// --flake-check + --trust-argv REQUIRES --exit-code-2 (the caller must supply the second run's exit).
if (flakeCheck && trustArgv && exitCode2Str === undefined) {
  console.error("record-verify.mjs: --flake-check with --trust-argv requires --exit-code-2 <N> (the second run's real exit code)");
  exit(2);
}
// --exit-code-2 without --flake-check is meaningless — reject to keep argv shape clean.
if (exitCode2Str !== undefined && !flakeCheck) {
  console.error("record-verify.mjs: --exit-code-2 <N> was supplied WITHOUT --flake-check. It is only meaningful alongside --flake-check.");
  exit(2);
}
// SEC-H2 (external audit #2 + in-session F2): the OLD code took the exit code from --exit-code argv
// (caller-supplied) and computed `passed = exitCode === 0` — so an agent could pass --exit-code 0
// for a failing test and record verified evidence without the criterion ever running. Now the
// criterion is EXECUTED by default and its real exit code is used. The legacy --exit-code path is
// still allowed but ONLY behind an explicit --trust-argv flag (visible opt-in, for the case where
// the orchestrator genuinely ran the command itself). --criterion is now mandatory on its own.
const idx = nStr ? parseInt(nStr, 10) : 1;

const repoAbs = (() => { try { return realpathSync(repo); } catch { return repo; } })();

// runOnce: executes (or trusts) the criterion ONCE and returns { exitCode, output }.
// - trustArgv && claimedExit !== undefined → use the caller-supplied exit code (legacy/explicit).
// - otherwise → spawn the criterion in repoAbs cwd with a 120s cap (SEC-H2 default).
function runOnce(claimedExit) {
  if (trustArgv && claimedExit !== undefined) {
    const ec = parseInt(claimedExit, 10);
    if (Number.isNaN(ec)) { console.error("record-verify.mjs: --exit-code <N> is not an integer"); exit(2); }
    return { exitCode: ec, output: "" };
  }
  let r;
  try {
    r = spawnSync(criterion, { cwd: repoAbs, shell: true, encoding: "utf8", timeout: 120 * 1000, maxBuffer: 5 * 1024 * 1024 });
  } catch (e) {
    console.error("record-verify.mjs: criterion failed to spawn: " + (e.message || e));
    return { exitCode: 127, output: String(e) };
  }
  const ec = (r.status === null) ? (r.signal ? 128 + 1 : 127) : r.status;
  const out = ((r.stdout || "") + (r.stderr || "")).slice(0, 50000);
  return { exitCode: ec, output: out };
}

// SEC-H2 (external audit #2 + in-session F2): the OLD code took the exit code from --exit-code argv
// (caller-supplied) and computed `passed = exitCode === 0` — so an agent could pass --exit-code 0
// for a failing test and record verified evidence without the criterion ever running. Now the
// criterion is EXECUTED by default and its real exit code is used. The legacy --exit-code path is
// still allowed but ONLY behind an explicit --trust-argv flag (visible opt-in, for the case where
// the orchestrator genuinely ran the command itself). --criterion is now mandatory on its own.
if (exitCodeStr !== undefined && !trustArgv) {
  console.error("record-verify.mjs: --exit-code <N> was supplied WITHOUT --trust-argv. By default the criterion is now EXECUTED (SEC-H2). Pass --trust-argv only if you ran the criterion yourself and are passing its real exit code.");
  exit(2);
}

// First run (always happens).
const run1 = runOnce(exitCodeStr);
let exitCode = run1.exitCode;
let runOutput = run1.output;

// Optional SECOND run for flake detection (only when --flake-check is set).
// In the trust-argv path the second exit code comes from --exit-code-2; in the execute path the
// criterion is spawned a second time here. The two exit codes are compared below.
let exitCode2 = undefined, runOutput2 = "";
if (flakeCheck) {
  if (trustArgv) {
    const r2 = runOnce(exitCode2Str);
    exitCode2 = r2.exitCode;
    runOutput2 = r2.output;
  } else {
    const r2 = runOnce(undefined);
    exitCode2 = r2.exitCode;
    runOutput2 = r2.output;
  }
}

// Status determination:
//   - flakeCheck off: passed iff exitCode === 0 (the original single-run semantics).
//   - flakeCheck on:  passed iff BOTH runs are 0; failed iff BOTH non-zero; FLAKY iff they disagree.
let passed, flaky = false;
if (flakeCheck) {
  const pass1 = exitCode === 0, pass2 = exitCode2 === 0;
  if (pass1 !== pass2) {
    flaky = true;
    passed = false; // a FLAKY criterion is NOT passed — it is surfaced, never silently accepted
  } else {
    passed = pass1 && pass2;
  }
} else {
  passed = exitCode === 0;
}
if (outputFile && !runOutput) { try { runOutput = readFileSync(outputFile, "utf8").slice(0, 50000); } catch {} }

const statePath = join(repoAbs, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) { console.error("no state file: " + statePath); exit(3); }

// Write the per-criterion evidence artifact under .zcode/verify/ (gated dir — not bookkeeping,
// so it's evidence the agent cannot forge via direct Write).
const verifyDir = join(repoAbs, ".zcode", "verify", slug);
mkdirSync(verifyDir, { recursive: true });
const artifactPath = join(verifyDir, `${todoId}-${idx}.json`);
// status: a single human/machine-readable state. "flaky" is DISTINCT from "failed" — a flaky
// criterion is surfaced for human review, never silently marked failed (which would hide that the
// first run passed only by luck) nor silently passed (which would hide that the second run failed).
const status = flaky ? "flaky" : (passed ? "passed" : "failed");
const evidence = {
  slug, todo_id: todoId, criterion_index: idx,
  criterion, exit_code: exitCode, passed,
  status, // "passed" | "failed" | "flaky"
  flaky, // boolean — true iff flake-check runs disagreed (one 0, other non-zero)
  flake_check: flakeCheck, // whether --flake-check was active for this record
  ...(flakeCheck ? { exit_code_2: exitCode2 } : {}), // second run's exit code (only when flake-check)
  executed: !trustArgv, // SEC-H2: true when this script ran the criterion itself
  output: runOutput || null,
  recorded_at: new Date().toISOString(),
};
const tmp = artifactPath + ".tmp." + process.pid;
writeFileSync(tmp, JSON.stringify(evidence, null, 2) + "\n");
try { renameSync(tmp, artifactPath); } catch { try { unlinkSync(tmp); } catch {} }

// Update state.verify lane atomically (pass/fail counts + history).
const LOCK_STALE_MS = 60 * 1000;
const lockPath = statePath + ".lock";
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
function apply(st) {
  st.verify = st.verify || { total: 0, passed: 0, failed: 0, flaky: 0, history: [] };
  // re-count from history to stay accurate across retries of the same criterion
  st.verify.history = Array.isArray(st.verify.history) ? st.verify.history : [];
  // replace any prior entry for this todo+index, then recompute counts
  st.verify.history = st.verify.history.filter((h) => !(h.todo_id === todoId && h.criterion_index === idx));
  st.verify.history.push({ todo_id: todoId, criterion_index: idx, passed, status, flaky, criterion, exit_code: exitCode, ...(flakeCheck ? { exit_code_2: exitCode2 } : {}), at: evidence.recorded_at, artifact: artifactPath });
  st.verify.total = st.verify.history.length;
  st.verify.passed = st.verify.history.filter((h) => h.passed).length;
  // A flaky entry is counted in `flaky` and EXCLUDED from `failed` (it is a distinct state, not a
  // failure). failed = total - passed - flaky.
  st.verify.flaky = st.verify.history.filter((h) => h.flaky).length;
  st.verify.failed = st.verify.total - st.verify.passed - st.verify.flaky;
  st.updated_at = evidence.recorded_at;
  return st;
}
const lockFd = acquireLock();
if (lockFd === null) {
  try { writeFileSync(statePath, JSON.stringify(apply(JSON.parse(readFileSync(statePath, "utf8"))), null, 2) + "\n"); } catch {}
} else {
  try {
    const st = apply(JSON.parse(readFileSync(statePath, "utf8")));
    const stmp = statePath + ".tmp." + process.pid;
    writeFileSync(stmp, JSON.stringify(st, null, 2) + "\n");
    renameSync(stmp, statePath);
  } finally { try { closeSync(lockFd); unlinkSync(lockPath); } catch {} }
}

// Surface FLAKY to the human: a distinct stderr line so the orchestrator/operator sees that the
// two flake-check runs disagreed. This is the "surface it" requirement — flaky must NOT be silent.
if (flaky) {
  console.error(`record-verify.mjs: FLAKY criterion detected for todo ${todoId} [${idx}] — run 1 exit ${exitCode}, run 2 exit ${exitCode2}. Surfaced for human review (not passed, not failed).`);
}
console.log(JSON.stringify({ artifact: artifactPath, passed, status, ...(flaky ? { flaky: true } : {}), exit_code: exitCode }));
// Exit codes: 0 passed · 6 failed · 7 FLAKY. A FLAKY criterion is non-zero (so the caller cannot
// treat it as done) but uses a DISTINCT code from a plain failure, so the orchestrator can route
// flaky outcomes to human review instead of retry-as-failed.
exit(flaky ? 7 : (passed ? 0 : 6));
