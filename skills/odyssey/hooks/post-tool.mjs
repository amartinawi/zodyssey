#!/usr/bin/env node
// post-tool.mjs — ZOdyssey PostToolUse hook for Task|Agent.
//
// Counterpart to pre-tool.mjs's parallel-cap ledger (audit gap #3): when a dispatch
// COMPLETES, remove its entry from .zcode/state/<slug>.inflight.json so the slot frees
// up for the next dispatch.
//
// NO-OP unless an orchestration run is active (same rule as pre-tool.mjs). Never blocks.
//
// stdin: the ZCode PostToolUse hook JSON (we read tool_name + tool_use_id + session_id).
// exit: 0 always (PostToolUse hooks must not block).

import { readFileSync, readdirSync, existsSync, writeFileSync, renameSync, unlinkSync, openSync, closeSync, statSync } from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import { exit } from "node:process";
import { spawnSync } from "node:child_process";
import { findActiveRuns, mostRecent, STALE_MS_DEFAULT, TERMINAL } from "./lib/find-run.mjs";
import { resolvePath } from "../scripts/lib/repo-path.mjs";

const PROJECT_DIR =
  resolvePath(process.env.CLAUDE_PROJECT_DIR || process.env.ZCODE_PROJECT_DIR || process.cwd());
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

// ─── NEW ARM: session-stamp (item 06, todo 4) — FIRST WITNESS, pass-through ──
// Stamps the orchestrator's session id into run state so run-close token
// attribution can be session-exact (lib/tokens.mjs scopes by s.id/parent_id)
// instead of a (repo, window) guess. Fires for EVERY matcher event — hook-payload
// session_id is shared across parallel sub-agents (pre-tool.mjs:885 already
// consumes it as an owner fallback), so first witness is the orchestrator's id
// regardless of which thread fired. STRICTLY pass-through: this arm NEVER exits,
// so the owning later arm (Edit diagnostics, capability observation, ledger
// drain) still runs exactly as before. Skip order is cheapest-first:
//   (1) payload.session_id absent / not a non-empty string → silent fall-through;
//   (2) findActiveRuns + mostRecent → no active run → fall-through;
//   (3) state already carries session_id → skip-fast, NO lock acquisition
//       (no lock churn on the hot path — every later matcher event takes this);
//   (4) else stamp via the SAME locked-write pattern as the capability arms
//       (openSync "wx" lockfile, 60s stale recovery, state re-read under the
//       lock, same-dir tmp + rename — last-writer-safe vs stop/consult), with an
//       only-if-absent re-check under the lock so a concurrent stamp can't
//       overwrite. Writes state.session_id ONLY — NOT the dead scaffolded
//       active_executor_session (scaffold.mjs:288; nothing ever writes it
//       non-null, so pre-tool.mjs:885's owner-fallback read can never fire).
//       All failures swallowed; exit-0-always is preserved by the existing arms.
try {
  const _ssSid = typeof payload.session_id === "string" ? payload.session_id.trim() : "";
  if (_ssSid) {
    const _ssRuns = findActiveRuns({ projectDir: PROJECT_DIR, staleMs: STALE_MS });
    const _ssRun = mostRecent(_ssRuns);
    if (_ssRun && _ssRun.state && _ssRun.state.slug && !_ssRun.state.session_id) {
      const _ssStatePath = join(_ssRun.stateDir, `${_ssRun.state.slug}.json`);
      const _ssLock = _ssStatePath + ".lock";
      const _SS_LOCK_STALE = 60 * 1000;
      let _ssLf = null;
      try { _ssLf = openSync(_ssLock, "wx"); } catch {
        try { if (Date.now() - statSync(_ssLock).mtimeMs > _SS_LOCK_STALE) { unlinkSync(_ssLock); _ssLf = openSync(_ssLock, "wx"); } } catch {}
      }
      if (_ssLf !== null) {
        try {
          let _ssCs; try { _ssCs = JSON.parse(readFileSync(_ssStatePath, "utf8")); } catch { _ssCs = _ssRun.state; }
          if (!_ssCs.session_id) {
            _ssCs.session_id = _ssSid;
            _ssCs.updated_at = new Date().toISOString();
            const _ssTmp = _ssStatePath + ".tmp." + process.pid;
            writeFileSync(_ssTmp, JSON.stringify(_ssCs, null, 2) + "\n");
            renameSync(_ssTmp, _ssStatePath);
          }
        } catch {} finally { try { closeSync(_ssLf); unlinkSync(_ssLock); } catch {} }
      }
    }
  }
} catch {}

// Shared lint invocation (item 07 / B10, todo 2) — imported HERE, adjacent to the arm
// that uses it (not at the file top), so the session-stamp arm above keeps its pinned
// line numbers. ESM hoists this; both hooks call the SAME module so pre-side capture
// and post-side comparison run byte-identical invocations (same toolchain read, same
// whitespace split, same 5s cap) — divergence would make the comparison measure two
// different things.
import { lintTarget, baselineKey, readBaselineMap, writeBaselineMap } from "./lib/lint-invocation.mjs";

// ─── NEW ARM: post-edit diagnostics for Edit/Write/MultiEdit ─────────────────
// (todo 12, "post-edit diagnostics hook as a new arm"; item 07 / B10 made the block
// ATTRIBUTED). MUTUALLY EXCLUSIVE with the existing Task/Agent ledger-drain path
// below by tool_name, so it cannot race the ledger drain: this arm returns early on
// non-Edit tools, and the existing path returns early on Edit tools. Reads
// .zcode/toolchain.json (produced by probe-toolchain.mjs, todo 4) via the shared
// lint-invocation module. Never blocks on success; injects a lint failure back to
// the executor only when the diagnostics are attributable to THIS edit.
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
    // The edited file path (Edit/Write carry file_path; some hosts use path).
    const _target = (payload.tool_input && (payload.tool_input.file_path || payload.tool_input.path)) || "";
    if (_target) {
      const _lint = lintTarget(_diagRepoRoot, _target);
      // Capability failure (nothing spawned — no lint_cmd / spawn error — or killed at
      // the 5s cap) is NEVER a diagnostic. This deletes the old defect where a timed-out
      // lint's status:null was graded as a failure signal and blocked the edit.
      const _capFail = !_lint.spawned || _lint.timedOut || _lint.status === null;
      if (_capFail) {
        // Record inert for a target with no entry yet (frozen values stay untouched);
        // best-effort, blocks nothing.
        try {
          const _m = readBaselineMap(_diagRun.stateDir, _diagRun.state.slug);
          const _k = baselineKey(_diagRepoRoot, _target);
          if (!_m || !(_k in _m)) {
            writeBaselineMap(_diagRun.stateDir, _diagRun.state.slug,
              _m ? { ..._m, [_k]: "inert" } : { [_k]: "inert" });
          }
        } catch {}
      } else if (_lint.status !== 0) {
        // ATTRIBUTED comparison against the first-touch baseline (item 07 six-row table,
        // docs/impl/07-b10-pre-edit-lint-baseline.md): block ONLY when the edit made it
        // worse. Baseline values are frozen by the pre-side capture arm.
        const _key = baselineKey(_diagRepoRoot, _target);
        const _map = readBaselineMap(_diagRun.stateDir, _diagRun.state.slug);
        const _entry = _map ? _map[_key] : undefined;
        if (_entry === "clean") {
          // clean → non-zero: the file passed lint before this edit, so every diagnostic
          // in this output arrived with it. Inject the failure back to the executor.
          // PostToolUse hooks must not block, so exit 0; the JSON decision carries the reason.
          const _stderr = _lint.stderr || _lint.stdout || ""; // stdout fallback: eslint/ruff/tsc report there
          const _reason = `post-edit lint failed for ${_target} (cmd: ${_lint.cmd}): ${String(_stderr).slice(0, 400)}. ` +
            `This file passed lint before this edit — these diagnostics are NEW to this edit; fix them before continuing.`;
          console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", decision: "block", reason: _reason } }));
        } else if (_entry === "failing") {
          // failing → non-zero: pre-existing noise, seen not new (today's false block,
          // removed). Record the sighting in the side-file's "seen:" namespace — frozen
          // per-target values are never rewritten — and block nothing.
          try {
            if (_map) {
              _map["seen:" + _key] = new Date().toISOString();
              writeBaselineMap(_diagRun.stateDir, _diagRun.state.slug, _map);
            }
          } catch {}
        } else {
          // Absent entry (a run created before this change, or a path that never
          // baselined) or an `inert` baseline: the arm never guesses a "before" it does
          // not have. No block; record inert for an absent entry.
          try {
            if (!_map || !(_key in _map)) {
              writeBaselineMap(_diagRun.stateDir, _diagRun.state.slug,
                _map ? { ..._map, [_key]: "inert" } : { [_key]: "inert" });
            }
          } catch {}
        }
      }
      // lint exited 0 → silent pass (do NOT block), regardless of baseline.
    }
  }
  // This arm OWNS Edit/Write/MultiEdit — never fall through to the Task/Agent
  // ledger path. (They are disjoint tool_name sets; falling through would let an
  // Edit event spuriously drain the parallel-cap ledger.)
  exit(0);
}

// ─── NEW ARM: OBSERVED capability recording for Skill / mcp__* ────────────────
// SEC (audit M7 + H2): F5 (record-final-wave) trusts `observed:true`, which must mean the skill/MCP
// actually LOADED, not merely that a call was attempted. PostToolUse fires after the tool returns,
// so this arm — not pre-tool — stamps observed. Requires the PostToolUse matcher to include
// Skill|mcp__* (plugin.json). Skips if the load reported an error. Never blocks.
if (toolName === "Skill" || toolName.startsWith("mcp__")) {
  const resp = payload.tool_response || payload.tool_result || {};
  const errored = payload.is_error === true || (resp && (resp.is_error === true || resp.error));
  if (!errored) {
    const _capRuns = findActiveRuns({ projectDir: PROJECT_DIR, staleMs: STALE_MS });
    const _capRun = mostRecent(_capRuns);
    if (_capRun && _capRun.state && _capRun.state.slug) {
      try {
        const ti = payload.tool_input || {};
        const cap = toolName === "Skill" ? `skill:${ti.skill || ti.name || "unknown"}` : toolName;
        const capStatePath = join(_capRun.stateDir, `${_capRun.state.slug}.json`);
        const capLock = capStatePath + ".lock";
        const CAP_LOCK_STALE = 60 * 1000;
        let lf = null;
        try { lf = openSync(capLock, "wx"); } catch {
          try { if (Date.now() - statSync(capLock).mtimeMs > CAP_LOCK_STALE) { unlinkSync(capLock); lf = openSync(capLock, "wx"); } } catch {}
        }
        if (lf !== null) {
          try {
            let cs; try { cs = JSON.parse(readFileSync(capStatePath, "utf8")); } catch { cs = _capRun.state; }
            cs.capabilities = Array.isArray(cs.capabilities) ? cs.capabilities : [];
            cs.capabilities.push({ at: new Date().toISOString(), phase: cs.phase, capability: cap, observed: true });
            cs.updated_at = new Date().toISOString();
            const ct = capStatePath + ".tmp." + process.pid;
            writeFileSync(ct, JSON.stringify(cs, null, 2) + "\n");
            renameSync(ct, capStatePath);
          } catch {} finally { try { closeSync(lf); unlinkSync(capLock); } catch {} }
        }
      } catch {}
    }
  }
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

// SEC (audit M4): record the dispatched agent as an OBSERVED capability so F5's `routed: agent:X`
// branch can verify against a real, hook-witnessed dispatch instead of passing declaration-only.
// Dispatching IS the routing act for an agent (unlike a Skill, where attempt ≠ load), and Task
// dispatches are witnessed by the hook, so recording here on completion is a genuine observation.
{
  const sub = (payload.tool_input && (payload.tool_input.subagent_type || payload.tool_input.agent_type || payload.tool_input.type)) || "";
  const errored = payload.is_error === true || (payload.tool_response && (payload.tool_response.is_error === true || payload.tool_response.error));
  if (sub && !errored) {
    const cap = `agent:${sub}`;
    const capStatePath = join(RUN_STATE_DIR, `${state.slug}.json`);
    const capLock = capStatePath + ".lock";
    const CAP_LOCK_STALE = 60 * 1000;
    let lf = null;
    try { lf = openSync(capLock, "wx"); } catch {
      try { if (Date.now() - statSync(capLock).mtimeMs > CAP_LOCK_STALE) { unlinkSync(capLock); lf = openSync(capLock, "wx"); } } catch {}
    }
    if (lf !== null) {
      try {
        let cs; try { cs = JSON.parse(readFileSync(capStatePath, "utf8")); } catch { cs = state; }
        cs.capabilities = Array.isArray(cs.capabilities) ? cs.capabilities : [];
        cs.capabilities.push({ at: new Date().toISOString(), phase: cs.phase, capability: cap, observed: true });
        cs.updated_at = new Date().toISOString();
        const ct = capStatePath + ".tmp." + process.pid;
        writeFileSync(ct, JSON.stringify(cs, null, 2) + "\n");
        renameSync(ct, capStatePath);
      } catch {} finally { try { closeSync(lf); unlinkSync(capLock); } catch {} }
    }
  }
}

const ledgerPath = join(RUN_STATE_DIR, `${state.slug}.inflight.json`);
if (!existsSync(ledgerPath)) exit(0);

// (audit F5, 2026-08-25) the drain was an unlocked read-splice-write — the twin of the pre-tool
// push race. Two concurrent drains each splice their own id out of their own snapshot; the lost
// completion leaks a slot for the full INFLIGHT_TTL_MS, and the G7 shift() fallbacks can drain an
// entry belonging to a still-in-flight dispatch, freeing a slot early. Same O_EXCL + stale-reap
// discipline as every other state writer. Contention fails OPEN here: a skipped drain only holds
// a slot until the TTL expires, while failing the hook would punish finished work. No exit()
// inside the lock's try — process.exit skips finally and would leak the lockfile.
const ledgerLock = ledgerPath + ".lock";
let lfd = null;
try { lfd = openSync(ledgerLock, "wx"); } catch {
  try {
    if (Date.now() - statSync(ledgerLock).mtimeMs > 60 * 1000) {
      try { unlinkSync(ledgerLock); } catch {}
      try { lfd = openSync(ledgerLock, "wx"); } catch {}
    }
  } catch {}
}
if (lfd !== null) {
  try {
    let arr;
    try {
      const parsed = JSON.parse(readFileSync(ledgerPath, "utf8"));
      arr = Array.isArray(parsed) ? parsed : null;
    } catch {
      arr = null;
    }
    if (arr !== null) {
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
      if (arr.length !== before) {
        // W5-minor: ACTUALLY atomic — same-dir temp + rename (the old mkdtempSync leaked a /tmp dir per call).
        const tmp = ledgerPath + ".tmp." + process.pid;
        writeFileSync(tmp, JSON.stringify(arr, null, 0));
        try { renameSync(tmp, ledgerPath); } catch { try { unlinkSync(tmp); } catch {} }
      }
    }
  } finally { try { closeSync(lfd); unlinkSync(ledgerLock); } catch {} }
}
exit(0);
