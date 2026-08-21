#!/usr/bin/env node
// record-todo.mjs — record a todo's status into state.todos (audit gap #9a).
//
// The orchestrator calls this on every dispatch and every return so run-report.mjs has real
// done/failed/retry numbers. Before this, scaffold.mjs initialized todos:{} and NOTHING ever
// populated it, so the scorecard always showed 0/0.
//
// Usage:
//   record-todo.mjs <repo> <slug> <id> <status> [--attempts N] [--session S] [--force-done]
//     status: pending | in_flight | done | failed | blocked
//   exit: 0 ok · 2 bad args · 3 no state file · 7 done refused (no verify evidence) · 9 plan_path isolation violation
//
// Atomic write under O_EXCL lockfile with stale-lock reaping (same pattern as the hooks).

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { execFileSync } from "node:child_process";
import { resolvePlanPath } from "./lib/plan-path.mjs";

const [repo, slug, id, status, ...rest] = argv.slice(2);
if (!repo || !slug || !id || !status) {
  console.error("usage: record-todo.mjs <repo> <slug> <id> <status> [--attempts N] [--session S] [--force-done]");
  exit(2);
}
const VALID = new Set(["pending", "in_flight", "done", "failed", "blocked"]);
if (!VALID.has(status)) {
  console.error("status must be one of: " + [...VALID].join(", "));
  exit(2);
}

const statePath = join(repo, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) {
  console.error("no state file: " + statePath);
  exit(3);
}

// parse optional flags
let attempts, session, force = false;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--attempts") attempts = parseInt(rest[++i], 10);
  else if (rest[i] === "--session") session = rest[++i];
  else if (rest[i] === "--force-done") force = true;
}

// ---------------------------------------------------------------------------
// THE VERIFY TRANSITION GUARD.
//
// record-verify.mjs:9-10 has claimed since it was written that "a todo cannot reach `done`
// without verify evidence (enforced by record-todo.mjs's transition guard, added alongside
// this)". No such guard was ever written. `done` was whatever the orchestrator asserted, which
// made the whole acceptance chain circular: record-verify sets acceptance[id].pass only when
// todos[id].status === "done", and nothing gated "done".
//
// The guard reads state.verify.history — per-criterion records written by record-verify with a
// REAL exit code from a REAL spawn. That source is written independently of todo status, which
// is what breaks the circularity (gating on acceptance[id] instead would deadlock immediately).
//
// --force-done exists because a todo can legitimately have no executable criteria. It is not a
// silent bypass: it stamps forced:true and forced_reason into the todo record, so a forced
// completion is visible in the evidence chain rather than indistinguishable from a verified one.
function verifyEvidenceFor(st, todoId) {
  const hist = (st.verify && Array.isArray(st.verify.history)) ? st.verify.history : [];
  const mine = hist.filter((h) => h && String(h.todo_id) === String(todoId));
  if (mine.length === 0) return { ok: false, reason: "no verify evidence: record-verify.mjs has never run for this todo" };
  const failed = mine.filter((h) => !h.passed && !h.flaky);
  const flaky = mine.filter((h) => h.flaky);
  if (failed.length) return { ok: false, reason: `${failed.length} of ${mine.length} acceptance criteria FAILED (exit codes: ${failed.map((h) => h.exit_code).join(", ")})` };
  if (flaky.length) return { ok: false, reason: `${flaky.length} criterion/criteria are FLAKY (disagreed across two runs) — neither passed nor failed` };

  // COMPLETENESS (2026-08-12, shakedown round 3): "some criteria passed" is not "the todo is
  // verified". The old guard accepted any todo with ≥1 passing record and no failures, so round 3
  // reached `done` with acceptance {pass:false, criteria_run:1, criteria_declared:4} — three
  // quarters of the exam unwritten, and the run finished anyway. The state file even said so; the
  // gate just wasn't reading it.
  //
  // Count what the PLAN declares and require the recorded criteria to cover it. Same source of
  // truth record-verify uses for acceptance[].pass, so the two can no longer disagree.
  // Fail OPEN on an unreadable plan (keep the old behaviour) rather than blocking every run in a
  // repo whose plan cannot be parsed — the ≥1-passing floor still applies there.
  // I3 exception: a plan_path pointing into ANOTHER repo is an isolation violation, not an
  // unreadable plan — exit non-zero with the named reason instead of keeping the floor on
  // foreign bytes.
  const { planPath, violation } = resolvePlanPath(st, repo);
  if (violation) {
    // verifyEvidenceFor runs inside the state-lock section — release before refusing, same
    // as the exit(7) evidence-refusal path below, or the next writer contends on a leaked lock.
    try { if (lockFd) closeSync(lockFd); unlinkSync(lockPath); } catch {}
    console.error(`record-todo.mjs: ${violation} (state: ${statePath})`);
    exit(9);
  }
  try {
    const parsed = JSON.parse(execFileSync(process.execPath,
      [new URL("./parse-plan.mjs", import.meta.url).pathname, planPath],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 }));
    const todo = (parsed.todos || []).find((t) => String(t.id) === String(todoId));
    const declared = todo && Array.isArray(todo.acceptance) ? todo.acceptance.length : null;
    if (declared !== null) {
      const distinct = new Set(mine.map((h) => h.criterion_index)).size;
      if (distinct < declared) {
        return { ok: false, reason: `only ${distinct} of ${declared} declared acceptance criteria have been verified — run the rest through record-verify.mjs first` };
      }
    }
  } catch { /* plan unreadable → keep the ≥1-passing floor */ }

  return { ok: true, count: mine.length };
}

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
// SEC-M10 (external audit #12): the OLD fallback on lock-contention was `direct()` — a non-atomic
// writeFileSync that ALSO skipped the file-lock release + active_todos cleanup the locked path
// performs. That stranded file locks for 30 min (parallel-execute stalls) AND wrote state
// non-atomically (last-writer-wins under contention, the exact race the lock exists to prevent).
// Now: bounded retry-with-backoff, and if the lock genuinely can't be acquired (real deadlock),
// exit non-zero instead of silently degrading. The stale-lock reaper inside acquireLock already
// handles a crashed holder, so contention is normally transient.
let lockFd = null;
for (let attempt = 0; attempt < 10 && lockFd === null; attempt++) {
  lockFd = acquireLock();
  if (lockFd === null) { // wait 50ms then retry (reaper clears a stale lock on the next attempt)
    const _end = Date.now() + 50;
    while (Date.now() < _end) { /* spin-wait */ }
  }
}
if (lockFd === null) {
  console.error("record-todo.mjs: could not acquire state lock after retries (real contention or stuck lock). Refusing to write non-atomically; the todo record was NOT written. Free the lock or raise ZODYSSEY_STALE_HOURS reaper.");
  exit(6);
}
try {
  const st = JSON.parse(readFileSync(statePath, "utf8"));
  st.todos = st.todos && typeof st.todos === "object" ? st.todos : {};
  const prev = st.todos[id] || {};
  const now = new Date().toISOString();

  // Enforce the guard BEFORE any mutation, and release the lock on refusal.
  let ev = null;
  if (status === "done") {
    ev = verifyEvidenceFor(st, id);
    if (!ev.ok && !force) {
      try { closeSync(lockFd); unlinkSync(lockPath); } catch {}
      console.error(
        `record-todo.mjs: REFUSING to mark todo ${id} as done — ${ev.reason}.\n` +
        `  Run the todo's acceptance criteria through record-verify.mjs first.\n` +
        `  If this todo genuinely has no executable criteria, re-run with --force-done ` +
        `(which records forced:true in the evidence chain).`
      );
      exit(7);
    }
  }

  st.todos[id] = {
    status,
    ...(status === "done" ? {
      verified: !!(ev && ev.ok),
      verified_criteria: ev && ev.ok ? ev.count : 0,
      ...(ev && !ev.ok ? { forced: true, forced_reason: ev.reason } : {}),
    } : {}),
    attempts: attempts !== undefined ? attempts : (prev.attempts || 0) + (status === "in_flight" && prev.status !== "in_flight" ? 1 : 0),
    started_at: prev.started_at || (status === "in_flight" ? now : null),
    completed_at: status === "done" || status === "failed" ? now : null,
    session: session || prev.session || null,
    updated_at: now,
  };
  // W7-1 (H4 v3): per-dispatch owner MAP (not a global scalar). Each in-flight executor registers
  // its todo under its owner key, so concurrent executors don't collide on one shared id.
  // pre-tool.mjs resolves myTodo = active_todos[owner] and stamps file_locks[rel].todo with it;
  // self-ownership requires the SAME owner (see hook). Cleared on done/failed/blocked.
  const ownerKey = session || prev.session;
  st.active_todos = (st.active_todos && typeof st.active_todos === "object") ? st.active_todos : {};
  if (status === "in_flight" && ownerKey) st.active_todos[ownerKey] = id;
  else if (["done", "failed", "blocked"].includes(status) && ownerKey && st.active_todos[ownerKey] === id) {
    delete st.active_todos[ownerKey];
  }
  // Lock release (W7-1): drop entries THIS owner holds for THIS todo. Require BOTH todo id AND
  // owner match, so a finishing todo can't free another executor's lock (the W6-3 bug).
  if (status === "done" || status === "failed") {
    const owner = session || prev.session;
    if (st.file_locks && typeof st.file_locks === "object") {
      const kept = {};
      for (const [p, lk] of Object.entries(st.file_locks)) {
        if (!lk) { kept[p] = lk; continue; }
        // W7-1: release ONLY locks this owner holds for this todo. Require BOTH (the W6-3 bug
        // released by todo id alone, freeing another executor's lock under parallelism).
        const mine = lk.todo === id && lk.session === owner;
        if (!mine) kept[p] = lk;
      }
      st.file_locks = kept;
    }
  }
  st.updated_at = now;
  const tmp = statePath + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
  renameSync(tmp, statePath);
} finally {
  try { closeSync(lockFd); unlinkSync(lockPath); } catch {}
}
exit(0);
