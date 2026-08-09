#!/usr/bin/env node
// record-todo.mjs — record a todo's status into state.todos (audit gap #9a).
//
// The orchestrator calls this on every dispatch and every return so run-report.mjs has real
// done/failed/retry numbers. Before this, scaffold.mjs initialized todos:{} and NOTHING ever
// populated it, so the scorecard always showed 0/0.
//
// Usage:
//   record-todo.mjs <repo> <slug> <id> <status> [--attempts N] [--session S]
//     status: pending | in_flight | done | failed | blocked
//   exit: 0 ok · 2 bad args · 3 no state file
//
// Atomic write under O_EXCL lockfile with stale-lock reaping (same pattern as the hooks).

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

const [repo, slug, id, status, ...rest] = argv.slice(2);
if (!repo || !slug || !id || !status) {
  console.error("usage: record-todo.mjs <repo> <slug> <id> <status> [--attempts N] [--session S]");
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
let attempts, session;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--attempts") attempts = parseInt(rest[++i], 10);
  else if (rest[i] === "--session") session = rest[++i];
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
  st.todos[id] = {
    status,
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
