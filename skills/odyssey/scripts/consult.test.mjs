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
const auditorPromptPath = join(
  process.env.HOME, ".zcode/skills/odyssey/references/auditor-prompt.md"
);
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

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
