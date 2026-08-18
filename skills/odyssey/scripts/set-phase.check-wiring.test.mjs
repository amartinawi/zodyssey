#!/usr/bin/env node
// set-phase.check-wiring.test.mjs — the zero-caller checks must fire from phase transitions.
//
// WHY THIS EXISTS (item 02): check-imports.mjs, coverage-delta.mjs and resolve-capabilities.mjs
// each shipped with a passing suite and ZERO code callers — ceremony without mechanism. The
// paired probe: hand-invoking check-imports in a repo with a hallucinated import exits 9, while
// a full orchestration run sails to `done` without ever invoking it. This suite asserts all
// three sides together, per check — invoke (the transition runs it), record (the state lane is
// written), consume (the `done` precondition reads it) — because the wiring precedent it mirrors
// (B8) shipped half-wired once: `regression-gate --check`, the only writer of the status the
// done gate consumes, still has no code caller.
//
// Gate-vs-inert, as built and asserted here:
//   · check-imports        GATES on findings (exit 9 → `done` refuses); capability absent
//                           (no git work-tree, no JS/Python manifest) → `inert`, never a block.
//   · coverage-delta       NEVER gates — evidence only, its own header contract.
//   · resolve-capabilities NEVER gates — its violation classes describe the operator's whole
//                           installation, not this run; recorded + surfaced, never a precondition.
//
// The paired direction (criterion 8): with only set-phase.mjs reverted, every invocation/
// recording assertion below fails because no lane is ever written — the suite exits 1.
//
// Coverage note: this suite drives every transition through set-phase.mjs, so the SECOND
// baseline-capture site — record-review.mjs's enteredExecute block, the entry a real run
// actually takes into execute — is NOT asserted here. It is asserted in
// pipeline-integration.test.mjs ("import-check baseline sha captured at execute entry"), the
// one suite that drives a real record-review → execute path. Reverting record-review.mjs
// leaves this file green; that assertion is what goes red. Don't conclude from this suite
// alone that the baseline has one site.
//
// Run:  node set-phase.check-wiring.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const S = new URL(".", import.meta.url).pathname;
const SET_PHASE = join(S, "set-phase.mjs");
const SET_PHASE_SRC = readFileSync(SET_PHASE, "utf8");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const cleanup = [];
const git = (repo, ...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });

// A git fixture with a JS manifest and one clean commit — the repo class where findings CAN
// occur (exit 9 is only reachable with a manifest present).
function makeManifestRepo() {
  const repo = mkdtempSync(join(tmpdir(), "zod-wiring-"));
  cleanup.push(repo);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "package.json"),
    JSON.stringify({ name: "fixture", version: "1.0.0", private: true, type: "module" }, null, 2));
  writeFileSync(join(repo, "src", "placeholder.js"), "export const ok = 1;\n");
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@t.t");
  git(repo, "config", "user.name", "t");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "baseline");
  return repo;
}

// A bare fixture — no git, no manifest. The capability-absent class: records `inert`, never blocks.
function makeBareRepo() {
  const repo = mkdtempSync(join(tmpdir(), "zod-wiring-bare-"));
  cleanup.push(repo);
  return repo;
}

const statePath = (repo) => join(repo, ".zcode", "state", "t.json");
function state(repo) {
  try { return JSON.parse(readFileSync(statePath(repo), "utf8")); } catch { return null; }
}
function writeState(repo, st) {
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  writeFileSync(statePath(repo), JSON.stringify(st, null, 2));
}
// review-OKAY base so the execute/done preconditions pass and only the NEW wiring is under test.
function baseState(extra = {}) {
  return {
    slug: "t", phase: "review", updated_at: new Date().toISOString(),
    review: { verdict: "OKAY", round: 1, max_rounds: 3 },
    ...extra,
  };
}
// Item 05: declare this suite's phase transitions synthetic at source — the `done` scorecards
// must land in results.synthetic.jsonl, not the operator's live results.jsonl, even on direct
// `node set-phase.check-wiring.test.mjs` dev-loop runs (run-tests.mjs blankets suite runs; this
// covers everything else). Pattern: pipeline-integration.test.mjs's run(). Placed BEFORE ...opts
// so default calls inherit it. Metis nit: a caller passing opts.env replaces the sculpted env
// wholesale and silently drops the lane — the two such callers today (the ZCAP `final` sculpt
// below and the PATH-stripped `verify` degrade probe) drive no terminal phase, so this is safe;
// any future terminal-phase caller passing env must re-include ZODYSSEY_EVAL_LANE.
function phase(repo, target, opts = {}) {
  return spawnSync(process.execPath, [SET_PHASE, repo, "t", target], {
    encoding: "utf8", env: { ...process.env, ZODYSSEY_EVAL_LANE: "synthetic" }, ...opts,
  });
}
const HALLUCINATION = `import x from "zodyssey-hallucination-probe";\nexport const probe = x;\n`;

console.log("set-phase.mjs check wiring — invoke AND record AND consume, per check\n");

// --- (a) manifest repo + hallucinated import: fires, stamps, and `done` refuses ------------
{
  const repo = makeManifestRepo();
  const sha = git(repo, "rev-parse", "HEAD").stdout.trim();
  writeState(repo, baseState());

  const ex = phase(repo, "execute");
  check("entering execute records the baseline sha (invoke+record)",
    ex.status === 0 && state(repo)?.checks?.baseline_sha === sha,
    `(exit ${ex.status}) ${JSON.stringify(state(repo)?.checks)}`);

  // The run's work: a NEW file importing a package that exists nowhere and is declared nowhere.
  writeFileSync(join(repo, "src", "probe.js"), HALLUCINATION);
  const ve = phase(repo, "verify");
  check("entering verify exits 0 while recording the finding",
    ve.status === 0, `(exit ${ve.status}) ${(ve.stderr || "").slice(0, 200)}`);
  check("records state.imports.status === unresolved",
    state(repo)?.imports?.status === "unresolved", JSON.stringify(state(repo)?.imports));
  check("finding names file + spec",
    (state(repo)?.imports?.findings || []).some(
      (f) => f.file === "src/probe.js" && f.spec === "zodyssey-hallucination-probe"),
    JSON.stringify(state(repo)?.imports?.findings));

  // Craft the done-bound state so the new clause is the ONLY thing refusing.
  const st = state(repo);
  st.phase = "final";
  st.final = { verdict: "pass" };
  writeState(repo, st);
  const dn = phase(repo, "done");
  check("`done` REFUSES (exit 6) naming the finding",
    dn.status === 6 &&
      /src\/probe\.js/.test((dn.stderr || "") + (dn.stdout || "")) &&
      /zodyssey-hallucination-probe/.test((dn.stderr || "") + (dn.stdout || "")),
    `(exit ${dn.status}) ${(dn.stderr || "").slice(0, 300)}`);

  // --- recovery: fix the import, re-enter verify (final→verify→…→done is legal) ------------
  writeFileSync(join(repo, "src", "probe.js"),
    `import { existsSync } from "node:fs";\nexport const probe = existsSync;\n`);
  const rv = phase(repo, "verify");
  check("re-entering verify after the fix re-records clean",
    rv.status === 0 && state(repo)?.imports?.status === "clean",
    `(exit ${rv.status}) ${JSON.stringify(state(repo)?.imports)}`);

  // --- (e) entering final records the coverage line and the capabilities lane -------------
  const fin = phase(repo, "final");
  check("entering final exits 0 (evidence lanes never gate)",
    fin.status === 0, `(exit ${fin.status}) ${(fin.stderr || "").slice(0, 200)}`);
  check("records a state.coverage line",
    typeof state(repo)?.coverage?.line === "string" && state(repo).coverage.line.length > 0,
    JSON.stringify(state(repo)?.coverage));
  check("records a state.capabilities_check lane",
    ["clean", "violations", "inert"].includes(state(repo)?.capabilities_check?.status),
    JSON.stringify(state(repo)?.capabilities_check));

  const dn2 = phase(repo, "done");
  check("`done` proceeds after the fix",
    dn2.status === 0 && state(repo)?.phase === "done",
    `(exit ${dn2.status}) ${(dn2.stderr || "").slice(0, 300)}`);
}

// --- (b) bare repo: capability absent → inert, never a block ---------------------------------
{
  const repo = makeBareRepo();
  writeState(repo, baseState());

  const ex = phase(repo, "execute");
  check("non-git execute entry records baseline_sha null",
    ex.status === 0 && state(repo)?.checks?.baseline_sha === null,
    `(exit ${ex.status}) ${JSON.stringify(state(repo)?.checks)}`);
  const ve = phase(repo, "verify");
  check("bare verify exits 0",
    ve.status === 0, `(exit ${ve.status}) ${(ve.stderr || "").slice(0, 200)}`);
  check("records inert (capability absent, never a block)",
    state(repo)?.imports?.status === "inert", JSON.stringify(state(repo)?.imports));

  // Enter final through the transition so the evidence lanes fire in the capability-absent repo.
  const fin = phase(repo, "final");
  check("bare final exits 0",
    fin.status === 0, `(exit ${fin.status}) ${(fin.stderr || "").slice(0, 200)}`);
  check("bare final recorded the coverage no-op line",
    /skipping|no toolchain/.test(state(repo)?.coverage?.line || ""),
    JSON.stringify(state(repo)?.coverage));

  const st = state(repo);
  st.phase = "final";
  st.final = { verdict: "pass" };
  writeState(repo, st);
  const dn = phase(repo, "done");
  check("bare `done` unaffected (no new refusal)",
    dn.status === 0 && state(repo)?.phase === "done",
    `(exit ${dn.status}) ${(dn.stderr || "").slice(0, 300)}`);
}

// --- (c) clean manifest repo records clean ---------------------------------------------------
{
  const repo = makeManifestRepo();
  writeState(repo, baseState());
  phase(repo, "execute");
  // A new file with a resolvable (builtin) import — in the changed set, resolves fine.
  writeFileSync(join(repo, "src", "fine.js"),
    `import { existsSync } from "node:fs";\nexport const fine = existsSync;\n`);
  const ve = phase(repo, "verify");
  check("clean manifest repo records clean",
    ve.status === 0 && state(repo)?.imports?.status === "clean",
    `(exit ${ve.status}) ${JSON.stringify(state(repo)?.imports)}`);
}

// --- controls: a run created BEFORE the wiring transitions unchanged -------------------------
{
  const repo = makeManifestRepo();
  writeState(repo, baseState({ phase: "execute" })); // no checks lane — old-schema in-flight run
  const ve = phase(repo, "verify");
  check("old-schema run transitions normally (fields optional)",
    ve.status === 0, `(exit ${ve.status}) ${(ve.stderr || "").slice(0, 200)}`);
  check("records inert with a no-baseline reason",
    state(repo)?.imports?.status === "inert" && /baseline/i.test(state(repo)?.imports?.reason || ""),
    JSON.stringify(state(repo)?.imports));

  const st = state(repo);
  st.phase = "final";
  st.final = { verdict: "pass" };
  writeState(repo, st);
  const dn = phase(repo, "done");
  check("old-schema `done` gets no new refusal",
    dn.status === 0, `(exit ${dn.status}) ${(dn.stderr || "").slice(0, 300)}`);
}

// --- (d) resolve-capabilities violations at final entry: recorded, surfaced, NEVER gating ----
{
  // A ZCAP fixture home whose agent body references an MCP its tools: denies — the hard-error
  // class. Same env-relocation pattern as resolve-capabilities.test.mjs (never the live tree).
  const root = mkdtempSync(join(tmpdir(), "zod-wiring-zcap-"));
  cleanup.push(root);
  const zcode = join(root, ".zcode");
  mkdirSync(join(zcode, "skills", "odyssey", "references"), { recursive: true });
  mkdirSync(join(zcode, "agents"), { recursive: true });
  mkdirSync(join(zcode, "cli"), { recursive: true });
  mkdirSync(join(root, ".agents", "skills"), { recursive: true });
  writeFileSync(join(zcode, "agents", "violator.md"),
    `---\nname: violator\ndescription: references a capability its tools deny.\ntools: Read, Bash\n---\nCall mcp__ghost__scan for structure.\n`);
  writeFileSync(join(zcode, "cli", "config.json"),
    JSON.stringify({ mcp: { servers: {} } }, null, 2));
  const capsPath = join(zcode, "skills", "odyssey", "references", "capabilities.md");
  writeFileSync(capsPath, "# stub capabilities\n");

  const repo = makeBareRepo();
  writeState(repo, baseState({ phase: "verify" }));
  const r = phase(repo, "final", {
    env: { ...process.env, ZCAP_HOME: root, ZCAP_NO_CODEGRAPH: "1", ZCAP_CAPS_MD: capsPath },
  });
  check("entering final exits 0 even with capability violations",
    r.status === 0, `(exit ${r.status}) ${(r.stderr || "").slice(0, 300)}`);
  check("records state.capabilities_check.status === violations",
    state(repo)?.capabilities_check?.status === "violations", JSON.stringify(state(repo)?.capabilities_check));
  check("violations surfaced on stderr",
    /violat/i.test(r.stderr || ""), (r.stderr || "").slice(0, 300));
}

// --- degrade path: the check itself cannot run → inert, never a block ------------------------
{
  const repo = makeManifestRepo();
  writeState(repo, baseState());
  phase(repo, "execute");
  writeFileSync(join(repo, "src", "probe.js"), HALLUCINATION);
  // PATH stripped: set-phase's own `node`/`git` lookups fail — the invoke crashes, the
  // transition must still succeed and record `inert` (B8's posture: a check that cannot run
  // degrades; over-blocking is the failure class this wiring exists to remove).
  const ve = phase(repo, "verify", { env: { ...process.env, PATH: "" } });
  check("check crash/absence degrades to inert",
    ve.status === 0 && state(repo)?.imports?.status === "inert",
    `(exit ${ve.status}) ${JSON.stringify(state(repo)?.imports)}`);
}

// --- source tripwire (criterion 9): silent unhooking fails the suite -------------------------
{
  const total = (SET_PHASE_SRC.match(/check-imports\.mjs|coverage-delta\.mjs|resolve-capabilities\.mjs/g) || []).length;
  for (const name of ["check-imports.mjs", "coverage-delta.mjs", "resolve-capabilities.mjs"]) {
    check(`tripwire: set-phase.mjs names ${name} at its invoke site`,
      SET_PHASE_SRC.includes(name));
  }
  check("tripwire: ≥3 check invokes in set-phase.mjs", total >= 3, `(${total})`);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
