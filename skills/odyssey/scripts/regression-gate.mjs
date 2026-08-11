#!/usr/bin/env node
// regression-gate.mjs — the pass-to-pass property: work that was passing before the run must
// still be passing after it.
//
// WHY: `docs/MEASUREMENT.md` has listed "no regressions introduced" as a quality target since it
// was written, with NOTHING behind it. Nothing in the pipeline ever ran the repo's pre-existing
// test suite — not before the change, not after. F1 checks which FILES were touched; verify runs
// the todo's OWN acceptance criteria (authored by the same planner). Neither can see that a
// change satisfied its criteria while breaking twelve unrelated tests.
//
// Ecosystem check (2026-08-11): no OSS orchestrator implements this — not omo, prime-agent,
// spec-kit, SWE-agent, Cline/Roo, or claude-flow. It is the canonical SWE-bench property
// (PASS_TO_PASS) and essentially absent from agent harnesses.
//
// DESIGN — deliberately coarse, and honest about it:
//   The enforceable signal is the SUITE-LEVEL exit code, not individual test names. Parsing test
//   names is runner-specific and brittle (the exact failure mode that made harness.mjs's sentinel
//   check rot). So:
//     · baseline passing (exit 0) + now failing  -> REGRESSION, hard fail.
//     · baseline already failing                 -> recorded, never fails the gate. A suite that
//       was red before the run is not this run's fault, and a gate that punishes inherited
//       breakage gets switched off within a day.
//     · no toolchain / no test command           -> inert no-op, exit 0.
//   Failing test NAMES are extracted best-effort for the message only. They never decide the
//   verdict, so a parser miss degrades the error text rather than the enforcement.
//
// Usage:
//   regression-gate.mjs <repo> <slug> --snapshot   # baseline, at phase->execute
//   regression-gate.mjs <repo> <slug> --check      # compare, at verify/final
//   exit: 0 ok (or inert) · 2 bad args · 3 no state · 8 REGRESSION

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { spawnSync } from "node:child_process";

const [repo, slug, ...rest] = argv.slice(2);
if (!repo || !slug) {
  console.error("usage: regression-gate.mjs <repo> <slug> --snapshot|--check");
  exit(2);
}
const mode = rest.includes("--snapshot") ? "snapshot" : rest.includes("--check") ? "check" : null;
if (!mode) { console.error("specify --snapshot or --check"); exit(2); }

const TIMEOUT_MS = (() => {
  const n = parseInt(process.env.ZODYSSEY_REGRESSION_TIMEOUT_MS || "600000", 10);
  return Number.isInteger(n) && n > 0 ? n : 600000;
})();

const statePath = join(repo, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) { console.error("no state file: " + statePath); exit(3); }

function loadToolchain() {
  const p = join(repo, ".zcode", "toolchain.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// Best-effort failing-test names, for the MESSAGE only — never for the verdict.
function extractFailures(output) {
  const names = new Set();
  const patterns = [
    /^\s*(?:✕|✗|×|FAIL|not ok \d+)\s+(.+?)\s*$/gm,   // jest / tap / vitest
    /^\s*(?:FAILED|ERROR)\s+(\S+)/gm,                 // pytest / unittest
    /^--- FAIL: (\S+)/gm,                             // go test
    /^\s*\d+\)\s+(.+?)\s*$/gm,                        // mocha numbered failures
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(output)) !== null) {
      const n = (m[1] || "").trim();
      if (n && n.length < 200) names.add(n);
      if (names.size > 50) return [...names];
    }
  }
  return [...names];
}

function runSuite(testCmd) {
  // shell:true because test_cmd is a command LINE from toolchain.json ("npm test", "go test ./...").
  // It is machine-derived by probe-toolchain.mjs from the repo's own config, not agent-authored,
  // so this is not an injection surface the way an agent-supplied criterion would be.
  const r = spawnSync(testCmd, {
    cwd: repo, shell: true, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 40 * 1024 * 1024,
  });
  const out = ((r.stdout || "") + "\n" + (r.stderr || "")).slice(-200000);
  return {
    exit_code: r.status === null ? -1 : r.status,
    timed_out: r.error && r.error.code === "ETIMEDOUT" || r.signal === "SIGTERM",
    failures: extractFailures(out),
    at: new Date().toISOString(),
  };
}

function writeState(mut) {
  const st = JSON.parse(readFileSync(statePath, "utf8"));
  mut(st);
  st.updated_at = new Date().toISOString();
  const tmp = statePath + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
  renameSync(tmp, statePath);
}

const tc = loadToolchain();
const testCmd = tc && typeof tc.test_cmd === "string" && tc.test_cmd.trim() ? tc.test_cmd.trim() : null;

// Inert when there is nothing to run. A repo with no test command is not a failing repo, and the
// gate must degrade honestly rather than block every run in a bare project.
if (!testCmd) {
  console.log("regression-gate: no toolchain test_cmd — inert (run probe-toolchain.mjs to enable)");
  writeState((st) => { st.regression = { status: "inert", reason: "no test_cmd in toolchain.json", at: new Date().toISOString() }; });
  exit(0);
}

if (mode === "snapshot") {
  const res = runSuite(testCmd);
  const baselineGreen = res.exit_code === 0;
  writeState((st) => {
    st.regression = {
      status: "baselined",
      baseline: { ...res, green: baselineGreen, cmd: testCmd },
      at: res.at,
    };
  });
  console.log(`regression-gate: baseline ${baselineGreen ? "GREEN" : `RED (exit ${res.exit_code}, ${res.failures.length} failure(s) parsed)`} via \`${testCmd}\``);
  if (!baselineGreen) {
    console.log("  the suite was already failing before this run — the gate will not hold this run responsible for it.");
  }
  exit(0);
}

// --check
const st0 = JSON.parse(readFileSync(statePath, "utf8"));
const baseline = st0.regression && st0.regression.baseline;
if (!baseline) {
  console.log("regression-gate: no baseline recorded (snapshot never ran) — cannot compare, inert");
  writeState((st) => { st.regression = { ...(st.regression || {}), status: "no-baseline", at: new Date().toISOString() }; });
  exit(0);
}

const after = runSuite(testCmd);
const regressed = baseline.green === true && after.exit_code !== 0;
const newFailures = after.failures.filter((f) => !(baseline.failures || []).includes(f));

writeState((st) => {
  st.regression = {
    ...(st.regression || {}),
    status: regressed ? "regressed" : "ok",
    ok: !regressed,
    after: { ...after, green: after.exit_code === 0 },
    new_failures: newFailures,
    at: after.at,
  };
});

if (regressed) {
  console.error(
    `REGRESSION: the suite passed before this run and fails now (\`${testCmd}\` exit ${after.exit_code}).\n` +
    (newFailures.length
      ? `  newly failing:\n${newFailures.slice(0, 20).map((f) => "    - " + f).join("\n")}\n`
      : "  (could not parse individual test names — see the suite output)\n") +
    `  The change satisfied its own acceptance criteria while breaking work that was already passing.\n` +
    `  Fix the regression; do not weaken the tests (F1's test-integrity guard will catch that).`
  );
  exit(8);
}

if (baseline.green === false) {
  console.log(`regression-gate: baseline was already RED — no pass-to-pass claim can be made. Recorded, not enforced.`);
} else {
  console.log(`regression-gate: OK — suite still green after the run (\`${testCmd}\`)`);
}
exit(0);
