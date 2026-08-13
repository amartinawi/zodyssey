#!/usr/bin/env node
// recall-corrections.test.mjs — unit tests for recall-corrections.mjs.
//
// Black-box subprocess tests (no internal imports — mirrors how
// lint-untrusted.test.mjs drives lint-untrusted.mjs as a spawned script).
// Each case builds its OWN temp repo via mkdtempSync, populates
// <tmp>/.zcode/state/<slug>.json with crafted content, spawns the script,
// captures {code, stdout, stderr}, then tears the temp dir down in a finally.
//
// Covers the seven required cases (a)-(g) from the correction-signal-capture
// plan, todo 3:
//   (a) HAPPY        — one failed verify.history + one REJECT review.history
//                      → both signals print (criterion + blocker text), exit 0.
//   (b) ABSENT STORE — temp repo with no .zcode/state/ → exit 3, stdout empty,
//                      first-run message on stderr only.
//   (c) MALFORMED    — one garbage state.json + one valid-with-signal → garbage
//                      skipped with a stderr warning, valid signal still prints,
//                      exit 0, no crash.
//   (d) NO ACTIVE RUN — state.json with no `phase` field → still read & printed,
//                      no phase dependency, exit 0.
//   (e) BACKWARD-COMPAT — state.json with no verify/review keys → exit 0, no throw.
//   (f) TOP-K BOUND  — single state.json with 8 distinct failed verify entries
//                      → stdout prints EXACTLY K=5 signal items + truncation footer.
//   (g) NO ARG       — zero args → exit 2 + usage on stderr.
//
// Run:  node recall-corrections.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const RC = join(SCRIPT_DIR, "recall-corrections.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  \u2713 ${name}`); pass++; }
  else { console.log(`  \u2717 ${name} ${detail}`); fail++; }
}

// Spawn recall-corrections.mjs against a fresh temp repo. `setup(dir)` runs after
// <dir>/.zcode/state/ is created and may write state files; pass `null` to leave
// the state dir absent. `args` overrides the default `[dir]` argv (e.g. `[]` for
// the no-arg case). Returns {code, stdout, stderr}.
//
// NOTE: we use spawnSync (not execFileSync) deliberately. execFileSync only
// surfaces stderr on its THROWN error object — on the success path (exit 0)
// stderr is discarded. Case (c) emits its "skipping malformed state" warning on
// stderr while the script STILL exits 0, so that stderr must be captured on a
// success path. spawnSync returns {status, stdout, stderr} uniformly regardless
// of exit code, which is exactly the {code, stdout, stderr} shape the harness
// needs. The harness conventions (pass/fail/check, mkdtemp/rmSync, final exit)
// are otherwise unchanged from lint-untrusted.test.mjs.
function runRepo({ setup, args } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "zod-rc-test-"));
  let code = 0, stdout = "", stderr = "";
  try {
    if (setup) {
      mkdirSync(join(dir, ".zcode", "state"), { recursive: true });
      setup(dir);
    }
    const cliArgs = args ?? [dir];
    const res = spawnSync("node", [RC, ...cliArgs], { encoding: "utf8", stdio: "pipe" });
    code = res.status ?? 1;
    stdout = res.stdout ?? "";
    stderr = res.stderr ?? "";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { code, stdout, stderr };
}

// Helpers to write state files into the temp repo's .zcode/state/.
function writeState(dir, slug, obj) {
  writeFileSync(join(dir, ".zcode", "state", `${slug}.json`), JSON.stringify(obj));
}
function writeStateRaw(dir, slug, text) {
  writeFileSync(join(dir, ".zcode", "state", `${slug}.json`), text);
}

console.log("recall-corrections.mjs unit tests\n");

// --- (a) HAPPY — one failed verify + one REJECT-with-blockers → both print, exit 0 ---
{
  const criterion = "npm test must exit 0";
  const blocker = "scope creep detected in files list";
  const { code, stdout } = runRepo({
    setup: (dir) => writeState(dir, "alpha-run", {
      slug: "alpha-run",
      phase: "verify",
      verify: {
        history: [
          { passed: false, status: "failed", criterion, todo_id: "2", at: "2026-08-01T00:00:00Z" },
        ],
      },
      review: {
        history: [
          { round: 1, verdict: "REJECT", blockers: [blocker], at: "2026-08-01T00:00:00Z" },
        ],
      },
    }),
  });
  check("(a) happy → exit 0", code === 0, `(got exit ${code})`);
  check("(a) happy → stdout contains the verify criterion text",
    stdout.includes(criterion), `(stdout: ${stdout.slice(0, 200)})`);
  check("(a) happy → stdout contains the reject blocker text",
    stdout.includes(blocker), `(stdout: ${stdout.slice(0, 200)})`);
  check("(a) happy → top-K not triggered (2 found, K=5; no 'showing top')",
    !/showing top/.test(stdout), `(unexpected truncation: ${stdout.slice(0, 200)})`);
}

// --- (b) ABSENT STORE — no .zcode/state/ → exit 3, no stdout noise, stderr msg ---
{
  const { code, stdout, stderr } = runRepo({ setup: null });
  check("(b) absent store → exit 3", code === 3, `(got exit ${code})`);
  check("(b) absent store → no stdout noise", stdout === "",
    `(stdout was not empty: ${JSON.stringify(stdout.slice(0, 120))})`);
  check("(b) absent store → first-run message on stderr",
    /first run|no run state/i.test(stderr), `(stderr: ${stderr.slice(0, 160)})`);
}

// --- (c) MALFORMED — garbage file skipped with warning, valid signal still prints ---
{
  const criterion = "lint must pass";
  const { code, stdout, stderr } = runRepo({
    setup: (dir) => {
      writeStateRaw(dir, "garbage-run", "{not json");
      writeState(dir, "good-run", {
        slug: "good-run",
        phase: "verify",
        verify: {
          history: [{ passed: false, status: "failed", criterion, todo_id: "1" }],
        },
      });
    },
  });
  check("(c) malformed skipped → exit 0", code === 0, `(got exit ${code})`);
  check("(c) malformed skipped → stderr warning names the bad file",
    /skipping malformed state.*garbage-run/.test(stderr),
    `(stderr: ${stderr.slice(0, 200)})`);
  check("(c) malformed skipped → valid signal still prints",
    stdout.includes(criterion), `(stdout: ${stdout.slice(0, 200)})`);
  check("(c) malformed skipped → no crash (no SyntaxError / stack leak)",
    !/SyntaxError|node:internal|\n {4}at /.test(stderr),
    `(stderr had crash shape: ${stderr.slice(0, 200)})`);
}

// --- (d) NO ACTIVE RUN — state.json omits phase → still read & printed, exit 0 ---
{
  const criterion = "build must pass";
  const { code, stdout } = runRepo({
    setup: (dir) => writeState(dir, "no-phase-run", {
      slug: "no-phase-run",
      // NOTE: no `phase` field — proves there is no active-run dependency.
      verify: {
        history: [{ passed: false, status: "failed", criterion, todo_id: "3" }],
      },
    }),
  });
  check("(d) no phase field → exit 0 (no active-run dependency)", code === 0,
    `(got exit ${code})`);
  check("(d) no phase field → signal still prints", stdout.includes(criterion),
    `(stdout: ${stdout.slice(0, 200)})`);
}

// --- (e) BACKWARD-COMPAT — no verify/review keys → exit 0, no throw ---
{
  const { code, stdout, stderr } = runRepo({
    setup: (dir) => writeState(dir, "old-run", {
      slug: "old-run",
      phase: "final",
      // old / minimal run shape — no verify, no review keys at all.
    }),
  });
  check("(e) no verify/review keys → exit 0, no throw", code === 0,
    `(got exit ${code}, stderr: ${stderr.slice(0, 160)})`);
  check("(e) no verify/review keys → no signal printed",
    !/\[(verify-fail|reject-blockers)/.test(stdout),
    `(unexpected signal in stdout: ${stdout.slice(0, 200)})`);
}

// --- (f) TOP-K BOUND — 8 distinct failed verify entries → exactly K=5 items + footer ---
{
  const history = [];
  for (let i = 0; i < 8; i++) {
    history.push({
      passed: false,
      status: "failed",
      criterion: `criterion-number-${i}`,
      todo_id: String(i + 1),
    });
  }
  const { code, stdout } = runRepo({
    setup: (dir) => writeState(dir, "many-runs", {
      slug: "many-runs",
      phase: "verify",
      verify: { history },
    }),
  });
  // Count the per-signal header lines (each item emits exactly one
  // "  [verify-fail …" / "  [reject-blockers …" line); the "criterion:" sub-line
  // is indented further and is not a signal-item line.
  const itemCount =
    (stdout.match(/^  \[(verify-fail|reject-blockers)/gm) || []).length;
  check("(f) top-K bound → exit 0", code === 0, `(got exit ${code})`);
  check("(f) top-K bound → exactly 5 signal items printed",
    itemCount === 5, `(got ${itemCount} item header lines)`);
  check("(f) top-K bound → truncation footer present (showing 5 of 8)",
    /showing 5 of 8/.test(stdout), `(stdout tail: ${stdout.slice(-200)})`);
}

// --- (g) NO ARG — zero args → exit 2 + usage on stderr ---
{
  const { code, stdout, stderr } = runRepo({ setup: null, args: [] });
  check("(g) no arg → exit 2", code === 2, `(got exit ${code})`);
  check("(g) no arg → usage on stderr", /usage:/.test(stderr),
    `(stderr: ${stderr.slice(0, 160)})`);
  check("(g) no arg → no stdout noise", stdout === "",
    `(stdout was not empty: ${JSON.stringify(stdout.slice(0, 120))})`);
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
