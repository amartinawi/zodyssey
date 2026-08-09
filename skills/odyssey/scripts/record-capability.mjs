#!/usr/bin/env node
// record-capability.mjs — record a capability use into state.capabilities (audit gap #9b).
//
// The orchestrator calls this whenever it (or a dispatched agent) loads a skill, dispatches an
// agent, or calls an MCP — so the "always use the best tool" promise is finally MEASURED.
// Before this, run-report.mjs inferred capabilities by grepping free-text checkpoint notes,
// which matched English words ("memory", "explored") and produced meaningless counts.
//
// Usage:
//   record-capability.mjs <repo> <slug> <phase> <capability> [--activity A]
//     phase: prime|triage|consult|plan|review|execute|verify|final
//     capability: e.g. "TDD", "codegraph", "premortem", "Context7", "memory", "oracle"
//   exit: 0 ok · 2 bad args · 3 no state file
//
// Atomic write under O_EXCL lockfile with stale-lock reaping.

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

const [repo, slug, phase, capability, ...rest] = argv.slice(2);
if (!repo || !slug || !phase || !capability) {
  console.error("usage: record-capability.mjs <repo> <slug> <phase> <capability> [--activity A]");
  exit(2);
}
let activity = "general";
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--activity") activity = rest[++i];
}

const statePath = join(repo, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) {
  console.error("no state file: " + statePath);
  exit(3);
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
const lockFd = acquireLock();
const entry = { at: new Date().toISOString(), phase, capability, activity };
function apply(st) {
  st.capabilities = Array.isArray(st.capabilities) ? st.capabilities : [];
  st.capabilities.push(entry);
  st.updated_at = entry.at;
  return st;
}
if (lockFd === null) {
  try {
    const st = apply(JSON.parse(readFileSync(statePath, "utf8")));
    writeFileSync(statePath, JSON.stringify(st, null, 2) + "\n");
  } catch {}
  exit(0);
}
try {
  const st = apply(JSON.parse(readFileSync(statePath, "utf8")));
  const tmp = statePath + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
  renameSync(tmp, statePath);
} finally {
  try { closeSync(lockFd); unlinkSync(lockPath); } catch {}
}
exit(0);
