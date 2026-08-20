#!/usr/bin/env node
// compact.test.mjs — the additive invariant of compact.mjs as an executable assertion (item 11).
//
// WHY THIS EXISTS: compact.mjs shipped with a passing header comment ("NEVER reads, modifies, or
// deletes any source notepad") and ZERO callers — its only wiring was a "you may run this"
// sentence in SKILL.md. Item 11 wires it into the `final` transition (set-phase.mjs, above
// AUTO_COMPACT_MIN_LINES = 400 aggregate non-empty notepad lines, opt-out via
// ZODYSSEY_NO_AUTO_COMPACT=1, best-effort — never gates) and turns the comment into this suite.
//
// The ten cases (brief criterion 3), each test named starting with its letter token so result
// lines are greppable:
//   (a) 5×100 fixture, direct two-arg call → exit 0, brief written, sources byte-identical
//   (b) same fixture + --min-lines 400 (above threshold) → exit 0, brief, sources intact,
//       each section truncated at 40 lines carrying the compact.mjs marker
//   (c) 2×20 fixture + --min-lines 400 (below threshold) → exit 0, NOTHING written; a pre-seeded
//       brief from a "manual earlier run" stays byte-identical (never deleted, never rewritten)
//   (d) 2×20 fixture, plain two-arg call → exit 0, brief EXISTS (legacy contract unchanged)
//   (e) missing notepad dir → exit 3
//   (f) crafted verify-phase state + large set → `set-phase final` exits 0, brief written,
//       sources byte-identical, brief path printed to the transition's stdout (stdio:inherit)
//   (g) same crafted state + small set → transition exits 0, NO brief
//   (h) same crafted state + large set + ZODYSSEY_NO_AUTO_COMPACT=1 → exit 0, NO brief
//   (i) crafted state, no notepad dir → entering final still exits 0 (best-effort, warning only)
//   (j) idempotence — two final entries (final → verify → final re-entry) leave sources
//       byte-identical and the brief re-derived
//
// NON-VACUITY CONTROLS: (g) and (h) assert ABSENCE (no brief), which a transition with no
// compaction wiring at all would also produce — the vacuous-pass class. Each therefore carries a
// same-shape POSITIVE control (large set, env unset) that must produce a brief; the control fails
// while the wiring is absent, so these cases are genuinely red pre-wiring and only the threshold
// / opt-out can make them green post-wiring.
//
// Byte-identity is asserted via sha256 over raw file bytes, across EVERY path that touches the
// notepad dir. Fixtures live in scratch temp repos under os.tmpdir() — NEVER a real repo's
// .zcode/ tree. Env hygiene: ZODYSSEY_NO_AUTO_COMPACT is stripped from every invocation except
// case (h)'s opt-out probe, so an operator-exported opt-out cannot redden the other cases.
//
// Run:  node compact.test.mjs        (exit 0 = pass, 1 = fail)
//   or: node --test compact.test.mjs (same assertions via the test runner)

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const S = dirname(fileURLToPath(import.meta.url));
const COMPACT = join(S, "compact.mjs");
const SET_PHASE = join(S, "set-phase.mjs");
const BRIEF_NAME = "_compact-brief.md";
// compact.mjs:78 — the pinned truncation marker (truncation policy is unchanged by item 11).
const TRUNCATION_MARKER = "_(truncated to first 40 non-empty lines)_";

const roots = [];
function mkRepo(prefix) {
  const d = mkdtempSync(join(tmpdir(), prefix));
  roots.push(d);
  return d;
}

// A crafted run state at phase `verify` — entering `final` has no precondition (checkPrecondition
// gates only execute/done), so this is the entry the auto-compaction wiring rides on.
function craftState(repo, slug) {
  const dir = join(repo, ".zcode", "state");
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(join(dir, `${slug}.json`), JSON.stringify({
    slug, phase: "verify", created_at: now, updated_at: now, checkpoints: [],
  }, null, 2) + "\n");
}

// `files` notepads × `lines` NON-EMPTY lines each (the l.trim().length > 0 unit compact.mjs
// counts). Large = 5×100 = 500 aggregate; small = 2×20 = 40.
function seedNotepads(repo, slug, files, lines) {
  const dir = join(repo, ".zcode", "notepads", slug);
  mkdirSync(dir, { recursive: true });
  const names = [];
  for (let i = 1; i <= files; i++) {
    const name = `n${i}.md`;
    names.push(name);
    const body = Array.from({ length: lines }, (_, j) =>
      `notepad ${name} line ${String(j + 1).padStart(3, "0")}/${lines} of ${slug} — load-bearing working memory`).join("\n") + "\n";
    writeFileSync(join(dir, name), body);
  }
  return { dir, names };
}

const briefPathOf = (repo, slug) => join(repo, ".zcode", "notepads", slug, BRIEF_NAME);
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// name → sha256 for every file in the notepad dir; `sources`-flavored snapshots exclude the brief
// itself (it is a derived artifact — the sources are the invariant).
function snapshotDir(dir, { sources = true } = {}) {
  const m = new Map();
  for (const n of readdirSync(dir).sort()) {
    if (sources && n === BRIEF_NAME) continue;
    m.set(n, sha256(join(dir, n)));
  }
  return m;
}

function baseEnv() {
  const e = { ...process.env };
  delete e.ZODYSSEY_NO_AUTO_COMPACT; // only case (h) sets the opt-out
  return e;
}

function runCompact(repo, slug, extra = []) {
  return spawnSync(process.execPath, [COMPACT, repo, slug, ...extra],
    { encoding: "utf8", env: baseEnv(), timeout: 60_000 });
}

function runPhase(repo, slug, target, envExtra = {}) {
  return spawnSync(process.execPath, [SET_PHASE, repo, slug, target],
    { encoding: "utf8", env: { ...baseEnv(), ZODYSSEY_EVAL_LANE: "synthetic", ...envExtra }, timeout: 180_000 });
}

function phaseOf(repo, slug) {
  return JSON.parse(readFileSync(join(repo, ".zcode", "state", `${slug}.json`), "utf8")).phase;
}

after(() => { for (const r of roots) { try { rmSync(r, { recursive: true, force: true }); } catch {} } });

// --- direct invocation (compact.mjs) ---------------------------------------------------------

test("case (a) — direct two-arg compaction on the 5×100 fixture: exit 0, brief written, every source notepad byte-identical", () => {
  const repo = mkRepo("impl11-a-"), slug = "impl11-a";
  const { dir } = seedNotepads(repo, slug, 5, 100);
  const before = snapshotDir(dir);
  const r = runCompact(repo, slug);
  assert.equal(r.status, 0, `exit ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  const bp = briefPathOf(repo, slug);
  assert.ok(existsSync(bp), "brief written beside the sources");
  assert.deepEqual(snapshotDir(dir), before, "every source notepad byte-identical (sha256) — the additive invariant");
  assert.equal(r.stdout.trim(), bp, "two-arg invocation prints exactly the brief path (unchanged output contract)");
});

test("case (b) — --min-lines 400 above threshold (5×100 = 500 aggregate): exit 0, brief written, sources byte-identical, 40-line truncation markers", () => {
  const repo = mkRepo("impl11-b-"), slug = "impl11-b";
  const { dir, names } = seedNotepads(repo, slug, 5, 100);
  const before = snapshotDir(dir);
  const r = runCompact(repo, slug, ["--min-lines", "400"]);
  assert.equal(r.status, 0, `exit ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  const bp = briefPathOf(repo, slug);
  assert.ok(existsSync(bp), "above threshold: brief written");
  assert.deepEqual(snapshotDir(dir), before, "sources byte-identical above threshold");
  const brief = readFileSync(bp, "utf8");
  for (const n of names) {
    assert.ok(brief.includes(`## ${n} ${TRUNCATION_MARKER}`),
      `section for ${n} truncated at 40 lines carrying the marker`);
  }
});

test("case (c) — --min-lines 400 below threshold (2×20 = 40 aggregate): exit 0, NO brief written, pre-seeded brief from a manual earlier run stays byte-identical", () => {
  const repo = mkRepo("impl11-c-"), slug = "impl11-c";
  const { dir } = seedNotepads(repo, slug, 2, 20);
  const sentinel = "# Compact brief — STALE (manual earlier run)\n\nsentinel bytes that must survive a below-threshold invocation verbatim\n";
  writeFileSync(briefPathOf(repo, slug), sentinel); // a manual run left this behind
  const before = snapshotDir(dir, { sources: false }); // EVERY file, brief included
  const r = runCompact(repo, slug, ["--min-lines", "400"]);
  assert.equal(r.status, 0, `below threshold is inert, not an error — exit ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  assert.deepEqual(snapshotDir(dir, { sources: false }), before,
    "below threshold: nothing written, nothing deleted — the pre-seeded brief included");
  assert.equal(readFileSync(briefPathOf(repo, slug), "utf8"), sentinel,
    "the stale brief from the manual earlier run was neither deleted nor rewritten");
});

test("case (d) — legacy two-arg contract on the small fixture (2×20): exit 0, brief written", () => {
  const repo = mkRepo("impl11-d-"), slug = "impl11-d";
  const { dir } = seedNotepads(repo, slug, 2, 20);
  const before = snapshotDir(dir);
  const r = runCompact(repo, slug);
  assert.equal(r.status, 0, `exit ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  assert.ok(existsSync(briefPathOf(repo, slug)),
    "plain two-arg invocation still compacts below any threshold — the legacy contract is unchanged");
  assert.deepEqual(snapshotDir(dir), before, "sources byte-identical under the legacy contract");
});

test("case (e) — missing notepad dir: compact exits 3 (dir check unchanged)", () => {
  const repo = mkRepo("impl11-e-"), slug = "impl11-e"; // no .zcode/notepads/<slug> seeded
  const r = runCompact(repo, slug);
  assert.equal(r.status, 3, `expected exit 3 (no notepad dir), got ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
});

// --- wiring (set-phase.mjs final entry) -------------------------------------------------------

test("case (f) — entering final with the large set auto-compacts: transition exits 0, brief exists, sources byte-identical, brief path printed to the transition's stdout", () => {
  const repo = mkRepo("impl11-f-"), slug = "impl11-f";
  craftState(repo, slug);
  const { dir } = seedNotepads(repo, slug, 5, 100);
  const before = snapshotDir(dir);
  const r = runPhase(repo, slug, "final");
  assert.equal(r.status, 0, `final transition exited ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  assert.equal(phaseOf(repo, slug), "final", "the phase write itself happened");
  const bp = briefPathOf(repo, slug);
  assert.ok(existsSync(bp), "auto-compaction wrote the brief at final entry (above threshold)");
  assert.deepEqual(snapshotDir(dir), before, "every source notepad byte-identical across the transition");
  assert.ok(r.stdout.includes(bp),
    `the brief path reaches the transition's stdout (compact.mjs via stdio:inherit); stdout=${JSON.stringify((r.stdout || "").slice(0, 300))}`);
});

test("case (g) — entering final below threshold (small set): exit 0, no brief written (same-shape above-threshold control proves the wiring is live)", () => {
  const small = mkRepo("impl11-g-small-"), slugSmall = "impl11-g";
  craftState(small, slugSmall);
  seedNotepads(small, slugSmall, 2, 20);
  const r = runPhase(small, slugSmall, "final");
  assert.equal(r.status, 0, `final transition exited ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  assert.ok(!existsSync(briefPathOf(small, slugSmall)), "below threshold: no brief written at final entry");

  // NON-VACUITY CONTROL: the same crafted state with the large set MUST write a brief. Without
  // this, "no brief" would also pass while the wiring is entirely absent (the vacuous-probe
  // failure mode) — the control is what makes the absence above mean "inert", not "unwired".
  const ctl = mkRepo("impl11-g-ctl-"), slugCtl = "impl11-g-ctl";
  craftState(ctl, slugCtl);
  seedNotepads(ctl, slugCtl, 5, 100);
  const rc = runPhase(ctl, slugCtl, "final");
  assert.equal(rc.status, 0, `control transition exited ${rc.status}: ${(rc.stderr || "").slice(0, 300)}`);
  assert.ok(existsSync(briefPathOf(ctl, slugCtl)),
    "control: the same transition on the large set DID write a brief — the wiring is live, so the small-set absence is the threshold being inert");
});

test("case (h) — ZODYSSEY_NO_AUTO_COMPACT=1 skips auto-compaction: exit 0, no brief (env-unset control on the same fixture shape proves the wiring is live)", () => {
  const repo = mkRepo("impl11-h-"), slug = "impl11-h";
  craftState(repo, slug);
  seedNotepads(repo, slug, 5, 100); // large set — would compact but for the opt-out
  const r = runPhase(repo, slug, "final", { ZODYSSEY_NO_AUTO_COMPACT: "1" });
  assert.equal(r.status, 0, `final transition exited ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  assert.ok(!existsSync(briefPathOf(repo, slug)), "opt-out: no brief written even above threshold");

  // NON-VACUITY CONTROL: the identical fixture shape WITHOUT the env must write a brief, so the
  // absence above is attributable to the opt-out, not to absent wiring.
  const ctl = mkRepo("impl11-h-ctl-"), slugCtl = "impl11-h-ctl";
  craftState(ctl, slugCtl);
  seedNotepads(ctl, slugCtl, 5, 100);
  const rc = runPhase(ctl, slugCtl, "final");
  assert.equal(rc.status, 0, `control transition exited ${rc.status}: ${(rc.stderr || "").slice(0, 300)}`);
  assert.ok(existsSync(briefPathOf(ctl, slugCtl)),
    "control: without the env the same transition DID write a brief — the wiring is live, so the absence above is the opt-out being honored");
});

test("case (i) — entering final with no notepad dir: transition still exits 0 (best-effort, warning only)", () => {
  const repo = mkRepo("impl11-i-"), slug = "impl11-i";
  craftState(repo, slug); // state exists, .zcode/notepads/<slug> does not
  const r = runPhase(repo, slug, "final");
  assert.equal(r.status, 0,
    `a run with no notepad dir must never fail its final transition (best-effort catch) — exit ${r.status}: ${(r.stderr || "").slice(0, 300)}`);
  assert.equal(phaseOf(repo, slug), "final", "the transition completed");
});

test("case (j) — idempotence: two final entries (final → verify → final re-entry) leave every source notepad byte-identical and the brief re-derived", () => {
  const repo = mkRepo("impl11-j-"), slug = "impl11-j";
  craftState(repo, slug);
  const { dir } = seedNotepads(repo, slug, 5, 100);
  const before = snapshotDir(dir);
  const bp = briefPathOf(repo, slug);

  const r1 = runPhase(repo, slug, "final");
  assert.equal(r1.status, 0, `first final entry exited ${r1.status}: ${(r1.stderr || "").slice(0, 300)}`);
  assert.ok(existsSync(bp), "first entry wrote the brief");
  assert.ok(r1.stdout.includes(bp), "first entry printed the brief path");

  // Re-entering final through the legal verify edge (final: [done, verify, …]) — the re-entry
  // above threshold must refresh the brief, never touch the sources.
  const rv = runPhase(repo, slug, "verify");
  assert.equal(rv.status, 0, `verify re-entry edge exited ${rv.status}: ${(rv.stderr || "").slice(0, 300)}`);
  const r2 = runPhase(repo, slug, "final");
  assert.equal(r2.status, 0, `second final entry exited ${r2.status}: ${(r2.stderr || "").slice(0, 300)}`);
  assert.ok(r2.stdout.includes(bp), "second entry re-invoked compaction — the brief is regenerated, not stale");
  assert.ok(existsSync(bp), "brief present after the second entry");
  assert.deepEqual(snapshotDir(dir), before, "two compaction passes, zero source-byte drift (sha256)");
});
