#!/usr/bin/env node
// set-phase.audit-vehicle.test.mjs — the retroactive-audit vehicle can reach `audited` (item 26).
//
// WHY THIS EXISTS (brief 26, candidate C1): `audited` has predecessors `done` and `remediate`
// only (TRANSITIONS, set-phase.mjs:93-94), but a run opened purely to carry an external audit of
// already-shipped work executes nothing — it never earns review OKAY or a final wave, so it can
// never enter `done` and terminates at `abandoned`, whose edges exclude `audited` (:97). The
// trend-log auto-append fires on done|audited only (:477), so the one run class whose
// verify_origin: external-audit most deserves recording contributes ZERO rows (measured live:
// impl-04-audit — an ACCEPT with zero gaps — sits stranded at abandoned).
//
// The fix under test (brief "What fixed means"): (1) `abandoned` gains the `audited` edge; (2) a
// DESTINATION precondition — target `audited` requires state.consult.verdict === "ACCEPT"
// (minted only by trusted consult.mjs), which also tightens done→audited and remediate→audited;
// (3) `audited` stays out of FORCEABLE (:318), so the abandoned-force two-step cannot mint the
// label.
//
// Cases (brief docs/impl/26-audit-vehicle-audited-edge.md:66-78), each asserting exit code AND
// refusal NAME — the name is what distinguishes the old-reason refusal (illegal transition,
// set-phase.mjs:289) from the new gate's refusals (precondition :321 / --force restriction :326).
// An assertion that accepted ANY exit-6 message would false-green pre-edit, which is exactly the
// anti-slop failure the plan forbids:
//   (a) abandoned + ACCEPT → audited SUCCEEDS; the hermetic synthetic lane gains one
//       external-audit row (the corpus gains the record it was denied);
//   (b) abandoned + no ACCEPT (null AND "REJECT") → exit 6 naming the precondition;
//   (c) the master-bypass two-step from done (`abandoned --force`, then `audited`) refuses at
//       step 2 naming the precondition;
//   (d) `--force audited` directly → exit 6 naming the `--force cannot target` restriction
//       (and with an ACCEPT the flag is inert — the ACCEPT is the gate, never the flag);
//   (e) done→audited / remediate→audited with ACCEPT still succeed (no regression), AND
//       done→audited WITHOUT ACCEPT is now refused (the intended tightening, asserted in both
//       directions).
//
// RED-first (the paired probe, brief :115-121): on the UNMODIFIED DAG the abandoned→audited
// transition is illegal, so (a), (c) step 2, and (e-tightening) fail — the DAG's own gap IS the
// red; (b)/(d) pre-edit exit 6 for the OLD reason, so their NAME assertions fail too. After the
// two-edit fix this suite goes green with ZERO test edits (the RED byte-copy + sha256 live in
// .zcode/notepads/impl-26-audit-vehicle/).
//
// Every spawn pins BOTH decontamination rails (item 05): ZODYSSEY_EVAL_LANE=synthetic AND a
// hermetic mkdtemp HOME, so the audited auto-append lands in the fixture corpus — never the
// operator's live ~/.zcode/orchestration/eval. There is deliberately no opts.env escape (the
// check-wiring Metis nit: an env-replacing caller silently drops the lane).
//
// Run:  node set-phase.audit-vehicle.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const S = new URL(".", import.meta.url).pathname;
const SET_PHASE = join(S, "set-phase.mjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const cleanup = [];
const git = (repo, ...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });

// mkdtemp git fixture — the sibling harness shape (set-phase.check-wiring.test.mjs:49-62). The
// audited path has no git dependency; the fixture keeps the cited harness identical.
function makeRepo() {
  const repo = mkdtempSync(join(tmpdir(), "zod-audveh-"));
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
const freshHome = () => { const h = mkdtempSync(join(tmpdir(), "zod-audveh-home-")); cleanup.push(h); return h; };

const statePath = (repo) => join(repo, ".zcode", "state", "t.json");
function state(repo) {
  try { return JSON.parse(readFileSync(statePath(repo), "utf8")); } catch { return null; }
}
function writeState(repo, st) {
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  writeFileSync(statePath(repo), JSON.stringify(st, null, 2));
}

// Every spawn in this suite targets (or refuses) a TERMINAL phase, so every spawn pins the
// synthetic lane AND the hermetic HOME — no terminal-phase spawn may reach the operator corpus.
function phase(repo, target, home, extraArgs = []) {
  return spawnSync(process.execPath, [SET_PHASE, repo, "t", target, ...extraArgs], {
    encoding: "utf8", env: { ...process.env, HOME: home, ZODYSSEY_EVAL_LANE: "synthetic" },
  });
}

// The retroactive-audit vehicle shape, measured on the live victim (impl-04-audit): stranded at
// abandoned holding consult.verdict ACCEPT, review.verdict null, no final wave.
const now = () => new Date().toISOString();
const ACCEPT = { verdict: "ACCEPT", history: ["1:ACCEPT"] };
function vehicleState(consult, extra = {}) {
  return { slug: "t", phase: "abandoned", started_at: now(), updated_at: now(),
    review: { verdict: null, round: 1, max_rounds: 3 }, final: null, consult, ...extra };
}
// A run that DID reach done the sanctioned way (review OKAY + final pass) — the existing
// done→audited path, whose consult lane then decides the new destination gate.
function doneState(consult) {
  return { slug: "t", phase: "done", started_at: now(), updated_at: now(),
    review: { verdict: "OKAY", round: 1, max_rounds: 3 }, final: { verdict: "pass" }, consult };
}

// Refusal-NAME predicates — the load-bearing half of every refusal assertion. The ACCEPT-gate
// text is the planned clause verbatim prefix (todo 2); matching it is what proves the refusal
// fires for the RIGHT reason rather than any exit-6 message.
const out = (r) => (r.stderr || "") + (r.stdout || "");
const namesAcceptGate = (r, from) =>
  new RegExp(`precondition failed for ${from} → audited: audited requires consult\\.verdict === ACCEPT`)
    .test(out(r));
const oldReason = (r) => /illegal transition/.test(out(r)); // the pre-edit exit-6 reason
const namesForceRestriction = (r) => /--force cannot target audited/.test(out(r));

const evalFile = (home, name) => join(home, ".zcode", "orchestration", "eval", name);
function laneRows(home, name) {
  try {
    return readFileSync(evalFile(home, name), "utf8").split("\n").filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } });
  } catch { return []; }
}

console.log("set-phase.mjs audit vehicle — abandoned→audited behind consult ACCEPT, never --force\n");

// --- (a) the sanctioned new path: a stranded vehicle holding an ACCEPT reaches audited ---------
{
  const repo = makeRepo(), home = freshHome();
  writeState(repo, vehicleState(ACCEPT));
  const r = phase(repo, "audited", home);
  check("(a) abandoned→audited with consult ACCEPT exits 0", r.status === 0,
    `(exit ${r.status}) ${out(r).slice(0, 200)}`);
  check("(a) state.phase becomes audited", state(repo)?.phase === "audited",
    JSON.stringify(state(repo)?.phase));
  const syn = laneRows(home, "results.synthetic.jsonl");
  check("(a) hermetic synthetic lane gains exactly one row", syn.length === 1, `got ${syn.length}`);
  check("(a) the row carries verify_origin external-audit",
    syn.some((x) => x && x.slug === "t" && x.verify_origin === "external-audit"),
    JSON.stringify(syn.map((x) => x && x.verify_origin)));
  check("(a) operator-lane file gains nothing", laneRows(home, "results.jsonl").length === 0);
}

// --- (b) no ACCEPT (null AND REJECT): refused, naming the precondition ------------------------
for (const [label, consult] of [["null-verdict", { verdict: null, history: [] }],
                                ["REJECT-verdict", { verdict: "REJECT", history: ["1:REJECT"] }]]) {
  const repo = makeRepo(), home = freshHome();
  writeState(repo, vehicleState(consult));
  const r = phase(repo, "audited", home);
  check(`(b) ${label} abandoned→audited exits 6`, r.status === 6, `(exit ${r.status})`);
  check(`(b) ${label} refusal NAMES the consult-ACCEPT precondition (not illegal transition)`,
    namesAcceptGate(r, "abandoned") && !oldReason(r), out(r).slice(0, 200));
  if (label === "null-verdict") {
    check("(b) refused transition leaves the state at abandoned", state(repo)?.phase === "abandoned");
  }
}

// --- (c) the master-bypass two-step from done: `abandoned --force`, then `audited` -------------
{
  const repo = makeRepo(), home = freshHome();
  writeState(repo, doneState(undefined)); // consult lane absent — nothing to mint audited from
  const s1 = phase(repo, "abandoned", home, ["--force"]);
  check("(c) step 1: done→abandoned --force exits 0", s1.status === 0,
    `(exit ${s1.status}) ${out(s1).slice(0, 200)}`);
  check("(c) step 1: lands at abandoned", state(repo)?.phase === "abandoned");
  const s2 = phase(repo, "audited", home);
  check("(c) step 2: abandoned→audited (the two-step) exits 6", s2.status === 6,
    `(exit ${s2.status})`);
  check("(c) step 2: refusal NAMES the consult-ACCEPT precondition (bypass closed, not illegal transition)",
    namesAcceptGate(s2, "abandoned") && !oldReason(s2), out(s2).slice(0, 200));
  check("(c) the refused two-step measures nothing (no row in either lane)",
    laneRows(home, "results.synthetic.jsonl").length === 0 &&
    laneRows(home, "results.jsonl").length === 0);
}

// --- (d) `--force audited` directly: the FORCEABLE restriction, unchanged ---------------------
{
  const repo = makeRepo(), home = freshHome();
  writeState(repo, vehicleState({ verdict: null, history: [] }));
  const r = phase(repo, "audited", home, ["--force"]);
  check("(d) --force audited (no ACCEPT) exits 6", r.status === 6, `(exit ${r.status})`);
  check("(d) refusal NAMES the --force cannot target restriction (not illegal transition)",
    namesForceRestriction(r) && !oldReason(r), out(r).slice(0, 200));

  // The other half of case (d), the brief's own posture ("no flag authenticates anyone"): with a
  // real ACCEPT the transition succeeds with or without --force — the flag grants nothing, and
  // the ACCEPT is the only gate. Pre-edit this is red for the old illegal-transition reason.
  const repo2 = makeRepo(), home2 = freshHome();
  writeState(repo2, vehicleState(ACCEPT));
  const r2 = phase(repo2, "audited", home2, ["--force"]);
  check("(d) with ACCEPT, --force audited still enters — the flag is inert, the ACCEPT is the gate",
    r2.status === 0 && state(repo2)?.phase === "audited",
    `(exit ${r2.status}) ${out(r2).slice(0, 200)}`);
}

// --- (e) no regression on the sanctioned paths + the intended tightening, both directions -----
{
  const repo1 = makeRepo(), home1 = freshHome();
  writeState(repo1, doneState(ACCEPT));
  const e1 = phase(repo1, "audited", home1);
  check("(e) done→audited with ACCEPT still exits 0 and reaches audited (no regression)",
    e1.status === 0 && state(repo1)?.phase === "audited",
    `(exit ${e1.status}) ${out(e1).slice(0, 200)}`);

  const repo2 = makeRepo(), home2 = freshHome();
  writeState(repo2, { ...doneState(ACCEPT), phase: "remediate" });
  const e2 = phase(repo2, "audited", home2);
  check("(e) remediate→audited with ACCEPT still exits 0 (no regression)",
    e2.status === 0 && state(repo2)?.phase === "audited",
    `(exit ${e2.status}) ${out(e2).slice(0, 200)}`);

  // The tightening, asserted in both directions: WITH ACCEPT (above) still passes; WITHOUT
  // ACCEPT the old latent hole (done→audited never required an audit) is closed.
  const repo3 = makeRepo(), home3 = freshHome();
  writeState(repo3, doneState(undefined));
  const e3 = phase(repo3, "audited", home3);
  check("(e-tightening) done→audited WITHOUT ACCEPT exits 6", e3.status === 6,
    `(exit ${e3.status}) — the latent hole: exit 0 means an unconsulted done run took the audited label`);
  check("(e-tightening) refusal NAMES the consult-ACCEPT precondition (the latent hole closed)",
    namesAcceptGate(e3, "done") && !oldReason(e3), out(e3).slice(0, 200));
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
