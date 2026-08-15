#!/usr/bin/env node
// stop.mjs — ZOdyssey Stop hook. When the orchestrator stops mid-run, append a checkpoint
// to the active run's state.json so /orchestrate resume <slug> is current.
//
// NO-OP unless an orchestration run is active. Never blocks (exit 0 always).
//
// audit 2026-08-01 gap #5 (rest of T5):
//   · change-detected — only append a checkpoint when state actually changed since the last
//     one (phase moved or done-todo count changed). Without this, every assistant turn
//     appended a checkpoint forever → unbounded growth + a meaningless resume metric.
//   · the checkpoint now records phase + done-todo count (DESIGN §6 "capture phase + progress").
//   · atomic write via temp-then-rename under an O_EXCL lockfile (last-writer-safe against
//     concurrent stops and against pre-tool.mjs / consult.mjs state writes).
//
// stdin: ZCode Stop hook JSON (we ignore the body; we just need to know we stopped).

import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { exit } from "node:process";
import { findActiveRuns, mostRecent, STALE_MS_DEFAULT, TERMINAL } from "./lib/find-run.mjs";
import { resolvePath } from "../scripts/lib/repo-path.mjs";

const PROJECT_DIR =
  resolvePath(process.env.CLAUDE_PROJECT_DIR || process.env.ZCODE_PROJECT_DIR || process.cwd());
// A run whose updated_at is older than this is treated as inactive (abandoned mid-run).
const STALE_MS = (() => {
  const h = parseFloat(process.env.ZODYSSEY_STALE_HOURS || "24");
  return Number.isFinite(h) && h > 0 ? h * 3600 * 1000 : STALE_MS_DEFAULT;
})();

try {
  readFileSync(0, "utf8"); // drain stdin
} catch {
  // ignore
}

// SEC-H4 (external audit #3 + in-session F6): findActiveRun is now the SHARED DFS discovery
// (hooks/lib/find-run.mjs). Was flat here while pre-tool was fixed (#6a) — so nested-repo runs
// never got a resume checkpoint written. stop is a Stop event (no single target path), so use
// most-recent selection. activePath comes from the discovery record.
const _runs = findActiveRuns({ projectDir: PROJECT_DIR, staleMs: STALE_MS });
const _found = mostRecent(_runs);
if (!_found) exit(0);
const active = _found.state;
const activePath = _found.statePath;

// --- atomic write under a lockfile (audit gap #5c) ---
// O_EXCL gives a cross-process mutex; release in finally. If acquisition fails, the lock may
// be stale (a previous writer crashed) — reap it if older than LOCK_STALE_MS and retry once.
const lockPath = activePath + ".lock";
const LOCK_STALE_MS = 60 * 1000; // a lock older than this is from a dead writer
function acquireLock() {
  try {
    return openSync(lockPath, "wx"); // O_CREAT|O_EXCL|O_WRONLY
  } catch {
    // Lock exists. Is it stale?
    try {
      const stat = statSync(lockPath);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        unlinkSync(lockPath);
        try { return openSync(lockPath, "wx"); } catch { return null; }
      }
    } catch {}
    return null; // live lock held elsewhere
  }
}
let lockFd = acquireLock();
if (lockFd === null) exit(0); // another writer mid-update; never block.
// G8: do NOT call process.exit() inside the try — it skips the finally and leaks the lockfile.
// Compute the decision, then fall through to the finally that releases the lock.
let st;
try {
  st = JSON.parse(readFileSync(activePath, "utf8"));
} catch (st2) {
  try { closeSync(lockFd); unlinkSync(lockPath); } catch {}
  exit(0);
}
if (st) {
  const checkpoints = st.checkpoints || [];
  const last = checkpoints[checkpoints.length - 1];
  const todos = st.todos && typeof st.todos === "object" ? st.todos : {};
  const doneCount = Object.values(todos).filter(
    (t) => t && typeof t === "object" && t.status === "done"
  ).length;
  const lastPhase = last ? last.phase : null;
  // W5-minor: only compare done-count if the last checkpoint HAS one (set-phase checkpoints
  // don't — they record a phase transition only). Missing done → don't let it force an append.
  const lastHasDone = last && typeof last.done === "number";
  const doneChanged = lastHasDone ? last.done !== doneCount : false;
  const changed = !last || lastPhase !== st.phase || doneChanged;
  if (changed) {
    const now = new Date().toISOString();
    st.updated_at = now;
    checkpoints.push({
      at: now,
      phase: st.phase,
      done: doneCount,
      note: "orchestrator stopped — checkpoint for resume",
    });
    st.checkpoints = checkpoints;
    // atomic write: tmp → rename (rename is atomic on POSIX same-directory).
    const tmp = activePath + ".tmp." + process.pid;
    try {
      writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
      renameSync(tmp, activePath);
    } catch {}
  }
}
// ALWAYS release the lock (G8 — previously skipped when exit() was called mid-try).
try { closeSync(lockFd); unlinkSync(lockPath); } catch {}
exit(0);
