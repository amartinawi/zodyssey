#!/usr/bin/env node
// final-artifact-and-acceptance.test.mjs — findings C and D from the first end-to-end shakedown.
//
// C — NO TRUSTED WRITER FOR F2/F4. `.zcode/reviews/` is deliberately not bookkeeping, so no agent
//   can Write there; that is what makes a review artifact unforgeable. The review lane has had
//   record-momus-artifact.mjs since W7-2. The final wave never got an equivalent, so
//   record-final-wave demanded artifacts from a directory nothing in the toolchain could write.
//   The shakedown had to place them out-of-band through an MCP terminal.
//
//   Plus the NONCE ECONOMY bug the same run hit: F2/F4 nonces are one-time and were consumed even
//   when F1 had already failed, so fixing a trivial F1 problem (stray untracked files from an MCP
//   tool) required re-dispatching both reviewers purely to mint replacements.
//
// D — acceptance[id].pass WAS ALWAYS FALSE. It was gated on `todos[id].status === 'done'`, which
//   closed a real mid-verify race but used the wrong proxy: the natural order is verify-then-done,
//   so every successfully verified todo recorded pass:false. The shakedown saw verify.history 4/4
//   passed, todos.verified true, acceptance.pass false. A field that is always false is worse than
//   an absent one — a resuming orchestrator reads it as "not accepted" and redoes finished work.
//
// Run:  node final-artifact-and-acceptance.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const S = new URL(".", import.meta.url).pathname;
const HOOK = join(S, "..", "hooks", "pre-tool.mjs");
const sc = (n) => join(S, n);

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const node = (...a) => spawnSync(process.execPath, a, { encoding: "utf8" });
const git = (r, ...a) => spawnSync("git", ["-C", r, ...a], { encoding: "utf8" });

const cleanup = [];
function makeRun({ phase = "final", criteria = 2 } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "zod-fa-"));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.js"), "export const a = 1;\n");
  git(repo, "init", "-q"); git(repo, "config", "user.email", "t@t.t"); git(repo, "config", "user.name", "t");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
  const sha = git(repo, "rev-parse", "HEAD").stdout.trim();

  const crits = ["- `node --check src/a.js` exits 0", "- `node -e \"process.exit(0)\"` exits 0"].slice(0, criteria);
  const planPath = join(repo, ".zcode", "plans", "t.md");
  writeFileSync(planPath,
    `# t\n\n## Todos\n\n- [ ] 1. go\n  - Files: [\`src/a.js\`]\n  - Acceptance criteria:\n${crits.map((c) => "    " + c).join("\n")}\n\n## Final verification wave\n`);
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify({
    slug: "t", phase, updated_at: new Date().toISOString(), plan_path: planPath, run_start_sha: sha,
    review: { verdict: "OKAY", round: 1, max_rounds: 3 },
  }, null, 2));
  return repo;
}
const state = (r) => JSON.parse(readFileSync(join(r, ".zcode", "state", "t.json"), "utf8"));
const dispatch = (repo, agent) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ tool_name: "Task", tool_input: { subagent_type: agent, prompt: "review" } }),
  encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ZODYSSEY_UNGATE_BASH: "" },
});

console.log("record-final-artifact + acceptance completeness\n");

// --- C: the trusted writer ---------------------------------------------------
{
  const repo = makeRun();
  dispatch(repo, "feature-dev:code-reviewer");
  const nonce = state(repo).final_f2?.pending_nonce?.nonce;
  check("hook mints an F2 nonce", !!nonce);

  const r = node(sc("record-final-artifact.mjs"), repo, "t", "F2", "--nonce", nonce);
  // stdin closed → should refuse rather than write an empty artifact
  check("refuses with no verdict on stdin and no --from", r.status === 6, `(exit ${r.status})`);

  mkdirSync(join(repo, ".zcode", "staging"), { recursive: true });
  const src = join(repo, ".zcode", "staging", "f2.json");
  writeFileSync(src, JSON.stringify({ verdict: "APPROVE", findings: [] }));
  const w = node(sc("record-final-artifact.mjs"), repo, "t", "F2", "--nonce", nonce, "--from", src);
  const artifact = (w.stdout || "").trim();
  check("writes the F2 artifact under .zcode/reviews/", w.status === 0 && existsSync(artifact) && artifact.includes("/.zcode/reviews/"),
    `(exit ${w.status}) ${w.stderr.slice(0, 160)}`);
  check("stamps provenance", (() => {
    try { return !!JSON.parse(readFileSync(artifact, "utf8"))._provenance?.nonce; } catch { return false; }
  })());
}
{
  // Fail fast on a verdict the gate would reject anyway — refusing here costs nothing, refusing
  // at the gate costs a one-time nonce.
  const repo = makeRun();
  dispatch(repo, "feature-dev:code-reviewer");
  mkdirSync(join(repo, ".zcode", "staging"), { recursive: true });
  const src = join(repo, ".zcode", "staging", "f2.json");
  writeFileSync(src, JSON.stringify({ notes: "looked fine to me" }));
  check("refuses an artifact with no recognizable verdict",
    node(sc("record-final-artifact.mjs"), repo, "t", "F2", "--from", src).status === 6);

  writeFileSync(src, JSON.stringify({ verdict: "LGTM" }));
  check("refuses an unrecognized verdict value (not an approval)",
    node(sc("record-final-artifact.mjs"), repo, "t", "F2", "--from", src).status === 6);
}
{
  const repo = makeRun();
  dispatch(repo, "feature-dev:code-reviewer");
  mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
  const staged = join(repo, ".zcode", "plans", "sneaky.json");
  writeFileSync(staged, JSON.stringify({ verdict: "APPROVE" }));
  check("SEC-6 parity: refuses --from under plans/ (planner-writable)",
    node(sc("record-final-artifact.mjs"), repo, "t", "F2", "--from", staged).status === 6);
}
{
  const repo = makeRun();
  check("rejects an item that is not F2/F4", node(sc("record-final-artifact.mjs"), repo, "t", "F1").status === 2);
}

// --- C: nonce economy — a failed F1 must not burn the F2/F4 nonces -----------
{
  const repo = makeRun();
  // Make F1 fail: touch a file the plan never declared.
  writeFileSync(join(repo, "src", "stray.js"), "// out of scope\n");
  writeFileSync(join(repo, "src", "a.js"), "export const a = 2;\n");
  for (const agent of ["feature-dev:code-reviewer", "zodyssey:oracle"]) dispatch(repo, agent);
  const before = { f2: state(repo).final_f2?.pending_nonce?.nonce, f4: state(repo).final_f4?.pending_nonce?.nonce };
  check("both nonces minted", !!before.f2 && !!before.f4);

  mkdirSync(join(repo, ".zcode", "staging"), { recursive: true });
  const mk = (item) => {
    const p = join(repo, ".zcode", "staging", `${item}.json`);
    writeFileSync(p, JSON.stringify({ verdict: "APPROVE" }));
    return (node(sc("record-final-artifact.mjs"), repo, "t", item, "--from", p).stdout || "").trim();
  };
  const f2 = mk("F2"), f4 = mk("F4");
  const f3 = join(repo, ".zcode", "qa.md");
  writeFileSync(f3, "- [ ] check it\n");

  const fw = node(sc("record-final-wave.mjs"), repo, "t",
    "--f2-artifact", f2, "--f2-nonce", before.f2, "--f3-checklist", f3, "--f4-artifact", f4, "--f4-nonce", before.f4);
  const res = state(repo).final?.results || {};
  check("F1 fails on the out-of-scope file", res.F1?.passed === false, `(exit ${fw.status})`);
  check("F2 reported as not evaluated", res.F2?.not_evaluated === true, JSON.stringify(res.F2));
  check("F4 reported as not evaluated", res.F4?.not_evaluated === true, JSON.stringify(res.F4));
  check("the run still fails overall (no weakening)", state(repo).final?.verdict !== "pass");

  const after = { f2: state(repo).final_f2?.pending_nonce?.nonce, f4: state(repo).final_f4?.pending_nonce?.nonce };
  check("F2 nonce SURVIVES a failed F1 (no re-dispatch needed)", after.f2 === before.f2, `(${before.f2} -> ${after.f2})`);
  check("F4 nonce SURVIVES a failed F1", after.f4 === before.f4);

  // ...and the retry works with the SAME nonces once F1 is fixed.
  rmSync(join(repo, "src", "stray.js"));
  const retry = node(sc("record-final-wave.mjs"), repo, "t",
    "--f2-artifact", f2, "--f2-nonce", before.f2, "--f3-checklist", f3, "--f4-artifact", f4, "--f4-nonce", before.f4);
  check("retry passes with the ORIGINAL nonces", state(repo).final?.verdict === "pass",
    `(exit ${retry.status}) ${JSON.stringify(state(repo).final?.results).slice(0, 300)}`);
}

// --- D: acceptance completeness ---------------------------------------------
{
  const repo = makeRun({ phase: "verify", criteria: 2 });
  const v = (n, crit) => node(sc("record-verify.mjs"), repo, "t", "1", "--criterion", crit, "--n", String(n));

  v(1, "node --check src/a.js");
  const mid = state(repo).acceptance?.["1"];
  check("pass is FALSE after only 1 of 2 criteria (the race stays closed)", mid?.pass === false,
    JSON.stringify(mid));
  check("records how many ran vs how many the plan declares",
    mid?.criteria_run === 1 && mid?.criteria_declared === 2, JSON.stringify(mid));

  v(2, 'node -e "process.exit(0)"');
  const done = state(repo).acceptance?.["1"];
  check("pass is TRUE once ALL declared criteria pass — WITHOUT the todo being marked done",
    done?.pass === true, JSON.stringify(done));
  check("todo is still not done at that point",
    (state(repo).todos?.["1"]?.status || null) !== "done");
}
{
  // A failing criterion must not be laundered into a pass by completeness.
  const repo = makeRun({ phase: "verify", criteria: 2 });
  node(sc("record-verify.mjs"), repo, "t", "1", "--criterion", "node --check src/a.js", "--n", "1");
  node(sc("record-verify.mjs"), repo, "t", "1", "--criterion", "node -e \"process.exit(3)\"", "--n", "2");
  check("pass is FALSE when a criterion failed, even with all of them run",
    state(repo).acceptance?.["1"]?.pass === false, JSON.stringify(state(repo).acceptance?.["1"]));
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
