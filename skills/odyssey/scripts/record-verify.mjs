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
//   record-verify.mjs <repo> <slug> <todo-id> --criterion <cmd> --exit-code <N> [--output <file>] [--n <idx>]
//   exit: 0 ok · 2 bad args · 3 no state file · 6 verification FAILED (exit-code != 0)
//
// Atomic write under O_EXCL lockfile with stale-lock reaping (same pattern as the other writers).

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { spawnSync } from "node:child_process";

const [repo, slug, todoId, ...rest] = argv.slice(2);
if (!repo || !slug || !todoId) {
  console.error("usage: record-verify.mjs <repo> <slug> <todo-id> --criterion <cmd> [--exit-code <N> --trust-argv] [--output <file>] [--n <idx>]");
  exit(2);
}
let criterion, exitCodeStr, outputFile, nStr, trustArgv = false;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--criterion") criterion = rest[++i];
  else if (rest[i] === "--exit-code") exitCodeStr = rest[++i];
  else if (rest[i] === "--output") outputFile = rest[++i];
  else if (rest[i] === "--n") nStr = rest[++i];
  else if (rest[i] === "--trust-argv") trustArgv = true;
}
if (!criterion) {
  console.error("record-verify.mjs: --criterion <cmd> is required");
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

let exitCode, runOutput = "";
if (exitCodeStr !== undefined && trustArgv) {
  // legacy/explicit path: trust the caller's claimed exit code (the orchestrator ran it)
  exitCode = parseInt(exitCodeStr, 10);
  if (Number.isNaN(exitCode)) { console.error("record-verify.mjs: --exit-code <N> is not an integer"); exit(2); }
} else {
  // SEC-H2 default: EXECUTE the criterion. Run in the repo's cwd with a 120s cap. A non-zero or
  // crashed exit records a real failure (signal deaths → exit code > 128). The criterion comes from
  // the plan, which SEC-4 binds via plan_sha256 — so it is the reviewed, tamper-protected command.
  if (exitCodeStr !== undefined && !trustArgv) {
    console.error("record-verify.mjs: --exit-code <N> was supplied WITHOUT --trust-argv. By default the criterion is now EXECUTED (SEC-H2). Pass --trust-argv only if you ran the criterion yourself and are passing its real exit code.");
    exit(2);
  }
  let r;
  try {
    r = spawnSync(criterion, { cwd: repoAbs, shell: true, encoding: "utf8", timeout: 120 * 1000, maxBuffer: 5 * 1024 * 1024 });
  } catch (e) {
    console.error("record-verify.mjs: criterion failed to spawn: " + (e.message || e));
    exitCode = 127; runOutput = String(e);
    r = null;
  }
  if (r) {
    exitCode = (r.status === null) ? (r.signal ? 128 + 1 : 127) : r.status;
    runOutput = ((r.stdout || "") + (r.stderr || "")).slice(0, 50000);
  }
}
const passed = exitCode === 0;
if (outputFile && !runOutput) { try { runOutput = readFileSync(outputFile, "utf8").slice(0, 50000); } catch {} }

const statePath = join(repoAbs, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) { console.error("no state file: " + statePath); exit(3); }

// Write the per-criterion evidence artifact under .zcode/verify/ (gated dir — not bookkeeping,
// so it's evidence the agent cannot forge via direct Write).
const verifyDir = join(repoAbs, ".zcode", "verify", slug);
mkdirSync(verifyDir, { recursive: true });
const artifactPath = join(verifyDir, `${todoId}-${idx}.json`);
const evidence = {
  slug, todo_id: todoId, criterion_index: idx,
  criterion, exit_code: exitCode, passed,
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
  st.verify = st.verify || { total: 0, passed: 0, failed: 0, history: [] };
  // re-count from history to stay accurate across retries of the same criterion
  st.verify.history = Array.isArray(st.verify.history) ? st.verify.history : [];
  // replace any prior entry for this todo+index, then recompute counts
  st.verify.history = st.verify.history.filter((h) => !(h.todo_id === todoId && h.criterion_index === idx));
  st.verify.history.push({ todo_id: todoId, criterion_index: idx, passed, criterion, exit_code: exitCode, at: evidence.recorded_at, artifact: artifactPath });
  st.verify.total = st.verify.history.length;
  st.verify.passed = st.verify.history.filter((h) => h.passed).length;
  st.verify.failed = st.verify.total - st.verify.passed;
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

console.log(JSON.stringify({ artifact: artifactPath, passed, exit_code: exitCode }));
exit(passed ? 0 : 6);
