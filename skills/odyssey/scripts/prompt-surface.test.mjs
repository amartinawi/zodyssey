#!/usr/bin/env node
// prompt-surface.test.mjs — suite for prompt-surface.mjs (item 10, prompt-surface measurement).
//
// WHY THIS EXISTS: ~1,600 lines of guidance (SKILL.md sections, the capabilities quick matrix,
// 8 agent files) steer every run and nothing measures whether any of it changes outcomes. The
// script consumes 09's two-arm deltas and tags every surface unit with an evidence status —
// mechanically, no model call. This suite pins the three load-bearing behaviours:
//
//   precondition:  no arm-FIELD pair (seed judged under both arms) → exit 3, refusal on stderr
//                  naming two-arm + 09-two-arm-eval-baseline + the producing commands, stdout
//                  empty. Field, not slug: the mislabeled-arms fixture (slug "-baseline", arm
//                  field "zodyssey" — the exact pre-fix live-data shape, brief :306-309) must
//                  STILL refuse. Deliberate divergence from dashboard.mjs's exit-0-on-empty.
//   tagged-report: with ≥ 1 pair → exit 0, stdout only. MIN_N = 3 gating and the ±0.15 band
//                  (judge.mjs:294's own double-judge noise flag) asserted with a 6-seed fixture
//                  driving all three statuses, plus decoy capabilities sharing only a last
//                  segment (agent:not-zodyssey:prometheus) that must NEVER witness the real row —
//                  exact normalized identity, the tolerance class build order 03 closed.
//   enumeration:  the census re-derives from the files every run — a freshly added ## section,
//                  matrix row, and agents/*.md file each self-register as a VISIBLE unmeasured
//                  row (accretion-blindness guard), and README.md stays excluded by rule.
//
// RED-first: the implementation is invoked as a subprocess per case precisely so that when
// prompt-surface.mjs is ABSENT every case still runs and fails INDIVIDUALLY by name (exit 1,
// module not found ≠ 3/0) — a top-level static import would crash the file before any case name
// prints and the red proof would be vacuous (criterion 8 exists to catch exactly that class).
//
// Fixtures live in mktemp scratch dirs — never this repo's .zcode/ nor the live eval dir.
//
// Run:  node prompt-surface.test.mjs        (exit 0 = pass, 1 = fail)
//   or  node --test prompt-surface.test.mjs (same exit contract — the mini-runner's own
//                                            process exit code is the file-level verdict)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const IMPL = join(SCRIPT_DIR, "prompt-surface.mjs");
const REPO_ROOT = join(SCRIPT_DIR, "..", "..", ".."); // skills/odyssey/scripts → repo root

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name} ${detail}`); fail++; }
}

// Run the implementation as a subprocess, stdout/stderr captured separately. When
// prompt-surface.mjs is absent this returns code 1 + a module-not-found stderr — each caller's
// assertion on 3/0 then fails individually, which is the intended RED shape.
function run(args = []) {
  try {
    const stdout = execFileSync("node", [IMPL, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}

// A row/report line containing every token (case-insensitive is NOT wanted — status strings and
// capability identities are exact; only the line-finding is loose).
const rowWith = (out, ...tokens) =>
  out.split("\n").some((l) => tokens.every((t) => l.includes(t)));

// Scratch eval dir: judged.jsonl records (shape per judge.mjs:304-318; missing
// dimensions/criterion_results tolerated) + optional run-state files in the REAL harness
// layout (harness.mjs:177): each run repo is runs/<seed.id>-<arm>-<ts>/ — a fresh copy
// stamped with Date.now(), whose dirname is NOT the slug — and the state file inside it is
// .zcode/state/<slug>.json (capability observations shaped like post-tool.mjs:205/:251
// pushes: {at, phase, capability, observed:true}). F2 repair 2026-08-20: these fixtures used
// to fabricate runs/<slug>-live/, a layout that exists nowhere in the harness — every join
// silently missed while the suite stayed green. Fixtures repaired, assertions untouched.
function makeEvalDir(records, states = [], extraEmptyStateSlugs = []) {
  const dir = mkdtempSync(join(tmpdir(), "zod-psurface-eval-"));
  if (records.length) {
    writeFileSync(join(dir, "judged.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  states.forEach((st, i) => {
    // real layout (harness.mjs:177): runs/<seed.id>-<arm>-<Date.now()>/.zcode/state/<slug>.json
    // — the repo dirname carries a timestamp the join must not depend on; distinct per state so
    // sibling run repos coexist the way harness re-runs do
    const stateDir = join(dir, "runs", `${st.slug}-${RUN_TS + i}`, ".zcode", "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, `${st.slug}.json`), JSON.stringify(st) + "\n");
  });
  for (const slug of extraEmptyStateSlugs) {
    mkdirSync(join(dir, "runs", `${slug}-${RUN_TS + 9999}`, ".zcode", "state"), { recursive: true });
  }
  return dir;
}

// fixed fake Date.now() stamp for run-repo dirnames (the shape of the leftover run quoted at
// harness.mjs:189); fixed, not Date.now(), so fixture trees are reproducible byte-for-byte
const RUN_TS = 1787172158255;

const observed = (capability) =>
  ({ at: "2026-08-16T00:00:00Z", phase: "6", capability, observed: true });
const stateOf = (slug, caps) =>
  ({ slug, phase: "audited", capabilities: caps.map(observed) });

// Scratch repo-root carrying a DOCTORED copy of the real surface: one freshly added ## section,
// one new quick-matrix row, one new agents/*.md file — the accretion-blindness probe. Reading
// the real guidance files is fine; writing happens only inside the scratch dir.
function makeScratchRepoRoot() {
  const root = mkdtempSync(join(tmpdir(), "zod-psurface-surface-"));
  mkdirSync(join(root, "skills", "odyssey", "references"), { recursive: true });

  const NEW_SECTION = "Freshly-added accretion-probe section";
  const skill = readFileSync(join(REPO_ROOT, "skills", "odyssey", "SKILL.md"), "utf8");
  writeFileSync(join(root, "skills", "odyssey", "SKILL.md"),
    skill + `\n## ${NEW_SECTION}\n\nAdded next quarter; must self-register as a visible unmeasured row, never a silent pass.\n`);

  const NEW_ROW_ACTIVITY = "Accretion probe activity";
  const caps = readFileSync(join(REPO_ROOT, "skills", "odyssey", "references", "capabilities.md"), "utf8");
  const anchor = caps.indexOf("| **Parallel independent tasks** |"); // last row of the quick matrix
  if (anchor < 0) throw new Error("quick-matrix anchor row not found in capabilities.md");
  const eol = caps.indexOf("\n", anchor);
  writeFileSync(join(root, "skills", "odyssey", "references", "capabilities.md"),
    caps.slice(0, eol + 1) + `| **${NEW_ROW_ACTIVITY}** | \`Task: zodyssey:accretion-probe\` | — |\n` + caps.slice(eol + 1));

  cpSync(join(REPO_ROOT, "agents"), join(root, "agents"), { recursive: true }); // brings README.md along → exclusion rule exercised
  writeFileSync(join(root, "agents", "accretion-probe.md"),
    "# accretion-probe\n\nA brand-new agent definition; the census must list it as unmeasured.\n");

  return { root, NEW_SECTION, NEW_ROW_ACTIVITY };
}

console.log("prompt-surface.mjs — evidence-status report (item 10)\n");

// --- precondition block — fail closed without an arm-FIELD pair ----------------------------
{
  const empty = mkdtempSync(join(tmpdir(), "zod-psurface-empty-"));
  let emptyRun;
  try {
    emptyRun = run([empty]);
    check("precondition: empty eval dir (no judged.jsonl) → exit 3", emptyRun.code === 3, `(got ${emptyRun.code})`);
    check("precondition: refusal names 'two-arm' on stderr", emptyRun.stderr.includes("two-arm"));
    check("precondition: refusal names '09-two-arm-eval-baseline' on stderr",
      emptyRun.stderr.includes("09-two-arm-eval-baseline"));
    check("precondition: refusal names the producing commands (judge.mjs / harness.mjs) on stderr",
      /judge\.mjs/.test(emptyRun.stderr) && /harness\.mjs/.test(emptyRun.stderr));
    check("precondition: refusal stdout stays empty (stdout/stderr separation)", emptyRun.stdout === "");
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }

  const zodOnly = makeEvalDir([
    { seed_id: "s1", slug: "s1-zodyssey", arm: "zodyssey", overall: 0.9 },
    { seed_id: "s2", slug: "s2-zodyssey", arm: "zodyssey", overall: 0.7 },
  ]);
  try {
    const r = run([zodOnly]);
    check("precondition: zodyssey-arm-only records (no baseline arm FIELD) → exit 3", r.code === 3, `(got ${r.code})`);
    check("precondition: refusal stdout empty on data-present dir too", r.stdout === "");
  } finally {
    rmSync(zodOnly, { recursive: true, force: true });
  }

  // The mislabeled-arms fixture (brief :306-309): slug ends -baseline but the arm FIELD says
  // "zodyssey" — the exact pre-fix live shape. Slug-derived pairing would see a pair here; the
  // arm-FIELD rule must not (lib/arm.mjs is display-only; measurement never leans on it).
  const mislabeled = makeEvalDir([
    { seed_id: "std-01", slug: "std-01-zodyssey", arm: "zodyssey", overall: 0.9 },
    { seed_id: "std-01", slug: "std-01-baseline", arm: "zodyssey", overall: 0.83 },
  ]);
  try {
    const r = run([mislabeled]);
    check("precondition: mislabeled arms (slug -baseline, arm field \"zodyssey\") → still exit 3",
      r.code === 3, `(got ${r.code})`);
  } finally {
    rmSync(mislabeled, { recursive: true, force: true });
  }

  const noArmField = makeEvalDir([
    { seed_id: "s1", slug: "s1-zodyssey", arm: "zodyssey", overall: 0.9 },
    { seed_id: "s1", slug: "s1-baseline", overall: 0.4 }, // no arm field at all → counts toward nothing
  ]);
  try {
    const r = run([noArmField]);
    check("precondition: record lacking the arm field counts toward nothing → exit 3",
      r.code === 3, `(got ${r.code})`);
  } finally {
    rmSync(noArmField, { recursive: true, force: true });
  }
}

// --- tagged-report block — statuses computed from deltas, MIN_N gating, exact identity ------
{
  // Fixture 1 — criterion 6's tree in the REAL harness layout: one paired seed, one witnessed
  // agent capability under runs/s1-zodyssey-<ts>/.zcode/state/s1-zodyssey.json.
  // delta(s1) = 0.9 − 0.4 = +0.5, prometheus witnessed once → n=1 < MIN_N → unmeasured.
  const t1 = makeEvalDir(
    [
      { seed_id: "s1", slug: "s1-zodyssey", arm: "zodyssey", overall: 0.9 },
      { seed_id: "s1", slug: "s1-baseline", arm: "baseline", overall: 0.4 },
    ],
    [stateOf("s1-zodyssey", ["agent:zodyssey:prometheus"])],
    ["s1-baseline"],
  );
  try {
    const { code, stdout, stderr } = run([t1, REPO_ROOT]);
    check("tagged-report: single-pair fixture exits 0", code === 0, `(got ${code})`);
    check("tagged-report: report goes to stdout only (stderr empty on success)", stderr === "");
    check("tagged-report: table renders the agents/prometheus.md unit", rowWith(stdout, "agents/prometheus.md"));
    check("tagged-report: prometheus witnessed but n=1 < MIN_N reads unmeasured",
      rowWith(stdout, "agents/prometheus.md", "unmeasured", "n=1"));
    check("tagged-report: pipeline (aggregate) line reports the pair (n=1)",
      rowWith(stdout, "pipeline (aggregate)", "n=1"));
    check("tagged-report: header prints MIN_N = 3 and the 0.15 band as named constants",
      /MIN_N\s*=\s*3/.test(stdout) && /0\.15/.test(stdout));
    check("tagged-report: unmeasured fraction headline rendered",
      stdout.split("\n").some((l) => /unmeasured/i.test(l) && /fraction/i.test(l) && /\d/.test(l)));
  } finally {
    rmSync(t1, { recursive: true, force: true });
  }

  // Fixture 2 — six paired seeds, deltas beyond ±0.15, driving ALL THREE statuses:
  //   s1..s3 positive (+0.5, +0.4, +0.3) — prometheus witnessed on all three  → mean +0.40, n=3 → measured-load-bearing
  //   s4..s6 negative (−0.5, −0.4, −0.3) — oracle witnessed on all three      → mean −0.40, n=3 → contradicted
  //   metis witnessed on s1,s2 only → mean +0.45 (beyond band) but n=2 < MIN_N → unmeasured (the min-n gate)
  // Decoys share ONLY a last segment (agent:not-zodyssey:prometheus/oracle, on the opposite
  // seeds): under last-segment tolerance each victim would be witnessed n=6, mean 0.00 →
  // unmeasured — i.e. the status assertions below flip, so exact identity is asserted, not assumed.
  const seeds = [
    ["s1", 0.9, 0.4], ["s2", 0.8, 0.4], ["s3", 0.8, 0.5],
    ["s4", 0.4, 0.9], ["s5", 0.4, 0.8], ["s6", 0.5, 0.8],
  ];
  const records = seeds.flatMap(([id, z, b]) => [
    { seed_id: id, slug: `${id}-zodyssey`, arm: "zodyssey", overall: z },
    { seed_id: id, slug: `${id}-baseline`, arm: "baseline", overall: b },
  ]);
  const states = [
    stateOf("s1-zodyssey", ["agent:zodyssey:prometheus", "agent:zodyssey:metis", "agent:not-zodyssey:oracle"]),
    stateOf("s2-zodyssey", ["agent:zodyssey:prometheus", "agent:zodyssey:metis", "agent:not-zodyssey:oracle"]),
    stateOf("s3-zodyssey", ["agent:zodyssey:prometheus", "agent:not-zodyssey:oracle"]),
    stateOf("s4-zodyssey", ["agent:zodyssey:oracle", "agent:not-zodyssey:prometheus"]),
    stateOf("s5-zodyssey", ["agent:zodyssey:oracle", "agent:not-zodyssey:prometheus"]),
    stateOf("s6-zodyssey", ["agent:zodyssey:oracle", "agent:not-zodyssey:prometheus"]),
  ];
  const t2 = makeEvalDir(records, states);
  try {
    const { code, stdout } = run([t2, REPO_ROOT]);
    check("tagged-report: six-pair fixture exits 0", code === 0, `(got ${code})`);
    check("tagged-report: prometheus n=3, mean delta +0.40 ≥ +0.15 → measured-load-bearing",
      rowWith(stdout, "agents/prometheus.md", "measured-load-bearing", "n=3"));
    check("tagged-report: oracle n=3, mean delta −0.40 ≤ −0.15 → contradicted",
      rowWith(stdout, "agents/oracle.md", "contradicted", "n=3"));
    check("tagged-report: metis mean delta +0.45 beyond band but n=2 < MIN_N → unmeasured (min-n gate)",
      rowWith(stdout, "agents/metis.md", "unmeasured", "n=2"));
    check("tagged-report: all three statuses present in one report",
      stdout.includes("measured-load-bearing") && stdout.includes("contradicted") && stdout.includes("unmeasured"));
    check("tagged-report: exact identity — last-segment decoys never inflate the real rows (no n=6)",
      !rowWith(stdout, "agents/prometheus.md", "n=6") && !rowWith(stdout, "agents/oracle.md", "n=6"));
    check("tagged-report: aggregate over 6 pairs (mean delta 0.00, inside band) reads unmeasured",
      rowWith(stdout, "pipeline (aggregate)", "n=6", "unmeasured"));
  } finally {
    rmSync(t2, { recursive: true, force: true });
  }
}

// --- enumeration block — the census re-derives from the files; additions self-register ------
{
  const paired = makeEvalDir(
    [
      { seed_id: "s1", slug: "s1-zodyssey", arm: "zodyssey", overall: 0.9 },
      { seed_id: "s1", slug: "s1-baseline", arm: "baseline", overall: 0.4 },
    ],
    [stateOf("s1-zodyssey", ["agent:zodyssey:prometheus"])],
  );
  const surface = makeScratchRepoRoot();
  try {
    const { code, stdout } = run([paired, surface.root]);
    check("enumeration: doctored-surface report (paired data + scratch repo-root) exits 0",
      code === 0, `(got ${code})`);
    check("enumeration: freshly added SKILL.md ## section appears as an unmeasured row",
      rowWith(stdout, surface.NEW_SECTION, "unmeasured"));
    check("enumeration: newly added quick-matrix row appears as an unmeasured row",
      rowWith(stdout, surface.NEW_ROW_ACTIVITY, "unmeasured"));
    check("enumeration: newly added agents/*.md file appears as an unmeasured row",
      rowWith(stdout, "agents/accretion-probe.md", "unmeasured"));
    check("enumeration: agents/README.md stays excluded by rule",
      !stdout.split("\n").some((l) => l.includes("agents/README.md")));
  } finally {
    rmSync(paired, { recursive: true, force: true });
    rmSync(surface.root, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
exit(fail === 0 ? 0 : 1);
