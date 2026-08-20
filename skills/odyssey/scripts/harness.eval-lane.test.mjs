#!/usr/bin/env node
// harness.eval-lane.test.mjs — the eval harness is a synthetic generator and must declare its
// lane (item 22).
//
// WHY THIS EXISTS: harness.mjs builds fake runs — the baseline arm spawns an external CLI on a
// copied fixture and appends the efficiency record itself — yet it never declares
// ZODYSSEY_EVAL_LANE at either spawn (not the scaffold execFileSync options, not the baseline
// spawnSync options) and its self-append writes straight to the OPERATOR-lane RESULTS const.
// Item 05 taught set-phase.mjs to route declared-synthetic telemetry to
// results.synthetic.jsonl; this newer producer reopened the exact class by emitting records no
// declaration ever labels (measured 2026-08-20: 2 `arm:"baseline"` records in the operator
// corpus via this path). The fix is producer-side and unconditional: the harness IS the
// synthetic generator, so it stamps `ZODYSSEY_EVAL_LANE: "synthetic"` into both spawn envs
// (the run-tests.mjs declaration idiom) and appends its baseline record to the synthetic lane
// by CONSTANT — never `env.ZODYSSEY_EVAL_LANE || …`, which would ask the operator's env what
// lane the generator itself is.
//
// SCRUB MANDATE: run-tests.mjs exports ZODYSSEY_EVAL_LANE="synthetic" to EVERY suite it runs.
// Every harness spawn here deletes it from the env first (the set-phase.eval-lane.test.mjs
// explicit-control precedent) — an unscrubbed spawn makes the stub-witness leg vacuously green
// (the stub would inherit "synthetic" from the runner, not from the harness's declaration).
// The scrub is delete-only: this suite never sets the variable, so the ONLY way the spawned
// CLI can observe "synthetic" is the harness declaring it at the spawn site.
//
// Cases: (a) behavioral — after `--arm baseline`, exactly one parseable `arm:"baseline"`
// record lands under results.synthetic.jsonl and the operator results.jsonl stays absent or
// empty; (b) stub witness — the stub CLI tees its observed $ZODYSSEY_EVAL_LANE to a capture
// file; it must read "synthetic" (proves the spawn env, not just the append routing);
// (c) source shape — the lane declaration appears in BOTH spawn option objects (the scaffold
// execFileSync("node",…) call and the spawnSync(claudeBin,…) call) and the baseline
// self-append targets a variable declared as results.synthetic.jsonl.
//
// Paired direction (inversion, leg d): with harness.mjs at its pre-item-22 state (todo 1's
// probe evidence, .zcode/notepads/impl-22-harness-eval-lane/1.md: one `arm:"baseline"` record
// in the operator lane, synthetic file absent, stub observing no lane), legs (a)/(b)/(c) FAIL
// and the suite exits 1 — that RED is recorded at todo-2 completion, BEFORE the fix is
// dispatched. Todo 3's fix (both spawns tagged + the self-append routed synthetic) turns this
// suite green and mirrors the probe inverted.
//
// Hermeticity: every spawn runs under a mkdtemp HOME holding only seed.jsonl; the fixture is a
// committed git repo (todo 1's shape) so run_start_sha resolves; the stub CLI writes one
// non-.zcode work file (exactly enough to pass the empty-work guard — ANY change outside
// .zcode/ counts as work), tees its lane observation to an absolute path, prints {} and exits
// 0. The real ~/.zcode/orchestration/eval/ is never touched by anything here.
//
// Run:  node harness.eval-lane.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

const S = new URL(".", import.meta.url).pathname;
const HARNESS = join(S, "harness.mjs");
const HARNESS_SRC = readFileSync(HARNESS, "utf8");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const cleanup = [];

// Committed fixture (todo 1's shape): one file, one commit. The harness's own
// `git add -A; commit` then finds a clean tree and rides the fixture's HEAD (the SEC-M12
// narrowing), so run_start_sha resolves and the seed reaches the measured append instead of
// mass-skipping.
function makeCommittedFixture() {
  const dir = mkdtempSync(join(tmpdir(), "zod-lane-fx-"));
  cleanup.push(dir);
  const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "f.txt"), "fixture content\n");
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  g("add", "-A");
  g("commit", "-qm", "base");
  return dir;
}

// Hermetic HOME: mkdtemp, only the eval dir created (the harness mkdirs everything else).
function makeHome() {
  const home = mkdtempSync(join(tmpdir(), "zod-lane-hh-"));
  cleanup.push(home);
  mkdirSync(join(home, ".zcode", "orchestration", "eval"), { recursive: true });
  return home;
}

// The stub CLI — todo 1's, plus the tee leg (b) needs: write one non-.zcode work file (passes
// the empty-work guard), tee the OBSERVED $ZODYSSEY_EVAL_LANE to an absolute capture path
// (cwd is the run repo, so absolute matters), print {} (parses; no usage → tokens stay null),
// exit 0.
function makeStubCli(home) {
  const cli = join(home, "cli-stub.sh");
  const laneCapture = join(home, "stub-observed-lane.txt");
  writeFileSync(cli, [
    "#!/bin/sh",
    "printf 'work\\n' > work.txt",
    `printf '%s\\n' "$ZODYSSEY_EVAL_LANE" > "${laneCapture}"`,
    "printf '{}'",
    "",
  ].join("\n"));
  chmodSync(cli, 0o755);
  return { cli, laneCapture };
}

// EVERY harness spawn goes through here: hermetic HOME, stub CLI, and the scrub. The delete is
// the load-bearing line — run-tests.mjs exports ZODYSSEY_EVAL_LANE="synthetic" suite-wide, and
// leaving it in the spawn env would hand the stub a "synthetic" the harness never declared.
function runHarness(home, cli) {
  const env = { ...process.env, HOME: home };
  delete env.ZODYSSEY_EVAL_LANE;
  env.CLAUDE_CLI = cli;
  return spawnSync(process.execPath, [HARNESS, "--task", "p1", "--arm", "baseline"],
    { encoding: "utf8", env, timeout: 120000 });
}

const evalFile = (home, name) => join(home, ".zcode", "orchestration", "eval", name);
const lines = (p) => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()) : [];

console.log("harness.mjs eval lane — the harness is a synthetic generator and must declare it\n");

// --- (a)+(b): one hermetic baseline run — where the record lands, what the stub saw ----------
{
  const home = makeHome();
  const fixture = makeCommittedFixture();
  writeFileSync(evalFile(home, "seed.jsonl"),
    JSON.stringify({ id: "p1", intent: "standard", repo: fixture, prompt: "do it", success_criteria: ["c"] }) + "\n");
  const { cli, laneCapture } = makeStubCli(home);
  const r = runHarness(home, cli);

  // exit 0 FIRST, so a routing red cannot be misread as a dead stub or the guard firing
  // (todo 1's probe: the unmodified harness measures this seed fine — the record simply lands
  // in the wrong lane). If this check is ever red, the fixture/stub broke, not the routing.
  check("(a) harness exits 0 (seed measured — the defect is routing, not a dead stub)",
    r.status === 0, `(exit ${r.status}) ${((r.stdout || "") + (r.stderr || "")).slice(-300)}`);

  const syn = lines(evalFile(home, "results.synthetic.jsonl"));
  check("(a) exactly one record in results.synthetic.jsonl", syn.length === 1,
    `got ${syn.length}${existsSync(evalFile(home, "results.synthetic.jsonl")) ? "" : " (file absent)"}`);
  let parsed = null;
  try { parsed = JSON.parse(syn[0]); } catch {}
  check("(a) record parses with arm \"baseline\" and the run slug",
    !!(parsed && parsed.arm === "baseline" && parsed.slug === "p1-baseline"),
    parsed ? `arm=${JSON.stringify(parsed.arm)} slug=${JSON.stringify(parsed.slug)}` : "no parseable record");
  check("(a) operator results.jsonl absent or empty",
    lines(evalFile(home, "results.jsonl")).length === 0,
    existsSync(evalFile(home, "results.jsonl"))
      ? `holds ${lines(evalFile(home, "results.jsonl")).length} record(s) — the operator-lane append`
      : "(absent)");

  const observed = existsSync(laneCapture) ? readFileSync(laneCapture, "utf8").trim() : null;
  check("(b) stub observed ZODYSSEY_EVAL_LANE === \"synthetic\"",
    observed === "synthetic",
    observed === null ? "stub never ran (capture absent)" : `observed ${JSON.stringify(observed)}`);
}

// --- (c): source shape — the lane is declared at BOTH spawns and routes the self-append -----
{
  // Slice each spawn call (opener → first `});`) so the assertion is bound to that call's own
  // options object, not merely to the string occurring anywhere in the file.
  const callSpan = (opener) => {
    const i = HARNESS_SRC.indexOf(opener);
    if (i === -1) return null;
    const j = HARNESS_SRC.indexOf("});", i);
    return j === -1 ? null : HARNESS_SRC.slice(i, j);
  };
  // The literal form pins the declaration as the generator's own constant: an
  // `env.ZODYSSEY_EVAL_LANE || "synthetic"` fallback has no colon and does NOT match, so this
  // shape also forbids consulting the operator's env for the harness's own lane.
  const laneDecl = /ZODYSSEY_EVAL_LANE\s*:\s*"synthetic"/;
  const scaffoldSpan = callSpan('execFileSync("node"'); // the scaffold spawn
  check("(c) scaffold spawn (execFileSync node) declares the lane",
    !!scaffoldSpan && laneDecl.test(scaffoldSpan),
    scaffoldSpan ? "no ZODYSSEY_EVAL_LANE in the scaffold spawn options" : "scaffold spawn not found");
  const cliSpan = callSpan("spawnSync(claudeBin"); // the baseline CLI spawn
  check("(c) baseline CLI spawn (spawnSync claudeBin) declares the lane",
    !!cliSpan && laneDecl.test(cliSpan),
    cliSpan ? "no ZODYSSEY_EVAL_LANE in the baseline spawn options" : "baseline spawn not found");
  // The self-append must target a NAMED path variable declared as the synthetic file — the
  // RESULTS const (operator lane, still used by the summary print) is the wrong destination.
  const m = HARNESS_SRC.match(/appendFileSync\((\w+),\s*JSON\.stringify\(record\)/);
  check("(c) baseline self-append targets a named path variable", !!m,
    "no appendFileSync(<var>, JSON.stringify(record)…) found");
  if (m) {
    const decl = new RegExp(`const ${m[1]} = [^;]*results\\.synthetic\\.jsonl`);
    check("(c) that variable is declared as the synthetic-lane path",
      decl.test(HARNESS_SRC),
      `append target ${m[1]} is not declared against results.synthetic.jsonl`);
  }
}

for (const d of cleanup) rmSync(d, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
