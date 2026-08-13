#!/usr/bin/env node
// recall-corrections.mjs — the READ side of cross-run CORRECTION signals (todo 2 of
// the correction-signal-capture plan). A strict STRUCTURAL mirror of
// recall-outcomes.mjs: same argv shape, same realpathSync+basename repo resolution,
// same exit codes (0 · 2 bad args · 3 no state yet), same "skip malformed, never
// crash" parse discipline, same closing Metis instruction line.
//
// Where recall-outcomes mines the free-text outcomes store, this script mines TWO
// STRUCTURED correction signals from <repo>/.zcode/state/*.json (one file per run
// slug — globbed UNCONDITIONALLY; no dependency on state.phase and no requirement
// that a run be active; it reads disk regardless):
//
//   SIGNAL 1 (verify-fail): verify.history[] entries where passed === false
//     (status "failed" or "flaky"). Optionally paired with
//     todos[todo_id].attempts > 1 as a re-dispatch proxy.
//   SIGNAL 2 (reject-blockers): review.history[] entries where verdict === "REJECT"
//     AND blockers is a non-empty array.
//
// Output is TOP-K bounded (TOP_K = 5 below), deterministically ordered — PRIMARY
// key recency (newest run updated_at/started_at first; within a run, newest history
// entry first), SECONDARY key type priority (reject-blockers ranks above a single
// verify-fail; a re-dispatched verify-fail ranks above a plain one). Each printed
// line shows WHY it survived (which signal type + which run slug + the criterion
// text or blocker list). The full store is NEVER printed — only the bounded top-K,
// with a "(showing K of N)" footer when truncated. Metis folds the survivors into
// her premortem's "Identified Risks".
//
// FUTURE WORK (exclusions — documented so the next maintainer does not mistake the
// gap for an oversight):
//
//   (a) Periodic-improvement-pass / live-skill-edit loop — EXCLUDED. A future pass
//       could mine judged.jsonl / results.jsonl for RECURRING failure patterns and
//       PROPOSE staged, human-approved updates to agent prompts, capabilities.md,
//       and SKILL.md. That loop is STAGING-ONLY by design: recall-corrections is
//       read-only capture only — it never writes live skill/agent files, and install
//       is a separate human action (the task-observer staging-only model). This
//       script is the capture half, not the edit half.
//
//   (b) SIGNAL 3 (user mid-run corrections) — NOT RECORDED on disk today.
//       user-prompt-submit.mjs is warning-only and no `corrections` /
//       `user_overrides` field exists in state.json, so there is nothing structured
//       to mine. Out of scope until a capture channel is added.
//
// Usage:
//   recall-corrections.mjs <repo>
//   exit: 0 success · 2 bad args · 3 no state dir yet (first run)

import { readFileSync, existsSync, realpathSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import { argv, exit } from "node:process";

const TOP_K = 5;

const [repo] = argv.slice(2);
if (!repo) { console.error("usage: recall-corrections.mjs <repo>"); exit(2); }
const repoAbs = (() => { try { return realpathSync(repo); } catch { return repo; } })();
const repoBase = basename(repoAbs);
const stateDir = `${repoAbs}/.zcode/state`;
if (!existsSync(stateDir)) {
  console.error(`(no run state at ${stateDir} yet — this is the first run for this repo)`);
  exit(3);
}
// Glob every *.json state file (one per run slug). *.inflight.json lock files also
// match the glob; they are NON-EMPTY arrays of in-flight dispatch records (not run
// objects) and are filtered out below by the Array.isArray guard.
let stateFiles = [];
try {
  stateFiles = readdirSync(stateDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => `${stateDir}/${f}`);
} catch {
  stateFiles = [];
}

// For each state file: defensively parse, then extract the two signals. A file that
// fails to parse is skipped with a stderr warning rather than crashing the whole
// recall — one bad file must not blind metis. Every field access below is
// optional-chained so an old/partial state (no verify/review keys) yields empty
// arrays and produces zero signals, never a throw.
const signals = [];
let runCount = 0;
for (const file of stateFiles) {
  const fname = basename(file);
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    process.stderr.write(`recall-corrections: skipping unreadable state ${fname}\n`);
    continue;
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch {
    process.stderr.write(`recall-corrections: skipping malformed state ${fname}\n`);
    continue;
  }
  // inflight lock files are non-empty arrays of dispatch records, not run objects;
  // any non-object (or array) is skipped here.
  if (!state || typeof state !== "object" || Array.isArray(state)) continue;
  runCount += 1;

  const slug = state.slug || fname.replace(/\.json$/, "");
  const runStamp = state.updated_at || state.started_at || "";

  // SIGNAL 1 — verify-fail: verify.history[] where passed === false.
  const verifyHistory = state.verify?.history || [];
  for (const entry of verifyHistory) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.passed !== false) continue;
    const todoId = entry.todo_id ?? "?";
    const attempts = state.todos?.[todoId]?.attempts || 0;
    signals.push({
      type: "verify-fail",
      slug,
      todo_id: todoId,
      criterion: typeof entry.criterion === "string" && entry.criterion.length > 0
        ? entry.criterion
        : "(no criterion recorded)",
      status: entry.status || (entry.flaky ? "flaky" : "failed"),
      attempts,
      re_dispatched: attempts > 1,
      stamp: entry.at || runStamp,
      _idx: signals.length,
    });
  }

  // SIGNAL 2 — reject-blockers: review.history[] where verdict === "REJECT" and
  // blockers is a non-empty array.
  const reviewHistory = state.review?.history || [];
  for (const entry of reviewHistory) {
    if (!entry || typeof entry !== "object") continue;
    const blockers = Array.isArray(entry.blockers) ? entry.blockers : [];
    if (entry.verdict !== "REJECT" || blockers.length === 0) continue;
    signals.push({
      type: "reject-blockers",
      slug,
      round: entry.round ?? "?",
      blockers: blockers.filter((b) => typeof b === "string"),
      stamp: entry.at || runStamp,
      _idx: signals.length,
    });
  }
}

// No parseable run state objects. Distinguish "no state files" (genuinely the
// first run — mirrors the sibling) from "files present but none parsed" (all
// malformed or inflight locks) so the exit-3 message is not misleading.
if (runCount === 0) {
  if (stateFiles.length === 0) {
    console.error(`(no run state at ${stateDir} yet — this is the first run for this repo)`);
  } else {
    console.error(`(found ${stateFiles.length} state file(s) at ${stateDir} but none parsed as a run — all malformed or inflight locks; see warnings above)`);
  }
  exit(3);
}
if (signals.length === 0) {
  console.error(`(no correction signals found across ${runCount} run${runCount === 1 ? "" : "s"})`);
  exit(0);
}

// Deterministic order: PRIMARY recency (newest stamp first; empty stamps last),
// SECONDARY type priority (reject-blockers > re-dispatched verify-fail > plain
// verify-fail), then stable insertion order as a final tie-break.
const typePriority = (s) => {
  if (s.type === "reject-blockers") return 0;
  if (s.type === "verify-fail") return s.re_dispatched ? 1 : 2;
  return 3;
};
signals.sort((a, b) => {
  const sa = a.stamp || "";
  const sb = b.stamp || "";
  if (sa !== sb) return sb.localeCompare(sa); // descending = newest first
  const pa = typePriority(a);
  const pb = typePriority(b);
  if (pa !== pb) return pa - pb;
  return a._idx - b._idx;
});

const total = signals.length;
const shown = signals.slice(0, TOP_K);
console.log(`Correction signals for ${repoBase} (${total} found${total > TOP_K ? `, showing top ${shown.length}` : ""}):`);
for (const s of shown) {
  if (s.type === "verify-fail") {
    const recon = s.re_dispatched ? ` [re-dispatched: attempts=${s.attempts}]` : "";
    console.log(`\n  [verify-fail · run ${s.slug}] todo ${s.todo_id} (${s.status})${recon}`);
    console.log(`    criterion: ${s.criterion}`);
  } else {
    console.log(`\n  [reject-blockers · run ${s.slug}] review round ${s.round}`);
    for (const b of s.blockers) console.log(`    blocker: ${b}`);
  }
}
if (total > TOP_K) {
  console.log(`\n(showing ${TOP_K} of ${total} correction signals — older ones elided for context economy)`);
}
console.log(`\nMetis: fold any verify-fail / REJECT-blocker signals above into your premortem's Identified Risks.`);
exit(0);
