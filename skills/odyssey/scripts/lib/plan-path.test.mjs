#!/usr/bin/env node
// plan-path.test.mjs — suite for the ONE shared plan_path reader-side resolver (todo 3, run
// impl-23-project-isolation; audit finding I3: `.zcode/audits/2026-08-20-project-isolation.md:74-81`).
//
// The audit proved every reader site trusted the absolute `state.plan_path` verbatim — a state
// whose plan_path points into a sibling repo made the FOREIGN plan this project's scope
// authority (its Files: judged local edits, its filenames leaked into block messages). This
// suite pins the fix: `resolvePlanPath(st, repoRoot)` is the single sanctioned resolver, and
// every reader site routes through it.
//
// Cases:
//   UNIT-IN        — an in-repo plan_path passes through byte-identically, no violation.
//   UNIT-SYMLINK   — a plan_path spelled through an in-repo symlinked dir is contained after
//                    both-side normalization (repo-path.mjs's rule) — passthrough, no violation.
//   UNIT-FOREIGN   — a plan_path into a sibling repo → the run's own default plan path +
//                    the named violation reason.
//   UNIT-EMPTY     — absent / empty-string plan_path (and missing slug) → default path, no
//                    violation (the plain fallback, backward compatible).
//   UNIT-RELATIVE  — a relative plan_path resolving INSIDE repoRoot (cwd=repoRoot) stays
//                    contained; one that escapes upward is a violation.
//   HOOK-CONTAINED — real hook, contained plan_path: the declared edit still PASSES (the fix
//                    must not move legitimate single-repo behavior).
//   HOOK-FOREIGN   — real hook, state.plan_path → a sibling repo's plan: the edit is BLOCKED
//                    fail-closed, the reason NAMES the isolation violation, and NO filename
//                    from the foreign plan appears in the block message (the leak, closed).
//
// The hook-level cases drive the REAL pre-tool.mjs via spawnSync (no mocks) under the same
// hermeticity contract as pre-tool.project-isolation.test.mjs: fresh mkdtemp workspace,
// fixture ZODYSSEY_RUN_KEY_PATH (never the operator's real key), ZODYSSEY_NO_FIND_CACHE=1,
// ZODYSSEY_UNGATE_BASH forced to "" (the operator env carries =1).
//
// Run:  node skills/odyssey/scripts/lib/plan-path.test.mjs
// Exit: 0 = all green · 1 = at least one case failed.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stampMarker } from "./state-auth.mjs";
import { resolvePlanPath, PLAN_PATH_VIOLATION } from "./plan-path.mjs";

const HOOK = join(new URL("../../hooks/", import.meta.url).pathname, "pre-tool.mjs");
let pass = 0, fail = 0;
const cleanup = [];
const cleanupWs = () => { const ws = realpathSync(mkdtempSync(join(tmpdir(), "zod-pp-"))); cleanup.push(ws); return ws; };

// One named case prints exactly one `✓/✗ <TAG>: <name>` line aggregating its sub-assertions.
function scenario(TAG, name, subs) {
  const failed = subs.filter((s) => !s.ok);
  if (failed.length === 0) { console.log(`  ✓ ${TAG}: ${name}`); pass++; return; }
  console.log(`  ✗ ${TAG}: ${name}`);
  for (const f of failed) console.log(`      - ${f.label}${f.detail ? ` [${f.detail}]` : ""}`);
  fail++;
}

// Run the REAL checked-in hook. Env set explicitly AFTER the process.env spread so ambient
// operator values (notably ZODYSSEY_UNGATE_BASH=1) can never leak in.
function runHook({ projectDir, key, payload }) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      ZODYSSEY_RUN_KEY_PATH: key,
      ZODYSSEY_NO_FIND_CACHE: "1",
      ZODYSSEY_UNGATE_BASH: "",
      ZODYSSEY_DEBUG: "",
    },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

console.log("plan-path.mjs — I3 containment: one resolver, all reader sites\n");

try {
  // A fixture repo whose default plan declares exactly src/ok.js.
  const ws = cleanupWs();
  const key = join(ws, "fixture.key");
  const repo = join(ws, "repo");
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "ok.js"), "// fixture\n");
  const planText = "# iso3\n\n## Todos\n\n- [ ] 1. go\n  - Files: [`src/ok.js`]\n";
  const defaultPlan = join(repo, ".zcode", "plans", "iso3.md");
  writeFileSync(defaultPlan, planText);
  const planSha = createHash("sha256").update(planText).digest("hex");
  const mkState = (plan_path) => ({ slug: "iso3", phase: "execute", updated_at: new Date().toISOString(),
    plan_path, review: { verdict: "OKAY", round: 1, max_rounds: 3, plan_sha256: planSha } });

  // A sibling repo holding a FOREIGN plan with a filename distinctive enough that its
  // appearance in any message is unambiguous evidence of the leak. No .zcode/state there —
  // the sibling is only a plan-bytes source, never a discovered run.
  const other = join(ws, "other-repo");
  mkdirSync(join(other, ".zcode", "plans"), { recursive: true });
  const FOREIGN_TOKEN = "FOREIGN-SECRET-FILE.js";
  const foreignPlanText = `# foreign\n\n## Todos\n\n- [ ] 1. go\n  - Files: [\`${FOREIGN_TOKEN}\`]\n`;
  const foreignPlan = join(other, ".zcode", "plans", "foreign.md");
  writeFileSync(foreignPlan, foreignPlanText);

  // UNIT-IN — passthrough is byte-identical (the happy path must not move).
  {
    const st = mkState(defaultPlan);
    const { planPath, violation } = resolvePlanPath(st, repo);
    scenario("UNIT-IN", "an in-repo plan_path passes through byte-identically, no violation", [
      { ok: planPath === defaultPlan, label: "planPath is the exact plan_path string", detail: String(planPath) },
      { ok: violation === null, label: "no violation", detail: String(violation) },
    ]);
  }

  // UNIT-SYMLINK — containment must hold after both-side normalization (repo-path.mjs's rule:
  // never compare two paths unless both went through resolvePath).
  {
    symlinkSync(join(repo, ".zcode"), join(repo, "alias-to-zcode"));
    const viaLink = join(repo, "alias-to-zcode", "plans", "iso3.md");
    const st = mkState(viaLink);
    const { planPath, violation } = resolvePlanPath(st, repo);
    scenario("UNIT-SYMLINK", "a plan_path through an in-repo symlinked dir is contained (normalized), passthrough intact", [
      { ok: planPath === viaLink, label: "passthrough stays byte-identical (no rewriting)", detail: String(planPath) },
      { ok: violation === null, label: "symlink spelling does not fake a violation", detail: String(violation) },
    ]);
  }

  // UNIT-FOREIGN — the audit's core case at unit level.
  {
    const st = mkState(foreignPlan);
    const { planPath, violation } = resolvePlanPath(st, repo);
    scenario("UNIT-FOREIGN", "a plan_path into a sibling repo → default plan path + named violation", [
      { ok: planPath === defaultPlan, label: "the run's own default plan path is returned", detail: String(planPath) },
      { ok: violation === PLAN_PATH_VIOLATION, label: "the violation is the shared named reason", detail: String(violation) },
      { ok: typeof violation === "string" && !violation.includes(FOREIGN_TOKEN), label: "the reason carries no foreign filename" },
    ]);
  }

  // UNIT-EMPTY — the plain fallback stays backward compatible (old states have no plan_path).
  {
    const noField = mkState(undefined);
    delete noField.plan_path;
    const a = resolvePlanPath(noField, repo);
    const empty = resolvePlanPath(mkState(""), repo);
    const noSlug = resolvePlanPath({}, repo);
    scenario("UNIT-EMPTY", "absent/empty plan_path (and missing slug) → default path, no violation", [
      { ok: a.planPath === defaultPlan && a.violation === null, label: "absent plan_path → default, clean", detail: String(a.planPath) },
      { ok: empty.planPath === defaultPlan && empty.violation === null, label: "empty-string plan_path → default, clean" },
      { ok: noSlug.planPath === join(repo, ".zcode", "plans", "undefined.md") && noSlug.violation === null, label: "missing slug degrades exactly like the old expression", detail: String(noSlug.planPath) },
    ]);
  }

  // UNIT-RELATIVE — relative spellings are judged by where they resolve, not rejected blindly.
  {
    const prevCwd = process.cwd();
    process.chdir(repo); // a relative plan_path resolves against cwd, same as readFileSync always did
    const inside = resolvePlanPath(mkState(".zcode/plans/iso3.md"), repo);
    const escaping = resolvePlanPath(mkState("../../outside-plan.md"), repo);
    process.chdir(prevCwd);
    scenario("UNIT-RELATIVE", "relative plan_path: resolving inside repoRoot stays contained; escaping upward is a violation", [
      { ok: inside.planPath === ".zcode/plans/iso3.md" && inside.violation === null, label: "in-repo relative path passes through", detail: `${inside.planPath}|${inside.violation}` },
      { ok: escaping.violation === PLAN_PATH_VIOLATION && escaping.planPath === defaultPlan, label: "an upward escape is contained-out → violation + default", detail: `${escaping.planPath}|${escaping.violation}` },
    ]);
  }

  // HOOK-CONTAINED — the real hook on a legitimate single-repo run: the declared edit passes.
  {
    writeFileSync(join(repo, ".zcode", "state", "iso3.json"),
      JSON.stringify(stampMarker(mkState(defaultPlan), "iso3", key), null, 2));
    const r = runHook({ projectDir: ws, key, payload: { tool_name: "Edit", tool_input: { file_path: join(repo, "src", "ok.js") } } });
    scenario("HOOK-CONTAINED", "real hook, contained plan_path: the declared edit still passes", [
      { ok: r.status === 0, label: "exit 0 — the happy path is untouched", detail: `exit=${r.status}` },
    ]);
  }

  // HOOK-FOREIGN — the audit's bite: the run's own repo also holds a valid default plan
  // declaring src/ok.js, so ALLOWING the edit would prove the hook read SOME plan instead of
  // failing closed; and a scope block quoting the foreign Files: would prove the leak.
  {
    const st = mkState(foreignPlan);
    st.review.plan_sha256 = createHash("sha256").update(foreignPlanText).digest("hex");
    writeFileSync(join(repo, ".zcode", "state", "iso3.json"), JSON.stringify(stampMarker(st, "iso3", key), null, 2));
    const r = runHook({ projectDir: ws, key, payload: { tool_name: "Edit", tool_input: { file_path: join(repo, "src", "ok.js") } } });
    const named = /isolation/i.test(r.stdout);
    const leaked = r.stdout.includes(FOREIGN_TOKEN) || r.stdout.includes(foreignPlan);
    scenario("HOOK-FOREIGN", "real hook, plan_path → sibling repo: edit blocked fail-closed, isolation named, no foreign filenames", [
      { ok: r.status === 2, label: "the edit is BLOCKED (empty declared scope, never the foreign plan's)", detail: `exit=${r.status}` },
      { ok: named, label: "the block reason names the isolation violation", detail: r.stdout.slice(0, 160).replace(/\s+/g, " ") },
      { ok: !leaked, label: "no foreign filename or foreign plan path appears in the message" },
    ]);
  }

} finally {
  for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
