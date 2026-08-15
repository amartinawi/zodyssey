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
// Resume-format borrow (prime-agent primitive #1, SEC-7 candidate): on each verify record this
// script also populates state.acceptance[todoId] = { pass, at, evidence } and, if a notepad file
// exists at .zcode/notepads/<slug>/<todoId>.md, state.notepad_pointers[todoId] = <abs path>.
// This lets `/orchestrate resume <slug>` re-enter with structured per-todo progress instead of
// just phase + locks. Persistence-FORMAT extension only — no daemon, no scheduler. The state
// fields are OPTIONAL: read/written via `|| {}` so older runs lacking them are not crashed.
//
// Usage:
//   record-verify.mjs <repo> <slug> <todo-id> --criterion <cmd> [--exit-code <N> --trust-argv] [--output <file>] [--n <idx>] [--flake-check [--exit-code-2 <N>]]
//   exit: 0 ok · 2 bad args · 3 no state file · 6 verification FAILED (exit-code != 0) · 7 FLAKY (flake-check runs disagree) · 10 STALLED (workspace unchanged since the last failed attempt; --no-stall-check overrides)
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
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const [repo, slug, todoId, ...rest] = argv.slice(2);
if (!repo || !slug || !todoId) {
  console.error("usage: record-verify.mjs <repo> <slug> <todo-id> --criterion <cmd> [--exit-code <N> --trust-argv] [--output <file>] [--n <idx>] [--flake-check [--exit-code-2 <N>]]");
  exit(2);
}
let criterion, exitCodeStr, exitCode2Str, outputFile, nStr, trustArgv = false, flakeCheck = false, noStallCheck = false;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--criterion") criterion = rest[++i];
  else if (rest[i] === "--exit-code") exitCodeStr = rest[++i];
  else if (rest[i] === "--exit-code-2") exitCode2Str = rest[++i];
  else if (rest[i] === "--output") outputFile = rest[++i];
  else if (rest[i] === "--n") nStr = rest[++i];
  else if (rest[i] === "--trust-argv") trustArgv = true;
  else if (rest[i] === "--flake-check") flakeCheck = true;
  else if (rest[i] === "--no-stall-check") noStallCheck = true;
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

// ---------------------------------------------------------------------------
// NO-PROGRESS STALL DETECTOR (prime-agent primitive, `captureGitWorktreeSnapshot` in
// core/autonomous.ts — the one borrowable primitive left on the table after v0.2.0's fit study).
//
// THE LOOP IT BREAKS: a criterion fails. The executor is dispatched to fix it. It returns having
// changed nothing that matters — a comment, a reformat, or literally nothing. Verify re-runs the
// identical command against an identical workspace and gets the identical failure. Repeat until
// the attempt cap. Failed agentic attempts burn ~3.5x more steps than successful ones, and this
// shape is a large part of why: the harness cannot tell "tried again" from "tried again with
// something different", so it keeps paying for re-runs that cannot possibly differ.
//
// The fix is a fact, not a judgement: if the worktree is byte-identical to what it was at the
// previous FAILED attempt for this exact criterion, the outcome is already known. Refuse to
// re-run, count the attempt anyway (so the cap still advances and the loop terminates), and say
// plainly that nothing changed — which turns an invisible spin into a specific, actionable report.
//
// Fingerprint = tracked status + tracked diff + untracked file contents. Untracked CONTENT has to
// be in there: `git status --porcelain` lists untracked files by NAME, so a fix that only edits an
// untracked file would otherwise look like no change at all and be wrongly reported as a stall.
// Non-git repos have no fingerprint → the detector stays inert rather than guessing.
// `.zcode/` MUST be excluded. It holds this run's own state, plans, notepads, and the verify
// artifacts THIS SCRIPT writes on every invocation. Including it makes the fingerprint change on
// every call by construction, so the detector could never fire — and it would have failed exactly
// that way in production, because a user's repo does not gitignore `.zcode/` (only ZOdyssey's own
// repo does). Excluded via pathspec, with a JS-side filter behind it in case the pathspec form is
// unsupported: the fingerprint must describe the WORK, not the bookkeeping about the work.
const EXCLUDE_ZCODE = [".", ":(exclude).zcode", ":(exclude).zcode/**"];
function worktreeFingerprint(repoDir) {
  try {
    const status = execFileSync("git", ["-C", repoDir, "status", "--porcelain=v1", "-uall", "--no-renames", "--", ...EXCLUDE_ZCODE],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    const diff = execFileSync("git", ["-C", repoDir, "diff", "HEAD", "--", ...EXCLUDE_ZCODE],
      { encoding: "utf8", maxBuffer: 40 * 1024 * 1024 });
    const untracked = execFileSync("git", ["-C", repoDir, "ls-files", "--others", "--exclude-standard", "--", ...EXCLUDE_ZCODE],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
      .split("\n").map((s) => s.trim())
      .filter((p) => p && !p.startsWith(".zcode/") && p !== ".zcode");
    const h = createHash("sha256")
      .update(status.split("\n").filter((l) => !/\s\.zcode\//.test(l)).join("\n"))
      .update(diff);
    for (const rel of untracked.sort()) {
      h.update(rel);
      try { h.update(readFileSync(join(repoDir, rel))); } catch { h.update("<unreadable>"); }
    }
    return h.digest("hex");
  } catch {
    return null; // not a git repo, or git unavailable → detector inert
  }
}

const fingerprint = worktreeFingerprint(repoAbs);
const statePathEarly = join(repoAbs, ".zcode", "state", `${slug}.json`);
if (fingerprint && existsSync(statePathEarly) && !noStallCheck) {
  try {
    const stEarly = JSON.parse(readFileSync(statePathEarly, "utf8"));
    const prior = ((stEarly.verify && stEarly.verify.history) || [])
      .filter((h) => h && String(h.todo_id) === String(todoId) && h.criterion_index === idx && !h.passed)
      .pop();
    if (prior && prior.worktree === fingerprint) {
      const attempts = (prior.stall_attempts || 0) + 1;
      // Record the refusal as evidence and advance the attempt counter, so the run still converges
      // on its cap instead of spinning silently.
      const lockedWrite = (mut) => {
        const st = JSON.parse(readFileSync(statePathEarly, "utf8"));
        mut(st);
        st.updated_at = new Date().toISOString();
        const tmp = statePathEarly + ".tmp." + process.pid;
        writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
        renameSync(tmp, statePathEarly);
      };
      try {
        lockedWrite((st) => {
          const rec = (st.verify.history || []).find((h) =>
            String(h.todo_id) === String(todoId) && h.criterion_index === idx && !h.passed);
          if (rec) { rec.stall_attempts = attempts; rec.last_stall_at = new Date().toISOString(); }
        });
      } catch { /* evidence write is best-effort; the refusal below still stands */ }
      console.error(
        `NOT RERUN: the workspace is unchanged since this criterion last failed.\n` +
        `  todo ${todoId}, criterion #${idx}: ${criterion.slice(0, 120)}\n` +
        `  worktree fingerprint ${fingerprint.slice(0, 12)} is identical to the previous failed attempt` +
        ` (stall #${attempts}).\n` +
        `  Re-running cannot produce a different result. Either change the code, or if the criterion\n` +
        `  itself is wrong, say so and re-plan — do not retry unchanged. (--no-stall-check overrides.)`
      );
      exit(10);
    }
  } catch { /* unreadable state → fall through and run normally */ }
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
  // `worktree` is what the stall detector compares against on the NEXT attempt: the fingerprint of
  // the workspace that produced this result. Null in a non-git repo, which keeps the detector inert
  // there rather than guessing.
  st.verify.history.push({ todo_id: todoId, criterion_index: idx, passed, status, flaky, criterion, exit_code: exitCode, ...(flakeCheck ? { exit_code_2: exitCode2 } : {}), worktree: fingerprint, at: evidence.recorded_at, artifact: artifactPath });
  st.verify.total = st.verify.history.length;
  st.verify.passed = st.verify.history.filter((h) => h.passed).length;
  // A flaky entry is counted in `flaky` and EXCLUDED from `failed` (it is a distinct state, not a
  // failure). failed = total - passed - flaky.
  st.verify.flaky = st.verify.history.filter((h) => h.flaky).length;
  st.verify.failed = st.verify.total - st.verify.passed - st.verify.flaky;

  // Resume-format borrow (prime-agent #1, SEC-7 candidate): populate optional per-todo
  // acceptance + notepad pointers so /orchestrate resume <slug> re-enters with structured
  // progress. The `pass` here rolls up across this todo's criteria: any non-passing
  // (failed/flaky) criterion marks the todo's acceptance as not-passed. Fields are accessed
  // via `|| {}` so older state without them does not crash this writer.
  st.acceptance = st.acceptance || {};
  // a todo's acceptance.pass is true only if the todo is DONE AND EVERY recorded criterion
  // for it has passed. The status gate closes the mid-verify race (audit advisory #1): without it,
  // pass would flip true after criterion N while criteria N+1..M are still unrun, and a resuming
  // orchestrator reading SKILL.md's skip-on-pass guidance would prematurely skip the todo.
  const allForTodo = st.verify.history.filter((h) => h.todo_id === todoId);
  const todoStatus = (st.todos && st.todos[todoId] && st.todos[todoId].status) || null;

  // COMPLETENESS, NOT STATUS (2026-08-12, from the first end-to-end shakedown run).
  //
  // The old rule was `todoStatus === 'done'`. It closed a real race — pass must not flip true
  // after criterion N while N+1..M are still unrun — but it did so with the wrong proxy, and the
  // natural call order is verify-then-done, so `acceptance[id].pass` read FALSE on every
  // successfully verified todo. The shakedown observed exactly that: verify.history 4/4 passed,
  // todos.verified true, and acceptance[1|2].pass false. A field that is always false is worse
  // than absent, because a resuming orchestrator reads it as "not yet accepted" and redoes work
  // that is already done.
  //
  // The honest question is not "is the todo marked done" but "have ALL of this todo's criteria
  // been run and passed". So count what the PLAN declares for this todo and require the recorded
  // criteria to cover it. That closes the same race without depending on call order.
  //
  // Fail closed: if the plan cannot be read or the todo is not in it, fall back to the old
  // status gate rather than assuming completeness from an unknown denominator.
  let expectedCriteria = null;
  try {
    const planPath = st.plan_path || join(repoAbs, ".zcode", "plans", `${slug}.md`);
    const parsed = JSON.parse(execFileSync(process.execPath,
      [new URL("./parse-plan.mjs", import.meta.url).pathname, planPath],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }));
    const todo = (parsed.todos || []).find((t) => String(t.id) === String(todoId));
    if (todo && Array.isArray(todo.acceptance)) expectedCriteria = todo.acceptance.length;
  } catch { expectedCriteria = null; }

  const distinctRun = new Set(allForTodo.map((h) => h.criterion_index)).size;
  const allRecordedPassed = allForTodo.length > 0 && allForTodo.every((h) => h.passed);
  const allPass = expectedCriteria === null
    ? (todoStatus === "done" && allRecordedPassed)              // unknown denominator → old gate
    : (allRecordedPassed && distinctRun >= expectedCriteria);   // every declared criterion ran and passed

  st.acceptance[todoId] = {
    pass: allPass,
    at: evidence.recorded_at,
    evidence: artifactPath,
    criteria_run: distinctRun,
    ...(expectedCriteria !== null ? { criteria_declared: expectedCriteria } : {}),
  };

  st.notepad_pointers = st.notepad_pointers || {};
  const notepadPath = join(repoAbs, ".zcode", "notepads", slug, `${todoId}.md`);
  if (existsSync(notepadPath)) {
    st.notepad_pointers[todoId] = notepadPath;
  }

  st.updated_at = evidence.recorded_at;
  return st;
}
const lockFd = acquireLock();
if (lockFd === null) {
  // T2-1: was a non-atomic unlocked write that silently clobbered the lock holder. Refuse instead.
  console.error("record-verify.mjs: could not acquire the state lock (real contention or a stuck lock). Refusing to write non-atomically — nothing was written. The verify record was NOT written.");
  exit(6);
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
