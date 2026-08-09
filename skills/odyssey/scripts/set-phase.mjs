#!/usr/bin/env node
// set-phase.mjs — the TRUSTED writer for state.phase (audit re-audit gap G1).
//
// Companion to record-review.mjs. The orchestrator calls this to transition phases
// (plan→review→execute→verify→final→done→audited) since direct Write to state.json is gated.
//
// Usage:
//   set-phase.mjs <repo> <slug> <phase> [--note <text>]
//     phase: plan|consult|review|execute|verify|final|done|audited|abandoned|remediate
//   exit: 0 ok · 2 bad args · 3 no state file
//
// Atomic write under O_EXCL lockfile with stale-lock reaping.

import { readFileSync, writeFileSync, appendFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync, mkdirSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { argv, exit, env } from "node:process";
import { execFileSync } from "node:child_process";

// PERF (memory fix 3b): rolling cap for the cross-run eval ledgers. Keeps the most recent `max`
// non-empty lines; rewrites atomically via tmp+rename. Best-effort (advisory) — never lets a cap
// failure abort the phase transition that triggered the append.
function capJsonl(path, max) {
  try {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length <= max) return;
    const keep = lines.slice(lines.length - max).join("\n") + "\n";
    const tmp = path + ".tmp." + process.pid;
    writeFileSync(tmp, keep);
    renameSync(tmp, path);
  } catch { /* advisory */ }
}

const [repo, slug, phase, ...rest] = argv.slice(2);
if (!repo || !slug || !phase) {
  console.error("usage: set-phase.mjs <repo> <slug> <phase> [--note <text>]");
  exit(2);
}
const VALID = new Set(["plan", "consult", "review", "execute", "verify", "final", "done", "audited", "abandoned", "blocked", "remediate"]);
if (!VALID.has(phase)) {
  console.error("phase must be one of: " + [...VALID].join(", "));
  exit(2);
}
let note;
for (let i = 0; i < rest.length; i++) if (rest[i] === "--note") note = rest[++i];

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
function apply(st) {
  const now = new Date().toISOString();
  st.phase = phase;
  st.updated_at = now;
  st.checkpoints = Array.isArray(st.checkpoints) ? st.checkpoints : [];
  st.checkpoints.push({ at: now, phase, note: note || `phase set to ${phase}` });
  return st;
}

// T2-#6 (security + operational residual): phase-transition DAG. set-phase used to accept ANY
// transition, so `set-phase done` disarmed every hook — a master bypass. Now transitions are
// gated by an allowed map + preconditions. Escape hatches (blocked/abandoned) are always allowed
// (a stuck run must be able to terminate) but require --force for terminal destinations.
// SEC-M13 (external audit #6 + in-session F9): abandoned/blocked had NO re-entry edges, so a run
// that hit them could only be revived by hand-editing state.json — the catch-22 encoded in the
// DAG. They now re-enter plan/review/execute (the destination's precondition still applies, and
// --force is allowed for these recovery targets per SEC-3's FORCEABLE set).
const TRANSITIONS = {
  plan: ["review", "consult", "blocked", "abandoned"],
  consult: ["plan", "review", "blocked", "abandoned"],
  review: ["plan", "execute", "blocked", "abandoned"],
  execute: ["verify", "final", "blocked", "abandoned"],
  verify: ["execute", "final", "blocked", "abandoned"],
  final: ["done", "verify", "blocked", "abandoned"],
  remediate: ["done", "audited", "blocked", "abandoned"],
  done: ["audited", "remediate"],
  audited: ["remediate"],
  blocked: ["plan", "review", "execute", "abandoned"],
  abandoned: ["plan", "review", "execute", "blocked"],
};
// preconditions for entering a phase (read from the CURRENT state before mutation)
function checkPrecondition(st, target) {
  if (target === "execute") {
    if (st.review?.verdict !== "OKAY") return "execute requires review.verdict === OKAY";
  }
  if (target === "done") {
    if (st.review?.verdict !== "OKAY") return "done requires review.verdict === OKAY";
    if (!st.final || st.final.verdict !== "pass") return "done requires final.verdict === pass (run record-final-wave.mjs first)";
  }
  return null; // no precondition
}
{
  // read current phase under the lock-free path first for validation (re-read inside lock below)
  let cur;
  try { cur = JSON.parse(readFileSync(statePath, "utf8")); } catch { cur = {}; }
  const from = cur.phase || "plan";
  const allowed = TRANSITIONS[from] || [];
  // terminal escapes always permitted
  if (!allowed.includes(phase) && !["blocked", "abandoned"].includes(phase)) {
    console.error(`set-phase.mjs: illegal transition ${from} → ${phase}. Allowed from ${from}: ${allowed.join(", ")}`);
    console.error(`  (Use a trusted-writer path if this is a legitimate override; the DAG prevents the 'set-phase done' master-bypass.)`);
    exit(6);
  }
  // check preconditions for the destination
  const pc = checkPrecondition(cur, phase);
  const forcing = rest.includes("--force");
  // SEC-3 (external audit 2026-08-04): --force bypassed BOTH preconditions (execute needs OKAY;
  // done needs final.verdict===pass), and done∈TERMINAL disarms every hook — a master bypass
  // reachable in 4 commands without touching the review lane. --force is now scoped to the
  // documented recovery targets (blocked/abandoned) ONLY. It can never target execute or done,
  // so the gate cannot be skipped via the sanctioned escape hatch. Operator recovery from a
  // stuck run still works (set-phase <repo> <slug> blocked --force, then resume).
  const FORCEABLE = new Set(["blocked", "abandoned"]);
  if (pc) {
    if (!forcing) {
      console.error(`set-phase.mjs: precondition failed for ${from} → ${phase}: ${pc}`);
      console.error(`  (Pass --force to override, e.g. for an abandoned run. Do NOT --force to skip the gate.)`);
      exit(6);
    }
    if (forcing && !FORCEABLE.has(phase)) {
      console.error(`set-phase.mjs: --force cannot target ${phase} — it would skip the review/final gate. --force is restricted to recovery targets: ${[...FORCEABLE].join(", ")}.`);
      console.error(`  (To recover a stuck run: set-phase <repo> <slug> blocked --force, fix the issue, then transition forward through the gate normally.)`);
      exit(6);
    }
  }
}

const lockFd = acquireLock();
if (lockFd === null) {
  try { writeFileSync(statePath, JSON.stringify(apply(JSON.parse(readFileSync(statePath, "utf8"))), null, 2) + "\n"); } catch {}
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

// CRIT-4a (operational-consult): when a run reaches a terminal phase (done|audited), auto-append
// its run-report to the eval trend log. This is why results.jsonl was empty before — run-report's
// footer told the operator to append manually (`>> results.jsonl`), which nobody remembered.
// Now NO run can complete unmeasured. Best-effort: never fail the phase transition on a report error.
if (phase === "done" || phase === "audited") {
  try {
    const report = execFileSync("node", [
      join(env.HOME || "", ".zcode", "skills", "odyssey", "scripts", "run-report.mjs"),
      repo, slug, "--json",
    ], { encoding: "utf8", shell: false });
    const resultsPath = join(env.HOME || "", ".zcode", "orchestration", "eval", "results.jsonl");
    appendFileSync(resultsPath, report.trim() + "\n");
    // PERF (memory fix 3b): rolling cap so the cross-run ledger can't grow unbounded across eval sweeps.
    capJsonl(resultsPath, 1000);
    process.stderr.write(`ZOdyssey: run ${slug} reached ${phase} — scorecard appended to ${resultsPath}\n`);
  } catch (e) {
    process.stderr.write(`ZOdyssey: WARNING — could not auto-append run-report for ${slug} (${(e.message || "").slice(0, 120)}). Run record manually.\n`);
  }
}

// INTEG-#3 (integration-consult): write a structured memory entry on EVERY terminal transition
// (done, audited, abandoned, blocked). The memory MCP itself isn't script-callable (it's an
// in-process tool), so we write a structured file under .zcode/memory/ that the orchestrator
// loads into the MCP at session start + that phase-1 metis/premortem can read. The highest-value
// entries are blocked/failed (the lessons that leak today). Namespacing: <repo-basename>:<topic>.
if (["done", "audited", "abandoned", "blocked"].includes(phase)) {
  try {
    const repoBase = basename(realpathSync(repo));
    const memDir = join(repo, ".zcode", "memory");
    mkdirSync(memDir, { recursive: true });
    const entry = {
      name: `${repoBase}:${slug}:${phase}`,
      entity_type: "run_outcome",
      observations: [
        `run ${slug} reached ${phase} at ${new Date().toISOString()}`,
        note ? `note: ${note}` : `transition: ${phase}`,
      ],
      created_at: new Date().toISOString(),
    };
    appendFileSync(join(memDir, "outcomes.jsonl"), JSON.stringify(entry) + "\n");
  } catch {}
}
exit(0);
