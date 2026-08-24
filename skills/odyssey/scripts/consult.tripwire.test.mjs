#!/usr/bin/env node
// consult.tripwire.test.mjs — hermetic suite for the read-only audit tripwire
// (item 28 / candidate C6, docs/impl/28-readonly-audit-tripwire.md). Written
// RED-FIRST against the unmodified consult.mjs: the surface it asserts
// (workTreeSnapshot / compareWorkTree / runPostDoneConsult / readOnlyViolation)
// does not exist yet, so a failing run here is the missing feature, not a bug.
//
// The tripwire contract under test — every external-auditor spawn window
// (post-done, plan-audit, multi-auditor passes) is wrapped snapshot → spawn →
// snapshot → compare, recording a tri-state readOnlyViolation:
//   false — heads equal AND work-path sets equal (a clean window)
//   true  — HEAD moved OR any work-path entry added/removed/changed
//   null  — either git read failed (fail-closed indeterminate, NEVER a silent false)
// A true warns on stderr and is recorded; it never mutates the verdict, an exit
// code, or a rerun. The warning names BOTH causes verbatim (no attribution
// heuristics — a mid-window change is evidence, not accusation).
//
// Coverage (brief §Acceptance-criteria minimum + the paired probe):
//   (a) clean window → readOnlyViolation === false at all three spawn sites
//       (the plan-audit leg pins its observable: NO warning on stderr and
//       consult.history untouched — runPlanAudit writes state.plan_audit)
//   (b) stub-spawn mutating a work file mid-window → true recorded + warned
//   (c) .zcode/-only (and generated-dir) delta → false (exclusion set honored)
//   (d) non-git repo → null (fail-closed)
//   (e) HEAD move with clean porcelain → true
//   (f) plan-audit site: violation warns on stderr AND consult.history is NOT
//       touched (writes state.plan_audit — the tree-resolved fact)
//   (g) the paired probe: read-only stub → false; write-first stub → true;
//       verdict text byte-identical between the two runs (record-not-mutate)
//   plus the helper-level contract for workTreeSnapshot/compareWorkTree and the
//   multi-auditor fail-closed merge (true if any true, else null if any null,
//   else false).
//
// Hermetic discipline: scratch git repos under mkdtempSync(os.tmpdir()), the
// auditor CLI is NEVER contacted (the injectable `spawn` param returns a canned
// verdict envelope — runPostDoneConsult becomes injectable with the tripwire),
// no global corpus access, no network, zero npm deps (Node 18+ built-ins), sync.
//
// The work-path exclusion set below is COPIED from harness.mjs:276, never
// imported — the harness owns its copy, consult owns its own (a lib/ extraction
// is explicitly out of scope for item 28).
//
// Run:  node consult.tripwire.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// NAMESPACE import (NOT named imports): the tripwire exports do not exist in the
// unmodified consult.mjs — named imports would die at module-link time with
// "does not provide an export named 'workTreeSnapshot'" before ANY check prints.
// The namespace object lets the typeof assertions below report the absence as
// ordinary failing checks, so the RED run prints a full count instead of crashing
// (a module-load crash would be a fixture bug, not RED evidence).
import * as consult from "./consult.mjs";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  \u2713 ${name}`); pass++; }
  else { console.log(`  \u2717 ${name} ${detail}`); fail++; }
}

// A premature process.exit(0) from inside an invoked export (the refactored
// runPostDoneConsult must RETURN the normalized verdict, never exit) would
// vacuously "pass" this suite by terminating it before the summary line. If the
// process exits 0 without the summary having printed, flip the code to 1 and say
// why on stderr.
let summaryPrinted = false;
process.on("exit", (code) => {
  if (!summaryPrinted && code === 0) {
    process.exitCode = 1;
    process.stderr.write(
      "consult.tripwire.test.mjs: premature exit(0) before the summary — an invoked export exited the process instead of returning\n"
    );
  }
});

// The violation warning must name BOTH causes, verbatim per the brief. Matched
// as an order-preserving regex so source line-wrapping cannot break the pin.
const VIOLATION_WARNING_RE =
  /read-only window violated[\s\S]*tree changed during audit[\s\S]*could be the auditor OR a concurrent session[\s\S]*verdict below is untouched/;
function warnsViolation(stderrText) {
  return VIOLATION_WARNING_RE.test(String(stderrText || ""));
}

// The work-path exclusion set, COPIED from harness.mjs:276 (never imported).
// Deltas confined to these paths are legal bookkeeping / generated noise, not
// read-only violations: .zcode/ is conductor + concurrent-session bookkeeping,
// the directory roots are install/build artifacts.
const isWorkPath = (f) =>
  !f.startsWith(".zcode/") && !/^(node_modules|dist|build|target|coverage|\.cache|\.next)\//.test(f);

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

// Run git in a scratch dir; throw loudly on failure so a broken fixture can
// never masquerade as a failing check. shell:false argv only, like consult.mjs.
function gitIn(dir, args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`fixture git ${args.join(" ")} failed: ${(r.stderr || r.status)}`);
  return r.stdout;
}

// A scratch repo: real tiny git repo (committed baseline → meaningful HEAD and
// porcelain) + the .zcode scaffolding consult.mjs reads (state.json, plan,
// task). Same shape as consult.test.mjs's makeRepo, plus the git baseline.
function makeTripwireRepo(withGit = true) {
  const dir = mkdtempSync(join(tmpdir(), "zod-tripwire-"));
  mkdirSync(join(dir, ".zcode", "state"), { recursive: true });
  mkdirSync(join(dir, ".zcode", "plans"), { recursive: true });
  writeFileSync(join(dir, "work.txt"), "baseline\n");
  writeFileSync(join(dir, ".zcode", "state", "test-slug.json"),
    JSON.stringify({ slug: "test-slug", phase: "verify", updated_at: "2026-08-24T00:00:00Z" }, null, 2) + "\n");
  writeFileSync(join(dir, ".zcode", "plans", "test-slug.md"), "# Sample Plan\n\n## Scope\nDo the thing.\n");
  writeFileSync(join(dir, ".zcode", "plans", "test-slug.task.md"), "Make the thing work end-to-end.");
  if (withGit) {
    gitIn(dir, ["init", "-q"]);
    gitIn(dir, ["config", "user.email", "tripwire@example.invalid"]);
    gitIn(dir, ["config", "user.name", "Tripwire Test"]);
    gitIn(dir, ["add", "."]);
    gitIn(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "fixture baseline"]);
  }
  return dir;
}

function readState(repo) {
  return JSON.parse(readFileSync(join(repo, ".zcode", "state", "test-slug.json"), "utf8"));
}
function lastHistoryEntry(st) {
  const h = st && st.consult && Array.isArray(st.consult.history) ? st.consult.history : [];
  return h[h.length - 1];
}

// ---------------------------------------------------------------------------
// Stub auditor spawns (offline — the real CLI is never contacted).
// ---------------------------------------------------------------------------

const CANNED_VERDICT = { verdict: "ACCEPT", gaps: [], summary: "canned tripwire verdict" };
function envelope(v) {
  return { status: 0, stdout: JSON.stringify({ result: JSON.stringify(v) }), stderr: "" };
}
// A read-only stub: returns the canned verdict envelope, touches nothing.
function readOnlySpawn() {
  return () => envelope(CANNED_VERDICT);
}
// A stub whose spawn-time ACTION runs mid-window (the "tree changed during the
// read-only window" simulation — whichever side caused it; no attribution).
// `actions` is consumed in call order, one per spawn; null entries are no-ops
// (the multi-auditor path spawns twice, so [act, null] arms only pass 1).
function actingSpawn(actions) {
  const queue = [...actions];
  return () => {
    const act = queue.length ? queue.shift() : null;
    if (act) act();
    return envelope(CANNED_VERDICT);
  };
}
// Mid-window mutations.
function mutateWorkFile(repo) {
  return () => appendFileSync(join(repo, "work.txt"), "mid-window mutation\n");
}
function touchExcludedPath(repo) {
  return () => {
    mkdirSync(join(repo, ".zcode"), { recursive: true });
    writeFileSync(join(repo, ".zcode", "mid-window-note.txt"), "legal bookkeeping\n");
    mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "pkg", "index.js"), "generated noise\n");
  };
}
function moveHead(repo) {
  return () => gitIn(repo, ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "--no-verify", "-m", "mid-window head move"]);
}
function breakGit(repo) {
  return () => rmSync(join(repo, ".git"), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// stderr capture (the warning family writes via process.stderr.write and/or
// console.error). The patches stay installed until the awaited call settles, so
// writes that happen after an await inside the consult path are captured too.
// ---------------------------------------------------------------------------
async function captureStderr(fn) {
  const chunks = [];
  const origWrite = process.stderr.write;
  const origErr = console.error;
  process.stderr.write = (s) => { chunks.push(String(s)); return true; };
  console.error = (...a) => { chunks.push(a.map(String).join(" ") + "\n"); };
  try {
    const result = await fn();
    return { result, stderr: chunks.join("") };
  } finally {
    process.stderr.write = origWrite;
    console.error = origErr;
  }
}

// ===========================================================================
console.log("consult.mjs read-only audit tripwire (item 28) — RED-first hermetic suite\n");

// --- (0) the tripwire surface exists on the module --------------------------
const hasSnapshot = typeof consult.workTreeSnapshot === "function";
const hasCompare = typeof consult.compareWorkTree === "function";
const hasPostDone = typeof consult.runPostDoneConsult === "function";
check("(0) consult.mjs exports workTreeSnapshot(repoAbs) → {head, paths} | null", hasSnapshot,
  `(typeof workTreeSnapshot === ${typeof consult.workTreeSnapshot})`);
check("(0) consult.mjs exports compareWorkTree(before, after) → false | true | null", hasCompare,
  `(typeof compareWorkTree === ${typeof consult.compareWorkTree})`);
check("(0) consult.mjs exports runPostDoneConsult({repoRoot, slug, spawn}) — injectable post-done spawn", hasPostDone,
  `(typeof runPostDoneConsult === ${typeof consult.runPostDoneConsult})`);

// --- (1) workTreeSnapshot: {head, paths} from exactly the two git reads -----
if (hasSnapshot) {
  const repo = makeTripwireRepo();
  try {
    const clean = consult.workTreeSnapshot(repo);
    check("(1a) snapshot of a clean git repo is {head: <40-hex sha>, paths: []}",
      !!clean && typeof clean.head === "string" && /^[0-9a-f]{40}$/.test(clean.head) && Array.isArray(clean.paths),
      `(got ${JSON.stringify(clean)})`);
    check("(1b) clean repo → paths is empty (the committed .zcode/ baseline is excluded)",
      Array.isArray(clean && clean.paths) && clean.paths.length === 0,
      `(paths: ${JSON.stringify(clean && clean.paths)})`);

    writeFileSync(join(repo, "work2.txt"), "a new untracked work file\n");
    const dirty = consult.workTreeSnapshot(repo);
    check("(1c) an untracked WORK file appears in snapshot paths",
      Array.isArray(dirty && dirty.paths) && dirty.paths.some((p) => String(p).includes("work2.txt")),
      `(paths: ${JSON.stringify(dirty && dirty.paths)})`);

    mkdirSync(join(repo, ".zcode"), { recursive: true });
    writeFileSync(join(repo, ".zcode", "note.txt"), "bookkeeping\n");
    mkdirSync(join(repo, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "pkg", "i.js"), "generated\n");
    const excluded = consult.workTreeSnapshot(repo);
    check("(1d) .zcode/ and generated-dir entries are EXCLUDED from paths (the copied harness.mjs:276 set)",
      Array.isArray(excluded && excluded.paths) &&
        !excluded.paths.some((p) => String(p).startsWith(".zcode/")) &&
        !excluded.paths.some((p) => /^(node_modules|dist|build|target|coverage|\.cache|\.next)\//.test(String(p))),
      `(paths: ${JSON.stringify(excluded && excluded.paths)})`);
    check("(1e) paths is sorted",
      JSON.stringify(excluded && excluded.paths) === JSON.stringify([...((excluded && excluded.paths) || [])].sort()),
      `(paths: ${JSON.stringify(excluded && excluded.paths)})`);

    const nonGit = makeTripwireRepo(false);
    try {
      const snap = consult.workTreeSnapshot(nonGit);
      check("(1f) non-git repo → snapshot is null (fail-closed, never a silent clean)", snap === null,
        `(got ${JSON.stringify(snap)})`);
    } finally { rmSync(nonGit, { recursive: true, force: true }); }
  } finally { rmSync(repo, { recursive: true, force: true }); }
}

// --- (2) compareWorkTree: the tri-state comparison ---------------------------
if (hasCompare && hasSnapshot) {
  const repo = makeTripwireRepo();
  try {
    const before = consult.workTreeSnapshot(repo);
    check("(2a) identical snapshots → false",
      consult.compareWorkTree(before, consult.workTreeSnapshot(repo)) === false);

    writeFileSync(join(repo, "added.txt"), "new\n");
    const afterAdd = consult.workTreeSnapshot(repo);
    check("(2b) added work path → true", consult.compareWorkTree(before, afterAdd) === true);
    check("(2c) removed work path → true", consult.compareWorkTree(afterAdd, before) === true);
  } finally { rmSync(repo, { recursive: true, force: true }); }

  const repoD = makeTripwireRepo();
  try {
    const b = consult.workTreeSnapshot(repoD);
    appendFileSync(join(repoD, "work.txt"), "mutated\n");
    check("(2d) modified tracked work file → true",
      consult.compareWorkTree(b, consult.workTreeSnapshot(repoD)) === true);
  } finally { rmSync(repoD, { recursive: true, force: true }); }

  const repoE = makeTripwireRepo();
  try {
    const be = consult.workTreeSnapshot(repoE);
    mkdirSync(join(repoE, ".zcode"), { recursive: true });
    writeFileSync(join(repoE, ".zcode", "bookkeeping-only.txt"), "legal\n");
    mkdirSync(join(repoE, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(repoE, "node_modules", "pkg", "i.js"), "generated\n");
    check("(2e) .zcode/-only (and generated-dir) delta → false — exclusion honored",
      consult.compareWorkTree(be, consult.workTreeSnapshot(repoE)) === false);
  } finally { rmSync(repoE, { recursive: true, force: true }); }

  const repoH = makeTripwireRepo();
  try {
    const bh = consult.workTreeSnapshot(repoH);
    moveHead(repoH)();
    check("(2f) HEAD move with clean porcelain → true",
      consult.compareWorkTree(bh, consult.workTreeSnapshot(repoH)) === true);
  } finally { rmSync(repoH, { recursive: true, force: true }); }

  const anySnap = { head: "0".repeat(40), paths: [] };
  check("(2g) compareWorkTree(null, snap) → null (either failed read is indeterminate)",
    consult.compareWorkTree(null, anySnap) === null);
  check("(2g) compareWorkTree(snap, null) → null",
    consult.compareWorkTree(anySnap, null) === null);
  check("(2g) compareWorkTree(null, null) → null",
    consult.compareWorkTree(null, null) === null);
}

// ===========================================================================
console.log("\nsite-level: plan-audit (runPlanAudit — injectable spawn pre-exists)\n");

// --- (3)/(f)/(a-pa) plan-audit site -----------------------------------------
// Tree-resolved fact: runPlanAudit writes state.plan_audit, NOT consult.history —
// so this site's violation is stderr-only. The suite pins BOTH: the warning on
// stderr AND that consult.history stays untouched.
{
  const repo = makeTripwireRepo();
  try {
    const { result, stderr } = await captureStderr(() => consult.runPlanAudit({
      repoRoot: repo, slug: "test-slug", spawn: actingSpawn([mutateWorkFile(repo)]),
    }));
    check("(3a) fixture sanity: plan-audit verdict is still ACCEPT with a mid-window-mutating stub",
      !!result && result.verdict === "ACCEPT", `(got ${JSON.stringify(result && result.verdict)})`);
    check("(f) plan-audit readOnlyViolation=true warns on stderr (both causes named verbatim)",
      warnsViolation(stderr), `(stderr tail: ${JSON.stringify(stderr.slice(-300))})`);
    const st = readState(repo);
    check("(f) plan-audit does NOT write a readOnlyViolation into consult.history (state.plan_audit is its lane)",
      !(st.consult && Array.isArray(st.consult.history) &&
        st.consult.history.some((e) => e && "readOnlyViolation" in e)) &&
        !!st.plan_audit && typeof st.plan_audit === "object",
      `(consult: ${JSON.stringify(st.consult)})`);
  } finally { rmSync(repo, { recursive: true, force: true }); }

  const repoA = makeTripwireRepo();
  try {
    const { stderr } = await captureStderr(() => consult.runPlanAudit({
      repoRoot: repoA, slug: "test-slug", spawn: readOnlySpawn(),
    }));
    check("(a-pa) plan-audit clean window: NO readOnlyViolation warning on stderr",
      !warnsViolation(stderr), `(stderr tail: ${JSON.stringify(stderr.slice(-200))})`);
  } finally { rmSync(repoA, { recursive: true, force: true }); }
}

// ===========================================================================
console.log("\nsite-level: multi-auditor (runMultiAuditor → runSingleAudit × 2)\n");

// --- (4)/(a-ma)/(b-ma)/(d-ma) multi-auditor site ------------------------------
// The consensus history push gains readOnlyViolation as the fail-closed merge of
// the two per-pass values: true if any true, else null if any null, else false.
{
  const repo = makeTripwireRepo();
  try {
    const { result } = await captureStderr(() => consult.runMultiAuditor({
      repoRoot: repo, slug: "test-slug", spawn: readOnlySpawn(),
    }));
    check("(4a) fixture sanity: two agreeing passes reach consensus",
      !!result && !!result.comparison && result.comparison.consensus === true);
    const entry = lastHistoryEntry(readState(repo));
    check("(a-ma) clean window → readOnlyViolation === false in multi-auditor history",
      !!entry && entry.readOnlyViolation === false, `(entry: ${JSON.stringify(entry)})`);
  } finally { rmSync(repo, { recursive: true, force: true }); }

  const repoB = makeTripwireRepo();
  try {
    const { stderr } = await captureStderr(() => consult.runMultiAuditor({
      repoRoot: repoB, slug: "test-slug", spawn: actingSpawn([mutateWorkFile(repoB), null]),
    }));
    const entry = lastHistoryEntry(readState(repoB));
    check("(b-ma) work-file mutation mid-window (pass 1) → readOnlyViolation === true recorded",
      !!entry && entry.readOnlyViolation === true, `(entry: ${JSON.stringify(entry)})`);
    check("(b-ma) the violation warns on stderr (both causes named verbatim)",
      warnsViolation(stderr), `(stderr tail: ${JSON.stringify(stderr.slice(-300))})`);
  } finally { rmSync(repoB, { recursive: true, force: true }); }

  // Fail-closed merge: pass 1 true (mutates work.txt); pass 2's stub deletes
  // .git so ITS after-snapshot git read fails → null. (true, null) → true.
  const repoC = makeTripwireRepo();
  try {
    await captureStderr(() => consult.runMultiAuditor({
      repoRoot: repoC, slug: "test-slug", spawn: actingSpawn([mutateWorkFile(repoC), breakGit(repoC)]),
    }));
    const entry = lastHistoryEntry(readState(repoC));
    check("(4c) multi-auditor merge is fail-closed: (true, null) → true",
      !!entry && entry.readOnlyViolation === true, `(entry: ${JSON.stringify(entry)})`);
  } finally { rmSync(repoC, { recursive: true, force: true }); }

  const repoD = makeTripwireRepo(false);
  try {
    const { stderr } = await captureStderr(() => consult.runMultiAuditor({
      repoRoot: repoD, slug: "test-slug", spawn: readOnlySpawn(),
    }));
    const entry = lastHistoryEntry(readState(repoD));
    check("(d-ma) non-git repo → readOnlyViolation === null in multi-auditor history (fail-closed)",
      !!entry && entry.readOnlyViolation === null, `(entry: ${JSON.stringify(entry)})`);
    check("(d-ma) null does NOT warn (indeterminate is not a violation)",
      !warnsViolation(stderr));
  } finally { rmSync(repoD, { recursive: true, force: true }); }
}

// ===========================================================================
console.log("\nsite-level: post-done (runPostDoneConsult — export + injectable spawn are the tripwire refactor)\n");

// --- (5)/(a-pd)..(e-pd) post-done site ----------------------------------------
if (hasPostDone) {
  const repo = makeTripwireRepo();
  try {
    const { result, stderr } = await captureStderr(() =>
      consult.runPostDoneConsult({ repoRoot: repo, slug: "test-slug", spawn: readOnlySpawn() }));
    check("(5a) runPostDoneConsult RETURNS the normalized verdict (never process.exit)",
      !!result && result.verdict === "ACCEPT", `(got ${JSON.stringify(result)})`);
    const entry = lastHistoryEntry(readState(repo));
    check("(a-pd) clean window → readOnlyViolation === false in post-done history, beside audit_head",
      !!entry && entry.readOnlyViolation === false && typeof entry.audit_head === "string",
      `(entry: ${JSON.stringify(entry)})`);
    check("(a-pd) clean window does not warn", !warnsViolation(stderr));
  } finally { rmSync(repo, { recursive: true, force: true }); }

  const repoB = makeTripwireRepo();
  try {
    const { stderr } = await captureStderr(() =>
      consult.runPostDoneConsult({ repoRoot: repoB, slug: "test-slug", spawn: actingSpawn([mutateWorkFile(repoB)]) }));
    const entry = lastHistoryEntry(readState(repoB));
    check("(b-pd) work-file mutation mid-window → readOnlyViolation === true recorded",
      !!entry && entry.readOnlyViolation === true, `(entry: ${JSON.stringify(entry)})`);
    check("(b-pd) the violation warns on stderr (both causes named verbatim)",
      warnsViolation(stderr), `(stderr tail: ${JSON.stringify(stderr.slice(-300))})`);
  } finally { rmSync(repoB, { recursive: true, force: true }); }

  const repoC = makeTripwireRepo();
  try {
    const { stderr } = await captureStderr(() =>
      consult.runPostDoneConsult({ repoRoot: repoC, slug: "test-slug", spawn: actingSpawn([touchExcludedPath(repoC)]) }));
    const entry = lastHistoryEntry(readState(repoC));
    check("(c-pd) .zcode/-only + node_modules delta → readOnlyViolation === false (exclusion honored)",
      !!entry && entry.readOnlyViolation === false, `(entry: ${JSON.stringify(entry)})`);
    check("(c-pd) excluded-path delta does not warn", !warnsViolation(stderr));
  } finally { rmSync(repoC, { recursive: true, force: true }); }

  const repoD = makeTripwireRepo(false);
  try {
    const { stderr } = await captureStderr(() =>
      consult.runPostDoneConsult({ repoRoot: repoD, slug: "test-slug", spawn: readOnlySpawn() }));
    const entry = lastHistoryEntry(readState(repoD));
    check("(d-pd) non-git repo → readOnlyViolation === null in post-done history (fail-closed)",
      !!entry && entry.readOnlyViolation === null, `(entry: ${JSON.stringify(entry)})`);
    check("(d-pd) null does NOT warn (indeterminate is not a violation)", !warnsViolation(stderr));
  } finally { rmSync(repoD, { recursive: true, force: true }); }

  const repoE = makeTripwireRepo();
  try {
    const { stderr } = await captureStderr(() =>
      consult.runPostDoneConsult({ repoRoot: repoE, slug: "test-slug", spawn: actingSpawn([moveHead(repoE)]) }));
    const entry = lastHistoryEntry(readState(repoE));
    check("(e-pd) HEAD move with clean porcelain → readOnlyViolation === true",
      !!entry && entry.readOnlyViolation === true, `(entry: ${JSON.stringify(entry)})`);
    check("(e-pd) the HEAD-move violation warns (both causes named verbatim)",
      warnsViolation(stderr), `(stderr tail: ${JSON.stringify(stderr.slice(-300))})`);
  } finally { rmSync(repoE, { recursive: true, force: true }); }
}

// ===========================================================================
console.log("\npaired probe (brief §Paired probe): read-only stub vs write-first stub\n");

// --- (g) record-not-mutate: the same canned verdict, two different windows ----
if (hasPostDone) {
  const repo1 = makeTripwireRepo();
  const repo2 = makeTripwireRepo();
  try {
    const run1 = await captureStderr(() =>
      consult.runPostDoneConsult({ repoRoot: repo1, slug: "test-slug", spawn: readOnlySpawn() }));
    const run2 = await captureStderr(() =>
      consult.runPostDoneConsult({ repoRoot: repo2, slug: "test-slug", spawn: actingSpawn([
        () => writeFileSync(join(repo2, "probe.txt"), "x\n"),
      ]) }));

    const e1 = lastHistoryEntry(readState(repo1));
    const e2 = lastHistoryEntry(readState(repo2));
    check("(g1) probe run 1 (read-only stub) → readOnlyViolation === false in history",
      !!e1 && e1.readOnlyViolation === false, `(entry: ${JSON.stringify(e1)})`);
    check("(g2) probe run 2 (write-first stub) → readOnlyViolation === true in history",
      !!e2 && e2.readOnlyViolation === true, `(entry: ${JSON.stringify(e2)})`);
    check("(g2) fixture sanity: the probe file really landed in run 2's repo",
      existsSync(join(repo2, "probe.txt")));
    const text1 = run1.result
      ? JSON.stringify({ verdict: run1.result.verdict, summary: run1.result.summary, gaps: run1.result.gaps, advisories: run1.result.advisories })
      : "(run 1 returned no verdict)";
    const text2 = run2.result
      ? JSON.stringify({ verdict: run2.result.verdict, summary: run2.result.summary, gaps: run2.result.gaps, advisories: run2.result.advisories })
      : "(run 2 returned no verdict)";
    check("(g3) verdict text is byte-identical between the two probe runs (record-not-mutate)",
      text1 === text2 && text1.length > 0 && !text1.startsWith("(run"),
      `(\n    run1: ${text1}\n    run2: ${text2}\n  )`);
  } finally {
    rmSync(repo1, { recursive: true, force: true });
    rmSync(repo2, { recursive: true, force: true });
  }
}

// ===========================================================================
console.log(`\n${pass}/${pass + fail} passed`);
summaryPrinted = true;
process.exit(fail === 0 ? 0 : 1);
