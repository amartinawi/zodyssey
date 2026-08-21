#!/usr/bin/env node
// set-phase.eval-lane.test.mjs — synthetic runs must not write the operator's trend log (item 05).
//
// WHY THIS EXISTS: set-phase.mjs unconditionally appends every done|audited scorecard to the
// operator's live ~/.zcode/orchestration/eval/results.jsonl (CRIT-4a), with no notion of
// provenance — so the repo's own suite pollutes the corpus on every run (measured 2026-08-16:
// 159/190 = 83.7% synthetic; 387/91.2% by 2026-08-17 — the file compounds with every npm test).
// The fix routes DECLARED-synthetic runs (ZODYSSEY_EVAL_LANE=synthetic, exact match, set by the
// spawning fixture) to results.synthetic.jsonl. Real runs are bit-for-bit unchanged. The lane is
// a write destination, never a gate: a wrong-case or unset value means operator lane, and
// telemetry stays best-effort inside the transition.
//
// Every case runs under a hermetic HOME (mkdtemp) — which also pins the mkdir guard: the eval
// dir must not need to pre-exist (install.mjs created it on this machine; a fresh machine or
// hermetic test would silently degrade to the catch-and-warn that masks the behaviour under
// test).
//
// Cases: (a) default lane → operator file, one parseable record; (b) synthetic lane → synthetic
// file, operator file untouched; (c) lane value strictness — "Synthetic" behaves as operator;
// (d) cap twin — capJsonl caps whichever lane file was written (source-order assertion + the
// criterion-8 tripwire); (e) audited routes by the same lane rule; (f) a REFUSED done (recorded
// regression) appends to neither lane — the lane never gates and refusal never measures.
//
// Paired direction (criterion 4): with only set-phase.mjs reverted, (a)/(b) fail — the suite
// exits 1.
//
// Run:  node set-phase.eval-lane.test.mjs   (exit 0 = pass, 1 = fail)

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

function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "zod-lane-"));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  return repo;
}
// Done-bound state in the regression-gate.test.mjs crafting shape: review OKAY, final pass,
// no regressed regression, no unresolved imports — nothing but the transition under test.
function writeDoneBound(repo, slug = "t") {
  writeFileSync(join(repo, ".zcode", "state", `${slug}.json`), JSON.stringify({
    slug, phase: "final", updated_at: new Date().toISOString(),
    review: { verdict: "OKAY", round: 1, max_rounds: 3 },
    final: { verdict: "pass" },
  }, null, 2));
}
function phase(repo, target, home, lane) {
  // Explicit control per case: this suite must be immune to an inherited ZODYSSEY_EVAL_LANE
  // (run-tests.mjs exports "synthetic" for the whole run) — undefined means OPERATOR lane.
  const env = { ...process.env, HOME: home };
  delete env.ZODYSSEY_EVAL_LANE;
  if (lane !== undefined) env.ZODYSSEY_EVAL_LANE = lane;
  return spawnSync(process.execPath, [SET_PHASE, repo, "t", target], { encoding: "utf8", env });
}
const evalFile = (home, name) => join(home, ".zcode", "orchestration", "eval", name);
const lines = (p) => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l.trim()) : [];

console.log("set-phase.mjs eval lane — synthetic runs never touch the operator trend log\n");

// --- (a) default lane: operator file, one parseable record, mkdir guard ----------------------
{
  const repo = makeRepo(), home = mkdtempSync(join(tmpdir(), "zod-lane-home-a-"));
  cleanup.push(home);
  writeDoneBound(repo);
  const r = phase(repo, "done", home);
  const recs = lines(evalFile(home, "results.jsonl"));
  check("(a) done exits 0 (no pre-existing eval dir — mkdir guard)", r.status === 0,
    `(exit ${r.status}) ${(r.stderr || "").slice(0, 200)}`);
  check("(a) exactly one record in results.jsonl", recs.length === 1, `got ${recs.length}`);
  let parsed = null;
  try { parsed = JSON.parse(recs[0]); } catch {}
  check("(a) record is parseable run-report JSON with the slug", parsed && parsed.slug === "t");
  check("(a) synthetic lane file absent", !existsSync(evalFile(home, "results.synthetic.jsonl")));
}

// --- (b) synthetic lane: separate file, operator file untouched -------------------------------
{
  const repo = makeRepo(), home = mkdtempSync(join(tmpdir(), "zod-lane-home-b-"));
  cleanup.push(home);
  writeDoneBound(repo);
  const r = phase(repo, "done", home, "synthetic");
  const syn = lines(evalFile(home, "results.synthetic.jsonl"));
  check("(b) done exits 0", r.status === 0, `(exit ${r.status})`);
  check("(b) exactly one record in results.synthetic.jsonl", syn.length === 1, `got ${syn.length}`);
  check("(b) record parses with the slug", (() => { try { return JSON.parse(syn[0]).slug === "t"; } catch { return false; } })());
  check("(b) operator results.jsonl absent or empty",
    lines(evalFile(home, "results.jsonl")).length === 0,
    existsSync(evalFile(home, "results.jsonl")) ? readFileSync(evalFile(home, "results.jsonl"), "utf8").slice(0, 80) : "(absent)");
}

// --- (c) lane value strictness: "Synthetic" (wrong case) = operator lane ---------------------
{
  const repo = makeRepo(), home = mkdtempSync(join(tmpdir(), "zod-lane-home-c-"));
  cleanup.push(home);
  writeDoneBound(repo);
  const r = phase(repo, "done", home, "Synthetic");
  check("(c) wrong-case lane still transitions (lane never gates)", r.status === 0, `(exit ${r.status})`);
  check("(c) wrong-case lane lands in the OPERATOR file", lines(evalFile(home, "results.jsonl")).length === 1);
  check("(c) synthetic file untouched", lines(evalFile(home, "results.synthetic.jsonl")).length === 0);
}

// --- (d) cap twin: capJsonl caps whichever lane file was written (source order) ---------------
{
  // The routing must resolve ONE path variable used by BOTH the append and the cap — otherwise
  // a future edit caps the operator file while appending the lane (or vice versa). Assert the
  // shape: appendFileSync(<var>, …) … capJsonl(<var>, 1000) on the same identifier.
  const m = SET_PHASE_SRC.match(/appendFileSync\((\w+),\s*report/);
  check("(d) append targets a resolved path variable", !!m, "no appendFileSync(<var>, report…) found");
  if (m) {
    const re = new RegExp(`capJsonl\\(${m[1]},\\s*1000\\)`);
    check("(d) capJsonl caps the SAME variable the append wrote", re.test(SET_PHASE_SRC),
      `append var ${m[1]} not the capped one`);
  }
  check("(d) the synthetic lane is named at the routing site",
    /results\.synthetic\.jsonl/.test(SET_PHASE_SRC));
}

// --- (e) audited routes by the same lane rule --------------------------------------------------
{
  const repo = makeRepo(), home = mkdtempSync(join(tmpdir(), "zod-lane-home-e-"));
  cleanup.push(home);
  writeDoneBound(repo);
  phase(repo, "done", home);             // operator lane: done first
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify({
    slug: "t", phase: "done", updated_at: new Date().toISOString(),
    review: { verdict: "OKAY", round: 1, max_rounds: 3 }, final: { verdict: "pass" },
  }, null, 2));
  const r = phase(repo, "audited", home, "synthetic");
  check("(e) audited exits 0", r.status === 0, `(exit ${r.status})`);
  check("(e) audited+synthetic appends to the synthetic lane", lines(evalFile(home, "results.synthetic.jsonl")).length === 1);
  check("(e) operator file still holds exactly the one earlier done record", lines(evalFile(home, "results.jsonl")).length === 1);
}

// --- (f) a refused done measures nothing: no append in either lane -----------------------------
// Item 24 wired regression-gate --check into the done entry, so a hand-planted
// `regressed` lane is re-derived from the real suite before the refusal evaluates. The
// regressed state is therefore planted the honest way: a toolchain whose suite is red NOW
// over a green recorded baseline — the same shape set-phase.regression-wiring.test.mjs
// pins from the other side. The lane semantics under test (a REFUSED done appends to
// neither lane) are unchanged.
{
  const repo = makeRepo(), home = mkdtempSync(join(tmpdir(), "zod-lane-home-f-"));
  cleanup.push(home);
  const tcPath = join(repo, ".zcode", "toolchain.json");
  writeFileSync(tcPath, JSON.stringify({ test_cmd: "node -e process.exit(1)" }));
  const tcSha = spawnSync(process.execPath, ["-e",
    `console.log(require("crypto").createHash("sha256").update(require("fs").readFileSync(${JSON.stringify(tcPath)})).digest("hex"))`,
  ], { encoding: "utf8" }).stdout.trim();
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify({
    slug: "t", phase: "final", updated_at: new Date().toISOString(),
    review: { verdict: "OKAY", round: 1, max_rounds: 3 },
    final: { verdict: "pass" },
    regression: {
      status: "baselined", toolchain_sha256: tcSha,
      baseline: { exit_code: 0, timed_out: false, failures: [], at: new Date().toISOString(), green: true, cmd: "node -e process.exit(1)" },
      at: new Date().toISOString(),
    },
  }, null, 2));
  const r = phase(repo, "done", home, "synthetic");
  check("(f) refused done exits non-zero", r.status !== 0, `(exit ${r.status})`);
  check("(f) no record in either lane",
    lines(evalFile(home, "results.jsonl")).length === 0 && lines(evalFile(home, "results.synthetic.jsonl")).length === 0);
}

for (const d of cleanup) rmSync(d, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
