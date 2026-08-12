#!/usr/bin/env node
// record-todo.test.mjs — a todo cannot reach `done` on the orchestrator's say-so.
//
// record-verify.mjs:9-10 asserted since it was written that "a todo cannot reach `done` without
// verify evidence (enforced by record-todo.mjs's transition guard, added alongside this)". The
// guard was never written. That made the acceptance chain circular: record-verify sets
// acceptance[id].pass only when todos[id].status === "done", and nothing gated "done" — so
// "verified" ultimately rested on an assertion, not an execution.
//
// The guard reads state.verify.history (per-criterion records carrying a real exit code from a
// real spawn), NOT acceptance[] — gating on acceptance would deadlock against the existing
// circularity rather than break it. The deadlock case is asserted explicitly below, because
// getting this wrong yields a guard that looks correct and makes every run unfinishable.
//
// Run:  node record-todo.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = join(new URL(".", import.meta.url).pathname, "record-todo.mjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

const cleanup = [];
function makeRepo(history = null) {
  const repo = mkdtempSync(join(tmpdir(), "zod-todo-"));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  const st = { slug: "t", phase: "verify", updated_at: new Date().toISOString(), todos: {} };
  if (history) {
    st.verify = { total: history.length, passed: history.filter((h) => h.passed).length, failed: 0, flaky: 0, history };
  }
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify(st, null, 2));
  return repo;
}
const run = (repo, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, repo, "t", ...args], { encoding: "utf8" });
  let state = null;
  try { state = JSON.parse(readFileSync(join(repo, ".zcode", "state", "t.json"), "utf8")); } catch {}
  return { code: r.status, err: r.stderr || "", state };
};

console.log("record-todo.mjs — the verify transition guard\n");

// --- the guard --------------------------------------------------------------
{
  const repo = makeRepo(null); // no verify evidence at all
  const r = run(repo, "1", "done");
  check("REFUSES done with no verify evidence", r.code === 7, `(exit ${r.code})`);
  check("does not write the todo on refusal", !r.state?.todos?.["1"]);
  check("explains why", /no verify evidence/.test(r.err));
}
{
  const repo = makeRepo([{ todo_id: "1", criterion_index: 0, passed: false, exit_code: 1 }]);
  const r = run(repo, "1", "done");
  check("REFUSES done when a criterion FAILED", r.code === 7);
}
{
  const repo = makeRepo([{ todo_id: "1", criterion_index: 0, passed: false, flaky: true, exit_code: 0 }]);
  const r = run(repo, "1", "done");
  check("REFUSES done when a criterion is FLAKY (neither pass nor fail)", r.code === 7);
}
{
  // Evidence for a DIFFERENT todo must not launder this one through.
  const repo = makeRepo([{ todo_id: "2", criterion_index: 0, passed: true, exit_code: 0 }]);
  const r = run(repo, "1", "done");
  check("REFUSES done using another todo's evidence", r.code === 7);
}

// --- the happy path ---------------------------------------------------------
{
  const repo = makeRepo([
    { todo_id: "1", criterion_index: 0, passed: true, exit_code: 0 },
    { todo_id: "1", criterion_index: 1, passed: true, exit_code: 0 },
  ]);
  const r = run(repo, "1", "done");
  check("ALLOWS done with passing evidence", r.code === 0, `(exit ${r.code}: ${r.err.slice(0, 80)})`);
  check("stamps verified:true", r.state?.todos?.["1"]?.verified === true);
  check("records how many criteria were verified", r.state?.todos?.["1"]?.verified_criteria === 2);
}

// --- non-done transitions are untouched -------------------------------------
{
  const repo = makeRepo(null);
  check("in_flight needs no evidence", run(repo, "1", "in_flight").code === 0);
  check("failed needs no evidence", run(repo, "1", "failed").code === 0);
  check("blocked needs no evidence", run(repo, "1", "blocked").code === 0);
  check("pending needs no evidence", run(repo, "1", "pending").code === 0);
}

// --- the escape hatch is auditable, not silent ------------------------------
{
  const repo = makeRepo(null);
  const r = run(repo, "1", "done", "--force-done");
  check("--force-done allows done with no criteria", r.code === 0);
  check("--force-done records forced:true", r.state?.todos?.["1"]?.forced === true);
  check("--force-done records verified:false (not laundered into a pass)",
    r.state?.todos?.["1"]?.verified === false);
  check("--force-done records the reason", typeof r.state?.todos?.["1"]?.forced_reason === "string");
}

// --- THE DEADLOCK TRAP ------------------------------------------------------
// If the guard had been written against state.acceptance[id].pass instead of verify.history, it
// would deadlock: record-verify only sets acceptance[id].pass when todos[id].status === "done",
// and this guard blocks reaching "done". Nothing could ever complete. Asserting the real
// sequence works end-to-end is what proves we broke the circle rather than closed it.
{
  const repo = makeRepo([{ todo_id: "1", criterion_index: 0, passed: true, exit_code: 0 }]);
  const st = JSON.parse(readFileSync(join(repo, ".zcode", "state", "t.json"), "utf8"));
  check("precondition: acceptance[] is empty before done", !st.acceptance || !st.acceptance["1"]);
  const r = run(repo, "1", "done");
  check("verify → done completes without acceptance[] being pre-populated", r.code === 0);
}

// --- completeness: "some criteria passed" is not "verified" ------------------
//
// Round 3 reached `done` with acceptance {pass:false, criteria_run:1, criteria_declared:4}. The
// old guard accepted any todo with >=1 passing record and no failures, so three quarters of the
// exam went unwritten and the run finished anyway. The state file said so; the gate wasn't reading
// it. Now the plan's declared criteria count is the denominator — the same source record-verify
// uses for acceptance[].pass, so the two cannot disagree.
{
  const repo = mkdtempSync(join(tmpdir(), "zod-todo-c-"));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
  const planPath = join(repo, ".zcode", "plans", "t.md");
  writeFileSync(planPath,
    "# t\n\n## Todos\n\n- [ ] 1. go\n  - Files: [`a.js`]\n  - Acceptance criteria:\n" +
    "    - `npm test` exits 0\n    - `node --check a.js` exits 0\n    - `npm run lint` exits 0\n\n" +
    "## Final verification wave\n");
  const write = (hist) => writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify({
    slug: "t", phase: "verify", plan_path: planPath, todos: {},
    verify: { total: hist.length, passed: hist.length, failed: 0, flaky: 0, history: hist },
  }, null, 2));

  write([{ todo_id: "1", criterion_index: 0, passed: true, exit_code: 0 }]);
  let r = run(repo, "1", "done");
  check("REFUSES done with 1 of 3 declared criteria verified", r.code === 7, `(exit ${r.code})`);
  check("...and says how many are missing", /1 of 3/.test(r.err), r.err.slice(0, 120));

  write([0, 1].map((i) => ({ todo_id: "1", criterion_index: i, passed: true, exit_code: 0 })));
  check("still REFUSES at 2 of 3", run(repo, "1", "done").code === 7);

  write([0, 1, 2].map((i) => ({ todo_id: "1", criterion_index: i, passed: true, exit_code: 0 })));
  r = run(repo, "1", "done");
  check("ALLOWS done once all 3 are verified", r.code === 0, `(exit ${r.code}) ${r.err.slice(0, 160)}`);

  // Re-running the same criterion must not count as covering a different one.
  write([0, 0, 0].map(() => ({ todo_id: "1", criterion_index: 0, passed: true, exit_code: 0 })));
  check("re-running ONE criterion 3x does not satisfy 3 declared", run(repo, "1", "done").code === 7);
}
{
  // Unreadable plan → keep the old >=1-passing floor rather than blocking every run.
  const repo = makeRepo([{ todo_id: "1", criterion_index: 0, passed: true, exit_code: 0 }]);
  check("no plan → falls back to the >=1-passing floor", run(repo, "1", "done").code === 0);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
