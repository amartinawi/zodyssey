#!/usr/bin/env node
// harness.mjs — the eval loop's runner (operational-consult CRIT-4b).
//
// For each task in seed.jsonl: fresh-copy the fixture repo → scaffold a ZOdyssey run for the
// task's prompt → (the conductor then drives prime→…→done; when set-phase done fires, CRIT-4a
// auto-appends the run-report to results.jsonl) → emit a per-task summary.
//
// IMPORTANT — what this harness does and does NOT do:
//   DOES: fresh-repo isolation, run scaffolding, results.jsonl aggregation, end-state checking
//         against success_criteria. This is the "produce data" half the consultant asked for.
//   DOES NOT (yet): drive the LLM orchestrator itself. The actual /orchestrate call is done by
//         the operator (or a future wrapper) because it needs the interactive conductor. The
//         harness wires the measurement; the conductor does the work. A full autonomous mode is
//         a follow-up (it requires the /orchestrate command to be callable headlessly).
//
// Usage:
//   harness.mjs [--task <id>] [--arm zodyssey|baseline] [--list]
//   --task <id>   run only one seed task
//   --arm         which arm (zodyssey default; baseline = single-agent, no pipeline — TODO)
//   --list        print seed tasks and exit
//
// exit: 0 all tasks processed · 2 bad args · 3 seed missing

import { readFileSync, existsSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, env, cwd } from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// v0.3.0 portability: resolve the SCRIPTS dir relative to this script's own location so sibling
// scripts (run-report.mjs etc.) are found from the plugin cache install, not the legacy ~/.zcode path.
const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const SEED = join(env.HOME || "", ".zcode", "orchestration", "eval", "seed.jsonl");
const RESULTS = join(env.HOME || "", ".zcode", "orchestration", "eval", "results.jsonl");
const WORKDIR = join(env.HOME || "", ".zcode", "orchestration", "eval", "runs");

const args = argv.slice(2);
const listMode = args.includes("--list");
const taskIdx = args.indexOf("--task");
const taskFilter = taskIdx !== -1 ? args[taskIdx + 1] : null;
const armIdx = args.indexOf("--arm");
const arm = armIdx !== -1 ? args[armIdx + 1] : "zodyssey";

if (!existsSync(SEED)) { console.error("no seed file: " + SEED); exit(3); }

const seeds = readFileSync(SEED, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

// A seed is runnable iff its fixture EXISTS ON DISK. The old test was
// `!s.repo.includes("REPLACE_WITH")` — a magic-sentinel match that silently stopped working when
// the seeds were written with a different placeholder ("/path/to/throwaway/repo"). The sentinel
// never matched, so `--list` printed ✓ for all 5 seeds while every run died on cpSync ENOENT.
// The eval reported itself ready and had never executed a single task.
//
// Sentinel matching is the wrong shape for this question: it tests a string convention rather
// than the fact we actually care about. existsSync cannot drift out of sync with reality.
function seedReady(s) {
  if (!s.repo) return { ready: false, reason: "no `repo` field" };
  if (/REPLACE_WITH|\/path\/to\//.test(s.repo)) return { ready: false, reason: "placeholder path — point it at a real fixture" };
  if (!existsSync(s.repo)) return { ready: false, reason: `fixture does not exist: ${s.repo}` };
  return { ready: true };
}

if (listMode) {
  console.log("seed tasks:");
  let runnable = 0;
  for (const s of seeds) {
    const r = seedReady(s);
    if (r.ready) runnable++;
    console.log(`  ${s.id} [${s.intent}] ${r.ready ? "✓" : `✗ (${r.reason})`}  ${s.prompt.slice(0, 70)}`);
  }
  console.log(`\n${runnable}/${seeds.length} seed(s) runnable.`);
  if (runnable === 0) {
    console.error("\nNO SEED IS RUNNABLE — this eval cannot produce a number. Point each seed's `repo`\n" +
      "at a real fixture directory before drawing any conclusion from a harness run.");
    exit(4);
  }
  exit(0);
}

const selected = taskFilter ? seeds.filter((s) => s.id === taskFilter) : seeds;
if (selected.length === 0) { console.error(`no seed task with id ${taskFilter}`); exit(2); }

mkdirSync(WORKDIR, { recursive: true });
const results = [];

for (const seed of selected) {
  console.log(`\n=== ${seed.id} [${seed.intent}] arm=${arm} ===`);
  const readiness = seedReady(seed);
  if (!readiness.ready) {
    console.log(`  SKIP — ${readiness.reason}`);
    results.push({ id: seed.id, status: "skipped", reason: readiness.reason });
    continue;
  }
  // fresh copy of the fixture so each run is isolated
  const runRepo = join(WORKDIR, `${seed.id}-${arm}-${Date.now()}`);
  try { cpSync(seed.repo, runRepo, { recursive: true }); }
  catch (e) { console.log(`  SKIP — cannot copy fixture: ${e.message}`); results.push({ id: seed.id, status: "skipped", reason: "copy failed" }); continue; }
  // init as a fresh git repo so run_start_sha + diffs work
  // SEC-M12 (external audit #14): git config MUST run BEFORE add/commit — on a machine without a
  // global git identity, the commit used to fail silently (empty `catch {}`), leaving
  // run_start_sha="" and making every eval run's F1 vacuously pass. Now config-first, and on any
  // git-baseline failure we SKIP the seed loudly (so the eval corpus doesn't record false success).
  try {
    execFileSync("git", ["init", "-q"], { cwd: runRepo, shell: false, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "eval@zodyssey"], { cwd: runRepo, shell: false, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "zodyssey-eval"], { cwd: runRepo, shell: false, stdio: "pipe" });
    execFileSync("git", ["add", "-A"], { cwd: runRepo, shell: false, stdio: "pipe" });
    execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: runRepo, shell: false, stdio: "pipe" });
  } catch (e) {
    console.log(`  SKIP — git baseline failed (run_start_sha would be empty, F1 vacuous): ${(e.message || e).toString().slice(0, 160)}`);
    results.push({ id: seed.id, status: "skipped", reason: "git baseline failed" });
    continue;
  }

  // scaffold the ZOdyssey run for this task (the conductor will then drive it; on set-phase done,
  // CRIT-4a auto-appends to results.jsonl)
  const slug = `${seed.id}-${arm}`;
  try {
    execFileSync("node", [
      join(SCRIPTS, "scaffold.mjs"), runRepo, slug, seed.prompt.slice(0, 60), seed.intent, seed.prompt,
    ], { shell: false, stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    console.log(`  scaffold note: ${(e.stderr || e.message || "").slice(0, 120)}`);
  }

  console.log(`  fixture:    ${runRepo}`);
  console.log(`  scaffolded: .zcode/state/${slug}.json`);
  if (arm === "baseline") {
    console.log(`  BASELINE ARM: execute this task as a SINGLE agent with NO pipeline — no prime/consult/`);
    console.log(`                plan/review phases, no sub-agents. Just: read the prompt, do the work, stop.`);
    console.log(`                (This is the comparator. The delta vs the zodyssey arm on the same seed`);
    console.log(`                is the headline accuracy number.)`);
  } else {
    console.log(`  ZODYSSEY ARM: the conductor must now run /orchestrate on this task.`);
    console.log(`                on set-phase done|audited, the scorecard auto-appends to results.jsonl.`);
  }
  console.log(`  after the run, score it:  node judge.mjs ${runRepo} ${slug} ${seed.id}`);
  console.log(`  success_criteria for this task (judge end-state against these):`);
  for (const c of seed.success_criteria) console.log(`    - ${c}`);
  results.push({ id: seed.id, slug, repo: runRepo, arm, status: "scaffolded" });
}

console.log("\n=== harness summary ===");
for (const r of results) console.log(`  ${r.id}: ${r.status}${r.repo ? " → " + r.repo : ""}`);
console.log(`\nresults.jsonl: ${existsSync(RESULTS) ? readFileSync(RESULTS, "utf8").split("\n").filter((l) => l.trim()).length + " records" : "empty (will populate as runs complete)"}`);

// A run in which EVERY seed skipped is not a successful run. Exiting 0 here is what let the eval
// look healthy for its entire existence: it "completed", printed a summary, and measured nothing.
// Same rule as run-tests.mjs treating zero discovered tests as failure — a green that represents
// no work done is worse than a red, because it stops anyone from looking.
const scaffolded = results.filter((r) => r.status === "scaffolded").length;
if (scaffolded === 0) {
  console.error(`\nNO SEED RAN (${results.length} skipped). The harness measured nothing.\n` +
    `Do not treat this as a passing eval — fix the fixtures and re-run.`);
  exit(4);
}
exit(0);
