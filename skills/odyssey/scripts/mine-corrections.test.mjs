#!/usr/bin/env node
// mine-corrections.test.mjs — hermetic black-box tests for mine-corrections.mjs
// (item 25: the eval-loop meta-layer — staging-only corpus miner).
//
// Black-box subprocess tests, same harness discipline as recall-corrections.test.mjs:28-73
// (each case builds its OWN tmp repo + corpora fixture via mkdtempSync, spawns the script
// with spawnSync so stderr is captured even on exit-0 paths, counts check/pass/fail, tears
// everything down in a finally). The suite runs the miner binary directly against fixture
// corpora — it never spawns the test runner, so no ZODYSSEY_EVAL_LANE declaration is made
// here (run-tests.mjs declares it suite-wide when this suite runs under it).
//
// HERMETICITY: every spawn resolves corpora via a FIXTURE — `--corpora <mkdtemp dir>` argv,
// or (case j) ZODYSSEY_EVAL_DIR pointed at a fixture — and every other spawn pins
// ZODYSSEY_EVAL_DIR at an EMPTY tmp dir (the registry-report.test.mjs:44-52 precedent:
// without the pin, a spawn without --corpora inherits the operator's real corpus and every
// count assertion goes nondeterministic). The suite never reads ~/.zcode/orchestration/.
//
// Fixture shapes (sampled from the real corpora 2026-08-22): judged.jsonl record
// {seed_id, slug, arm, at, criterion_results:[{criterion, met, evidence}]}; results.jsonl
// record {slug, intent, phase, verdict, success, generated_at}; state consult gaps carry
// `category` from the closed set compliance|bug|quality|security. Fixture slugs never end
// in "-baseline" — judged-lane recurrence counts only zodyssey-arm records (armFromSlug).
//
// Cases (a)-(k) from the item-25 plan, todo 1:
//   (a) GREEN         — 3 distinct slugs share ONE identical failing count-grep criterion
//                       (`test $(grep -c …) -eq N` — the lane's dominant executable form)
//                       → exactly ONE proposal, dated from the NEWEST corpus stamp, citing
//                       all 3 slugs + the verbatim (clean ⇒ sanitized-identical) criterion.
//   (b) 2-RECURRENCE  — same shape across only 2 distinct slugs → zero files, exit 0.
//   (c) HOSTILE DEDUPE — the SAME slug ×3 records (re-judges, distinct stamps) → ZERO
//                       proposals: recurrence counts DISTINCT slugs.
//   (d) STAGING GUARD — tmp-tree snapshot (repo + corpora, sha256 per file) before/after
//                       → only .zcode/staging/proposals/** changed; corpora byte-identical.
//   (e) HOSTILE EVIDENCE — criterion/slug text with ../ traversal, control chars, embedded
//                       newlines → filename stays [a-z0-9-]-safe, content sanitized (no
//                       control chars, whitespace collapsed), nothing outside proposals.
//   (f) DETERMINISM   — run twice on the same fixture → identical file-set + content, no
//                       accumulation (supersede, not append).
//   (g) NO-OP        — absent corpora dir → exit 0 + message, zero files.
//   (h) NO ARG       — zero args → exit 2 + usage on stderr.
//   (i) STATE CLASS  — ≥3 distinct slugs with the same consult-gap category in
//                       .zcode/state/*.json → one proposal citing the 3 slugs.
//   (j) ENV DEFAULT  — spawn without --corpora but ZODYSSEY_EVAL_DIR=<fixture> → the
//                       fixture is read (second precedence level honored).
//   (k) PRUNE        — ≥3-recurrence fixture mined (proposal exists), then re-mined after
//                       the pattern dropped to 2 qualifying slugs → the old
//                       *-<pattern-id>.md is GONE (staging IS the pending set; orphans
//                       never accumulate).
//
// Run:  node mine-corrections.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { exit } from "node:process";
import { createHash } from "node:crypto";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const MC = join(SCRIPT_DIR, "mine-corrections.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  \u2713 ${name}`); pass++; }
  else { console.log(`  \u2717 ${name} ${detail}`); fail++; }
}

// Shared IMMUTABLE empty dir (created once, never written after) that pins the corpora
// default for every spawn which does not override it. Case (j) overrides it positively.
const EMPTY_EVAL_DIR = mkdtempSync(join(tmpdir(), "zod-mc-evalempty-"));

// Spawn the miner. `repo`/`corpora` undefined → argv omits them (case h passes neither).
// Every spawn inherits ZODYSSEY_EVAL_DIR=EMPTY_EVAL_DIR unless envExtra overrides — no
// spawn can reach the operator's real corpora at ~/.zcode/orchestration/eval.
function runMine({ repo, corpora, args = [], envExtra = {} } = {}) {
  const cliArgs = [];
  if (repo !== undefined) cliArgs.push(repo);
  if (corpora !== undefined) cliArgs.push("--corpora", corpora);
  cliArgs.push(...args);
  const res = spawnSync("node", [MC, ...cliArgs], {
    encoding: "utf8",
    env: { ...process.env, ZODYSSEY_EVAL_DIR: EMPTY_EVAL_DIR, ...envExtra },
  });
  return { code: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
const exitDetail = (r) => `(got exit ${r.code}, stderr: ${r.stderr.slice(0, 160)})`;

// --- fixture builders (fresh mkdtemp per call — no shared mutable fixture state) -----------
const crit = (criterion, met = false) => ({ criterion, met, evidence: "" });
const judgedLine = (slug, criteria, at) => JSON.stringify({
  seed_id: `seed-${slug.replace(/[^a-z0-9-]/gi, "") || "x"}`,
  slug, arm: "zodyssey", at, overall: 0.5, criterion_results: criteria,
});
const resultsLine = (slug, at) => JSON.stringify({
  slug, intent: "impl", phase: "done", verdict: "pass", success: true, generated_at: at,
});
function makeCorpora(judgedLines, resultsLines) {
  const dir = mkdtempSync(join(tmpdir(), "zod-mc-corpora-"));
  writeFileSync(join(dir, "judged.jsonl"), judgedLines.join("\n") + (judgedLines.length ? "\n" : ""));
  writeFileSync(join(dir, "results.jsonl"), resultsLines.join("\n") + (resultsLines.length ? "\n" : ""));
  return dir;
}
function makeRepo() { return mkdtempSync(join(tmpdir(), "zod-mc-repo-")); }
function writeState(dir, slug, obj) {
  mkdirSync(join(dir, ".zcode", "state"), { recursive: true });
  writeFileSync(join(dir, ".zcode", "state", `${slug}.json`), JSON.stringify(obj, null, 2));
}
function proposalsDir(repo) { return join(repo, ".zcode", "staging", "proposals"); }
function listProposals(repo) {
  try { return readdirSync(proposalsDir(repo)).filter((f) => f.endsWith(".md")).sort(); }
  catch { return []; }
}
function readProposal(repo, name) { return readFileSync(join(proposalsDir(repo), name), "utf8"); }

// The canonical QUALIFYING fixture: 3 distinct slugs, one IDENTICAL failing count-grep
// criterion. Identical text = one shape under any normalizer design, and the `test
// $(grep -c …) -eq N` form is the lane's dominant executable shape — class (i) must
// recognize it or it can never fire on the lane it was induced from.
const CANON_CRIT = 'test $(grep -c "usage:" docs/INSTALL.md) -eq 3';
function makeQualifyingCorpora() {
  const slugs = ["impl-90-a", "impl-91-b", "impl-92-c"];
  const judgedLines = slugs.map((s, i) =>
    judgedLine(s, [crit(CANON_CRIT, false), crit("node --check passes", true)], `2026-08-0${i + 1}T10:00:00Z`));
  const resultsLines = slugs.map((s, i) => resultsLine(s, `2026-08-0${i + 1}T10:00:00Z`));
  return { dir: makeCorpora(judgedLines, resultsLines), slugs, judgedLines, resultsLines };
}

// Staging-guard helpers: snapshot a tree as relpath → sha256(content), then diff.
function snapshotTree(root) {
  const files = new Map();
  const walk = (dir, rel) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r);
      else {
        try { files.set(r, createHash("sha256").update(readFileSync(join(dir, e.name))).digest("hex")); }
        catch { files.set(r, "<unreadable>"); }
      }
    }
  };
  walk(root, "");
  return files;
}
function changedPaths(before, after) {
  const out = [];
  for (const k of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(k) !== after.get(k)) out.push(k);
  }
  return out.sort();
}
// Control chars that must NEVER survive sanitization. \n (0x0a), \t (0x09) and \r (0x0d)
// are excluded — the proposal is markdown and owns its own structural whitespace; the
// check targets injected \x00/\x01/\x02/\x1f/\x7f etc. from hostile evidence.
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const NAME_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/;

console.log("mine-corrections.mjs \u2014 hermetic suite (item 25, cases a-k)\n");

// --- (a) GREEN — 3 distinct slugs, one identical failing criterion → ONE proposal ---------
{
  const repo = makeRepo();
  const fx = makeQualifyingCorpora();
  try {
    const r = runMine({ repo, corpora: fx.dir });
    check("(a) green → exit 0", r.code === 0, exitDetail(r));
    const files = listProposals(repo);
    check("(a) green → exactly ONE proposal file (met:true criteria do not multiply it)",
      files.length === 1, `(got ${files.length}: ${files.join(", ")})`);
    check("(a) green → filename is <date>-<pattern-id>.md over charset [a-z0-9-]",
      files.length === 1 && NAME_RE.test(files[0]), `(names: ${files.join(", ")})`);
    check("(a) green → filename date = NEWEST corpus stamp (2026-08-03), not wall clock",
      files.length === 1 && files[0].startsWith("2026-08-03-"), `(names: ${files.join(", ")})`);
    const content = files.length === 1 ? readProposal(repo, files[0]) : "";
    check("(a) green → proposal cites all 3 distinct slugs",
      fx.slugs.every((s) => content.includes(s)), `(content head: ${content.slice(0, 200)})`);
    check("(a) green → proposal cites the failing criterion verbatim (clean text ⇒ sanitized-identical)",
      content.includes(CANON_CRIT), `(criterion absent: ${CANON_CRIT})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fx.dir, { recursive: true, force: true });
  }
}

// --- (b) 2-RECURRENCE — below threshold → zero files, exit 0 ------------------------------
{
  const repo = makeRepo();
  const slugs = ["impl-93-a", "impl-93-b"];
  const judged = slugs.map((s, i) => judgedLine(s, [crit(CANON_CRIT, false)], `2026-08-0${i + 1}T11:00:00Z`));
  const corpora = makeCorpora(judged, slugs.map((s, i) => resultsLine(s, `2026-08-0${i + 1}T11:00:00Z`)));
  try {
    const r = runMine({ repo, corpora });
    check("(b) 2-recurrence → exit 0 (below threshold is a clean no-op, not an error)",
      r.code === 0, exitDetail(r));
    check("(b) 2-recurrence → zero proposal files",
      listProposals(repo).length === 0, `(got: ${listProposals(repo).join(", ")})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(corpora, { recursive: true, force: true });
  }
}

// --- (c) HOSTILE DEDUPE — same slug ×3 records (re-judges) → ZERO proposals ---------------
{
  const repo = makeRepo();
  const slug = "rejudge-run";
  const judged = [1, 2, 3].map((n) =>
    judgedLine(slug, [crit(CANON_CRIT, false)], `2026-08-0${n}T12:0${n}:00Z`));
  const corpora = makeCorpora(judged, [resultsLine(slug, "2026-08-03T12:03:00Z")]);
  try {
    const r = runMine({ repo, corpora });
    check("(c) same-slug ×3 → exit 0", r.code === 0, exitDetail(r));
    check("(c) same-slug ×3 → ZERO proposals (recurrence counts DISTINCT slugs; re-judges dedupe per slug)",
      listProposals(repo).length === 0, `(got: ${listProposals(repo).join(", ")})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(corpora, { recursive: true, force: true });
  }
}

// --- (d) STAGING GUARD — only .zcode/staging/proposals/** may change -----------------------
{
  const repo = makeRepo();
  const fx = makeQualifyingCorpora();
  try {
    // Rich tree: state files the miner must READ but never mutate, plus unrelated repo files.
    writeState(repo, "guard-run", { slug: "guard-run", phase: "done" });
    writeState(repo, "guard-run-2", { slug: "guard-run-2", phase: "done" });
    mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
    writeFileSync(join(repo, ".zcode", "plans", "plan.md"), "# plan\n");
    writeFileSync(join(repo, "README.md"), "# repo\n");
    const before = snapshotTree(repo);
    const corporaBefore = snapshotTree(fx.dir);
    const r = runMine({ repo, corpora: fx.dir });
    check("(d) staging guard → exit 0", r.code === 0, exitDetail(r));
    const changed = changedPaths(before, snapshotTree(repo));
    check("(d) staging guard → something WAS written (the guard is not vacuous)",
      changed.length > 0, "(no changes detected under the tmp repo)");
    check("(d) staging guard → ONLY .zcode/staging/proposals/** changed",
      changed.every((p) => p.startsWith(".zcode/staging/proposals/")),
      `(changed: ${changed.join(", ")})`);
    const corporaDrift = changedPaths(corporaBefore, snapshotTree(fx.dir));
    check("(d) staging guard → corpora fixture byte-identical (read-only input)",
      corporaDrift.length === 0, `(corpora drift: ${corporaDrift.join(", ")})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fx.dir, { recursive: true, force: true });
  }
}

// --- (e) HOSTILE EVIDENCE — traversal, control chars, embedded newlines -------------------
{
  const repo = makeRepo();
  // The hostile criterion keeps the `test $(grep -c …) -eq 3` bracket structure so the
  // count-grep family still recognizes it once sanitized; the hostile payload lives inside.
  const hostileCriterion = 'test $(grep -c "../etc/p\x01asswd\nFLAG" guard.md) -eq 3';
  const hostileSlugs = ["../evil-a\x01", "../evil-b\x02", "evil-c\nrm -rf /"];
  const judged = hostileSlugs.map((s, i) =>
    judgedLine(s, [crit(hostileCriterion, false)], `2026-08-0${i + 1}T13:00:00Z`));
  const corpora = makeCorpora(judged, []);
  try {
    const before = snapshotTree(repo);
    const r = runMine({ repo, corpora });
    check("(e) hostile evidence → exit 0", r.code === 0, exitDetail(r));
    const files = listProposals(repo);
    check("(e) hostile evidence → exactly one proposal (3 DISTINCT hostile slugs do qualify)",
      files.length === 1, `(got ${files.length}: ${files.join(", ")})`);
    check("(e) hostile evidence → filename stays [a-z0-9-]-safe (no ../, control chars, newlines)",
      files.length === 1 && NAME_RE.test(files[0]), `(names: ${files.join(", ")})`);
    const content = files.length === 1 ? readProposal(repo, files[0]) : "";
    check("(e) hostile evidence → content has NO control chars (san() strip held)",
      !CTRL.test(content), "(found \\x00-\\x08, \\x0b, \\x0c, \\x0e-\\x1f or \\x7f in the proposal)");
    check("(e) hostile evidence → criterion cited SANITIZED (controls → space, whitespace collapsed)",
      content.includes("../etc/p asswd FLAG"), "(the sanitized fragment is absent)");
    check("(e) hostile evidence → hostile slugs cited sanitized, not dropped",
      content.includes("../evil-a") && content.includes("../evil-b") && content.includes("evil-c rm -rf /"),
      "(sanitized slug citations are absent)");
    const changed = changedPaths(before, snapshotTree(repo));
    check("(e) hostile evidence → nothing written outside proposals (traversal cannot escape staging)",
      changed.every((p) => p.startsWith(".zcode/staging/proposals/")),
      `(changed: ${changed.join(", ")})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(corpora, { recursive: true, force: true });
  }
}

// --- (f) DETERMINISM — same fixture twice → identical file-set + content -------------------
{
  const repo = makeRepo();
  const fx = makeQualifyingCorpora();
  try {
    const r1 = runMine({ repo, corpora: fx.dir });
    check("(f) determinism → run 1 exit 0", r1.code === 0, exitDetail(r1));
    const after1 = listProposals(repo);
    check("(f) determinism → run 1 wrote exactly one proposal",
      after1.length === 1, `(got ${after1.length})`);
    const content1 = after1.length === 1 ? readProposal(repo, after1[0]) : "";
    const r2 = runMine({ repo, corpora: fx.dir });
    check("(f) determinism → run 2 exit 0", r2.code === 0, exitDetail(r2));
    const after2 = listProposals(repo);
    check("(f) determinism → identical file-set after re-mine (supersede, no accumulation)",
      after1.length === 1 && after2.length === 1 && after1[0] === after2[0],
      `(run1: ${after1.join(",")} | run2: ${after2.join(",")})`);
    check("(f) determinism → byte-identical content across runs",
      after2.length === 1 && readProposal(repo, after2[0]) === content1, "(proposal content drifted)");
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fx.dir, { recursive: true, force: true });
  }
}

// --- (g) NO-OP — absent corpora dir → exit 0 + message -------------------------------------
{
  const repo = makeRepo();
  const absent = join(tmpdir(), "zod-mc-absent-corpora-"); // deliberately never created
  try {
    const r = runMine({ repo, corpora: absent });
    check("(g) absent corpora → exit 0 (graceful no-op)", r.code === 0, exitDetail(r));
    check("(g) absent corpora → a no-op message on stdout/stderr",
      /(corpora|corpus|mine|mining|no-op)/i.test(r.stdout + r.stderr),
      `(stdout+stderr: ${(r.stdout + r.stderr).slice(0, 200)})`);
    check("(g) absent corpora → zero proposal files",
      listProposals(repo).length === 0, `(got: ${listProposals(repo).join(", ")})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(absent, { recursive: true, force: true });
  }
}

// --- (h) NO ARG — zero args → exit 2 + usage ------------------------------------------------
{
  const r = runMine({ args: [] });
  check("(h) no arg → exit 2 (bad args)", r.code === 2, exitDetail(r));
  check("(h) no arg → usage on stderr", /usage:/i.test(r.stderr),
    `(stderr: ${r.stderr.slice(0, 160)})`);
}

// --- (i) STATE CLASS — ≥3 slugs, same consult-gap category → one proposal ------------------
{
  const repo = makeRepo();
  // Corpora present + non-empty but with ZERO failing criteria — the only qualifying
  // pattern can come from the state class (and an early no-op on empty corpora cannot
  // mask the state lane).
  const corpora = makeCorpora(
    [judgedLine("quiet-run", [crit("node --check passes", true)], "2026-08-01T14:00:00Z")],
    [resultsLine("quiet-run", "2026-08-01T14:00:00Z")],
  );
  const gapSlugs = ["gap-run-1", "gap-run-2", "gap-run-3"];
  try {
    gapSlugs.forEach((s, i) => {
      writeState(repo, s, {
        slug: s,
        phase: "done",
        review: { verdict: "OKAY", round: 1 },
        consult: {
          rounds: 1,
          history: [{
            round: 1,
            at: `2026-08-0${i + 1}T15:00:00Z`,
            verdict: "REJECT",
            gaps: [{
              category: "compliance",
              severity: "major",
              issue: `plan section ${i} cites an unrun command`,
              fix: "run the command",
            }],
            advisories: [],
          }],
        },
      });
    });
    const r = runMine({ repo, corpora });
    check("(i) state class → exit 0", r.code === 0, exitDetail(r));
    const files = listProposals(repo);
    check("(i) state class → exactly one proposal from the shared consult-gap category",
      files.length === 1, `(got ${files.length}: ${files.join(", ")})`);
    check("(i) state class → filename is <date>-<pattern-id>.md over charset [a-z0-9-]",
      files.length === 1 && NAME_RE.test(files[0]), `(names: ${files.join(", ")})`);
    const content = files.length === 1 ? readProposal(repo, files[0]) : "";
    check("(i) state class → proposal cites the 3 state-run slugs",
      gapSlugs.every((s) => content.includes(s)), `(content head: ${content.slice(0, 200)})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(corpora, { recursive: true, force: true });
  }
}

// --- (j) ENV DEFAULT — ZODYSSEY_EVAL_DIR=<fixture> (no --corpora) is read ------------------
{
  const repo = makeRepo();
  const fx = makeQualifyingCorpora();
  try {
    const r = runMine({ repo, envExtra: { ZODYSSEY_EVAL_DIR: fx.dir } });
    check("(j) env default → exit 0", r.code === 0, exitDetail(r));
    const files = listProposals(repo);
    check("(j) env default → the ZODYSSEY_EVAL_DIR fixture was read (one proposal)",
      files.length === 1, `(got ${files.length}: ${files.join(", ")})`);
    const content = files.length === 1 ? readProposal(repo, files[0]) : "";
    check("(j) env default → proposal cites the fixture's 3 slugs",
      fx.slugs.every((s) => content.includes(s)), `(content head: ${content.slice(0, 200)})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fx.dir, { recursive: true, force: true });
  }
}

// --- (k) PRUNE — pattern drops below threshold on re-mine → orphan is removed --------------
{
  const repo = makeRepo();
  const fx = makeQualifyingCorpora();
  try {
    const r1 = runMine({ repo, corpora: fx.dir });
    check("(k) prune → mine 1 exit 0", r1.code === 0, exitDetail(r1));
    const files1 = listProposals(repo);
    check("(k) prune → mine 1: the ≥3-recurrence proposal exists",
      files1.length === 1, `(got ${files1.length}: ${files1.join(", ")})`);
    // MUTATE the case-local fixture: drop the third slug's records → the pattern drops to
    // 2 qualifying distinct slugs (below the ≥3 threshold).
    writeFileSync(join(fx.dir, "judged.jsonl"), fx.judgedLines.slice(0, 2).join("\n") + "\n");
    writeFileSync(join(fx.dir, "results.jsonl"), fx.resultsLines.slice(0, 2).join("\n") + "\n");
    const r2 = runMine({ repo, corpora: fx.dir });
    check("(k) prune → mine 2 (mutated fixture) exit 0", r2.code === 0, exitDetail(r2));
    const files2 = listProposals(repo);
    check("(k) prune → the old *-<pattern-id>.md is GONE",
      files1.length === 1 && !files2.includes(files1[0]),
      `(still present: ${files1.filter((f) => files2.includes(f)).join(", ")})`);
    check("(k) prune → zero proposals remain (orphans never accumulate)",
      files2.length === 0, `(leftover: ${files2.join(", ")})`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(fx.dir, { recursive: true, force: true });
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
rmSync(EMPTY_EVAL_DIR, { recursive: true, force: true });
exit(fail === 0 ? 0 : 1);
