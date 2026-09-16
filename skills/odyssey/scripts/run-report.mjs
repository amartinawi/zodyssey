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
import { gapKey, scanRecurredGaps } from "./lib/gap-ledger.mjs";

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

// --- verification origin (ISNAD R4, independence labeling) ---
// A run that was externally audited is a different verification grade than one verified only
// in-session: F1-F5 all read the same plan + notepads (one origin), while the consult auditor is
// a separate process that cannot inherit the run's assumptions. The report says which one stands
// behind "success" — an in-session-only run is never silently equivalent to an audited one.
const consultHist = Array.isArray(state.consult?.history) ? state.consult.history : [];
const verifyOrigin = (consultHist.length > 0 || state.phase === "audited") ? "external-audit" : "in-session-only";
const consultRounds = state.consult?.rounds || consultHist.length || null;

// --- gap lifecycle (row 32): the convergence claim, finally measured ---------------------
// consult_rounds says how LONG the loop ran; gap_delta says whether it CONVERGED. Deterministic
// finding key (lib/gap-ledger.mjs): last-round buckets, the longest consecutive per-key
// persisting streak counted in TRANSITIONS (first appearance = 0 — a gap in 4 straight rounds
// streaks 3), open-at-close (kept gaps on a terminal REJECT are OPEN, never "resolved" — the
// never-congratulate discipline), and cross-run recurrence of the final kept gaps against
// sibling state files. Advisory evidence only — nothing gates on it, and none of it ever
// reaches the next auditor's prompt. Pre-32 histories (no gap_delta) still yield the streak
// (replayed from each round's gaps) with null last-round buckets.
const lifecycle = (() => {
  if (!consultHist.length) return null;
  let maxStreak = 0;
  let streaks = new Map();
  for (const h of consultHist) {
    const cur = new Set((Array.isArray(h.gaps) ? h.gaps : []).map((g) => gapKey(g)));
    const next = new Map();
    for (const k of cur) {
      const s = (streaks.has(k) ? streaks.get(k) : -1) + 1;
      next.set(k, s);
      if (s > maxStreak) maxStreak = s;
    }
    streaks = next;
  }
  const lastDelta = consultHist[consultHist.length - 1].gap_delta || null;
  const finalGaps = Array.isArray(state.consult?.last_gaps) ? state.consult.last_gaps : [];
  const terminal = ["done", "audited", "abandoned", "blocked"].includes(state.phase);
  const openAtClose = state.consult?.verdict === "REJECT" && terminal && finalGaps.length > 0 ? finalGaps.length : 0;
  const recurred = finalGaps.length > 0
    ? scanRecurredGaps(repoRoot, slug, finalGaps.map((g) => gapKey(g)))
    : { count: 0, slugs: [] };
  return {
    lifecycle: {
      last_new: lastDelta ? lastDelta.new : null,
      last_persisting: lastDelta ? lastDelta.persisting : null,
      last_resolved: lastDelta ? lastDelta.resolved : null,
      max_persisting_streak: maxStreak,
      open_at_close_gaps: openAtClose,
    },
    recurred: { count: recurred.count, slugs: recurred.slugs },
  };
})();

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

// --- ungated Bash calls (item 04: the hatch testifies) ---
// ZODYSSEY_UNGATE_BASH=1 opens the whole Bash gate; pre-tool.mjs witnesses every call that walks
// through the open gate as one JSON line in <repo>/.zcode/state/<slug>.ungated.jsonl. Count =
// ledger rows; absent file = 0 (the ledger records bypasses, not ordinary traffic — a blocked
// call never took the hatch exit and writes nothing). The count is evidence, never a gate.
let ungatedBashCalls = 0;
try {
  const ungatedLedger = join(repoRoot, ".zcode", "state", `${slug}.ungated.jsonl`);
  if (existsSync(ungatedLedger)) {
    ungatedBashCalls = readFileSync(ungatedLedger, "utf8").split("\n").filter((l) => l.trim()).length;
  }
} catch {}

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
// this was waiting on plumbing, not a platform feature. collectRunTokens returns a reason-stamped
// inert object (never null, never throws) when the DB is absent or yields nothing, so a report
// never fails on missing telemetry. state.session_id is witnessed by post-tool's stamp arm; absent
// (pre-item-06 runs), the || null degrades to the (repo, window) heuristic.
const tokens = collectRunTokens({ repoRoot, startMs: start, endMs: end, sessionId: state.session_id || null });
// An inert object is TRUTHY — `tokens ?` alone would dereference .totals on it and crash the
// report (and with it the auto-append). Inert means no numbers exist, so per-todo stays null.
const tokensPerTodo = tokens && !tokens.inert ? Math.round(tokens.totals.total / Math.max(1, done)) : null;

// --- zodyssey_version (item 27 / C3): the trend record self-identifies its emitting copy ---
// Read the plugin manifest SELF-relative (up-3 from this script's own location — the depth
// precedent is pre-tool.mjs:1750) because the cache dir NAME tracks the last Get while its
// contents track the last --sync-cache: only the manifest beside the copy that RAN answers
// provenance, so the repo's/cwd's manifest is never consulted. Fail-safe by contract: the
// set-phase.mjs:479 auto-append swallows report errors, and a throw here would DROP the whole
// record — so ANY failure (missing file, bad JSON, missing/non-string .version) yields null.
const zodysseyVersion = (() => {
  try {
    const manifestPath = join(new URL(".", import.meta.url).pathname, "..", "..", "..", ".zcode-plugin", "plugin.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch { return null; }
})();

const report = {
  slug,
  zodyssey_version: zodysseyVersion,
  intent: state.intent,
  phase: state.phase,
  verdict,
  verify_origin: verifyOrigin,
  consult_rounds: consultRounds,
  consult_gap_lifecycle: lifecycle ? lifecycle.lifecycle : null, // row 32: additive; null for no-consult runs and pre-32 histories
  recurred_gaps_from_prior_runs: lifecycle ? lifecycle.recurred : null, // row 32: cross-run recurrence, advisory only
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
  ungated_bash_calls: ungatedBashCalls,
  capabilities_used: caps,
  tokens_per_todo: tokensPerTodo,
  tokens, // two shapes: populated (see lib/tokens.mjs for the arithmetic rules) or a
  // reason-stamped inert {inert:true, reason, node_version, at} when telemetry is unavailable —
  // passed through UNCHANGED, never flattened to null, so the record says why numbers are absent

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
console.log(`  verify origin     ${verifyOrigin === "external-audit"
  ? `external audit${consultRounds ? ` (${consultRounds} round${consultRounds === 1 ? "" : "s"})` : ""}`
  : "in-session only — never externally audited"}`);
if (lifecycle) { // consult_gap_lifecycle (row 32) — rendered only when consult history exists
  const L = lifecycle.lifecycle;
  console.log(`  gap lifecycle     new ${L.last_new ?? "—"} / persisting ${L.last_persisting ?? "—"} / resolved ${L.last_resolved ?? "—"} (last round) · max persisting streak ${L.max_persisting_streak}`);
  if (L.open_at_close_gaps > 0) console.log(`  open at close     ${L.open_at_close_gaps} kept gap(s) on a terminal REJECT — open, never resolved`);
  if (lifecycle.recurred.count > 0) console.log(`  recurred gaps     ${lifecycle.recurred.count} from prior run(s): ${lifecycle.recurred.slugs.join(", ")}`);
}
console.log(`  ${"─".repeat(48)}`);
console.log(`  wall-clock        ${wallClockMin} min`);
console.log(`  review rounds     ${reviewRounds}/3    ${bar(3 - reviewRounds + 1, 3)} (1 = great)`);
console.log(`  todos done/total  ${done}/${todoList.length}    ${bar(done, Math.max(1, todoList.length))}`);
console.log(`  todo retries      ${retries}    ${bar(3 - Math.min(3, retries), 3)} (0 = great)`);
console.log(`  failed todos      ${failed}`);
console.log(`  resume events     ${resumeEvents}    (0 = no crashes mid-run)`);
if (logPath) console.log(`  hook blocks       ${hookBlocks}`);
console.log(`  ungated Bash      ${ungatedBashCalls}    (0 = gate never bypassed)`);
console.log(`  ${"─".repeat(48)}`);
const capStr = Object.entries(caps).map(([k, v]) => `${k}×${v}`).join(" · ");
console.log(`  capabilities used ${capStr || "(none recorded)"}`);
console.log(`  tokens/todo       ${tokensPerTodo ?? "n/a (no telemetry for this window)"}`);
if (tokens && !tokens.inert) {
  const k = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
  console.log(`  tokens total      ${k(tokens.totals.total)}  (billable input ${k(tokens.totals.billable_input)}, cache read ${k(tokens.totals.cache_read)}, output ${k(tokens.totals.output)})`);
  console.log(`  cache hit ratio   ${(tokens.cache_hit_ratio * 100).toFixed(1)}%   [${tokens.confidence} — attributed by ${tokens.attribution}]`);
  console.log(`  orchestrator/sub  ${k(tokens.by_role.orchestrator.total)} / ${k(tokens.by_role.subagent.total)}`);
} else if (tokens) {
  // Inert: no numbers exist, only the recorded reason (an inert is truthy — the guard above is
  // what keeps .totals out of reach). One line; the reason set is closed in lib/tokens.mjs.
  console.log(`  tokens n/a        (${tokens.reason})`);
}
console.log(`  ${"─".repeat(48)}`);
console.log(`  append to trend:  run-report.mjs <repo> ${slug} --json >> ~/.zcode/orchestration/eval/results.jsonl\n`);
