#!/usr/bin/env node
// prompt-surface.mjs — evidence-status report for the guidance surface (item 10).
//
// WHY THIS EXISTS: ~1,600 lines of guidance text (SKILL.md sections, the capabilities quick
// matrix, 8 agent definitions) steer every orchestration run, and nothing measures whether any
// of it changes outcomes. This report tags every unit of that surface with an evidence status —
// `measured-load-bearing` / `contradicted` / `unmeasured` — computed mechanically from the
// two-arm eval deltas (item 09) joined to hook-witnessed capability activity in run state.
// No model call anywhere: the only LLM in the pipeline is 09's judge, whose scores this script
// CONSUMES. Nothing is mutated — measurement, not pruning; acting on this table is a human
// decision in a separate change.
//
// Usage:
//   prompt-surface.mjs [eval-dir] [repo-root]
//     eval-dir   directory holding judged.jsonl + runs/<slug>-<ts>/… (default ~/.zcode/orchestration/eval)
//     repo-root  repo whose prompt surface is censused                (default: cwd)
//
// exit contract: 0 report rendered · 2 bad args · 3 precondition failed (no arm-FIELD pair).
//
// DELIBERATE DIVERGENCE from dashboard.mjs's exit-0-on-empty: the dashboard displays what
// exists; this script computes evidence statuses, and a wall of `unmeasured` rendered over zero
// paired seeds would look exactly like a result. It refuses instead (exit 3), naming the
// producing prompt and commands.
//
// Arm rule (the 2026-08-17 amendment, as code): pairing keys on the judged record's `arm` FIELD
// ONLY — never on a slug suffix. The slug-derivation lib (lib/arm.mjs) is display-only and is
// neither imported nor re-implemented here; records lacking `arm` count toward nothing. Fail
// closed rather than fall back to an inferred arm.
//
// Capability identity, derived from the observation writers themselves (post-tool.mjs:204-205
// and :250-251 push {at, phase, capability, observed:true} into state.capabilities):
//   Skill tool load      → recorded `skill:<name>`           (post-tool.mjs:193)
//   Task/Agent dispatch  → recorded `agent:<subagent_type>`  (post-tool.mjs:239)
//   mcp__* tool calls    → recorded as the raw tool name (`mcp__<server>__<tool>`) — no
//                          deterministic prescription→token shape exists, so matrix cells naming
//                          MCPs stay UNMAPPED rather than guessed. Matching is EXACT normalized
//                          identity; last-segment tolerance is the silent-misattribution class
//                          build order 03 closed and must not return.
// Matrix prescriptions normalize as `skill: X` → `skill:X` and `Task: X` → `agent:X`
// (whitespace-stripped). A census agent file `agents/<base>.md` joins on `agent:zodyssey:<base>`.
//
// Read-only: writes stdout and exits. Never edits guidance files, judged.jsonl, or state files.
// Zero npm dependencies; Node 18+ built-ins only; synchronous, no daemon.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, env, cwd } from "node:process";

// Named constants, printed in the report header — conventions, not laws:
const MIN_N = 3; // paired seeds a unit must be witnessed on before a status beyond `unmeasured`
const DELTA_THRESHOLD = 0.15; // judge.mjs:294's own double-judge disagreement flag — a delta smaller than judge-to-judge noise cannot be called load-bearing

const DEFAULT_EVAL_DIR = join(env.HOME || "", ".zcode", "orchestration", "eval");

const usage = [
  "usage: prompt-surface.mjs [eval-dir] [repo-root]",
  "  eval-dir   directory holding judged.jsonl + runs/<slug>-<ts>/… (default ~/.zcode/orchestration/eval)",
  "  repo-root  repo whose prompt surface is censused               (default: cwd)",
  "exit: 0 report rendered · 2 bad args · 3 precondition failed (no arm-FIELD pair)",
].join("\n");

const rest = argv.slice(2);
if (rest.length > 2 || rest.some((a) => a.startsWith("-"))) {
  process.stderr.write(usage + "\n");
  exit(2);
}
const evalDir = rest[0] !== undefined ? rest[0] : DEFAULT_EVAL_DIR;
const repoRoot = rest[1] !== undefined ? rest[1] : cwd();

// --- read & parse helpers (dashboard.mjs's tolerant shapes) --------------------

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip malformed line rather than crash */ }
  }
  return out;
}

const readText = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// --- precondition: pairing on the arm FIELD only — never a slug suffix ---------

const judged = readJsonl(join(evalDir, "judged.jsonl"));
const bySeed = new Map(); // seed_id → { zodyssey: [records], baseline: [records] }
for (const j of judged) {
  if (!j || typeof j.seed_id !== "string") continue;
  const arm = j.arm; // FIELD ONLY: absent or other values count toward nothing
  if (arm !== "zodyssey" && arm !== "baseline") continue;
  if (!bySeed.has(j.seed_id)) bySeed.set(j.seed_id, { zodyssey: [], baseline: [] });
  bySeed.get(j.seed_id)[arm].push(j);
}

const pairedSeeds = [...bySeed.entries()]
  .filter(([, a]) => a.zodyssey.length > 0 && a.baseline.length > 0)
  .map(([seed, a]) => {
    const dz = mean(a.zodyssey.map((r) => num(r.overall)).filter((x) => x !== null));
    const db = mean(a.baseline.map((r) => num(r.overall)).filter((x) => x !== null));
    return {
      seed,
      delta: dz !== null && db !== null ? dz - db : null, // null = unscored arm → excluded from means, never fabricated
      zodSlugs: [...new Set(a.zodyssey.map((r) => r.slug).filter((s) => typeof s === "string"))],
    };
  })
  .sort((x, y) => x.seed.localeCompare(y.seed));

if (pairedSeeds.length === 0) {
  process.stderr.write(
    [
      `prompt-surface: refusing to run — no paired seed in ${join(evalDir, "judged.jsonl")}.`,
      "",
      "The two-arm evidence this report consumes does not exist yet: no seed_id has one judged",
      'record whose arm FIELD is "baseline" and one whose arm FIELD is "zodyssey". The arm field,',
      "never a slug suffix — the slug-derivation in lib/arm.mjs is display-only, and this script",
      "does not fall back to it. Produce the pair first (item 09, the two-arm eval baseline:",
      "docs/impl/09-two-arm-eval-baseline.md):",
      "",
      "  node skills/odyssey/scripts/harness.mjs --task <seed-id> --arm baseline",
      "  node skills/odyssey/scripts/harness.mjs --task <seed-id> --arm zodyssey",
      "  node skills/odyssey/scripts/judge.mjs <run-repo> <slug> <seed-id> --arm baseline",
      "  node skills/odyssey/scripts/judge.mjs <run-repo> <slug> <seed-id> --arm zodyssey",
      "",
      "exit 3 — deliberate divergence from dashboard.mjs's exit-0-on-empty: a wall of `unmeasured`",
      "rendered over zero pairs would look exactly like a result.",
      "",
    ].join("\n")
  );
  exit(3);
}

// --- witnessed-activity substrate (zodyssey-arm run state only) ----------------
// The harness (harness.mjs:177) copies each arm's run repo to runs/<seed.id>-<arm>-<ts>/ under
// the eval dir — a Date.now() stamp, NOT the slug; re-runs mint fresh dirs. The scaffolded
// state lives at .zcode/state/<slug>.json INSIDE that repo (harness.mjs:215/:225), so the slug
// is carried by the FILENAME and resolution must be layout-agnostic: for each slug, glob
// runs/*/.zcode/state/<slug>.json and UNION capabilities across every match (a capability
// witnessed in any run repo of that slug was witnessed — the repo dirname carries no joinable
// identity). Only the zodyssey arm is consulted: the baseline runs no pipeline, so there is
// nothing to witness there. A missing state file or an empty capabilities[] degrades to
// `unmeasured`, never to a block or a guess.

const runsDir = join(evalDir, "runs");
let runRepoDirs = [];
if (existsSync(runsDir)) {
  try {
    runRepoDirs = readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch { runRepoDirs = []; } // unreadable runs/ → no witnesses, never a crash
}

for (const p of pairedSeeds) {
  const caps = new Set();
  for (const slug of p.zodSlugs) {
    // layout-agnostic glob: runs/*/.zcode/state/<slug>.json — harness.mjs:177 stamps each run
    // repo `<seed.id>-<arm>-<Date.now()>`, so the slug lives in the state FILENAME, never in the
    // repo dirname; every match's capabilities union (re-runs are re-witnesses, not overrides)
    for (const repo of runRepoDirs) {
      const sp = join(runsDir, repo, ".zcode", "state", `${slug}.json`);
      if (!existsSync(sp)) continue;
      let st;
      try { st = JSON.parse(readFileSync(sp, "utf8")); } catch { continue; }
      if (st && Array.isArray(st.capabilities)) {
        for (const c of st.capabilities) {
          if (c && typeof c.capability === "string") caps.add(c.capability); // exact recorded string
        }
      }
    }
  }
  p.caps = caps;
}

// --- census: the surface re-derived from the files on every run ----------------
// (accretion-blindness guard: a unit added next quarter self-registers here as a visible
// `unmeasured` row, never a silent pass)

const sectionTitles = readText(join(repoRoot, "skills", "odyssey", "SKILL.md"))
  .split("\n")
  .map((l) => (l.match(/^## (.+?)\s*$/) || [])[1])
  .filter(Boolean);

const matrixRows = [];
for (const line of readText(join(repoRoot, "skills", "odyssey", "references", "capabilities.md")).split("\n")) {
  const m = line.match(/^\| \*\*(.+?)\*\* \|(.+)\|$/); // quick-matrix rows: | **Activity** | Primary | Reinforcing |
  if (!m) continue;
  const cells = m[2].split("|"); // cells[0] = Primary, cells[1] = Reinforcing
  matrixRows.push({ activity: m[1].trim(), cells: [cells[0] || "", cells[1] || ""] });
}

const agentsDir = join(repoRoot, "agents");
const agentFiles = existsSync(agentsDir)
  ? readdirSync(agentsDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "README.md") // excluded by rule: the porting map, not a dispatched prompt
      .map((e) => e.name)
      .sort()
  : [];

// prescription (matrix cell) → recorded token. EXACT identity, whitespace-stripped; anything
// without a deterministic recorded shape (MCP names, slash commands, prose) stays unmapped
// rather than guessed.
function tokensOfCell(cell) {
  const out = [];
  for (const span of cell.match(/`[^`]+`/g) || []) {
    const s = span.slice(1, -1).trim();
    let m;
    if ((m = s.match(/^skill:\s*(.+)$/i))) out.push("skill:" + m[1].replace(/\s+/g, ""));
    else if ((m = s.match(/^Task:\s*(.+)$/i))) out.push("agent:" + m[1].replace(/\s+/g, ""));
  }
  return out;
}

const units = [];
for (const title of sectionTitles) {
  // SKILL.md sections execute in every zodyssey-arm run by construction — a two-arm design
  // cannot attribute outcomes to them individually (that needs ablation). No capability
  // mapping, n=0, honestly `unmeasured` in this first pass.
  units.push({ label: `SKILL.md # ${title}`, tokens: [], note: "no ablation substrate" });
}
for (const r of matrixRows) {
  const tokens = [...new Set(r.cells.flatMap(tokensOfCell))];
  units.push({ label: `matrix: ${r.activity}`, tokens, note: tokens.length ? tokens.join(", ") : "no mappable capability token" });
}
for (const f of agentFiles) {
  const token = `agent:zodyssey:${f.replace(/\.md$/, "")}`;
  units.push({ label: `agents/${f}`, tokens: [token], note: token });
}

// --- status computation (mechanical; named thresholds, no judgment anywhere) ---

function statusOf(n, meanDelta) {
  if (n >= MIN_N && meanDelta !== null) {
    if (meanDelta >= DELTA_THRESHOLD) return "measured-load-bearing";
    if (meanDelta <= -DELTA_THRESHOLD) return "contradicted";
  }
  return "unmeasured";
}

for (const u of units) {
  const w = u.tokens.length ? pairedSeeds.filter((p) => u.tokens.some((t) => p.caps.has(t))) : [];
  u.n = w.length;
  u.meanDelta = mean(w.map((p) => p.delta).filter((d) => d !== null));
  u.status = statusOf(u.n, u.meanDelta);
}

const aggDeltas = pairedSeeds.map((p) => p.delta).filter((d) => d !== null);
const aggMean = mean(aggDeltas);
const aggStatus = statusOf(pairedSeeds.length, aggMean);

// --- report (stdout only) ------------------------------------------------------

const fmtDelta = (d) => {
  if (d === null) return "—";
  const v = Math.round(d * 100) / 100;
  return (v > 0 ? "+" : "") + (v === 0 ? 0 : v).toFixed(2);
};

const counts = { "measured-load-bearing": 0, contradicted: 0, unmeasured: 0 };
for (const u of units) counts[u.status]++;
const total = units.length;
const frac = total ? counts.unmeasured / total : 0;

const lines = [];
const push = (s = "") => lines.push(s);
push("# prompt-surface evidence report");
push("");
push(`- eval dir: \`${evalDir}\``);
push(`- repo root: \`${repoRoot}\``);
push(`- judged records read: ${judged.length}`);
push(`- paired seeds (arm-field pairs): ${pairedSeeds.length}`);
push(`- constants: MIN_N = ${MIN_N} · delta band ±${DELTA_THRESHOLD} (judge.mjs:294's double-judge noise flag)`);
push("");
push("## Evidence status per unit");
push("");
push("| unit | status | witnessed n | mean delta | capability tokens joined |");
push("|---|---|---|---|---|");
push(`| pipeline (aggregate) | ${aggStatus} | n=${pairedSeeds.length} | ${fmtDelta(aggMean)} | (the guidance surface as a whole) |`);
for (const u of units) {
  push(`| ${u.label} | ${u.status} | n=${u.n} | ${fmtDelta(u.meanDelta)} | ${u.note} |`);
}
push("");
push("## Counts by status");
push("");
push(`- measured-load-bearing: ${counts["measured-load-bearing"]}`);
push(`- contradicted: ${counts.contradicted}`);
push(`- unmeasured: ${counts.unmeasured}`);
push(`- total units: ${total} (${sectionTitles.length} SKILL.md sections + ${matrixRows.length} quick-matrix rows + ${agentFiles.length} agent files)`);
push("");
push(`unmeasured fraction: ${frac.toFixed(3)} (${counts.unmeasured} of ${total} units) — the headline this report exists to make quotable`);

process.stdout.write(lines.join("\n") + "\n");
exit(0);
