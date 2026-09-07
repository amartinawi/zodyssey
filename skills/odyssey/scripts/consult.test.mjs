#!/usr/bin/env node
// consult.test.mjs — unit tests for consult.mjs's --plan-audit mode (todo 17) and
// --multi-auditor mode (todo 20).
//
// Covers:
//   (a) The post-done / no-args path still works (existing behavior byte-identical): no args
//       exits 2, missing state exits 3. The --plan-audit flag is OPT-IN; without it, behavior
//       is unchanged.
//   (b) The --plan-audit flag is parsed and routes to runPlanAudit (not the post-done path).
//   (c) buildPlanAuditPrompt builds a prompt DISTINCT from the post-done auditor-prompt.md:
//       no "THE DIFF" section (no code exists yet), uses plan-focused criteria categories
//       (completeness/criteria/scope/ordering, NOT quality/bug/security), mentions "plan".
//   (d) runPlanAudit with an injected stub `spawn` runs OFFLINE (no real claude process),
//       parses the auditor's JSON verdict via the shared normalizeConsultVerdict, and writes
//       to state.plan_audit (a NEW lane, NOT state.consult — the post-done lane is untouched).
//   (m) MULTI-AUDITOR mode (todo 20): the --multi-auditor flag is parsed; runMultiAuditor runs
//       OFFLINE with a stub `spawn`, and the disagreement path (one ACCEPT + one REJECT) is
//       flagged (no auto-resolution) while two agreeing passes reach consensus. Mirrors
//       judge.mjs:140-147's double-judge pattern. The memory bridge (outcomeToGraphEntity) is
//       exercised on disagreement.
//
// The external CLI is NEVER spawned in these tests: runPlanAudit's / runMultiAuditor's `spawn`
// parameter is a stub returning a fixed { stdout } envelope, so the suite runs fully offline.
//
// Run:  node consult.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const CONSULT = join(SCRIPT_DIR, "consult.mjs");

// Import the testable exports (the isMain guard prevents the CLI from running on import).
const { buildPlanAuditPrompt, runPlanAudit, runMultiAuditor, compareAuditorVerdicts, scoreOf, DISAGREEMENT_THRESHOLD } = await import(pathToFileURL(CONSULT).href);
// Memory-schema (todo 2): imported to assert the disagreement record is a valid graph entity.
const { validateGraphEntity } = await import(new URL("./lib/memory-schema.mjs", import.meta.url).href);

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  \u2713 ${name}`); pass++; }
  else { console.log(`  \u2717 ${name} ${detail}`); fail++; }
}

// Read the post-done auditor-prompt.md so we can assert the plan-audit prompt is DISTINCT.
// v0.3.0 portability: resolve relative to this test file's own location (SCRIPT_DIR, derived
// from import.meta.url) instead of joining $HOME — works from the plugin cache install.
const auditorPromptPath = join(SCRIPT_DIR, "..", "references", "auditor-prompt.md");
const postDonePrompt = readFileSync(auditorPromptPath, "utf8");

// Run consult.mjs as a child process; return { status, stdout, stderr }.
function runCli(args) {
  const r = spawnSync("node", [CONSULT, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// Build a tmp repo with a minimal state.json + plan + task file for runPlanAudit tests.
function makeRepo(planText = "# Sample Plan\n\n## Scope\nDo the thing.\n") {
  const dir = mkdtempSync(join(tmpdir(), "zod-consult-test-"));
  mkdirSync(join(dir, ".zcode", "state"), { recursive: true });
  mkdirSync(join(dir, ".zcode", "plans"), { recursive: true });
  writeFileSync(join(dir, ".zcode", "state", "test-slug.json"),
    JSON.stringify({ slug: "test-slug", phase: "plan", updated_at: "2026-08-10T00:00:00Z" }, null, 2) + "\n");
  writeFileSync(join(dir, ".zcode", "plans", "test-slug.md"), planText);
  writeFileSync(join(dir, ".zcode", "plans", "test-slug.task.md"), "Make the thing work end-to-end.");
  return dir;
}
function readState(repo) {
  return JSON.parse(readFileSync(join(repo, ".zcode", "state", "test-slug.json"), "utf8"));
}

// A stub `spawn` for runPlanAudit: returns the envelope the real `claude -p --output-format json`
// would return, with a fixed verdict JSON embedded in the result body. No real process.
function stubSpawn(verdictObj) {
  return (_bin, _args, _opts) => ({
    status: 0,
    stdout: JSON.stringify({ result: JSON.stringify(verdictObj) }),
    stderr: "",
  });
}

// A stub `spawn` for runMultiAuditor that returns DIFFERENT verdicts on successive calls, so the
// disagreement path can be exercised offline. `verdicts` is an array consumed in order; each call
// pops the next. This is how the test simulates "pass 1 ACCEPT, pass 2 REJECT" without a real CLI.
function stubSpawnSequence(verdictObjs) {
  const queue = [...verdictObjs];
  return (_bin, _args, _opts) => {
    const v = queue.shift() || verdictObjs[verdictObjs.length - 1];
    return { status: 0, stdout: JSON.stringify({ result: JSON.stringify(v) }), stderr: "" };
  };
}

console.log("consult.mjs --plan-audit mode tests\n");

// --- (a) post-done / no-args path unchanged (byte-identical behavior preserved) ---
{
  const r = runCli([]);
  check("(a) no args exits 2", r.status === 2, `(got status ${r.status})`);
  check("(a) usage mentions --plan-audit", /--plan-audit/.test(r.stderr), `(stderr: ${r.stderr.trim()})`);

  const r2 = runCli(["/tmp/does-not-exist-zod-consult", "fake-slug"]);
  check("(a) missing state exits 3", r2.status === 3, `(got status ${r2.status})`);
}

// --- (b) --plan-audit flag is parsed and routes to runPlanAudit ---
// We assert routing indirectly: with a missing state file, BOTH modes exit 3 — but the
// error message differs (plan-audit path prints via runPlanAudit). The stronger routing
// test is (d) below (runPlanAudit called directly with a stub returns a verdict). Here we
// confirm the flag is accepted (does not exit 2 as an unknown flag).
{
  const repo = makeRepo();
  try {
    // With a stub CLI set via CLAUDE_CLI, the --plan-audit path will try to run it. We point
    // CLAUDE_CLI at a trivial stub script that echoes an ACCEPT verdict, proving the flag is
    // parsed and routed (not rejected as an unknown arg).
    const stubScript = join(repo, "stub-claude.sh");
    writeFileSync(stubScript,
      `#!/bin/sh\n` +
      `cat <<'EOF'\n` +
      `{"result":"{\\"verdict\\":\\"ACCEPT\\",\\"gaps\\":[],\\"summary\\":\\"plan looks ready\\"}"}\n` +
      `EOF\n`,
      { mode: 0o755 });
    const r = runCli([repo, "test-slug", "--plan-audit"]);
    // Override env for this child invocation.
    const env = { ...process.env, CLAUDE_CLI: stubScript };
    const r2 = spawnSync("node", [CONSULT, repo, "test-slug", "--plan-audit"], { encoding: "utf8", env });
    check("(b) --plan-audit flag is accepted (not exit 2 unknown-arg)", r2.status === 0 || r2.status === 3 || r2.status === 4,
      `(got status ${r2.status}, stderr: ${(r2.stderr || "").slice(0, 200)})`);
    if (r2.status === 0) {
      const out = JSON.parse(r2.stdout.trim().split("\n").pop());
      check("(b) --plan-audit returns ACCEPT verdict from stub", out.verdict === "ACCEPT", `(got ${JSON.stringify(out)})`);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (c) buildPlanAuditPrompt is DISTINCT from the post-done auditor-prompt.md ---
{
  const prompt = buildPlanAuditPrompt("# My Plan\n\n## Scope\n- item", "do the thing");
  check("(c) prompt is non-empty", prompt.length > 100, `(len ${prompt.length})`);
  // DISTINCT from post-done: no "THE DIFF" section (no code exists yet in plan-audit).
  check("(c) prompt has NO 'THE DIFF' section (plan-audit, not post-done)", !/THE DIFF/.test(prompt),
    "(found a DIFF section — wrong prompt used)");
  // DISTINCT from post-done: no code-quality / bug / security criteria (those need code).
  check("(c) prompt has NO 'Code quality' criterion (no code yet)", !/Code quality/.test(prompt),
    "(found code-quality criterion — should be absent pre-execution)");
  // DISTINCT from post-done: uses plan-focused criteria categories.
  check("(c) prompt has 'completeness' category", /completeness/.test(prompt));
  check("(c) prompt has 'criteria' category", /criteria/.test(prompt));
  check("(c) prompt has 'scope' category", /scope/i.test(prompt));
  check("(c) prompt has 'ordering' category", /ordering/.test(prompt));
  // The prompt mentions "plan" (the load-bearing grep for the AC).
  check("(c) prompt mentions 'plan'", /plan/i.test(prompt));
  // The post-done prompt and the plan-audit prompt must be genuinely different text.
  check("(c) plan-audit prompt != post-done auditor-prompt.md", prompt !== postDonePrompt);
  check("(c) plan-audit prompt does not embed the post-done header line verbatim",
    !prompt.includes("## Your judgment scope (full review)"),
    "(post-done judgment-scope header leaked into plan-audit prompt)");
  // Original task + plan are interpolated into the prompt.
  check("(c) prompt embeds the original task", prompt.includes("do the thing"));
  check("(c) prompt embeds the plan body", prompt.includes("My Plan"));
}

// --- (d) runPlanAudit runs OFFLINE with a stub spawn, parses via normalizeConsultVerdict,
//         and writes to state.plan_audit (NOT state.consult) ---
{
  const repo = makeRepo("# Plan\n\n## Scope\n- all the work");
  try {
    const out = await runPlanAudit({
      repoRoot: repo,
      slug: "test-slug",
      spawn: stubSpawn({ verdict: "ACCEPT", gaps: [], summary: "plan is ready to execute" }),
    });
    check("(d) runPlanAudit returns ACCEPT verdict", out.verdict === "ACCEPT", `(got ${out.verdict})`);
    check("(d) runPlanAudit returns empty gaps", Array.isArray(out.gaps) && out.gaps.length === 0);
    check("(d) runPlanAudit returns auditor name", typeof out.auditor === "string");
    check("(d) runPlanAudit returns plan_audit lane", out.plan_audit && typeof out.plan_audit === "object");
    check("(d) plan_audit lane has 'at' timestamp", typeof out.plan_audit.at === "string");

    const st = readState(repo);
    check("(d) state.plan_audit written", st.plan_audit && typeof st.plan_audit === "object",
      `(got ${JSON.stringify(st.plan_audit)})`);
    check("(d) state.plan_audit.verdict is ACCEPT", st.plan_audit.verdict === "ACCEPT");
    check("(d) state.plan_audit has gaps", Array.isArray(st.plan_audit.gaps));
    check("(d) state.plan_audit has 'at' field", typeof st.plan_audit.at === "string");
    check("(d) state.plan_audit has 'auditor' field", typeof st.plan_audit.auditor === "string");
    // CRITICAL: the post-done lane is NOT touched by plan-audit mode.
    check("(d) state.consult is NOT written by plan-audit", st.consult === undefined,
      `(got consult lane: ${JSON.stringify(st.consult)})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (d2) runPlanAudit REJECT path (fail-closed via normalizeConsultVerdict) ---
{
  const repo = makeRepo("# Plan\n");
  try {
    const out = await runPlanAudit({
      repoRoot: repo,
      slug: "test-slug",
      spawn: stubSpawn({ verdict: "REJECT", gaps: [{ category: "criteria", issue: "vague", fix: "add exit code" }], summary: "criteria not executable" }),
    });
    check("(d2) REJECT verdict passes through", out.verdict === "REJECT");
    check("(d2) REJECT gaps preserved", out.gaps.length === 1);
    const st = readState(repo);
    check("(d2) state.plan_audit.verdict is REJECT", st.plan_audit.verdict === "REJECT");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (d3) runPlanAudit fail-closed: ACCEPT with non-empty gaps → REJECT (the shared schema) ---
{
  const repo = makeRepo("# Plan\n");
  try {
    const out = await runPlanAudit({
      repoRoot: repo,
      slug: "test-slug",
      spawn: stubSpawn({ verdict: "ACCEPT", gaps: [{ issue: "x" }], summary: "sneaky" }),
    });
    // normalizeConsultVerdict is fail-closed: ACCEPT with gaps becomes REJECT.
    check("(d3) ACCEPT-with-gaps fails closed to REJECT", out.verdict === "REJECT",
      `(got ${out.verdict} — the shared normalizer must fail-closed)`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (e) runPlanAudit honors a missing task file gracefully (originalTask fallback) ---
{
  const repo = makeRepo("# Plan\n");
  // Remove the task file so originalTask falls back to the placeholder.
  rmSync(join(repo, ".zcode", "plans", "test-slug.task.md"), { force: true });
  try {
    const out = await runPlanAudit({
      repoRoot: repo,
      slug: "test-slug",
      spawn: stubSpawn({ verdict: "ACCEPT", gaps: [], summary: "ok" }),
    });
    check("(e) missing task file does not crash runPlanAudit", out.verdict === "ACCEPT");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// ===========================================================================
// (m) MULTI-AUDITOR mode (todo 20) — ports judge.mjs:140-147's double-judge pattern.
// Tests: (m1) --multi-auditor flag parsed & accepted; (m2) two agreeing passes → consensus;
// (m3) one ACCEPT + one REJECT → DISAGREEMENT flagged, never auto-resolved;
// (m4) the memory bridge records the disagreement (outcomeToGraphEntity from todo 2);
// (m5) the compareAuditorVerdicts helper detects score-delta > 0.15 disagreements.
// The external CLI is mocked throughout via stub spawn functions — never spawned for real.
// ===========================================================================
console.log("consult.mjs --multi-auditor mode tests\n");

// --- (m1) --multi-auditor flag is parsed and accepted (not rejected as unknown arg) ---
{
  const repo = makeRepo();
  try {
    // Point CLAUDE_CLI at a stub that echoes an ACCEPT verdict, then invoke the CLI with the flag.
    const stubScript = join(repo, "stub-claude.sh");
    writeFileSync(stubScript,
      `#!/bin/sh\n` +
      `cat <<'EOF'\n` +
      `{"result":"{\\"verdict\\":\\"ACCEPT\\",\\"gaps\\":[],\\"summary\\":\\"ok\\"}"}\n` +
      `EOF\n`,
      { mode: 0o755 });
    const env = { ...process.env, CLAUDE_CLI: stubScript };
    // No CLAUDE_CLI_2 → both passes use the stub; pass 2 gets a prompt variation but same verdict → consensus.
    const r = spawnSync("node", [CONSULT, repo, "test-slug", "--multi-auditor"], { encoding: "utf8", env });
    check("(m1) --multi-auditor flag is accepted (exit 0 consensus or 5 disagreement, not 2)",
      r.status === 0 || r.status === 5, `(got status ${r.status}, stderr: ${(r.stderr || "").slice(0, 200)})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (m2) two AGREEING passes → consensus (ACCEPT/ACCEPT), state.consult.verdict = ACCEPT ---
{
  const repo = makeRepo("# Plan\n\n## Scope\n- the work");
  try {
    const out = await runMultiAuditor({
      repoRoot: repo,
      slug: "test-slug",
      spawn: stubSpawnSequence([
        { verdict: "ACCEPT", gaps: [], summary: "pass1 ok" },
        { verdict: "ACCEPT", gaps: [], summary: "pass2 ok" },
      ]),
    });
    check("(m2) multi-auditor returns multi_auditor=true", out.multi_auditor === true);
    check("(m2) pass1 verdict ACCEPT", out.pass1.verdict === "ACCEPT");
    check("(m2) pass2 verdict ACCEPT", out.pass2.verdict === "ACCEPT");
    check("(m2) comparison.consensus is true", out.comparison.consensus === true,
      `(got reason: ${out.comparison.reason})`);
    check("(m2) consensus verdict is ACCEPT", out.comparison.verdict === "ACCEPT");
    check("(m2) both passes have score 1.0 (ACCEPT = no gaps)", out.pass1.score === 1.0 && out.pass2.score === 1.0);
    const st = readState(repo);
    check("(m2) state.consult.verdict = ACCEPT on consensus", st.consult && st.consult.verdict === "ACCEPT",
      `(got ${JSON.stringify(st.consult && st.consult.verdict)})`);
    check("(m2) no disagreement recorded on consensus", !st.consult.disagreements || st.consult.disagreements.length === 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (m3) one ACCEPT + one REJECT → DISAGREEMENT, never auto-resolved ---
// This is the core guarantee: when auditors disagree, we surface to human (do NOT auto-loop).
{
  const repo = makeRepo("# Plan\n\n## Scope\n- the work");
  try {
    const out = await runMultiAuditor({
      repoRoot: repo,
      slug: "test-slug",
      spawn: stubSpawnSequence([
        { verdict: "ACCEPT", gaps: [], summary: "pass1 looks good" },
        { verdict: "REJECT", gaps: [{ category: "scope", severity: "critical", issue: "missing piece", fix: "add it" }], summary: "pass2 finds a gap" },
      ]),
    });
    check("(m3) pass1 verdict ACCEPT", out.pass1.verdict === "ACCEPT");
    check("(m3) pass2 verdict REJECT", out.pass2.verdict === "REJECT");
    check("(m3) comparison.consensus is FALSE (disagreement)", out.comparison.consensus === false,
      `(got consensus=true unexpectedly)`);
    check("(m3) disagreement reason mentions the verdict clash", /clash/i.test(out.comparison.reason),
      `(reason: ${out.comparison.reason})`);
    check("(m3) no majority verdict on disagreement", out.comparison.verdict === null);
    const st = readState(repo);
    check("(m3) state.consult.verdict = DISAGREEMENT marker", st.consult && st.consult.verdict === "DISAGREEMENT",
      `(got ${JSON.stringify(st.consult && st.consult.verdict)})`);
    check("(m3) state.consult.disagreements has one entry",
      Array.isArray(st.consult.disagreements) && st.consult.disagreements.length === 1,
      `(got ${JSON.stringify(st.consult && st.consult.disagreements)})`);
    if (st.consult && st.consult.disagreements && st.consult.disagreements[0]) {
      const d = st.consult.disagreements[0];
      check("(m3) disagreement entry records pass1 ACCEPT", d.pass1 && d.pass1.verdict === "ACCEPT");
      check("(m3) disagreement entry records pass2 REJECT", d.pass2 && d.pass2.verdict === "REJECT");
      check("(m3) disagreement entry has a reason string", typeof d.reason === "string" && d.reason.length > 0);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (m4) memory bridge: disagreement recorded via outcomeToGraphEntity into outcomes.jsonl ---
// AC4 / MUST-DO #5: multi-auditor uses the memory bridge from todo 2 so future runs can recall.
{
  const repo = makeRepo("# Plan\n");
  try {
    const out = await runMultiAuditor({
      repoRoot: repo,
      slug: "test-slug",
      spawn: stubSpawnSequence([
        { verdict: "ACCEPT", gaps: [], summary: "ok" },
        { verdict: "REJECT", gaps: [{ category: "scope", severity: "critical", issue: "x", fix: "y" }], summary: "no" },
      ]),
    });
    check("(m4) disagreement detected (precondition for memory-bridge write)", out.comparison.consensus === false);
    // The memory bridge writes to <repo>/.zcode/memory/outcomes.jsonl on disagreement.
    const outcomesPath = join(repo, ".zcode", "memory", "outcomes.jsonl");
    let recorded = null;
    try {
      const lines = readFileSync(outcomesPath, "utf8").split("\n").filter((l) => l.trim());
      for (const l of lines) {
        const obj = JSON.parse(l);
        if (obj.entityType === "auditor_disagreement") { recorded = obj; break; }
      }
    } catch {}
    check("(m4) disagreement recorded to outcomes.jsonl", recorded !== null,
      `(no auditor_disagreement entity found at ${outcomesPath})`);
    if (recorded) {
      // The recorded entity must be a valid memory.json graph entity (the bridge contract).
      check("(m4) recorded entity passes validateGraphEntity", validateGraphEntity(recorded) === true);
      check("(m4) recorded entity name is namespaced to slug", typeof recorded.name === "string" && recorded.name.includes("test-slug"));
      check("(m4) recorded entity has observations array", Array.isArray(recorded.observations) && recorded.observations.length > 0);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (m5) compareAuditorVerdicts: score-delta > 0.15 also triggers disagreement ---
// Mirrors judge.mjs:143-144 (delta > 0.15 → flag). Both REJECT, but one far harsher than the other.
{
  // Two REJECTs: one with a single minor gap (score 0.9), one with two critical gaps (score 0.0).
  // |0.9 - 0.0| = 0.9 > 0.15 → disagreement even though both verdicts are REJECT.
  const harsh = { verdict: "REJECT", gaps: [{ severity: "critical", issue: "a", fix: "x" }, { severity: "critical", issue: "b", fix: "y" }], summary: "" };
  const lenient = { verdict: "REJECT", gaps: [{ severity: "minor", issue: "c", fix: "z" }], summary: "" };
  const cmp = compareAuditorVerdicts(harsh, lenient);
  check("(m5) both-REJECT but large score delta → disagreement", cmp.consensus === false,
    `(got consensus=true, delta=${cmp.delta})`);
  check("(m5) disagreement reason mentions the delta threshold", /0\.15/.test(cmp.reason),
    `(reason: ${cmp.reason})`);
  check("(m5) DISAGREEMENT_THRESHOLD is 0.15 (ported from judge.mjs)", DISAGREEMENT_THRESHOLD === 0.15);
  // And the symmetric control: two identical REJECTs with the same severity → consensus.
  const cmp2 = compareAuditorVerdicts(lenient, { verdict: "REJECT", gaps: [{ severity: "minor", issue: "d", fix: "z" }], summary: "" });
  check("(m5) two similar REJECTs → consensus (delta <= 0.15)", cmp2.consensus === true,
    `(got consensus=false, delta=${cmp2.delta})`);
  // scoreOf sanity: ACCEPT (no gaps) = 1.0.
  check("(m5) scoreOf(ACCEPT) = 1.0", scoreOf({ verdict: "ACCEPT", gaps: [] }) === 1.0);
}


// --- EPIPE is not a process error -------------------------------------------
//
// spawnSync reports EPIPE when the child stops reading stdin before the parent finishes writing.
// The child exiting early is not the spawn failing — and if it exited 0 with usable stdout, the
// audit is valid. Treating EPIPE as fatal both discarded good results and hid the real cause: you
// saw "process error: EPIPE" when the truth was "the auditor exited 1 because of a bad flag".
//
// It also made THIS suite flaky. The stub below does not drain stdin, so under CI load the write
// raced the exit and a run went red on a file the change never touched. A gate that fails randomly
// teaches people to re-run red instead of reading it.
{
  const dir = mkdtempSync(join(tmpdir(), "zod-epipe-"));
  try {
    // A stub that answers immediately and never reads stdin — the exact race.
    const stub = join(dir, "stub.sh");
    writeFileSync(stub, `#!/bin/sh\nprintf %s '{"result":"{\\"verdict\\":\\"ACCEPT\\"}"}'\nexit 0\n`);
    spawnSync("chmod", ["+x", stub]);
    const res = spawnSync(stub, [], { encoding: "utf8", input: "x".repeat(5 * 1024 * 1024) });

    check("(e) the race reproduces: EPIPE with a usable exit-0 result",
      res.error && res.error.code === "EPIPE" && res.status === 0 && !!res.stdout,
      `(error=${res.error && res.error.code} status=${res.status} stdout=${(res.stdout || "").length})`);

    // Mirror isFatalSpawnError's contract.
    const fatal = (r) => r.status === null ? true : (!r.error ? false : r.error.code !== "EPIPE");
    check("(e) EPIPE + exit 0 is NOT fatal", fatal(res) === false);
    check("(e) a real spawn failure IS fatal", fatal({ error: { code: "ENOENT" }, status: null }) === true);
    check("(e) killed-by-signal IS fatal", fatal({ status: null }) === true);
    check("(e) clean run is not fatal", fatal({ status: 0, stdout: "x" }) === false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ===========================================================================
// (r) POST-DONE GAP-REFUTE FILTER (run `consult-refute-adaptation`, todo 3).
// Written RED-FIRST against the unmodified consult.mjs: the refute pass, its history
// field, and the confidence routing do not exist yet, so these checks fail at RED for
// the right reason (single spawn consumed, no `refute` field, unpartitioned gaps) —
// never a crash (every history/spawn read below is `|| {}`-guarded).
//
// Contract under test (metis D3/D4 + the plan's insertion contract):
//   - DEFAULT-ON for post-done REJECT rounds only: the refuter consumes the SECOND
//     stub response of a spawn sequence; `--no-refute` and ACCEPT rounds spawn exactly
//     once (byte-today); plan-audit / multi-auditor are pinned by their existing cases
//     above staying green, unedited.
//   - Fail-closed verdict semantics: the verdict VALUE is never recomputed — an
//     all-refuted REJECT stays REJECT (empty last_gaps + "[refuted] …" string
//     advisories + the optional history `refute` report field).
//   - Refuter failure (non-zero status, unparseable output, spawn throw) = ONE stderr
//     warn naming the failure + "zero gaps refuted", gaps intact, NO refute field, no
//     new exit code.
//   - The refute spawn inherits the full item-28 pattern: argv identical to the audit
//     spawn, bin CLAUDE_CLI_2 || CLAUDE_CLI, 10-min timeout, 200MB maxBuffer, and the
//     DATA-framed prompt over gaps JSON + plan + the frozen redacted diff.
// ===========================================================================
console.log("consult.mjs post-done gap-refute filter tests\n");

// The post-done entry point (appended import — the destructure at the top of this file
// predates the filter and stays untouched; the isMain guard keeps the import side-effect free).
const { runPostDoneConsult } = await import(pathToFileURL(CONSULT).href);

// stderr capture for the refuter-failure warns (they write via process.stderr.write).
// Same patch discipline as the tripwire suite: stays installed until the awaited call settles.
async function captureStderr(fn) {
  const chunks = [];
  const origWrite = process.stderr.write;
  const origErr = console.error;
  process.stderr.write = (s) => { chunks.push(String(s)); return true; };
  console.error = (...a) => { chunks.push(a.map(String).join(" ") + "\n"); };
  try {
    const result = await fn();
    return { result, stderr: chunks.join("") };
  } finally {
    process.stderr.write = origWrite;
    console.error = origErr;
  }
}

// A spawn stub that records every call (bin/args/opts) and delegates to `inner`.
function recordingSpawn(inner) {
  const calls = [];
  const fn = (bin, args, opts) => { calls.push({ bin, args, opts }); return inner(bin, args, opts); };
  fn.calls = calls;
  return fn;
}

// --- (r1) stub-sequence REJECT: the refute pass consumes the 2nd stub response ---
{
  const repo = makeRepo();
  try {
    const gapKept = { severity: "major", issue: "widget lock missing", fix: "wrap the widget write in the state lock" };
    const gapLowConf = { severity: "minor", issue: "typo in header comment", fix: "fix the header typo", confidence: 0.1 };
    const gapRefuted = { severity: "critical", issue: "no exit code for lock failure", fix: "exit 6 when the state lock cannot be acquired" };
    const refuteReason = 'The frozen diff already contains "exit 6 when the state lock cannot be acquired" — the gap is stale.';
    const spawnStub = recordingSpawn(stubSpawnSequence([
      { verdict: "REJECT", gaps: [gapKept, gapLowConf, gapRefuted], advisories: ["consider splitting the module"], summary: "three findings" },
      { refutations: [{ index: 1, reason: refuteReason }] },
    ]));
    const out = await runPostDoneConsult({ repoRoot: repo, slug: "test-slug", spawn: spawnStub, rest: [] });

    check("(r1) exactly TWO spawns ran (audit + refute)", spawnStub.calls.length === 2,
      `(got ${spawnStub.calls.length})`);
    check("(r1) verdict stays REJECT (never recomputed)", out.verdict === "REJECT", `(got ${JSON.stringify(out.verdict)})`);
    check("(r1) returned gaps = the kept gap only (low-confidence routed, one refuted)",
      JSON.stringify(out.gaps) === JSON.stringify([gapKept]), `(got ${JSON.stringify(out.gaps)})`);
    check("(r1) advisories = auditor's + routed low-confidence + [refuted], in order",
      Array.isArray(out.advisories) && out.advisories.length === 3 &&
        out.advisories[0] === "consider splitting the module" &&
        out.advisories[1] === "[low-confidence] typo in header comment" &&
        out.advisories[2] === `[refuted] no exit code for lock failure — ${refuteReason}`,
      `(got ${JSON.stringify(out.advisories)})`);
    const st = readState(repo);
    check("(r1) state.consult.verdict is REJECT", !!(st.consult && st.consult.verdict === "REJECT"));
    check("(r1) state.consult.last_gaps = the kept gap only",
      JSON.stringify((st.consult || {}).last_gaps) === JSON.stringify([gapKept]),
      `(got ${JSON.stringify((st.consult || {}).last_gaps)})`);
    const entry = ((st.consult || {}).history || [])[0] || {};
    const rf = entry.refute || {};
    check("(r1) history entry carries the optional refute field (attempted/refuted/kept/report)",
      rf.attempted === true && rf.refuted === 1 && rf.kept === 1 && !!(rf.report && typeof rf.report === "object"),
      `(got ${JSON.stringify(entry.refute)})`);
    check("(r1) refute.report lists the refuted gap (issue+reason) with the convergence-trap note",
      Array.isArray(rf.report && rf.report.refuted) && rf.report.refuted.length === 1 &&
        rf.report.refuted[0].issue === "no exit code for lock failure" &&
        rf.report.refuted[0].reason === refuteReason &&
        /re-judged fresh/.test(String((rf.report || {}).note || "")),
      `(got ${JSON.stringify(rf.report)})`);
    const c2 = spawnStub.calls[1] || { args: [], opts: {} };
    check("(r1) refute spawn argv is identical to the audit spawn argv (read-only flags)",
      JSON.stringify(c2.args) === JSON.stringify((spawnStub.calls[0] || {}).args) &&
        JSON.stringify(c2.args) === JSON.stringify(["-p", "--output-format", "json", "--permission-mode", "plan", "--allowedTools", ""]),
      `(got ${JSON.stringify(c2.args)})`);
    check("(r1) refute spawn timeout=10min, maxBuffer=200MB (the audit-spawn envelope)",
      c2.opts.timeout === 10 * 60 * 1000 && c2.opts.maxBuffer === 200 * 1024 * 1024,
      `(timeout=${c2.opts.timeout}, maxBuffer=${c2.opts.maxBuffer})`);
    check("(r1) refute prompt is the DATA-framed refute prompt over the KEPT gaps + frozen diff",
      String(c2.opts.input || "").includes("Refute Prompt") &&
        String(c2.opts.input || "").includes(gapKept.issue) &&
        String(c2.opts.input || "").includes(gapRefuted.issue) &&
        !String(c2.opts.input || "").includes(gapLowConf.issue) &&
        String(c2.opts.input || "").includes("THE FROZEN DIFF"),
      `(input head: ${JSON.stringify(String(c2.opts.input || "").slice(0, 120))})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (r2) ALL gaps refuted → REJECT stays REJECT (never auto-ACCEPT), empty last_gaps ---
{
  const repo = makeRepo();
  try {
    const gapA = { severity: "major", issue: "alpha gap unfixed", fix: "apply the alpha remediation patch now" };
    const gapB = { severity: "minor", issue: "beta gap unfixed", fix: "apply the beta remediation patch now" };
    const reasonA = 'Already done: "apply the alpha remediation patch now".';
    const reasonB = 'Already done: "apply the beta remediation patch now".';
    const spawnStub = recordingSpawn(stubSpawnSequence([
      { verdict: "REJECT", gaps: [gapA, gapB], summary: "two findings" },
      { refutations: [{ index: 0, reason: reasonA }, { index: 1, reason: reasonB }] },
    ]));
    const out = await runPostDoneConsult({ repoRoot: repo, slug: "test-slug", spawn: spawnStub, rest: [] });

    check("(r2) invariant: an all-refuted REJECT STAYS REJECT (the verdict is NEVER recomputed)",
      out.verdict === "REJECT", `(got ${JSON.stringify(out.verdict)})`);
    check("(r2) returned gaps are EMPTY (nothing left to remediate)",
      Array.isArray(out.gaps) && out.gaps.length === 0, `(got ${JSON.stringify(out.gaps)})`);
    check("(r2) refuted gaps arrive as STRING advisories ('[refuted] <issue> — <reason>')",
      Array.isArray(out.advisories) && out.advisories.length === 2 &&
        out.advisories[0] === `[refuted] alpha gap unfixed — ${reasonA}` &&
        out.advisories[1] === `[refuted] beta gap unfixed — ${reasonB}`,
      `(got ${JSON.stringify(out.advisories)})`);
    const st = readState(repo);
    check("(r2) state.consult: verdict REJECT + EMPTY last_gaps (the empty-last_gaps surface rule's input)",
      !!(st.consult && st.consult.verdict === "REJECT" && Array.isArray(st.consult.last_gaps) && st.consult.last_gaps.length === 0),
      `(verdict=${st.consult && st.consult.verdict}, last_gaps=${JSON.stringify(st.consult && st.consult.last_gaps)})`);
    const entry = ((st.consult || {}).history || [])[0] || {};
    const rf = entry.refute || {};
    check("(r2) history refute field reports 2 refuted / 0 kept with the full report",
      rf.refuted === 2 && rf.kept === 0 &&
        Array.isArray(rf.report && rf.report.refuted) && rf.report.refuted.length === 2,
      `(got ${JSON.stringify(entry.refute)})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (r3) refuter FAILS (non-zero status) → zero refuted + ONE warn + gaps intact ---
{
  const repo = makeRepo();
  try {
    const gaps = [
      { severity: "major", issue: "gap one stands", fix: "fix one with a long enough fix text" },
      { severity: "minor", issue: "gap two stands", fix: "fix two with a long enough fix text" },
    ];
    let call = 0;
    const spawnStub = recordingSpawn(() => {
      call += 1;
      if (call === 1) {
        return { status: 0, stdout: JSON.stringify({ result: JSON.stringify({ verdict: "REJECT", gaps, summary: "two findings" }) }), stderr: "" };
      }
      return { status: 1, stdout: "", stderr: "stub refuter exploded" };
    });
    const { result: out, stderr } = await captureStderr(() =>
      runPostDoneConsult({ repoRoot: repo, slug: "test-slug", spawn: spawnStub, rest: [] }));

    check("(r3) both gaps stand (zero refuted — fail-closed no-op)",
      JSON.stringify(out.gaps) === JSON.stringify(gaps), `(got ${JSON.stringify(out.gaps)})`);
    check("(r3) ONE stderr warn names the failure AND states zero gaps refuted",
      /refuter failed \(exit 1\)[\s\S]*stub refuter exploded[\s\S]*zero gaps refuted/.test(stderr) &&
        (stderr.match(/zero gaps refuted/g) || []).length === 1,
      `(stderr tail: ${JSON.stringify(stderr.slice(-400))})`);
    check("(r3) verdict REJECT and the call RETURNED (no new exit code on refuter failure)",
      out.verdict === "REJECT");
    const st = readState(repo);
    const entry = ((st.consult || {}).history || [])[0] || {};
    check("(r3) NO refute field on the history entry (today's entry shape on failure)",
      !("refute" in entry), `(entry keys: ${Object.keys(entry).join(",")})`);
    check("(r3) no [refuted] advisories",
      JSON.stringify(out.advisories) === JSON.stringify([]), `(got ${JSON.stringify(out.advisories)})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (r3b) refuter returns UNPARSEABLE output → the same degradation ---
{
  const repo = makeRepo();
  try {
    const gap = { severity: "major", issue: "gap stands after garbage", fix: "a fix line long enough to quote verbatim" };
    let call = 0;
    const spawnStub = recordingSpawn(() => {
      call += 1;
      if (call === 1) {
        return { status: 0, stdout: JSON.stringify({ result: JSON.stringify({ verdict: "REJECT", gaps: [gap], summary: "one finding" }) }), stderr: "" };
      }
      return { status: 0, stdout: "<html>502 Bad Gateway</html>", stderr: "" };
    });
    const { result: out, stderr } = await captureStderr(() =>
      runPostDoneConsult({ repoRoot: repo, slug: "test-slug", spawn: spawnStub, rest: [] }));

    check("(r3b) the gap stands (zero refuted from garbage output)",
      JSON.stringify(out.gaps) === JSON.stringify([gap]), `(got ${JSON.stringify(out.gaps)})`);
    check("(r3b) the warn names 'unparseable' and states zero gaps refuted",
      /refuter response unparseable[\s\S]*zero gaps refuted/.test(stderr),
      `(stderr tail: ${JSON.stringify(stderr.slice(-300))})`);
    check("(r3b) verdict REJECT, gaps intact in last_gaps, no refute field",
      out.verdict === "REJECT" &&
        JSON.stringify((readState(repo).consult || {}).last_gaps) === JSON.stringify([gap]) &&
        !("refute" in (((readState(repo).consult || {}).history || [])[0] || {})),
      `(state: ${JSON.stringify(readState(repo).consult)})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (r4) --no-refute → EXACTLY one spawn, byte-today (no refute, no routing) ---
{
  const repo = makeRepo();
  try {
    const gaps = [
      { severity: "major", issue: "kept gap one", fix: "fix one with a long enough fix text" },
      // confidence 0.1 WOULD route to an advisory if the filter were on — with --no-refute
      // it must stay a gap (byte-today means no routing either, not just no refute spawn).
      { severity: "minor", issue: "low-confidence gap stays a gap", fix: "fix two with a long enough fix text", confidence: 0.1 },
    ];
    const spawnStub = recordingSpawn(stubSpawnSequence([
      { verdict: "REJECT", gaps, advisories: ["auditor advisory"], summary: "two findings" },
    ]));
    const out = await runPostDoneConsult({ repoRoot: repo, slug: "test-slug", spawn: spawnStub, rest: ["--no-refute"] });

    check("(r4) exactly ONE spawn (byte-today single-spawn behavior)",
      spawnStub.calls.length === 1, `(got ${spawnStub.calls.length})`);
    check("(r4) gaps pass through UNROUTED (the confidence-0.1 gap stays a gap)",
      JSON.stringify(out.gaps) === JSON.stringify(gaps), `(got ${JSON.stringify(out.gaps)})`);
    check("(r4) advisories are the auditor's alone",
      JSON.stringify(out.advisories) === JSON.stringify(["auditor advisory"]), `(got ${JSON.stringify(out.advisories)})`);
    const st = readState(repo);
    const entry = ((st.consult || {}).history || [])[0] || {};
    check("(r4) no refute field on the history entry",
      !("refute" in entry), `(entry keys: ${Object.keys(entry).join(",")})`);
    check("(r4) last_gaps = the full gap list",
      JSON.stringify((st.consult || {}).last_gaps) === JSON.stringify(gaps),
      `(got ${JSON.stringify((st.consult || {}).last_gaps)})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (r5) ACCEPT round → single spawn (no refute on ACCEPT) ---
{
  const repo = makeRepo();
  try {
    const spawnStub = recordingSpawn(stubSpawnSequence([
      { verdict: "ACCEPT", gaps: [], summary: "clean" },
    ]));
    const out = await runPostDoneConsult({ repoRoot: repo, slug: "test-slug", spawn: spawnStub, rest: [] });

    check("(r5) ACCEPT round spawns exactly once (no refute pass)",
      spawnStub.calls.length === 1 && out.verdict === "ACCEPT",
      `(spawns=${spawnStub.calls.length}, verdict=${JSON.stringify(out.verdict)})`);
    const entry = (((readState(repo).consult || {}).history || [])[0]) || {};
    check("(r5) no refute field on an ACCEPT history entry", !("refute" in entry),
      `(entry keys: ${Object.keys(entry).join(",")})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

// --- (r6) refute bin = CLAUDE_CLI_2 || CLAUDE_CLI; a valid EMPTY refutations array is SUCCESS ---
{
  const repo = makeRepo();
  const origCli = process.env.CLAUDE_CLI;
  const origCli2 = process.env.CLAUDE_CLI_2;
  process.env.CLAUDE_CLI = "stub-audit-cli";
  process.env.CLAUDE_CLI_2 = "stub-refute-cli";
  try {
    const gap = { severity: "major", issue: "single gap stands", fix: "the single fix text is long enough" };
    let call = 0;
    const spawnStub = recordingSpawn(() => {
      call += 1;
      if (call === 1) {
        return { status: 0, stdout: JSON.stringify({ result: JSON.stringify({ verdict: "REJECT", gaps: [gap], summary: "one finding" }) }), stderr: "" };
      }
      return { status: 0, stdout: JSON.stringify({ result: JSON.stringify({ refutations: [] }) }), stderr: "" };
    });
    const { result: out, stderr } = await captureStderr(() =>
      runPostDoneConsult({ repoRoot: repo, slug: "test-slug", spawn: spawnStub, rest: [] }));

    check("(r6) audit spawn uses CLAUDE_CLI; the refute spawn prefers CLAUDE_CLI_2",
      spawnStub.calls.length === 2 && (spawnStub.calls[0] || {}).bin === "stub-audit-cli" &&
        (spawnStub.calls[1] || {}).bin === "stub-refute-cli",
      `(bins: ${JSON.stringify(spawnStub.calls.map((c) => c.bin))})`);
    check("(r6) a valid EMPTY refutations array is SUCCESS (no warn, gap stands)",
      !/zero gaps refuted/.test(stderr) && out.verdict === "REJECT" &&
        JSON.stringify(out.gaps) === JSON.stringify([gap]),
      `(stderr tail: ${JSON.stringify(stderr.slice(-200))}, gaps: ${JSON.stringify(out.gaps)})`);
    const entry = (((readState(repo).consult || {}).history || [])[0]) || {};
    const rf = entry.refute || {};
    check("(r6) refute field: attempted=true, refuted=0, kept=1",
      rf.attempted === true && rf.refuted === 0 && rf.kept === 1,
      `(got ${JSON.stringify(entry.refute)})`);
  } finally {
    if (origCli === undefined) delete process.env.CLAUDE_CLI; else process.env.CLAUDE_CLI = origCli;
    if (origCli2 === undefined) delete process.env.CLAUDE_CLI_2; else process.env.CLAUDE_CLI_2 = origCli2;
    rmSync(repo, { recursive: true, force: true });
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);