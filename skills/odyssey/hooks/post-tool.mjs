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
import { join, resolve as pathResolve } from "node:path";
import { exit } from "node:process";
import { spawnSync } from "node:child_process";
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

// ─── NEW ARM: post-edit diagnostics for Edit/Write/MultiEdit ─────────────────
// (todo 12, "post-edit diagnostics hook as a new arm"). MUTUALLY EXCLUSIVE with
// the existing Task/Agent ledger-drain path below by tool_name, so it cannot
// race the ledger drain: this arm returns early on non-Edit tools, and the
// existing path returns early on Edit tools. Reads .zcode/toolchain.json
// (produced by probe-toolchain.mjs, todo 4). Never blocks on success; injects a
// lint failure back to the executor only on a non-zero exit.
if (["Edit", "Write", "MultiEdit"].includes(toolName)) {
  // Phase guard: diagnostics only run during execute/verify/final — never
  // planning/review (an edit there is the planner/reviewer's own scratch, not a
  // product edit; running lint would be noise + risk false-rejecting the gate).
  const _diagRuns = findActiveRuns({ projectDir: PROJECT_DIR, staleMs: STALE_MS });
  const _diagRun = mostRecent(_diagRuns);
  if (_diagRun && _diagRun.state && _diagRun.state.phase &&
      ["execute", "verify", "final"].includes(_diagRun.state.phase)) {
    // repo root for this run = two levels above its stateDir (.../<repo>/.zcode/state)
    const _diagRepoRoot = pathResolve(_diagRun.stateDir, "..", "..");
    const _toolchainPath = join(_diagRepoRoot, ".zcode", "toolchain.json");
    let _tc = null;
    if (existsSync(_toolchainPath)) {
      try { _tc = JSON.parse(readFileSync(_toolchainPath, "utf8")); } catch { _tc = null; }
    }
    const _lintCmd = _tc && typeof _tc.lint_cmd === "string" && _tc.lint_cmd.trim()
      ? _tc.lint_cmd.trim() : null;
    if (_lintCmd) {
      // The edited file path (Edit/Write carry file_path; some hosts use path).
      const _target = (payload.tool_input && (payload.tool_input.file_path || payload.tool_input.path)) || "";
      if (_target) {
        // Scope the lint to the single edited file by appending the path to
        // the configured cmd. spawnSync with an argv array + shell:false → no
        // shell interpolation → no injection surface (consistent with
        // consult.mjs:719). 5s cap keeps this fast. Never throws on non-zero
        // exit — that IS the failure signal we read from result.status.
        const lintParts = _lintCmd.split(/\s+/);
        const result = spawnSync(lintParts[0], [...lintParts.slice(1), _target], {
          cwd: _diagRepoRoot,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 5000,
          shell: false,
          encoding: "utf8",
        });
        if (result.status !== 0) {
          // Inject the failure back to the executor. PostToolUse hooks must not
          // block, so exit 0; the JSON decision carries the reason.
          const _stderr = result.stderr || result.stdout || "";
          const _reason = `post-edit lint failed for ${_target} (cmd: ${_lintCmd}): ${String(_stderr).slice(0, 400)}`;
          console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", decision: "block", reason: _reason } }));
        }
        // lint exited 0 → silent pass (do NOT block).
      }
    }
  }
  // This arm OWNS Edit/Write/MultiEdit — never fall through to the Task/Agent
  // ledger path. (They are disjoint tool_name sets; falling through would let an
  // Edit event spuriously drain the parallel-cap ledger.)
  exit(0);
}

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
