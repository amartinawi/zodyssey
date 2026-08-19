#!/usr/bin/env node
// two-arm-eval.test.mjs — hermetic suite for the two-arm eval surface (impl item 09, v0.6.7).
//
// Cases (a)-(g) per docs/impl/09-two-arm-eval-baseline.md criterion 2 (todo 2 of the
// impl-09-two-arm-eval run):
//   (a) stamp = argv — judge invoked with `--arm baseline` on slugs DECOUPLED from the arm
//       (suffix-less AND `-zodyssey` shapes) appends records with arm === "baseline". The
//       decoupling is load-bearing (plan deviation 5): judge.mjs at HEAD stamps
//       armFromSlug(slug), so a `-baseline` slug would let the un-fixed judge pass vacuously —
//       and todo 4's stash proof (criterion 4) reverts judge.mjs to exactly that HEAD behavior.
//   (b) default back-compat — with no `--arm`, armFromSlug is preserved for BOTH slug shapes
//       (`-baseline` → "baseline"; `-zodyssey` and suffix-less → "zodyssey"); `--arm zodyssey`
//       overrides a `-baseline` slug's derivation.
//   (c) enum strictness — `--arm bogus` exits 2 for judge AND harness (harness also combined
//       with `--dry-run`), before side effects (no append, no runs/ dir).
//   (d) blind judging — the stub-captured judge prompt for a `--arm baseline` run contains no
//       arm token (seed prompt/criteria and fixture content are crafted arm-free).
//   (e) compare — judge --compare (read-only) renders per-seed {zodyssey, baseline, delta},
//       marks a single-arm seed's missing arm, prints an unknown arm as its own warned group,
//       warns slug/stamp mismatches; empty OR missing judged.jsonl exits 3.
//   (f) dry-run safety — harness --dry-run --arm baseline exits 0 printing the plan (judge
//       command carrying `--arm baseline`, a line per seed, spawn/cwd, append destination) and
//       leaves the hermetic HOME byte-identical: nothing written, nothing spawned.
//   (g) nothing-measured — a baseline batch whose CLI stub fails every seed produces zero
//       success appends and the harness exits 4.
//
// Hermeticity: every judge/harness spawn runs with env.HOME pointed at a mkdtemp dir holding
// its own .zcode/orchestration/eval/seed.jsonl + judged.jsonl, a git fixture repo with a valid
// run_start_sha state file, and shell-stub CLIs (ok-stub: tees stdin to a capture file, echoes
// one fixed verdict JSON, logs each invocation; fail-stub: exit 1). Both scripts resolve
// everything from env.HOME / env.CLAUDE_CLI, so no product change is needed for isolation
// (dashboard.test.mjs's mkdtemp pattern is the in-repo precedent). The real operator corpus
// (~/.zcode/orchestration/eval) is never touched by anything here.
//
// TDD: at pre-item-09 HEAD this suite is RED BY DESIGN — judge has no --arm/--compare and
// harness's baseline arm is an instruction printer. The red run (todos 2-3) is the deliverable;
// todos 4-5 turn it green. Case (d) and the derivation clauses of case (b) are invariants that
// are green at HEAD and must STAY green after the fix.
//
// Run:  node two-arm-eval.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const JUDGE = join(SCRIPT_DIR, "judge.mjs");
const HARNESS = join(SCRIPT_DIR, "harness.mjs");

// The fixed verdict every ok-stub judge call returns (consumed by judge.mjs's runJudgeOnce:
// stdout is valid JSON with no .result/.text/.content key, so the body falls through to the raw
// stdout and the {…} match parses it).
const VERDICT = JSON.stringify({
  overall: 0.72,
  dimensions: { correctness: 0.8, scope_fidelity: 0.7, verification_rigor: 0.7, code_quality: 0.7, efficiency: 0.7 },
  criterion_results: [],
  summary: "stub verdict (fixed)",
  blockers: [],
});

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  + ${name}`); pass++; }
  else { console.log(`  x ${name} ${detail}`); fail++; }
}

// Run judge/harness with the hermetic HOME (and optional CLAUDE_CLI) — the only env the scripts
// need overridden; everything else (PATH for node/git) is inherited.
function run(script, args, home, cli) {
  const env = { ...process.env, HOME: home };
  if (cli) env.CLAUDE_CLI = cli;
  try {
    const stdout = execFileSync("node", [script, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env, timeout: 120000,
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: (e.stdout || "").toString(), stderr: (e.stderr || "").toString() };
  }
}

// Hermetic home: the eval dir (seed.jsonl/judged.jsonl/results.jsonl/runs live under it), the
// two CLI stubs, and the stub witness paths (stdin capture + invocation log).
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), "zod-two-arm-"));
  const evalDir = join(home, ".zcode", "orchestration", "eval");
  mkdirSync(evalDir, { recursive: true });
  const capture = join(home, "judge-prompt-captured.txt");
  const invoked = join(home, "stub-invoked.log");
  const stubOk = join(home, "stub-claude-ok.sh");
  writeFileSync(stubOk, [
    "#!/bin/sh",
    `cat > "${capture}"`,
    `printf '%s\\n' '${VERDICT}'`,
    `printf 'invoked\\n' >> "${invoked}"`,
    "",
  ].join("\n"));
  chmodSync(stubOk, 0o755);
  const stubFail = join(home, "stub-claude-fail.sh");
  writeFileSync(stubFail, ["#!/bin/sh", "cat > /dev/null", 'echo "stub CLI failure (exit 1)" >&2', "exit 1", ""].join("\n"));
  chmodSync(stubFail, 0o755);
  // (h)/(i): argv-logging stubs that EXIT 0. stubNoop writes nothing to cwd — the permission-
  // starved agent shape; stubWrite produces real work. Both log their argv so the permission
  // surface is assertable.
  const argvLog = join(home, "stub-argv.log");
  const stubNoop = join(home, "stub-claude-noop.sh");
  writeFileSync(stubNoop, [
    "#!/bin/sh",
    "cat > /dev/null",
    `printf '%s\\n' "$*" >> "${argvLog}"`,
    `printf '%s\\n' '{"usage":null}'`,
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(stubNoop, 0o755);
  const stubWrite = join(home, "stub-claude-write.sh");
  writeFileSync(stubWrite, [
    "#!/bin/sh",
    "cat > /dev/null",
    `printf '%s\\n' "$*" >> "${argvLog}"`,
    'printf "baseline agent output\\n" > baseline-work.txt',
    `printf '%s\\n' '{"usage":null}'`,
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(stubWrite, 0o755);
  return { home, evalDir, stubOk, stubFail, stubNoop, stubWrite, argvLog, capture, invoked };
}

// Git fixture repo: two commits so judge has a real diff (start sha → work commit), plus an
// UNTRACKED .zcode/state/<slug>.json per slug. Untracked .zcode/ paths are skipped from the
// judged diff (judge.mjs's gather loop), so state content never leaks into the prompt — and all
// fixture content is arm-free for case (d).
function makeFixtureRepo(home, slugs) {
  const dir = join(home, "fixture-repo");
  mkdirSync(dir, { recursive: true });
  const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  const f = join(dir, "greeting.txt");
  writeFileSync(f, "greeting module v1\n");
  g("init", "-q");
  g("config", "user.email", "eval@example.com");
  g("config", "user.name", "eval-bot");
  g("add", "-A");
  g("commit", "-qm", "start");
  const startSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  writeFileSync(f, "greeting module v2 (the work under test)\n");
  g("add", "-A");
  g("commit", "-qm", "work");
  mkdirSync(join(dir, ".zcode", "state"), { recursive: true });
  for (const slug of slugs) {
    writeFileSync(join(dir, ".zcode", "state", `${slug}.json`),
      JSON.stringify({ slug, phase: "done", run_start_sha: startSha }) + "\n");
  }
  return dir;
}

// Plain (non-git) fixture for HARNESS cases: the harness's own flow git-inits the fresh copy and
// commits the baseline, which requires uncommitted content — a fixture that arrives with its own
// .git makes the harness's `git add -A` stage nothing and `git commit` fail with "nothing to
// commit", so every seed SKIPs (witnessed in the todo-2 red run: exit 4 for the wrong reason).
// Judge cases use the git fixture above; harness cases never reach the judge.
function makeFixtureDir(home) {
  const dir = join(home, "fixture-repo");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "greeting.txt"), "greeting module v2 (the work under test)\n");
  return dir;
}

function writeSeeds(evalDir, seeds) {
  writeFileSync(join(evalDir, "seed.jsonl"), seeds.map((s) => JSON.stringify(s)).join("\n") + "\n");
}

// judged: array → one line per record; [] → empty file; null → no file at all (case e9).
function writeJudged(evalDir, judged) {
  if (judged === null) return;
  writeFileSync(join(evalDir, "judged.jsonl"), judged.map((r) => JSON.stringify(r)).join("\n") + (judged.length ? "\n" : ""));
}

function judgedLines(home) {
  const p = join(home, ".zcode", "orchestration", "eval", "judged.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const runsDir = (home) => join(home, ".zcode", "orchestration", "eval", "runs");
const resultsPath = (home) => join(home, ".zcode", "orchestration", "eval", "results.jsonl");

// Byte-level fingerprint of a directory tree (absolute path → sha256) for case (f).
function snapshotTree(root) {
  const out = {};
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out[p] = createHash("sha256").update(readFileSync(p)).digest("hex");
    }
  })(root);
  return out;
}

// Seeds. Judge-side seed prompt/criteria must carry no arm token (case (d) inspects the
// captured prompt; only the seed prompt, criteria, rubric, and fixture diff are in it).
function judgeSeed(home, id) {
  return { id, repo: join(home, "fixture-repo"), intent: "trivial",
    prompt: "Write a greeting module that greets the user by name, with a test.",
    success_criteria: ["A greeting function exists", "A test exercises the greeting"] };
}
function harnessSeeds(home) {
  return [
    { id: "h1", repo: join(home, "fixture-repo"), intent: "trivial",
      prompt: "Add a farewell function with a test.", success_criteria: ["A farewell function exists"] },
    { id: "h2", repo: join(home, "fixture-repo"), intent: "trivial",
      prompt: "Add a thank-you function with a test.", success_criteria: ["A thank-you function exists"] },
  ];
}

console.log("two-arm-eval tests (judge --arm/--compare, harness --dry-run/baseline)\n");

// --- (a) stamp = argv: --arm baseline on slugs DECOUPLED from the arm ---
// Both slug shapes derive "zodyssey" under armFromSlug, so the un-fixed judge (and the
// todo-4 stash-reverted judge) stamps "zodyssey" here — the red is real, not vacuous.
{
  const h = makeHome();
  try {
    const repo = makeFixtureRepo(h.home, ["ta", "ta-zodyssey"]);
    writeSeeds(h.evalDir, [judgeSeed(h.home, "ta")]);
    writeJudged(h.evalDir, []);
    for (const slug of ["ta", "ta-zodyssey"]) {
      const r = run(JUDGE, [repo, slug, "ta", "--arm", "baseline"], h.home, h.stubOk);
      check(`(a) judge exits 0 (slug ${slug}, --arm baseline)`, r.code === 0, `(got ${r.code}) ${r.stderr.slice(0, 120)}`);
      const lines = judgedLines(h.home);
      const rec = lines[lines.length - 1];
      check(`(a) --arm baseline stamps arm "baseline" (slug ${slug})`,
        !!rec && rec.arm === "baseline", `(got ${JSON.stringify(rec && rec.arm)})`);
    }
  } finally { rmSync(h.home, { recursive: true, force: true }); }
}

// --- (b) default back-compat: no --arm preserves armFromSlug for both slug shapes; --arm overrides ---
{
  const h = makeHome();
  try {
    const repo = makeFixtureRepo(h.home, ["tb-baseline", "tb-zodyssey", "tb"]);
    writeSeeds(h.evalDir, [judgeSeed(h.home, "tb")]);
    writeJudged(h.evalDir, []);
    const cases = [
      { slug: "tb-baseline", flag: null, want: "baseline" }, // derivation preserved (not part of case (a): argv agrees with slug here)
      { slug: "tb-zodyssey", flag: null, want: "zodyssey" }, // derivation preserved
      { slug: "tb", flag: null, want: "zodyssey" },          // suffix-less default
      { slug: "tb-baseline", flag: "zodyssey", want: "zodyssey" }, // override beats derivation
    ];
    for (const c of cases) {
      const args = [repo, c.slug, "tb"];
      if (c.flag) args.push("--arm", c.flag);
      const r = run(JUDGE, args, h.home, h.stubOk);
      const label = `slug ${c.slug}${c.flag ? ` + --arm ${c.flag}` : " (no --arm)"}`;
      check(`(b) judge exits 0 (${label})`, r.code === 0, `(got ${r.code}) ${r.stderr.slice(0, 120)}`);
      const lines = judgedLines(h.home);
      const rec = lines[lines.length - 1];
      check(`(b) ${label} stamps arm "${c.want}"`,
        !!rec && rec.arm === c.want, `(got ${JSON.stringify(rec && rec.arm)})`);
    }
  } finally { rmSync(h.home, { recursive: true, force: true }); }
}

// --- (c) enum strictness: --arm bogus exits 2 for judge AND harness, before side effects ---
{
  const hj = makeHome();
  try {
    const repo = makeFixtureRepo(hj.home, ["tc-zodyssey"]);
    writeSeeds(hj.evalDir, [judgeSeed(hj.home, "tc")]);
    writeJudged(hj.evalDir, []);
    const r = run(JUDGE, [repo, "tc-zodyssey", "tc", "--arm", "bogus"], hj.home, hj.stubOk);
    check("(c) judge --arm bogus exits 2", r.code === 2, `(got ${r.code})`);
    check("(c) judge --arm bogus appends nothing", judgedLines(hj.home).length === 0,
      `(judged.jsonl holds ${judgedLines(hj.home).length} record(s))`);
  } finally { rmSync(hj.home, { recursive: true, force: true }); }
  for (const args of [["--arm", "bogus"], ["--dry-run", "--arm", "bogus"]]) {
    const h = makeHome();
    try {
      makeFixtureDir(h.home);
      writeSeeds(h.evalDir, harnessSeeds(h.home));
      const r = run(HARNESS, args, h.home, h.stubOk);
      check(`(c) harness ${args.join(" ")} exits 2`, r.code === 2, `(got ${r.code})`);
      check(`(c) harness ${args.join(" ")} creates no runs/ dir`, !existsSync(runsDir(h.home)), "(runs/ exists — validation was not first)");
    } finally { rmSync(h.home, { recursive: true, force: true }); }
  }
}

// --- (d) blind judging: the judge prompt carries no arm token ---
// Invariant guard: green at HEAD (the prompt template has no arm words) and must stay green
// after --arm lands — the arm declares provenance on the record, never enters the judged prompt.
{
  const h = makeHome();
  try {
    const repo = makeFixtureRepo(h.home, ["td"]);
    writeSeeds(h.evalDir, [judgeSeed(h.home, "td")]);
    writeJudged(h.evalDir, []);
    const r = run(JUDGE, [repo, "td", "td", "--arm", "baseline"], h.home, h.stubOk);
    check("(d) judge exits 0 (--arm baseline)", r.code === 0, `(got ${r.code}) ${r.stderr.slice(0, 120)}`);
    const prompt = existsSync(h.capture) ? readFileSync(h.capture, "utf8") : "";
    check("(d) stub captured the judge prompt (non-empty, carries the seed prompt)",
      prompt.includes("greeting module") && prompt.includes("greets the user by name"),
      prompt ? `(capture ${prompt.length} bytes)` : "(no capture file — stub never invoked)");
    check("(d) judge prompt contains no arm token", !/baseline|zodyssey/i.test(prompt),
      /(baseline|zodyssey)/i.exec(prompt)?.[0] ? `(found "${/(baseline|zodyssey)/i.exec(prompt)[0]}")` : "");
  } finally { rmSync(h.home, { recursive: true, force: true }); }
}

// --- (e) compare: per-seed deltas, missing arm, unknown arm, mismatch warning; read-only ---
{
  // Crafted corpus: both arms across s1/s2 (s2's baseline WINS — delta sign must not be
  // absolute-valued into "zodyssey always better"), single-arm s3, unknown arm "banana" on s4,
  // and the historical mislabel shape on s5 (-baseline slug stamped zodyssey).
  const corpus = [
    { seed_id: "s1", slug: "s1-zodyssey", arm: "zodyssey", overall: 0.8, at: "2026-08-18T01:00:00.000Z" },
    { seed_id: "s1", slug: "s1-baseline", arm: "baseline", overall: 0.6, at: "2026-08-18T01:05:00.000Z" },
    { seed_id: "s2", slug: "s2-zodyssey", arm: "zodyssey", overall: 0.5, at: "2026-08-18T02:00:00.000Z" },
    { seed_id: "s2", slug: "s2-baseline", arm: "baseline", overall: 0.9, at: "2026-08-18T02:05:00.000Z" },
    { seed_id: "s3", slug: "s3-zodyssey", arm: "zodyssey", overall: 0.7, at: "2026-08-18T03:00:00.000Z" },
    { seed_id: "s4", slug: "s4-baseline", arm: "banana", overall: 0.4, at: "2026-08-18T04:00:00.000Z" },
    { seed_id: "s5", slug: "s5-baseline", arm: "zodyssey", overall: 0.45, at: "2026-08-18T05:00:00.000Z" },
    { seed_id: "s5", slug: "s5-zodyssey", arm: "zodyssey", overall: 0.55, at: "2026-08-18T05:10:00.000Z" },
  ];
  const h = makeHome();
  try {
    const judgedPath = join(h.evalDir, "judged.jsonl");
    writeJudged(h.evalDir, corpus);
    const before = readFileSync(judgedPath, "utf8");
    const r = run(JUDGE, ["--compare"], h.home, h.stubOk);
    const out = r.stdout + r.stderr;
    check("(e) --compare exits 0 on a reportable corpus", r.code === 0, `(got ${r.code}) ${r.stderr.slice(0, 120)}`);
    // delta rendering: 0.8-0.6=0.2 appears on s1's line; 0.5-0.9=-0.4 (magnitude) on s2's line.
    check("(e) s1 row shows delta 0.2 (zodyssey 0.8 vs baseline 0.6)",
      /s1[^\n]*0\.2|0\.2[^\n]*s1/.test(out), (out.split("\n").find((l) => l.includes("s1")) || "(no s1 line)"));
    check("(e) s2 row shows delta 0.4 (zodyssey 0.5 vs baseline 0.9)",
      /s2[^\n]*0\.4|0\.4[^\n]*s2/.test(out), (out.split("\n").find((l) => l.includes("s2")) || "(no s2 line)"));
    check("(e) single-arm seed s3 reported with its missing arm",
      /s3[^\n]*missing/i.test(out) || /missing[^\n]*s3/i.test(out),
      (out.split("\n").find((l) => /s3/.test(l)) || "(no s3 line)"));
    check("(e) unknown arm prints as its own warned group",
      out.includes("banana") && /unknown|warn/i.test(out));
    check("(e) slug/stamp mismatch warning names s5-baseline",
      /mismatch/i.test(out) && out.includes("s5-baseline"));
    check("(e) --compare appends nothing (judged.jsonl byte-identical)",
      readFileSync(judgedPath, "utf8") === before);
  } finally { rmSync(h.home, { recursive: true, force: true }); }
  const he = makeHome();
  try {
    writeJudged(he.evalDir, []);
    const r = run(JUDGE, ["--compare"], he.home, he.stubOk);
    check("(e) --compare exits 3 on empty judged.jsonl", r.code === 3, `(got ${r.code})`);
  } finally { rmSync(he.home, { recursive: true, force: true }); }
  const hm = makeHome();
  try {
    writeJudged(hm.evalDir, null);
    const r = run(JUDGE, ["--compare"], hm.home, hm.stubOk);
    check("(e) --compare exits 3 on missing judged.jsonl", r.code === 3, `(got ${r.code})`);
  } finally { rmSync(hm.home, { recursive: true, force: true }); }
}

// --- (f) dry-run safety: prints the plan, writes and spawns nothing, byte-identical HOME ---
{
  const h = makeHome();
  try {
    makeFixtureDir(h.home);
    writeSeeds(h.evalDir, harnessSeeds(h.home));
    writeJudged(h.evalDir, []);
    const before = snapshotTree(h.home);
    const r = run(HARNESS, ["--dry-run", "--arm", "baseline"], h.home, h.stubOk);
    check("(f) --dry-run --arm baseline exits 0", r.code === 0, `(got ${r.code})`);
    check("(f) plan prints the judge command with --arm baseline", r.stdout.includes("--arm baseline"),
      "(the printed judge command carries no arm)");
    check("(f) plan prints a line per seed (h1, h2)", r.stdout.includes("h1") && r.stdout.includes("h2"));
    check("(f) plan names the append destination (results.jsonl)", r.stdout.includes("results.jsonl"));
    check("(f) plan names the spawn command and/or cwd", /spawn|cwd/i.test(r.stdout));
    const after = snapshotTree(h.home);
    const drift = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]);
    check("(f) hermetic HOME byte-identical before/after", drift.length === 0,
      `(changed: ${drift.slice(0, 3).map((k) => k.replace(h.home, "~")).join(", ")}…)`);
    check("(f) no runs/ dir created", !existsSync(runsDir(h.home)));
    check("(f) CLI stub never spawned", !existsSync(h.invoked), "(stub-invoked.log exists)");
  } finally { rmSync(h.home, { recursive: true, force: true }); }
}

// --- (g) nothing-measured: all-failed baseline batch appends no success and exits 4 ---
{
  const h = makeHome();
  try {
    makeFixtureDir(h.home);
    writeSeeds(h.evalDir, harnessSeeds(h.home));
    writeJudged(h.evalDir, []);
    const r = run(HARNESS, ["--arm", "baseline"], h.home, h.stubFail);
    check("(g) all-failed baseline batch exits 4", r.code === 4, `(got ${r.code})`);
    const recs = existsSync(resultsPath(h.home))
      ? readFileSync(resultsPath(h.home), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
      : [];
    check("(g) zero success records appended", recs.every((x) => x.success !== true),
      `(results.jsonl holds ${recs.length} record(s), ${recs.filter((x) => x.success === true).length} with success:true)`);
    check("(g) failure is loud (output says failed)", /fail/i.test(r.stdout + r.stderr));
  } finally { rmSync(h.home, { recursive: true, force: true }); }
}

// --- (h) the baseline arm's permission surface is explicit and recorded -------------------
// Every other CLI spawn in the repo pins its permission surface (judge.mjs, consult.mjs pass
// `--permission-mode plan --allowedTools ""`). The baseline arm is the only spawn that must
// WRITE, and shipping it flagless made its tool access an uncontrolled variable: what the
// control arm may do would depend on whichever CLAUDE_CLI binary is on PATH.
{
  const h = makeHome();
  try {
    makeFixtureDir(h.home);
    writeSeeds(h.evalDir, harnessSeeds(h.home));
    writeJudged(h.evalDir, []);
    run(HARNESS, ["--arm", "baseline"], h.home, h.stubWrite);
    const argv = existsSync(h.argvLog) ? readFileSync(h.argvLog, "utf8") : "";
    check("(h) baseline spawn pins --permission-mode", /--permission-mode\s+\S+/.test(argv),
      `(argv was ${JSON.stringify(argv.trim().slice(0, 120))})`);
    const recs = existsSync(resultsPath(h.home))
      ? readFileSync(resultsPath(h.home), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
      : [];
    check("(h) a productive baseline run IS measured", recs.length > 0, `(got ${recs.length} record(s))`);
    check("(h) the record carries the permission mode it ran under",
      recs.length > 0 && typeof recs[0].baseline_permission_mode === "string" && recs[0].baseline_permission_mode.length > 0,
      `(got ${JSON.stringify(recs[0] && recs[0].baseline_permission_mode)})`);
  } finally { rmSync(h.home, { recursive: true, force: true }); }
}

// --- (i) an empty baseline diff is a CAPABILITY FAILURE, never an arm result ---------------
// The loud-failure rule (req 3) fires on spawn error, non-zero exit and timeout. A permission-
// starved agent does none of those: it runs, writes nothing, exits 0. Recording that as a
// measured baseline hands the judge an empty diff to score near zero — a silent, DIRECTIONAL
// bias in the arm the experiment exists to give a fair hearing.
{
  const h = makeHome();
  try {
    makeFixtureDir(h.home);
    writeSeeds(h.evalDir, harnessSeeds(h.home));
    writeJudged(h.evalDir, []);
    const r = run(HARNESS, ["--arm", "baseline"], h.home, h.stubNoop);
    const recs = existsSync(resultsPath(h.home))
      ? readFileSync(resultsPath(h.home), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
      : [];
    check("(i) a no-op baseline appends NO record", recs.length === 0,
      `(results.jsonl holds ${recs.length} record(s))`);
    check("(i) the batch reports nothing measured (exit 4)", r.code === 4, `(got ${r.code})`);
    check("(i) the failure names it as a capability failure, not a loss",
      /produced no changes.*capability failure, not an arm result/is.test(r.stdout + r.stderr),
      `(output: ${JSON.stringify((r.stdout + r.stderr).slice(-240))})`);
  } finally { rmSync(h.home, { recursive: true, force: true }); }
}

console.log(`\n${pass} passed, ${fail} failed`);
exit(fail === 0 ? 0 : 1);
