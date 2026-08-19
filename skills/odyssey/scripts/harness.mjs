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
//         The BASELINE arm (--arm baseline) is executed machinery too (item 09): the harness
//         itself spawns the single external-CLI agent and appends the efficiency record.
//   DOES NOT: drive the zodyssey arm's LLM orchestrator. The actual /orchestrate call is done by
//         the operator because it needs the interactive conductor. The harness wires the
//         measurement; the conductor does the work. A full autonomous zodyssey mode is a
//         follow-up (it requires the /orchestrate command to be callable headlessly).
//
// Usage:
//   harness.mjs [--task <id>] [--arm zodyssey|baseline] [--dry-run] [--list]
//   --task <id>   run only one seed task
//   --arm         which arm: zodyssey (default — conductor-driven; the operator runs
//                 /orchestrate on each scaffolded run) | baseline (single external-CLI agent
//                 on the seed prompt alone, no pipeline — executed by this harness)
//   --dry-run     print each runnable seed's plan for the selected arm (spawn command, cwd,
//                 append destination, judge command) and exit 0 — writes nothing, spawns
//                 nothing (branches before the runs/ side-effect)
//   --list        print seed tasks and exit
//
// exit: 0 all tasks processed · 2 bad args (--arm outside the enum included) · 3 seed missing ·
//       4 nothing measured (every seed skipped or failed)

import { readFileSync, existsSync, rmSync, mkdirSync, cpSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, env, cwd } from "node:process";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isFatalSpawnError } from "./lib/spawn.mjs";

// v0.3.0 portability: resolve the SCRIPTS dir relative to this script's own location so sibling
// scripts (run-report.mjs etc.) are found from the plugin cache install, not the legacy ~/.zcode path.
const SCRIPTS = fileURLToPath(new URL(".", import.meta.url));
const SEED = join(env.HOME || "", ".zcode", "orchestration", "eval", "seed.jsonl");
const RESULTS = join(env.HOME || "", ".zcode", "orchestration", "eval", "results.jsonl");
const WORKDIR = join(env.HOME || "", ".zcode", "orchestration", "eval", "runs");

// BASELINE_TIMEOUT_MIN — the wall-clock budget for ONE baseline-arm external-CLI run (item 09;
// 2026-08-19 amendment, docs/impl/09-two-arm-eval-baseline.md "Amendment — the timeout
// constant", and MEASUREMENT.md §6 item 6). The amendment directs the reasoning to live in the
// header next to the number, so it does:
//   - wall_clock_min measures ELAPSED time including idle (a run left open overnight reads as
//     seventeen hours), so corpus run-times bound this constant from BELOW only — no corpus
//     figure settles it. The longest non-gap seed run observed is 160.9 min.
//   - The honest basis: the baseline is a single agent with no pipeline (no prime/consult/
//     plan/review, no sub-agents) and should finish FASTER than any pipeline row; 240 ≈ 1.5×
//     the longest non-gap run is a margin that exists to bound spend, not to grade the arm.
//   - A timeout here is a CAPABILITY FAILURE, never an arm result: the seed records
//     status:"failed" with no success append; failed baselines are excluded from per-arm means
//     and reported as their own count. A short cap that silently converted "did not finish"
//     into "did worse" would be confirmation bias compiled into a constant.
const BASELINE_TIMEOUT_MIN = 240;

// BASELINE_PERMISSION_MODE — the tool-permission surface the baseline arm runs under.
// Every other CLI spawn in this repo pins its surface deliberately (judge.mjs, consult.mjs pass
// `--permission-mode plan --allowedTools ""`, because an auditor must not write). The baseline
// arm is the ONLY spawn that must WRITE, and it shipped flagless — which made the control arm's
// tool access an UNCONTROLLED VARIABLE in a controlled experiment: what it was permitted to do
// depended on whichever CLAUDE_CLI binary happened to be on PATH, and nothing recorded it.
// Pinned here, overridable per-CLI, and stamped into the appended record so the experiment's
// conditions live in the data rather than in the operator's memory.
const BASELINE_PERMISSION_MODE = env.ZODYSSEY_BASELINE_PERMISSION_MODE || "acceptEdits";

const USAGE = "usage: harness.mjs [--task <id>] [--arm zodyssey|baseline] [--dry-run] [--list]";

const args = argv.slice(2);
const listMode = args.includes("--list");
const dryRun = args.includes("--dry-run");
const taskIdx = args.indexOf("--task");
const taskFilter = taskIdx !== -1 ? args[taskIdx + 1] : null;
const armIdx = args.indexOf("--arm");
const arm = armIdx !== -1 ? args[armIdx + 1] : "zodyssey";

// --arm is a validated enum (item 09): unknown flags used to be silently ignored, which is
// exactly the laxity that made a pre-fix --dry-run dangerous (it fell through into the real
// flow). Validation is FIRST — before the seed check, before the runs/ side-effect, before the
// dry-run branch — so `--arm bogus` (alone or combined with --dry-run) exits 2 having done
// nothing.
const ARM_ENUM = ["zodyssey", "baseline"];
if (armIdx !== -1 && !ARM_ENUM.includes(arm)) {
  console.error(`bad --arm value: ${JSON.stringify(arm)} (expected zodyssey|baseline)`);
  console.error(USAGE);
  exit(2);
}

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
  // item 09: --list names both arms so the arm surface is visible before any spend
  console.log("arms: zodyssey (default — conductor-driven /orchestrate per scaffolded run) · " +
    "baseline (--arm baseline — one external-CLI agent on the seed prompt, no pipeline; " +
    "--dry-run previews either arm without spending anything)");
  if (runnable === 0) {
    console.error("\nNO SEED IS RUNNABLE — this eval cannot produce a number. Point each seed's `repo`\n" +
      "at a real fixture directory before drawing any conclusion from a harness run.");
    exit(4);
  }
  exit(0);
}

const selected = taskFilter ? seeds.filter((s) => s.id === taskFilter) : seeds;
if (selected.length === 0) { console.error(`no seed task with id ${taskFilter}`); exit(2); }

// --dry-run (item 09): print exactly what the selected arm would do for each runnable seed and
// stop. This branch sits BEFORE the mkdirSync(WORKDIR) side-effect below and before anything
// that writes $HOME/.zcode/.zodyssey-run-key (the scaffold flow does) — dry-run writes nothing,
// spawns nothing; the filesystem stays byte-identical (pinned by two-arm-eval.test.mjs case f).
if (dryRun) {
  for (const seed of selected) {
    console.log(`\n=== ${seed.id} [${seed.intent}] arm=${arm} (DRY RUN — nothing executed) ===`);
    const readiness = seedReady(seed);
    if (!readiness.ready) { console.log(`  SKIP — ${readiness.reason}`); continue; }
    const slug = `${seed.id}-${arm}`;
    const runRepo = join(WORKDIR, `${seed.id}-${arm}-<ts>`);
    console.log(`  prefix (both arms): fresh copy ${seed.repo} → ${runRepo}; git baseline (SEC-M12);`);
    console.log(`  scaffold .zcode/state/${slug}.json (records run_start_sha — this is what makes the run judgeable)`);
    if (arm === "baseline") {
      console.log(`  spawn: ${env.CLAUDE_CLI || "claude"} -p --output-format json`);
      console.log(`  cwd:   ${runRepo}   timeout: ${BASELINE_TIMEOUT_MIN} min (BASELINE_TIMEOUT_MIN)`);
      console.log(`  input: the seed's prompt, verbatim (${seed.prompt.length} chars) — no criteria, no plan`);
      console.log(`  on completion: self-append the efficiency record (arm "baseline") to ${RESULTS}`);
    } else {
      console.log(`  spawn: none — the conductor drives /orchestrate on the scaffolded run (interactive boundary)`);
      console.log(`  on set-phase done|audited: the scorecard auto-appends to ${RESULTS}`);
    }
    console.log(`  judge: node ${join(SCRIPTS, "judge.mjs")} ${runRepo} ${slug} ${seed.id}${arm === "baseline" ? " --arm baseline" : ""}`);
  }
  console.log(`\ndry run complete — nothing written, nothing spawned; ${RESULTS} untouched.`);
  exit(0);
}

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
  // run_start_sha="" and making every eval run's F1 vacuously pass. Now config-first, and on a
  // git-baseline failure with HEAD UNRESOLVABLE we SKIP the seed loudly (so the eval corpus
  // doesn't record false success). Narrowed 2026-08-20: all 4 live fixtures ship as
  // already-committed repos, so `commit` fails "nothing to commit" on a clean tree while
  // rev-parse HEAD still resolves — v0.6.9's any-failure skip fired on EVERY seed that way
  // (exit 4, nothing measured; live repro --task std-01 --arm baseline, leftover
  // runs/std-01-baseline-1787172158255). A resolvable HEAD was never the invariant's target
  // (the judged std-01-baseline rode fixture HEAD f9dd73a pre-SEC-M12): we log it and ride.
  try {
    execFileSync("git", ["init", "-q"], { cwd: runRepo, shell: false, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "eval@zodyssey"], { cwd: runRepo, shell: false, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "zodyssey-eval"], { cwd: runRepo, shell: false, stdio: "pipe" });
    execFileSync("git", ["add", "-A"], { cwd: runRepo, shell: false, stdio: "pipe" });
    execFileSync("git", ["commit", "-qm", "fixture baseline"], { cwd: runRepo, shell: false, stdio: "pipe" });
  } catch (e) {
    // narrowed 2026-08-20: only an unresolvable HEAD makes a failed baseline fatal — a fixture
    // that already has a HEAD is a valid starting point; proceed on it.
    let head = "";
    try {
      head = execFileSync("git", ["rev-parse", "HEAD"],
        { cwd: runRepo, encoding: "utf8", shell: false, stdio: "pipe" }).trim();
    } catch { head = ""; }
    if (!head) {
      console.log(`  SKIP — git baseline failed, HEAD is unresolvable (run_start_sha would be empty, F1 vacuous): ${(e.message || e).toString().slice(0, 160)}`);
      results.push({ id: seed.id, status: "skipped", reason: "git baseline failed" });
      continue;
    }
    console.log(`  git baseline: riding fixture HEAD ${head.slice(0, 7)}`);
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
    // BASELINE ARM (item 09): EXECUTE. One synchronous external-CLI agent (the same binary
    // judge.mjs resolves) on the seed's `prompt` VERBATIM — no criteria, no plan artifacts, no
    // sub-agents (helping the baseline with orchestration artifacts would confound the arms).
    // cwd = the fresh copy; bounded by BASELINE_TIMEOUT_MIN (reasoning in its header).
    const claudeBin = env.CLAUDE_CLI || "claude";
    const t0 = Date.now();
    const res = spawnSync(claudeBin, ["-p", "--output-format", "json", "--permission-mode", BASELINE_PERMISSION_MODE], {
      cwd: runRepo, encoding: "utf8", input: seed.prompt, shell: false,
      maxBuffer: 200 * 1024 * 1024, timeout: BASELINE_TIMEOUT_MIN * 60 * 1000,
    });
    // Loud failure (item 09 req 3): CLI absent / non-zero exit / timeout → status "failed", NO
    // vacuous success append. A timed-out or crashed baseline is a capability failure, never an
    // arm result — excluded from per-arm means, reported as its own count. EPIPE-with-success
    // is not fatal (same classifier judge.mjs uses, lib/spawn.mjs).
    const timedOut = !!(res.error && res.error.code === "ETIMEDOUT");
    if (isFatalSpawnError(res) || res.status !== 0) {
      const why = timedOut
        ? `timed out after ${BASELINE_TIMEOUT_MIN} min (BASELINE_TIMEOUT_MIN — capability failure, not an arm result)`
        : (res.error
            ? `cannot spawn ${JSON.stringify(claudeBin)}: ${res.error.message}`
            : `exited ${res.status}`);
      console.log(`  FAILED — baseline agent ${why}; no success append for this seed.`);
      if (res.stderr) console.log(`  agent stderr: ${String(res.stderr).slice(0, 200)}`);
      results.push({ id: seed.id, slug, repo: runRepo, arm, status: "failed", reason: why });
      continue;
    }
    // EMPTY-WORK GUARD (v0.6.8): req 3's loud-failure rule fires on spawn error, non-zero exit
    // and timeout. A permission-starved agent does NONE of those — it runs, writes nothing, and
    // exits 0. Recording that as a measured baseline hands the judge an empty diff to score near
    // zero, so a capability failure would enter the corpus as an ARM LOSS. That bias runs one
    // way: it flatters the pipeline arm, inside the one instrument built to let this project be
    // wrong about itself. Same rule as the timeout, mechanically enforced rather than left to a
    // reader noticing a suspiciously empty diff.
    //
    // The check is deliberately coarse — ANY change outside .zcode/ counts as work. Judging the
    // work's quality is the judge's job; this only separates "did something" from "did nothing",
    // which is the difference between an arm result and a dead tool surface.
    const isWorkPath = (f) => !f.startsWith(".zcode/") && !/^(node_modules|dist|build|target|coverage|\.cache|\.next)\//.test(f);
    let worked = false;
    try {
      const porcelain = execFileSync("git", ["-C", runRepo, "status", "--porcelain", "--untracked-files=all"],
        { encoding: "utf8", shell: false, maxBuffer: 50 * 1024 * 1024 });
      worked = porcelain.split("\n").map((l) => l.slice(3).trim()).filter(Boolean).some(isWorkPath);
    } catch (e) {
      // git unreadable here means we cannot tell work from no-work. Fail closed: an
      // unverifiable state blocks, it never passes (Step-5 constraint).
      worked = false;
    }
    // consult-remediation GAP 2 (external audit, 2026-08-19): porcelain sees only UNCOMMITTED
    // changes, but this harness hands the agent a repo with a COMMITTED git baseline (the
    // "fixture baseline" commit above) — so committing is the natural thing for a coding agent
    // to do, and a committing agent left a clean tree that the porcelain half alone called
    // "no work": the seed failed, and real measured work was discarded. Decide work against
    // the run's START COMMIT as well (the scaffold already records run_start_sha in the run's
    // state file — judge.mjs consumes the same field): any non-.zcode/ path in
    // `diff run_start_sha..HEAD` is work. Missing state / invalid sha / unreadable git here
    // stays silent (fail closed — porcelain's verdict stands; git unreadable NEVER passes).
    if (!worked) {
      try {
        const statePath = join(runRepo, ".zcode", "state", `${slug}.json`);
        if (existsSync(statePath)) {
          const runState = JSON.parse(readFileSync(statePath, "utf8"));
          const startSha = runState.run_start_sha;
          if (typeof startSha === "string" && /^[0-9a-f]{7,40}$/.test(startSha)) {
            const changed = execFileSync("git", ["-C", runRepo, "diff", "--name-only", startSha, "HEAD"],
              { encoding: "utf8", shell: false, maxBuffer: 50 * 1024 * 1024 });
            worked = changed.split("\n").map((l) => l.trim()).filter(Boolean).some(isWorkPath);
          }
        }
      } catch { /* fail closed — an unreadable diff cannot verify work */ }
    }
    if (!worked) {
      const why = `produced no changes under ${JSON.stringify(BASELINE_PERMISSION_MODE)} — ` +
        `the agent exited 0 having written nothing outside .zcode/, which is a capability ` +
        `failure, not an arm result (check the CLI's permission surface: ` +
        `ZODYSSEY_BASELINE_PERMISSION_MODE overrides it)`;
      console.log(`  FAILED — baseline agent ${why}; no success append for this seed.`);
      results.push({ id: seed.id, slug, repo: runRepo, arm, status: "failed", reason: why });
      continue;
    }
    // Self-append (item 09 req 2): the harness is the appender of last resort — no set-phase
    // transition ever fires for a baseline run, so CRIT-4a cannot append. Run-report schema
    // (run-report.mjs:119-150) with pipeline-only fields as honest nulls/zeros — never
    // fabricated — plus arm "baseline" and the measured wall_clock_min; tokens only when the
    // CLI reported usage; success null (only the judge can know it, later and separately).
    const wallClockMin = Math.round(((Date.now() - t0) / 60000) * 10) / 10;
    let cliUsage = null;
    try { const e = JSON.parse(res.stdout); cliUsage = e.usage || null; } catch { /* no parsable usage — stays null */ }
    const record = {
      slug,
      intent: seed.intent,
      phase: null,       // no pipeline machinery ran — honest null, not a fabricated "done"
      verdict: null,     // no review gate exists for a baseline run
      verify_origin: null,
      consult_rounds: 0,
      success: null,     // the harness cannot know this — the judge scores the run later
      arm: "baseline",   // provenance stamp: this harness constructed the run under --arm baseline
      baseline_permission_mode: BASELINE_PERMISSION_MODE, // the tool surface this arm actually ran under
      wall_clock_min: wallClockMin,
      review_rounds: 0,
      todos_total: 0, todos_done: 0, todos_failed: 0, todo_retries: 0,
      resume_events: 0,
      hook_blocks: 0,
      ungated_bash_calls: 0,
      capabilities_used: {},
      tokens_per_todo: null,
      tokens: cliUsage,  // the CLI's own usage report, or null when it reports none — never invented
      generated_at: new Date().toISOString(),
    };
    mkdirSync(join(env.HOME || "", ".zcode", "orchestration", "eval"), { recursive: true });
    appendFileSync(RESULTS, JSON.stringify(record) + "\n");
    console.log(`  baseline agent completed in ${wallClockMin} min — efficiency record appended to ${RESULTS}`);
    console.log(`  after the run, score it:  node judge.mjs ${runRepo} ${slug} ${seed.id} --arm baseline`);
    console.log(`  success_criteria for this task (judge end-state against these):`);
    for (const c of seed.success_criteria) console.log(`    - ${c}`);
    results.push({ id: seed.id, slug, repo: runRepo, arm, status: "measured" });
  } else {
    console.log(`  ZODYSSEY ARM: the conductor must now run /orchestrate on this task.`);
    console.log(`                on set-phase done|audited, the scorecard auto-appends to results.jsonl.`);
    console.log(`  after the run, score it:  node judge.mjs ${runRepo} ${slug} ${seed.id}`);
    console.log(`  success_criteria for this task (judge end-state against these):`);
    for (const c of seed.success_criteria) console.log(`    - ${c}`);
    results.push({ id: seed.id, slug, repo: runRepo, arm, status: "scaffolded" });
  }
}

console.log("\n=== harness summary ===");
for (const r of results) console.log(`  ${r.id}: ${r.status}${r.repo ? " → " + r.repo : ""}`);
// Item 05: both lanes, or the summary silently under-reports — the miniature of the
// vacuous-dashboard problem the lane split exists to close.
const SYNTH = join(env.HOME || "", ".zcode", "orchestration", "eval", "results.synthetic.jsonl");
const count = (p) => (existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).length + " records" : "empty");
console.log(`\nresults.jsonl (operator lane): ${count(RESULTS)}${existsSync(RESULTS) ? "" : " (will populate as runs complete)"}`);
console.log(`results.synthetic.jsonl (synthetic lane): ${count(SYNTH)}`);

// A run in which NO seed produced work is not a successful run. Exiting 0 here is what let the
// eval look healthy for its entire existence: it "completed", printed a summary, and measured
// nothing. Same rule as run-tests.mjs treating zero discovered tests as failure — a green that
// represents no work done is worse than a red, because it stops anyone from looking. Item 09
// extends it beyond skipped seeds to the baseline arm's failures: a batch in which every seed
// failed (CLI absent / non-zero exit / timeout) measured nothing and exits 4.
const skipped = results.filter((r) => r.status === "skipped").length;
const failedSeeds = results.filter((r) => r.status === "failed").length;
const produced = results.filter((r) => r.status === "scaffolded" || r.status === "measured").length;
if (produced === 0) {
  console.error(`\nNO SEED RAN (${skipped} skipped, ${failedSeeds} failed). The harness measured nothing.\n` +
    `Do not treat this as a passing eval — fix the fixtures and re-run.`);
  exit(4);
}
exit(0);
