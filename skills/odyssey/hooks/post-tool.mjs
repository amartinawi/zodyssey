#!/usr/bin/env node
// post-tool.mjs — ZOdyssey PostToolUse hook for Task|Agent.
//
// Counterpart to pre-tool.mjs's parallel-cap ledger (audit gap #3): when a dispatch
// COMPLETES, remove its entry from .zcode/state/<slug>.inflight.json so the slot frees
// up for the next dispatch.
//
// NO-OP unless an orchestration run is active (same rule as pre-tool.mjs). Never blocks.
//
// stdin: the ZCode PostToolUse hook JSON (we read tool_name + tool_use_id).
// exit: 0 always (PostToolUse hooks must not block).

import { readFileSync, readdirSync, existsSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { exit } from "node:process";
import { findActiveRuns, mostRecent, STALE_MS_DEFAULT, TERMINAL } from "./lib/find-run.mjs";

const PROJECT_DIR =
  process.env.CLAUDE_PROJECT_DIR || process.env.ZCODE_PROJECT_DIR || process.cwd();
const STALE_MS = (() => {
  const h = parseFloat(process.env.ZODYSSEY_STALE_HOURS || "24");
  return Number.isFinite(h) && h > 0 ? h * 3600 * 1000 : STALE_MS_DEFAULT;
})();
const INFLIGHT_TTL_MS = 30 * 60 * 1000;

let payload = {};
try {
  const raw = readFileSync(0, "utf8");
  payload = raw.trim() ? JSON.parse(raw) : {};
} catch {
  exit(0);
}

const toolName = payload.tool_name || payload.tool || "";
if (!["Task", "Agent", "dispatch_agent"].includes(toolName)) exit(0);

// SEC-H4 (external audit #3 + in-session F6): findActiveRun is now the SHARED DFS discovery
// (hooks/lib/find-run.mjs), not a flat top-level readdir. This was flat here while pre-tool was
// fixed (#6a) — so nested-repo runs never reached this hook and the parallel-cap ledger never
// drained (30-min stall). The single source of truth prevents the three-way drift recurring.
// post-tool is a dispatch-COMPLETION event (no single target path), so use most-recent selection.
const _runs = findActiveRuns({ projectDir: PROJECT_DIR, staleMs: STALE_MS });
const _found = mostRecent(_runs);
if (!_found) exit(0);
const state = _found.state;
const RUN_STATE_DIR = _found.stateDir;

const ledgerPath = join(RUN_STATE_DIR, `${state.slug}.inflight.json`);
if (!existsSync(ledgerPath)) exit(0);

let arr;
try {
  const parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
  arr = Array.isArray(parsed) ? parsed : [];
} catch {
  exit(0);
}

const id = payload.tool_use_id || "";
const before = arr.length;
const now = Date.now();
// First prune stale entries (orphans > TTL).
arr = arr.filter((e) => typeof e.at === "number" && now - e.at < INFLIGHT_TTL_MS);
// Then remove the matching entry by id.
if (id) {
  const idx = arr.findIndex((e) => e.id === id);
  if (idx !== -1) arr.splice(idx, 1);
  else arr.shift(); // G7: id didn't match (host didn't echo it) — drain the OLDEST so a slot frees
} else if (arr.length > 0) {
  arr.shift(); // G7: no id at all — drain oldest unconditionally so the ledger can't grow unbounded
}
if (arr.length === before) exit(0); // nothing to remove

// W5-minor: ACTUALLY atomic — same-dir temp + rename (the old mkdtempSync leaked a /tmp dir per call).
const tmp = ledgerPath + ".tmp." + process.pid;
writeFileSync(tmp, JSON.stringify(arr, null, 0));
try { renameSync(tmp, ledgerPath); } catch { try { unlinkSync(tmp); } catch {} }
exit(0);
