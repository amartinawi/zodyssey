#!/usr/bin/env node
// set-phase.regression-wiring.test.mjs — the last zero-caller check gets its invoke: the
// `done` transition runs regression-gate.mjs --check.
//
// WHY THIS EXISTS (item 24): B8 shipped the regression gate half-wired. --snapshot runs from
// two sites, `set-phase … done` carries refusal clauses for `regressed` and `toolchain-drift`
// (set-phase.mjs:131, :137), but --check — the ONLY writer of either value — had zero code
// callers, so the comparison never ran and both clauses guarded a field nothing sets. The
// README's enforcement table carried it as its one ⚠️ row. This suite asserts the wiring the
// way set-phase.check-wiring.test.mjs asserted item 02's three checks: invoke (the done
// transition runs --check), record (the state lane is written), consume (the done refusal
// reads it) — all three sides together, because half-wirings pass single-sided tests.
//
// The paired direction (case D): with set-phase.mjs's done-entry invoke reverted, case A
// fails — `done` succeeds with st.regression.status still `baselined`, exactly the silent
// pass the half-wiring shipped with.
//
// Gate-vs-inert, as asserted here:
//   · baseline GREEN + suite now RED      → `done` REFUSES (status `regressed`) — the gate.
//   · baseline GREEN + suite still GREEN  → `done` succeeds (status `ok`).
//   · no regression lane at all           → `done` succeeds (`no-baseline`, never a block —
//     the gate must not wedge a run it cannot evaluate; regression-gate's own suite covers
//     the inert/toolchain-drift lanes).
//
// Run:  node set-phase.regression-wiring.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const S = new URL(".", import.meta.url).pathname;
const SET_PHASE = join(S, "set-phase.mjs");
const SET_PHASE_SRC = readFileSync(SET_PHASE, "utf8");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const cleanup = [];
process.on("exit", () => { for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} } });

// A minimal run repo: toolchain.json whose test_cmd is a sentinel-driven script (green unless
// red.flag exists), and a state file one precondition away from done (OKAY + final pass),
// carrying a GREEN regression baseline over the CURRENT toolchain sha.
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "zod-regwiring-"));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  const suite = join(repo, "suite.mjs");
  writeFileSync(suite, "import { existsSync } from \"node:fs\";\nprocess.exit(existsSync(process.argv[2]) ? 1 : 0);\n");
  writeFileSync(join(repo, ".zcode", "toolchain.json"), JSON.stringify({ test_cmd: `node ${suite} ${join(repo, "red.flag")}` }));
  const state = {
    slug: "r", phase: "final", intent: "standard", updated_at: new Date().toISOString(),
    review: { verdict: "OKAY", round: 1 },
    final: { verdict: "pass", at: new Date().toISOString() },
    todos: { "1": { status: "done" } },
    regression: {
      status: "baselined",
      toolchain_sha256: null, // filled below
      baseline: { exit_code: 0, timed_out: false, failures: [], at: new Date().toISOString(), green: true, cmd: "node suite" },
      at: new Date().toISOString(),
    },
  };
  const stPath = join(repo, ".zcode", "state", "r.json");
  const sha = spawnSync("node", ["-e",
    `console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(${JSON.stringify(join(repo, ".zcode", "toolchain.json"))})).digest("hex"))`,
  ], { encoding: "utf8" }).stdout.trim();
  state.regression.toolchain_sha256 = sha;
  writeFileSync(stPath, JSON.stringify(state, null, 2));
  return repo;
}

const doneResult = (repo) => spawnSync("node", [SET_PHASE, repo, "r", "done"],
  { encoding: "utf8", timeout: 120_000 });
const readState = (repo) => JSON.parse(readFileSync(join(repo, ".zcode", "state", "r.json"), "utf8"));

console.log("regression-wiring: the done transition must run --check and honor its verdict");

// (A) THE GATE — baseline green, suite red now → done refuses, status regressed.
{
  const repo = makeRepo();
  writeFileSync(join(repo, "red.flag"), "x");
  const r = doneResult(repo);
  const st = readState(repo);
  check("A1 done REFUSES when the suite regressed", r.status !== 0, `exit ${r.status}`);
  check("A2 refusal names the regression", /passed before this run and fails now/.test(r.stdout + r.stderr), "");
  check("A3 status lane recorded (regressed)", st.regression && st.regression.status === "regressed", JSON.stringify(st.regression && st.regression.status));
  check("A4 phase still final (not done)", st.phase === "final", st.phase);
  check("A5 the after-run was recorded", !!(st.regression && st.regression.after), "");
}

// (B) PASS-THROUGH — baseline green, suite green → done succeeds, status ok.
{
  const repo = makeRepo();
  const r = doneResult(repo);
  const st = readState(repo);
  check("B1 done succeeds when the suite is still green", r.status === 0, `exit ${r.status}: ${(r.stdout + r.stderr).slice(0, 200)}`);
  check("B2 status lane recorded (ok)", st.regression && st.regression.status === "ok", JSON.stringify(st.regression && st.regression.status));
  check("B3 phase advanced to done", st.phase === "done", st.phase);
}

// (C) NO LANE — a run with no regression record at all → done succeeds (no-baseline never blocks).
{
  const repo = makeRepo();
  const stPath = join(repo, ".zcode", "state", "r.json");
  const st = JSON.parse(readFileSync(stPath, "utf8"));
  delete st.regression;
  writeFileSync(stPath, JSON.stringify(st, null, 2));
  const r = doneResult(repo);
  const st2 = readState(repo);
  check("C1 done succeeds with no baseline (no-baseline)", r.status === 0, `exit ${r.status}`);
  check("C2 lane written as no-baseline, never a block", st2.regression && st2.regression.status === "no-baseline", JSON.stringify(st2.regression && st2.regression.status));
}

// (D) SOURCE-SHAPE — the invoke is wired at the done entry (the paired probe: revert it and
// A goes red with a silent pass). Matches the check-wiring suite's precedent of pinning the
// wiring shape against accidental removal.
{
  check("D1 done entry invokes regression-gate --check",
    /phase === "done"[\s\S]{0,400}regression-gate\.mjs[\s\S]{0,200}--check/.test(SET_PHASE_SRC),
    "the done-entry invoke block was not found in set-phase.mjs source");
  check("D2 state is re-read after the check (the refusal sees the fresh lane)",
    /--check[\s\S]{0,600}readFileSync\(statePath/.test(SET_PHASE_SRC),
    "no state re-read found after the --check invoke");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
