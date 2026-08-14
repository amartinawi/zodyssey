#!/usr/bin/env node
// pipeline-integration.test.mjs — can a run still reach `done`?
//
// WHY THIS EXISTS: every gate in this repo is unit-tested in isolation, and every one of them can
// BLOCK. Nothing tested whether they compose. That is the gap that let v0.3.0 ship: each file was
// correct, each check passed, and the assembled system was dead.
//
// The 2026-08-11 wave added several new refusals — record-todo refuses `done` without verify
// evidence, parse-plan requires a criterion invoking the real test command, the regression gate
// blocks `done`, F2/F4 now demand a parseable verdict. Any ONE of them mis-wired turns every run
// into a deadlock, and no unit test can see that, because a unit test asserts a gate says NO.
// This asserts the pipeline can still say YES.
//
// It drives the scripts in the conductor's documented order against a real git repo, and mints
// REAL nonces by invoking the REAL hook with the same Task payload ZCode sends. Nothing is
// stubbed; the only things absent are ZCode's hook invocation and the LLM agents themselves, so a
// pass here means "the machinery composes", not "the agents behave".
//
// Run:  node pipeline-integration.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const S = new URL(".", import.meta.url).pathname;
const HOOK = join(S, "..", "hooks", "pre-tool.mjs");
const script = (n) => join(S, n);

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const run = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: "utf8", ...opts });
const git = (repo, ...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });

// ---------------------------------------------------------------------------
// A realistic target: a real git repo with a GREEN pre-existing suite, so the regression gate has
// something true to protect and F1 has a real diff to inspect.
const repo = mkdtempSync(join(tmpdir(), "zod-pipeline-"));
mkdirSync(join(repo, "src"), { recursive: true });
mkdirSync(join(repo, "test"), { recursive: true });
writeFileSync(join(repo, "package.json"), JSON.stringify({
  name: "fixture", version: "1.0.0", private: true, type: "module",
  scripts: { test: "node --test test/*.test.js" },
}, null, 2));
writeFileSync(join(repo, "src", "text.js"),
  `export function slugify(s) {\n  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");\n}\n`);
writeFileSync(join(repo, "test", "text.test.js"),
  `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { slugify } from "../src/text.js";\n\ntest("slugify", () => { assert.equal(slugify("Hello World"), "hello-world"); });\n`);
git(repo, "init", "-q");
git(repo, "config", "user.email", "t@t.t");
git(repo, "config", "user.name", "t");
git(repo, "add", "-A");
git(repo, "commit", "-qm", "baseline");

const SLUG = "add-truncate";
const statePath = () => join(repo, ".zcode", "state", `${SLUG}.json`);
const state = () => JSON.parse(readFileSync(statePath(), "utf8"));

// Invoke the REAL hook with the payload ZCode sends on a Task dispatch. This is how the review /
// F2 / F4 nonces come into existence — fabricating them in the fixture would test nothing, since
// the unforgeability of those nonces is the property under test.
function dispatch(subagent) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: "Task", tool_input: { subagent_type: subagent, prompt: "review it" } }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ZODYSSEY_UNGATE_BASH: "" },
  });
}

// v0.4.0: same principle for the routing observation — the conductor loads the routed skill in
// the parent thread, the hook witnesses the Skill call and records {capability, observed:true}
// into state.capabilities. F5 cross-checks that record at the final wave.
const loadSkill = (name) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ tool_name: "Skill", tool_input: { skill: name } }),
  encoding: "utf8",
  env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ZODYSSEY_UNGATE_BASH: "" },
});

console.log("pipeline integration — can a run still reach `done`?\n");

// --- phase 2: PLAN -----------------------------------------------------------
{
  const r = run([script("scaffold.mjs"), repo, SLUG, "Add truncate()", "standard", "add a truncate helper"]);
  check("scaffold creates the run", r.status === 0 && existsSync(statePath()), r.stderr);
  check("scaffold probes the toolchain (probe-toolchain is wired in)",
    existsSync(join(repo, ".zcode", "toolchain.json")),
    "toolchain.json missing — post-edit lint + criterion lint would be dead");
}

const planPath = join(repo, ".zcode", "plans", `${SLUG}.md`);

// A plan shaped the way prometheus is instructed to write one. The acceptance criteria matter
// most: one must invoke the repo's real test command or --lint refuses (B6).
const PLAN = `# Add truncate()

## Capability routing
- \`routed: skill:test-driven-development\`
- Evidence: code todo; TDD is the mandated implement capability.

## Scope

Add a \`truncate\` helper to the text module, with tests.

## Todos

- [ ] 1. add truncate() + tests
  - Files: [\`src/text.js\`, \`test/text.test.js\`]
  - Acceptance criteria:
    - \`node --test test/*.test.js\` exits 0
    - \`node -e "import('./src/text.js').then(m=>process.exit(m.truncate('abcdef',4)==='abc…'?0:1))"\` exits 0

## Final verification wave
`;

// --- phase 3: REVIEW (the enforced gate) ------------------------------------
{
  writeFileSync(planPath, PLAN);
  const lint = run([script("parse-plan.mjs"), planPath, "--lint"]);
  check("plan passes --lint (criteria are executable AND run the real suite)",
    lint.status === 0, `(exit ${lint.status}) ${lint.stdout.slice(0, 300)}`);

  // The conductor honors the plan's routing declaration by loading the skill in the parent
  // thread. The hook witnesses the Skill call → state.capabilities gains an observed entry.
  loadSkill("test-driven-development");
  check("hook records the routed skill load as an observed capability",
    (state().capabilities || []).some((c) => c.observed === true && c.capability === "skill:test-driven-development"),
    JSON.stringify(state().capabilities || []));

  const d = dispatch("zodyssey:momus");
  const nonce = state().review?.pending_nonce?.nonce;
  check("hook mints a review nonce on Task(momus)", !!nonce, d.stderr.slice(0, 200));

  // SEC-6: --from refuses paths under .zcode/plans|notepads (agent-writable bookkeeping cannot
  // be the verdict source). Stage it outside the run tree, as the conductor is told to.
  const verdictFile = join(tmpdir(), `momus-verdict-${process.pid}.json`);
  writeFileSync(verdictFile, JSON.stringify({ verdict: "OKAY", blockers: [], notes: "fine" }));
  const art = run([script("record-momus-artifact.mjs"), repo, SLUG, "1", "--nonce", nonce, "--from", verdictFile]);
  const artifactPath = (art.stdout || "").trim().split("\n").pop();
  check("record-momus-artifact binds the nonce", art.status === 0 && !!artifactPath, art.stderr.slice(0, 200));

  const planSha = createHash("sha256").update(readFileSync(planPath)).digest("hex");
  const rev = run([script("record-review.mjs"), repo, SLUG, "OKAY", "--momus-artifact", artifactPath, "--plan-sha", planSha]);
  check("record-review records OKAY", rev.status === 0 && state().review?.verdict === "OKAY", rev.stderr.slice(0, 300));
}

// --- phase 4: EXECUTE --------------------------------------------------------
{
  // record-review.mjs advances the phase to execute ITSELF on OKAY (record-review.mjs:208) —
  // it does not go through set-phase.mjs. Calling set-phase here would be an illegal
  // execute->execute transition. Asserting the real path instead of inventing one.
  check("record-review advanced the run into execute", state().phase === "execute",
    `(phase: ${state().phase})`);
  check("regression gate takes a GREEN baseline",
    state().regression?.baseline?.green === true,
    `(regression: ${JSON.stringify(state().regression)})`);

  run([script("record-todo.mjs"), repo, SLUG, "1", "in_flight", "--session", "exec-1"]);

  // The executor's work: implement + extend the tests.
  writeFileSync(join(repo, "src", "text.js"),
    readFileSync(join(repo, "src", "text.js"), "utf8") +
    `\nexport function truncate(s, max) {\n  s = String(s);\n  return s.length <= max ? s : s.slice(0, max - 1) + "…";\n}\n`);
  writeFileSync(join(repo, "test", "text.test.js"),
    readFileSync(join(repo, "test", "text.test.js"), "utf8") +
    `\nimport { truncate } from "../src/text.js";\n` +
    `test("truncate leaves short strings alone", () => { assert.equal(truncate("abc", 5), "abc"); });\n` +
    `test("truncate cuts and ellipsises", () => { assert.equal(truncate("abcdef", 4), "abc…"); });\n`);
}

// --- phase 5: VERIFY ---------------------------------------------------------
{
  run([script("set-phase.mjs"), repo, SLUG, "verify"]);

  // THE DEADLOCK CANDIDATE: record-todo now refuses `done` without verify evidence.
  const premature = run([script("record-todo.mjs"), repo, SLUG, "1", "done", "--session", "exec-1"]);
  check("record-todo REFUSES done before verify evidence exists", premature.status === 7,
    `(exit ${premature.status})`);

  for (const [n, crit] of [
    ["1", `node --test test/*.test.js`],
    ["2", `node -e "import('./src/text.js').then(m=>process.exit(m.truncate('abcdef',4)==='abc…'?0:1))"`],
  ]) {
    const v = run([script("record-verify.mjs"), repo, SLUG, "1", "--criterion", crit, "--n", n]);
    check(`criterion ${n} verifies (exit 0)`, v.status === 0, `(exit ${v.status}) ${v.stderr.slice(0, 200)}`);
  }

  const done = run([script("record-todo.mjs"), repo, SLUG, "1", "done", "--session", "exec-1"]);
  check("record-todo ALLOWS done once evidence exists", done.status === 0, `(exit ${done.status}) ${done.stderr.slice(0, 300)}`);
  check("todo is marked verified", state().todos?.["1"]?.verified === true);

  const rg = run([script("regression-gate.mjs"), repo, SLUG, "--check"]);
  check("regression gate: no pass-to-pass regression", rg.status === 0, `(exit ${rg.status}) ${rg.stderr.slice(0, 200)}`);
}

// --- phase 6: FINAL WAVE -----------------------------------------------------
{
  run([script("set-phase.mjs"), repo, SLUG, "final"]);
  mkdirSync(join(repo, ".zcode", "reviews"), { recursive: true });

  const nonces = {};
  for (const [agent, field] of [["feature-dev:code-reviewer", "final_f2"], ["zodyssey:oracle", "final_f4"]]) {
    dispatch(agent);
    nonces[field] = state()[field]?.pending_nonce?.nonce;
    check(`hook mints the ${field} nonce`, !!nonces[field]);
  }

  // Artifacts must now carry a parseable verdict — the whole point of the F2/F4 change.
  const f2 = join(repo, ".zcode", "reviews", "f2.json");
  const f4 = join(repo, ".zcode", "reviews", "f4.json");
  writeFileSync(f2, JSON.stringify({ verdict: "APPROVE", findings: [] }));
  writeFileSync(f4, JSON.stringify({ verdict: "APPROVE", scope: "matches plan" }));
  const f3 = join(repo, ".zcode", "verify", "qa.md");
  mkdirSync(join(repo, ".zcode", "verify"), { recursive: true });
  writeFileSync(f3, "- [ ] eyeball truncate() output\n");

  const fw = run([script("record-final-wave.mjs"), repo, SLUG,
    "--f2-artifact", f2, "--f2-nonce", nonces.final_f2,
    "--f3-checklist", f3,
    "--f4-artifact", f4, "--f4-nonce", nonces.final_f4]);
  const res = state().final?.results || {};
  check("F1 passes (in scope, work done, tests intact)", res.F1?.passed === true,
    `(${JSON.stringify(res.F1).slice(0, 400)})`);
  check("F2 passes on an APPROVE artifact", res.F2?.passed === true, JSON.stringify(res.F2));
  check("F4 passes on an APPROVE artifact", res.F4?.passed === true, JSON.stringify(res.F4));
  check("final verdict is pass", state().final?.verdict === "pass", `(exit ${fw.status}) ${fw.stderr.slice(0, 200)}`);
}

// --- the whole point ---------------------------------------------------------
{
  const d = run([script("set-phase.mjs"), repo, SLUG, "done"]);
  check("THE RUN REACHES done", d.status === 0 && state().phase === "done",
    `(exit ${d.status}) ${d.stderr.slice(0, 400)}`);
}

// --- and the suite is genuinely still green ----------------------------------
{
  const t = spawnSync("npm", ["test"], { cwd: repo, encoding: "utf8" });
  check("the fixture's own suite passes after the change", t.status === 0);
}

// --- the authoritative plan-sha is review.plan_sha256, and only that ---------
//
// scaffold used to stamp a top-level state.plan_sha256 that nothing read. It went stale the
// moment the plan was edited (which happens on every REJECT-replan, and on any mid-review fix),
// while sitting beside the real field looking equally official. Round 4 hit the drift and had to
// reason out which one mattered. Removed; this asserts the remaining one is correct AFTER an edit,
// since that is the case the stale copy got wrong.
{
  check("no vestigial top-level plan_sha256", state().plan_sha256 === undefined,
    `(got ${state().plan_sha256})`);
  const liveSha = createHash("sha256").update(readFileSync(planPath)).digest("hex");
  check("review.plan_sha256 matches the plan ON DISK after a mid-review edit",
    state().review?.plan_sha256 === liveSha,
    `(state ${String(state().review?.plan_sha256).slice(0, 12)} vs disk ${liveSha.slice(0, 12)})`);
}

rmSync(repo, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
