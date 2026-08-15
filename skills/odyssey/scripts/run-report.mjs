#!/usr/bin/env node
// run-report.mjs — emit an efficiency scorecard for one ZOdyssey run.
// Reads <repo>/.zcode/state/<slug>.json + checkpoints + (optionally) the ZCode log for hook blocks,
// and prints a human-readable scorecard plus a JSON summary you can append to eval/results.jsonl.
//
// This is the EFFICIENCY half of measurement (§1 of MEASUREMENT.md). The QUALITY half (judge) is
// a separate script. Together: tokens/time/dispatch/retry numbers now; judged score later.
//
// Usage:
//   run-report.mjs <repo-root> <slug>                # text scorecard
//   run-report.mjs <repo-root> <slug> --json          # machine-readable (append to results)
//   run-report.mjs <repo-root> <slug> --log <path>    # also count hook blocks from the log
//   exit: 0 ok · 2 bad args · 3 state file missing

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { collectRunTokens } from "./lib/tokens.mjs";

const [repoRoot, slug, ...rest] = argv.slice(2);
if (!repoRoot || !slug) {
  console.error("usage: run-report.mjs <repo-root> <slug> [--json] [--log <path>]");
  exit(2);
}
const asJson = rest.includes("--json");
const logIdx = rest.indexOf("--log");
const logPath = logIdx !== -1 ? rest[logIdx + 1] : null;

const statePath = join(repoRoot, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) {
  console.error("no state file: " + statePath);
  exit(3);
}
const state = JSON.parse(readFileSync(statePath, "utf8"));

// --- derive timings ---
const start = new Date(state.started_at).getTime();
const end = state.phase === "done" && state.checkpoints?.length
  ? new Date(state.checkpoints[state.checkpoints.length - 1].at).getTime()
  : Date.now();
const wallClockMs = Math.max(0, end - start);
const wallClockMin = (wallClockMs / 60000).toFixed(1);

// --- todos ---
const todos = state.todos || {};
const todoList = Object.entries(todos).map(([id, t]) => ({ id, ...t }));
const done = todoList.filter((t) => t.status === "done").length;
const failed = todoList.filter((t) => t.status === "failed").length;
const attempts = todoList.reduce((s, t) => s + (t.attempts || 0), 0);
const retries = todoList.reduce((s, t) => s + Math.max(0, (t.attempts || 0) - 1), 0);

// --- review ---
const reviewRounds = state.review?.round ?? 0;
const verdict = state.review?.verdict ?? null;

// --- checkpoints (resume signal) ---
const checkpoints = state.checkpoints || [];
const resumeEvents = checkpoints.filter((c) => /resume|restart|stopped/i.test(c.note || "")).length;

// --- hook blocks (from log, optional) ---
// audit gap #9d: count by the ZODYSSEY_BLOCK prefix that pre-tool.mjs now stamps on every
// block reason (the old free-text "ZOdyssey:...block" regex missed the parallel-cap reason).
let hookBlocks = 0;
if (logPath && existsSync(logPath)) {
  try {
    const log = readFileSync(logPath, "utf8");
    const blocks = log.match(/ZODYSSEY_BLOCK/g) || [];
    hookBlocks = blocks.length;
  } catch {}
}

// --- capability usage (audit gap #9c) ---
// Read the STRUCTURED state.capabilities array. MAJOR-3: distinguish OBSERVED (hook-recorded on
// real Skill/MCP tool calls) from SELF-DECLARED (record-capability.mjs, called by the agent).
// Observed is trustworthy; self-declared is the circular signal the consultant flagged.
const capArr = Array.isArray(state.capabilities) ? state.capabilities : [];
const capsObserved = {};
const capsDeclared = {};
for (const c of capArr) {
  if (!c || !c.capability) continue;
  const bucket = c.observed ? capsObserved : capsDeclared;
  bucket[c.capability] = (bucket[c.capability] || 0) + 1;
}
const caps = { ...capsDeclared, ...capsObserved };

// --- token accounting (was a null placeholder: "populated when ZCode exposes per-run token
// counts"). ZCode does expose them — every model request is recorded in its own SQLite DB — so
// this was waiting on plumbing, not a platform feature. collectRunTokens returns null (never
// throws) when the DB is absent, so a report never fails on missing telemetry.
const tokens = collectRunTokens({ repoRoot, startMs: start, endMs: end });
const tokensPerTodo = tokens ? Math.round(tokens.totals.total / Math.max(1, done)) : null;

const report = {
  slug,
  intent: state.intent,
  phase: state.phase,
  verdict,
  // T3-#7: success derives from the EVIDENCE (state.final.verdict), not the phase string.
  // Reaching "done" only means the final wave ran; the final wave's verdict is what says the
  // work passed. A run that reached done through a bug (not real verification) won't have
  // final.verdict === "pass" and will report success: false. Falls back to phase-based only if
  // the run predates the final-wave machinery (no state.final field).
  success: state.final && state.final.verdict
    ? (state.final.verdict === "pass" && failed === 0)
    : ((state.phase === "done" || state.phase === "audited") && failed === 0),
  wall_clock_min: parseFloat(wallClockMin),
  review_rounds: reviewRounds,
  todos_total: todoList.length,
  todos_done: done,
  todos_failed: failed,
  todo_retries: retries,
  resume_events: resumeEvents,
  hook_blocks: hookBlocks,
  capabilities_used: caps,
  tokens_per_todo: tokensPerTodo,
  tokens, // null when telemetry is unavailable; see lib/tokens.mjs for the arithmetic rules

  generated_at: new Date().toISOString(),
};

if (asJson) {
  console.log(JSON.stringify(report));
  exit(0);
}

// --- text scorecard ---
const bar = (n, max = 10) => "█".repeat(Math.min(max, Math.max(0, n))) + "░".repeat(Math.max(0, max - Math.min(max, n)));
const r = (n, d = 1) => (typeof n === "number" ? n.toFixed(d) : "—");

console.log(`\n  ZOdyssey run scorecard — ${slug}`);
console.log(`  ${"─".repeat(48)}`);
console.log(`  intent            ${state.intent}`);
console.log(`  phase             ${state.phase}    verdict: ${verdict ?? "—"}`);
console.log(`  success           ${report.success ? "YES ✅" : "no ⚠"}`);
console.log(`  ${"─".repeat(48)}`);
console.log(`  wall-clock        ${wallClockMin} min`);
console.log(`  review rounds     ${reviewRounds}/3    ${bar(3 - reviewRounds + 1, 3)} (1 = great)`);
console.log(`  todos done/total  ${done}/${todoList.length}    ${bar(done, Math.max(1, todoList.length))}`);
console.log(`  todo retries      ${retries}    ${bar(3 - Math.min(3, retries), 3)} (0 = great)`);
console.log(`  failed todos      ${failed}`);
console.log(`  resume events     ${resumeEvents}    (0 = no crashes mid-run)`);
if (logPath) console.log(`  hook blocks       ${hookBlocks}`);
console.log(`  ${"─".repeat(48)}`);
const capStr = Object.entries(caps).map(([k, v]) => `${k}×${v}`).join(" · ");
console.log(`  capabilities used ${capStr || "(none recorded)"}`);
console.log(`  tokens/todo       ${tokensPerTodo ?? "n/a (no telemetry for this window)"}`);
if (tokens) {
  const k = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
  console.log(`  tokens total      ${k(tokens.totals.total)}  (billable input ${k(tokens.totals.billable_input)}, cache read ${k(tokens.totals.cache_read)}, output ${k(tokens.totals.output)})`);
  console.log(`  cache hit ratio   ${(tokens.cache_hit_ratio * 100).toFixed(1)}%   [${tokens.confidence} — attributed by ${tokens.attribution}]`);
  console.log(`  orchestrator/sub  ${k(tokens.by_role.orchestrator.total)} / ${k(tokens.by_role.subagent.total)}`);
}
console.log(`  ${"─".repeat(48)}`);
console.log(`  append to trend:  run-report.mjs <repo> ${slug} --json >> ~/.zcode/orchestration/eval/results.jsonl\n`);
