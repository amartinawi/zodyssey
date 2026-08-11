#!/usr/bin/env node
// regression-gate.test.mjs — pass-to-pass, plus the two ways a gate like this gets switched off.
//
// `docs/MEASUREMENT.md` listed "no regressions introduced" as a quality target with nothing behind
// it: the pipeline never ran the repo's pre-existing suite, before or after. F1 checks which FILES
// changed; verify runs the todo's OWN criteria (written by the planner). Neither can see a change
// that satisfied its criteria while breaking unrelated work.
//
// The two failure modes that matter as much as the happy path:
//   · a suite that was ALREADY RED before the run must never be blamed on the run;
//   · a repo with no test command must not be blocked from finishing.
// A gate that gets either wrong is one that gets disabled, and a disabled gate protects nothing.
//
// Run:  node regression-gate.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = join(new URL(".", import.meta.url).pathname, "regression-gate.mjs");
const SET_PHASE = join(new URL(".", import.meta.url).pathname, "set-phase.mjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

const cleanup = [];
// `testExit` controls whether the fake suite passes. Flipping the marker file between snapshot and
// check is how we simulate "the change broke something".
function makeRepo({ withToolchain = true } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "zod-rg-"));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  // A "suite" that fails iff BROKEN exists. No framework, no network, deterministic.
  writeFileSync(join(repo, "suite.mjs"),
    `import { existsSync } from "node:fs";\n` +
    `if (existsSync(new URL("./BROKEN", import.meta.url))) { console.log("not ok 1 thing-that-worked"); process.exit(1); }\n` +
    `console.log("ok 1 thing-that-worked"); process.exit(0);\n`);
  if (withToolchain) {
    writeFileSync(join(repo, ".zcode", "toolchain.json"),
      JSON.stringify({ test_runner: "node-test", test_cmd: `node ${join(repo, "suite.mjs")}`, bare: false }));
  }
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify({
    slug: "t", phase: "execute", updated_at: new Date().toISOString(),
    review: { verdict: "OKAY", round: 1, max_rounds: 3 },
  }, null, 2));
  return repo;
}
const gate = (repo, mode) => {
  const r = spawnSync(process.execPath, [SCRIPT, repo, "t", mode], { encoding: "utf8" });
  let state = null;
  try { state = JSON.parse(readFileSync(join(repo, ".zcode", "state", "t.json"), "utf8")); } catch {}
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), state };
};
const breakIt = (repo) => writeFileSync(join(repo, "BROKEN"), "x");

console.log("regression-gate.mjs — pass-to-pass\n");

// --- the regression it exists to catch ---------------------------------------
{
  const repo = makeRepo();
  const snap = gate(repo, "--snapshot");
  check("snapshot records a GREEN baseline", snap.state?.regression?.baseline?.green === true, `(${snap.out.trim()})`);

  breakIt(repo); // the "change" breaks previously-passing work
  const chk = gate(repo, "--check");
  check("check FAILS when a green suite goes red", chk.code === 8, `(exit ${chk.code})`);
  check("records status=regressed", chk.state?.regression?.status === "regressed");
  check("names the newly failing test", (chk.state?.regression?.new_failures || []).some((f) => /thing-that-worked/.test(f)),
    `(${JSON.stringify(chk.state?.regression?.new_failures)})`);
}

// --- no regression: the suite stays green ------------------------------------
{
  const repo = makeRepo();
  gate(repo, "--snapshot");
  const chk = gate(repo, "--check");
  check("check PASSES when the suite stays green", chk.code === 0);
  check("records ok:true", chk.state?.regression?.ok === true);
}

// --- an ALREADY-RED suite is not this run's fault -----------------------------
{
  const repo = makeRepo();
  breakIt(repo);                       // red BEFORE the run starts
  const snap = gate(repo, "--snapshot");
  check("snapshot records a RED baseline", snap.state?.regression?.baseline?.green === false);
  const chk = gate(repo, "--check");
  check("check does NOT fail on inherited breakage", chk.code === 0, `(exit ${chk.code})`);
  check("...and says so rather than claiming success", /already RED|no pass-to-pass claim/i.test(chk.out));
}

// --- no test command: inert, never blocking ----------------------------------
{
  const repo = makeRepo({ withToolchain: false });
  const snap = gate(repo, "--snapshot");
  check("no toolchain → inert, exit 0", snap.code === 0);
  check("records status=inert", snap.state?.regression?.status === "inert");
  const chk = gate(repo, "--check");
  check("check also inert without a toolchain", chk.code === 0);
}

// --- no baseline: cannot compare, must not invent a verdict ------------------
{
  const repo = makeRepo();
  const chk = gate(repo, "--check"); // --check without a prior --snapshot
  check("check without a baseline is inert, not a pass or a fail", chk.code === 0);
  check("records no-baseline", chk.state?.regression?.status === "no-baseline");
}

// --- the gate is wired into `done` -------------------------------------------
{
  const repo = makeRepo();
  gate(repo, "--snapshot");
  breakIt(repo);
  gate(repo, "--check"); // status=regressed
  // Satisfy the other `done` preconditions so regression is the ONLY thing blocking.
  const sp = join(repo, ".zcode", "state", "t.json");
  const st = JSON.parse(readFileSync(sp, "utf8"));
  st.phase = "final";
  st.final = { verdict: "pass" };
  writeFileSync(sp, JSON.stringify(st, null, 2));
  const r = spawnSync(process.execPath, [SET_PHASE, repo, "t", "done"], { encoding: "utf8" });
  check("set-phase done is BLOCKED by a recorded regression", r.status !== 0, `(exit ${r.status})`);
  check("...and explains why", /regress/i.test((r.stdout || "") + (r.stderr || "")));
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
