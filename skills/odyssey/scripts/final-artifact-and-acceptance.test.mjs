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
import { stampMarker } from "./lib/state-auth.mjs";

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
  // Deliberately CommonJS-compatible: `node --check` on a .js file with no package.json treats
  // it as CJS, so `export` is a syntax error on node 18 while node 22+ auto-detects module
  // syntax and passes. CI's node-18 leg caught that; a same-version-only run would not have.
  writeFileSync(join(repo, "src", "a.js"), "const a = 1;\n");
  git(repo, "init", "-q"); git(repo, "config", "user.email", "t@t.t"); git(repo, "config", "user.name", "t");
  git(repo, "add", "-A"); git(repo, "commit", "-qm", "base");
  const sha = git(repo, "rev-parse", "HEAD").stdout.trim();

  const crits = ["- `node --check src/a.js` exits 0", "- `node -e \"process.exit(0)\"` exits 0"].slice(0, criteria);
  const planPath = join(repo, ".zcode", "plans", "t.md");
  // v0.4.0: the plan carries a `## Capability routing` tri-state (F5 cross-checks it against
  // state.capabilities[]). Fixture default: routed to prompt-master AND observed — the happy path.
  writeFileSync(planPath,
    `# t\n\n## Capability routing\n- \`routed: skill:prompt-master\`\n- Evidence: fixture default routing.\n\n## Todos\n\n- [ ] 1. go\n  - Files: [\`src/a.js\`]\n  - Acceptance criteria:\n${crits.map((c) => "    " + c).join("\n")}\n\n## Final verification wave\n`);
  // v0.5.0: authenticated run discovery — an unmarked fixture state file is ignored by the hook.
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify(stampMarker({
    slug: "t", phase, updated_at: new Date().toISOString(), plan_path: planPath, run_start_sha: sha,
    review: { verdict: "OKAY", round: 1, max_rounds: 3 },
    // M5: a `routed:` capability must be observed at/after the plan exists — `execute` is the
    // realistic phase (the conductor loads the routed skill in the parent thread before dispatching).
    capabilities: [{ at: new Date().toISOString(), phase: "execute", capability: "skill:prompt-master", observed: true }],
  }, "t"), null, 2));
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
  writeFileSync(join(repo, "src", "a.js"), "const a = 2;\n");
  for (const agent of ["feature-dev:code-reviewer", "zodyssey:oracle"]) dispatch(repo, agent);
  const before = { f2: state(repo).final_f2?.pending_nonce?.nonce, f4: state(repo).final_f4?.pending_nonce?.nonce };
  check("both nonces minted", !!before.f2 && !!before.f4);

  mkdirSync(join(repo, ".zcode", "staging"), { recursive: true });
  // AUDIT-3 FINDING 2: this used to omit --nonce, which record-final-artifact silently tolerated —
  // the check was `if (nonceArg && pending && …)`, so no nonce meant no comparison, and a missing
  // pending nonce only warned. An artifact could be placed in .zcode/reviews/ with no reviewer
  // dispatch behind it at all. The nonce is now required, so the fixture passes it, which is also
  // what the real flow does.
  const mk = (item, nonce) => {
    const p = join(repo, ".zcode", "staging", `${item}.json`);
    writeFileSync(p, JSON.stringify({ verdict: "APPROVE" }));
    return (node(sc("record-final-artifact.mjs"), repo, "t", item, "--nonce", nonce, "--from", p).stdout || "").trim();
  };
  const f2 = mk("F2", before.f2), f4 = mk("F4", before.f4);

  // The tightened contract itself: each refusal is a separate way the old check fell open.
  {
    const p = join(repo, ".zcode", "staging", "nononce.json");
    writeFileSync(p, JSON.stringify({ verdict: "APPROVE" }));
    check("    F2 artifact WITHOUT --nonce is refused",
      node(sc("record-final-artifact.mjs"), repo, "t", "F2", "--from", p).status === 6);
    check("    F2 artifact with a WRONG nonce is refused",
      node(sc("record-final-artifact.mjs"), repo, "t", "F2", "--nonce", "not-the-nonce", "--from", p).status === 6);
  }
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

// --- F5 (v0.4.0): behavioral routing cross-check --------------------------------
// F5 cross-checks the plan's `## Capability routing` tri-state against state.capabilities[]
// (the hook-witnessed observed log). Each case asserts on res.F5 specifically — F1 may or may
// not pass in the fixture, which is irrelevant to the routing verdict.
{
  const setRouting = (repo, routingLine, caps) => {
    const planPath = join(repo, ".zcode", "plans", "t.md");
    const t = readFileSync(planPath, "utf8");
    writeFileSync(planPath, t.replace(
      /## Capability routing\n[^\n]*\n[^\n]*\n\n/,
      `## Capability routing\n${routingLine}\n- Evidence: test.\n\n`));
    const sp = join(repo, ".zcode", "state", "t.json");
    const s = JSON.parse(readFileSync(sp, "utf8"));
    s.capabilities = caps || [];
    writeFileSync(sp, JSON.stringify(s, null, 2));
  };
  const wave = (repo, extra = []) => {
    const f3 = join(repo, ".zcode", "staging", "f3.md");
    mkdirSync(join(repo, ".zcode", "staging"), { recursive: true });
    writeFileSync(f3, "checklist\n");
    const r = node(sc("record-final-wave.mjs"), repo, "t", "--f3-checklist", f3, "--skip", "F2,F4", "--skip-reason", "test fixture: isolating one F-item", ...extra);
    try { return JSON.parse(r.stdout).results; } catch { return { parse_error: (r.stdout || "").slice(0, 200), stderr: (r.stderr || "").slice(0, 200) }; }
  };
  // `execute` = a post-plan phase (M5: routed capabilities must be observed once the plan exists).
  const obs = (cap) => [{ at: new Date().toISOString(), phase: "execute", capability: cap, observed: true }];
  // consult PRECEDES the plan — legitimate for discovery, never for a routed capability.
  const obsConsult = (cap) => [{ at: new Date().toISOString(), phase: "consult", capability: cap, observed: true }];

  {
    const repo = makeRun();
    const res = wave(repo); // fixture default: routed prompt-master + observed
    check("F5 passes when the declared skill IS observed", res.F5?.passed === true, JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    const repo = makeRun();
    setRouting(repo, "- `routed: skill:aws-serverless`", obs("skill:prompt-master")); // wrong skill observed
    const res = wave(repo);
    check("F5 FAILS when the declared skill was never observed (declared-but-not-honored)", res.F5?.passed === false && /aws-serverless/.test(res.F5?.reason || ""), JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    const repo = makeRun();
    setRouting(repo, "- `routed: skill:aws-serverless`", obs("skill:aws-serverless"));
    const res = wave(repo);
    check("F5 passes with spacing normalized (`skill: aws-…` declaration vs `skill:aws-…` record)", res.F5?.passed === true, JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    const repo = makeRun();
    setRouting(repo, "- `discovered: find-skills`", obs("skill:find-skills"));
    const res = wave(repo);
    check("F5 passes for `discovered:` when skill:find-skills was observed", res.F5?.passed === true, JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    const repo = makeRun();
    setRouting(repo, "- `generic: no fitting skill`", []); // generic without a discovery attempt
    const res = wave(repo);
    check("F5 FAILS for `generic:` with NO find-skills observation (generic without trying)", res.F5?.passed === false && /find-skills/.test(res.F5?.reason || ""), JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    // audit M4: agent routing is now behaviorally verified — post-tool records the dispatch as an
    // observed `agent:<name>` capability. A declared agent WITH an observed dispatch passes.
    const repo = makeRun();
    setRouting(repo, "- `routed: agent:zodyssey:oracle`", obs("agent:zodyssey:oracle"));
    const res = wave(repo);
    check("F5 passes for `agent:` routing WITH an observed dispatch", res.F5?.passed === true, JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    // audit M4: agent routing declared but NEVER dispatched must FAIL (was a declaration-only pass).
    const repo = makeRun();
    setRouting(repo, "- `routed: agent:zodyssey:oracle`", []);
    const res = wave(repo);
    check("F5 FAILS for `agent:` routing with no observed dispatch", res.F5?.passed === false && /oracle/.test(res.F5?.reason || ""), JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    // audit M5: an observation from BEFORE the plan existed must NOT satisfy a `routed:` decision.
    // `consult` is the real pre-plan phase (a run is scaffolded at `plan`; prime/triage are not
    // state phases at all — filtering on those names was a no-op, caught in post-remediation review).
    const repo = makeRun();
    setRouting(repo, "- `routed: skill:aws-serverless`", obsConsult("skill:aws-serverless"));
    const res = wave(repo);
    check("F5 FAILS when the routed skill was only observed pre-plan (consult) — M5", res.F5?.passed === false, JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    // ...but discovery legitimately runs during consult, so `discovered:` still accepts it.
    const repo = makeRun();
    setRouting(repo, "- `discovered: find-skills`", obsConsult("skill:find-skills"));
    const res = wave(repo);
    check("F5 still passes for `discovered:` observed at consult (discovery's natural phase)", res.F5?.passed === true, JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    const repo = makeRun();
    setRouting(repo, "- `routed: mcp:codegraph`", obs("mcp__codegraph__explore"));
    const res = wave(repo);
    check("F5 prefix-matches MCP observations (`mcp:codegraph` vs `mcp__codegraph__explore`)", res.F5?.passed === true, JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    const repo = makeRun();
    // strip the routing section entirely (pre-0.4.0-shaped plan)
    const planPath = join(repo, ".zcode", "plans", "t.md");
    writeFileSync(planPath, readFileSync(planPath, "utf8").replace(/## Capability routing\n[^\n]*\n[^\n]*\n\n/, ""));
    const res = wave(repo);
    check("F5 FAILS when the routing section is absent (pre-0.4.0-shaped plan)", res.F5?.passed === false, JSON.stringify(res.F5)?.slice(0, 200));
  }
  {
    const repo = makeRun();
    const res = wave(repo, ["--skip", "F2,F4,F5", "--skip-reason", "test fixture: isolating one F-item"]);
    check("F5 is skippable (documented escape hatch)", res.F5?.skipped === true && res.F5?.passed === true, JSON.stringify(res.F5)?.slice(0, 200));
  }
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

{
  // (audit H1, 2026-08-25) bidirectional substring matching let a fabricated FRAGMENT count as a
  // declared criterion: "node --check" is a substring of "`node --check src/a.js` exits 0", and a
  // one-token invoke matched almost anything. Matching is equality-after-tail-strip now, so the
  // fragment is recorded but must NOT advance criteria_run nor flip pass.
  const repo = makeRun({ phase: "verify", criteria: 2 });
  const v = (n, crit, extra = []) => node(sc("record-verify.mjs"), repo, "t", "1", "--criterion", crit, "--n", String(n), ...extra);
  v(1, "node --check src/a.js");
  v(2, "node --check", ["--trust-argv", "--exit-code", "0"]);
  const acc = state(repo).acceptance?.["1"];
  check("a substring fragment of a declared criterion does NOT count as coverage",
    acc?.criteria_run === 1 && acc?.pass === false, JSON.stringify(acc));
  check("the fragment is flagged as undeclared", acc?.criteria_undeclared === 1, JSON.stringify(acc));
  // And the byte-exact full-text invocation still counts (the sanctioned discipline).
  v(2, "node -e \"process.exit(0)\"");
  check("the full declared text (tail-stripped) still completes coverage",
    state(repo).acceptance?.["1"]?.pass === true, JSON.stringify(state(repo).acceptance?.["1"]));
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
