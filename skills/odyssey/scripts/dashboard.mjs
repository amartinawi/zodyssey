#!/usr/bin/env node
// dashboard.mjs — eval scorecard renderer (DESIGN item 21).
//
// Reads orchestration/eval/{results,judged}.jsonl and renders a markdown summary to stdout.
// No web server, no file writes. Markdown only.
//
// Usage:
//   dashboard.mjs [eval-dir]
//     eval-dir  optional path to the directory holding results.jsonl + judged.jsonl
//               (default: ~/.zcode/orchestration/eval)
//
// exit: 0 always (missing/empty data → "No eval data yet" message, NOT a crash)
//
// Data shapes (read from the real files, not assumed):
//   results.jsonl: {slug,intent,phase,verdict,success,wall_clock_min,review_rounds,
//                   todos_total,todos_done,todos_failed,...,generated_at}
//   judged.jsonl:  {seed_id,slug,arm,at,overall,dimensions:{...},
//                   criterion_results:[{criterion,met,evidence}],summary,blockers}
//
// Arm derivation: the `arm` field on legacy judged records was unreliable (all emitted
// "zodyssey" — fixed 2026-08-17: judge.mjs now stamps it via lib/arm.mjs's slug-suffix
// derivation). Arm is still derived from the slug suffix rather than trusted: ends with
// "-baseline" → baseline, else zodyssey. Seed for results.jsonl records likewise.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, env } from "node:process";
import { armFromSlug } from "./lib/arm.mjs";

const DEFAULT_EVAL_DIR = join(env.HOME || "", ".zcode", "orchestration", "eval");
const evalDir = argv[2] ? argv[2] : DEFAULT_EVAL_DIR;
const RESULTS_PATH = join(evalDir, "results.jsonl");
const JUDGED_PATH = join(evalDir, "judged.jsonl");

// --- read & parse helpers -------------------------------------------------

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); }
    catch { /* skip malformed line rather than crash the dashboard */ }
  }
  return out;
}

// armFromSlug moved to ./lib/arm.mjs (shared with judge.mjs and the narrator trust registry);
// see the file-header note at :20 for why the slug suffix is the authoritative arm source.

function seedFromSlug(slug) {
  // strip the trailing -<arm> token to recover the seed id
  if (typeof slug !== "string") return "?";
  return slug.replace(/-(baseline|zodyssey)$/, "");
}

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  return Number(n).toFixed(digits);
}

function pct(num, den) {
  if (!den) return "n/a";
  return (100 * num / den).toFixed(0) + "%";
}

// --- main -----------------------------------------------------------------

const results = readJsonl(RESULTS_PATH);
const judged = readJsonl(JUDGED_PATH);

if (results.length === 0 && judged.length === 0) {
  console.log("No eval data yet. Run `harness.mjs` to generate.");
  exit(0);
}

const lines = [];
const push = (s = "") => lines.push(s);

push("# ZOdyssey eval scorecard");
push("");
push(`- results records: **${results.length}**`);
push(`- judged runs: **${judged.length}**`);
push(`- eval dir: \`${evalDir}\``);
push("");

// --- Section: Per-seed win-rate ------------------------------------------
// win-rate = fraction of runs for that (seed, arm) whose success === true.
push("## Per-seed win-rate");
push("");
const seedArmRuns = new Map(); // key `${seed}|${arm}` → {seed, arm, total, won}
const acc = (seed, arm, success) => {
  const k = `${seed}|${arm}`;
  if (!seedArmRuns.has(k)) seedArmRuns.set(k, { seed, arm, total: 0, won: 0 });
  const r = seedArmRuns.get(k);
  r.total++;
  if (success) r.won++;
};
for (const r of results) acc(seedFromSlug(r.slug), armFromSlug(r.slug), r.success);
for (const j of judged) {
  // judged records carry overall + criterion met flags; map to success via overall ≥ 0.7
  // (judge.mjs uses 0.7 as the pass bar). Include them only if not already counted from results.
  const k = `${j.seed_id}|${armFromSlug(j.slug)}`;
  if (!seedArmRuns.has(k)) acc(j.seed_id, armFromSlug(j.slug), (j.overall ?? 0) >= 0.7);
}
const seeds = [...new Set([...seedArmRuns.values()].map((r) => r.seed))].sort();
push("| seed | arm | wins | runs | win-rate |");
push("|------|-----|------|------|----------|");
for (const seed of seeds) {
  for (const arm of ["zodyssey", "baseline"]) {
    const r = seedArmRuns.get(`${seed}|${arm}`);
    if (!r || r.total === 0) continue;
    push(`| ${seed} | ${arm} | ${r.won} | ${r.total} | ${pct(r.won, r.total)} |`);
  }
}
push("");

// --- Section: Mean overall judge score per arm ---------------------------
push("## Mean overall judge score (per arm)");
push("");
const byArm = new Map(); // arm → {sum, n, dims:{}, dimN:{}}
for (const j of judged) {
  const arm = armFromSlug(j.slug);
  if (!byArm.has(arm)) byArm.set(arm, { sum: 0, n: 0, dims: {}, dimN: {} });
  const a = byArm.get(arm);
  if (typeof j.overall === "number") { a.sum += j.overall; a.n++; }
  if (j.dimensions && typeof j.dimensions === "object") {
    for (const [dk, dv] of Object.entries(j.dimensions)) {
      if (typeof dv !== "number") continue;
      a.dims[dk] = (a.dims[dk] || 0) + dv;
      a.dimN[dk] = (a.dimN[dk] || 0) + 1;
    }
  }
}
push("| arm | mean overall | n |");
push("|-----|--------------|---|");
const armNames = [...byArm.keys()].sort();
for (const arm of armNames) {
  const a = byArm.get(arm);
  push(`| ${arm} | ${fmt(a.n ? a.sum / a.n : null)} | ${a.n} |`);
}
push("");
if (judged.length > 0) {
  // dimension breakdown
  const allDims = new Set();
  for (const a of byArm.values()) for (const dk of Object.keys(a.dims)) allDims.add(dk);
  if (allDims.size > 0) {
    push("Dimension means:");
    push("");
    const dimCols = [...allDims].sort();
    push("| arm | " + dimCols.join(" | ") + " |");
    push("|" + ["-----"].concat(dimCols.map(() => "----")).join("|") + "|");
    for (const arm of armNames) {
      const a = byArm.get(arm);
      const row = dimCols.map((dk) => {
        const m = a.dimN[dk] ? a.dims[dk] / a.dimN[dk] : null;
        return fmt(m);
      });
      push(`| ${arm} | ${row.join(" | ")} |`);
    }
    push("");
  }
}

// --- Section: Score over time --------------------------------------------
push("## Score over time");
push("");
const chrono = [...judged]
  .filter((j) => typeof j.at === "string")
  .sort((a, b) => a.at.localeCompare(b.at));
if (chrono.length === 0) {
  push("_(no judged runs with timestamps yet)_");
} else {
  push("| timestamp | seed | arm | overall |");
  push("|-----------|------|-----|---------|");
  for (const j of chrono) {
    push(`| ${j.at} | ${j.seed_id} | ${armFromSlug(j.slug)} | ${fmt(j.overall)} |`);
  }
  push("");
}

// --- Section: Recent runs table ------------------------------------------
// last ~10 runs (by generated_at), with seed/arm/success/overall joined across both files.
push("## Recent runs");
push("");
const overallBySlug = new Map(); // slug → last overall
for (const j of judged) overallBySlug.set(j.slug, j.overall);
const recent = [...results]
  .filter((r) => typeof r.generated_at === "string")
  .sort((a, b) => b.generated_at.localeCompare(a.generated_at))
  .slice(0, 10);
if (recent.length === 0) {
  push("_(no completed runs yet)_");
} else {
  push("| generated_at | seed | arm | slug | success | overall | phase | verify |");
  push("|--------------|------|-----|------|---------|---------|-------|--------|");
  for (const r of recent) {
    const o = overallBySlug.get(r.slug);
    push(
      `| ${r.generated_at} | ${seedFromSlug(r.slug)} | ${armFromSlug(r.slug)} ` +
      `| ${r.slug} | ${r.success ? "yes" : "no"} | ${o === undefined ? "-" : fmt(o)} | ${r.phase || "-"} | ${r.verify_origin || "-"} |`
    );
  }
  push("");
}

process.stdout.write(lines.join("\n") + "\n");
exit(0);
