#!/usr/bin/env node
// registry-report.test.mjs — black-box subprocess tests for registry-report.mjs (queue row 19).
//
// WHY THIS EXISTS: the narrator trust registry is the cross-run meta-layer the eval loop lacked —
// deterministic arithmetic over consult verdicts and judge criterion results, keyed on agent-config
// content hashes (ISNAD R2 + the stochastic-narrator rule). A trust score that metis will weigh at
// consult is a load-bearing number, so its writer gets the same hermetic-suite treatment as the
// recall twins. Key properties under test: the attribution rules (ACCEPT→momus ✓, compliance
// gap→momus ✗, bug/quality/security gap→executor ✗, judged criterion→executor ✓/✗), Laplace trust
// with n always shown, idempotent re-scan (stable evidence ids), baseline judged records excluded,
// --store/ZODYSSEY_EVAL_DIR overrides, malformed-state tolerance, and exit codes.
//
// Cases:
//   (a) no args → 2        (b) no state dir → 3      (c) ACCEPT round → momus s=1 trust 0.67
//   (d) REJECT w/ compliance+bug+unknown gaps → momus m=1, executor m=1, unknown skipped loudly
//   (e) idempotent re-scan (0 new rows, same entries)  (f) --store honored, valid JSONL written
//   (g) --json shape + --min-n filter                    (h) judge lane: met true/false counted,
//   -baseline slug ignored                                (i) malformed state → stderr warn, exit 0
//   (j) no crash output anywhere
//
// Run:  node registry-report.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const RR = join(SCRIPT_DIR, "registry-report.mjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const NO_CRASH = /SyntaxError|node:internal|\n {4}at /;

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "zod-reg-"));
  mkdirSync(join(dir, ".zcode", "state"), { recursive: true });
  return dir;
}
function writeState(dir, slug, obj) {
  writeFileSync(join(dir, ".zcode", "state", `${slug}.json`), JSON.stringify(obj, null, 2));
}
// The judge lane reads a GLOBAL file (~/.zcode/orchestration/eval/judged.jsonl) — the operator's
// real 5-record corpus. Without pinning ZODYSSEY_EVAL_DIR at an empty dir, fixtures inherit real
// judge evidence and every count assertion becomes nondeterministic. (Found the honest way: the
// first run of this suite ingested s=7 m=3 of real criterion results into a "hermetic" fixture.)
const EMPTY_EVAL_DIR = mkdtempSync(join(tmpdir(), "zod-reg-evalempty-"));
function run(args, extraEnv = {}) {
  const r = spawnSync("node", [RR, ...args], {
    encoding: "utf8",
    env: { ...process.env, ZODYSSEY_EVAL_DIR: EMPTY_EVAL_DIR, ...extraEnv },
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
const OKAY = { verdict: "OKAY", round: 1 };
const gap = (category) => ({ category, severity: "major", issue: "x", fix: "y" });

console.log("registry-report.mjs — narrator trust registry (ISNAD R2)\n");

// --- (a)/(b) argv + state-dir exits -------------------------------------------
{
  check("(a) no args → exit 2", run([]).code === 2);
  const bare = mkdtempSync(join(tmpdir(), "zod-reg-bare-"));
  try { check("(b) no state dir → exit 3", run([bare]).code === 3); }
  finally { rmSync(bare, { recursive: true, force: true }); }
}

// --- (c) ACCEPT round → momus success -------------------------------------------
{
  const repo = makeRepo();
  const store = mkdtempSync(join(tmpdir(), "zod-reg-store1-"));
  try {
    writeState(repo, "r1", { slug: "r1", review: OKAY, consult: { rounds: 1, history: [
      { round: 1, at: "2026-08-17T10:00:00Z", verdict: "ACCEPT", gaps: [], advisories: [] }] } });
    const r = run([repo, "--json", "--store", store]);
    check("(c) exit 0", r.code === 0, `got ${r.code}`);
    check("(j) no crash output", !NO_CRASH.test(r.stdout + r.stderr));
    const j = JSON.parse(r.stdout);
    const momus = j.entries.find((e) => e.agent === "momus");
    check("(c) momus entry present with key hash shape", !!momus && /^momus@[0-9a-f]{12}$/.test(momus.key), JSON.stringify(momus && momus.key));
    check("(c) momus s=1 m=0 n=1", momus && momus.success === 1 && momus.miss === 0 && momus.n === 1);
    check("(c) momus trust 0.67 (Laplace (1+1)/(1+2))", momus && momus.trust === 0.67, `got ${momus && momus.trust}`);
    check("(c) no judge-assumption marker on consult-only evidence", momus && !momus.assumed_current_config);
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); }
}

// --- (d) REJECT with compliance + bug + unknown-category gaps ---------------------
{
  const repo = makeRepo();
  const store = mkdtempSync(join(tmpdir(), "zod-reg-store2-"));
  try {
    writeState(repo, "r2", { slug: "r2", review: OKAY, consult: { rounds: 1, history: [
      { round: 1, at: "2026-08-17T11:00:00Z", verdict: "REJECT",
        gaps: [gap("compliance"), gap("bug"), gap("weird-unknown")], advisories: [] }] } });
    const r = run([repo, "--json", "--store", store]);
    check("(d) exit 0", r.code === 0, `got ${r.code}`);
    const j = JSON.parse(r.stdout);
    const momus = j.entries.find((e) => e.agent === "momus");
    const exec = j.entries.find((e) => e.agent === "sisyphus-junior");
    check("(d) compliance gap → momus miss (m=1, trust 0.33)", momus && momus.miss === 1 && momus.trust === 0.33, JSON.stringify(momus));
    check("(d) bug gap → executor miss (m=1, trust 0.33)", exec && exec.miss === 1 && exec.trust === 0.33, JSON.stringify(exec));
    check("(d) unknown gap category skipped with stderr warning", /unknown category "weird-unknown"/.test(r.stderr));
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); }
}

// --- (e) idempotence + (f) store honored + (g) --min-n ---------------------------
{
  const repo = makeRepo();
  const store = mkdtempSync(join(tmpdir(), "zod-reg-store3-"));
  try {
    writeState(repo, "r3", { slug: "r3", review: OKAY, consult: { history: [
      { round: 1, at: "2026-08-17T12:00:00Z", verdict: "ACCEPT", gaps: [] }] } });
    const first = run([repo, "--json", "--store", store]);
    const second = run([repo, "--json", "--store", store]);
    check("(e) re-scan records 0 new evidence rows", JSON.parse(second.stdout).evidence_rows_new === 0);
    check("(e) entries identical across re-scans",
      JSON.stringify(JSON.parse(first.stdout).entries) === JSON.stringify(JSON.parse(second.stdout).entries));
    const ledgerPath = join(store, "narrators.jsonl");
    check("(f) --store honored: narrators.jsonl written", existsSync(ledgerPath));
    const lines = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim());
    check("(f) valid JSONL rows", lines.length === 1 && (() => { try { JSON.parse(lines[0]); return true; } catch { return false; } })());
    const filtered = run([repo, "--json", "--store", store, "--min-n", "5"]);
    check("(g) --min-n 5 filters the n=1 entry out", JSON.parse(filtered.stdout).entries.length === 0);
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); }
}

// --- (h) judge lane: zodyssey counted, baseline ignored ---------------------------
{
  const repo = makeRepo(); // no state files with consult → only judge evidence
  const store = mkdtempSync(join(tmpdir(), "zod-reg-store4-"));
  const evalDir = mkdtempSync(join(tmpdir(), "zod-reg-eval-"));
  try {
    writeFileSync(join(evalDir, "judged.jsonl"), [
      JSON.stringify({ seed_id: "std-01", slug: "std-01-zodyssey", arm: "zodyssey", at: "2026-08-01T20:43:12Z", overall: 0.6,
        criterion_results: [{ criterion: "a", met: true, evidence: "" }, { criterion: "b", met: false, evidence: "" }] }),
      JSON.stringify({ seed_id: "std-01", slug: "std-01-baseline", arm: "zodyssey", at: "2026-08-01T20:47:01Z", overall: 0.5,
        criterion_results: [{ criterion: "a", met: false, evidence: "" }] }),
    ].join("\n") + "\n");
    const r = run([repo, "--json", "--store", store], { ZODYSSEY_EVAL_DIR: evalDir });
    check("(h) exit 0", r.code === 0, `got ${r.code}`);
    const j = JSON.parse(r.stdout);
    check("(h) one zodyssey judged record scanned", j.judge_records === 1, `got ${j.judge_records}`);
    const exec = j.entries.find((e) => e.agent === "sisyphus-junior");
    check("(h) executor s=1 m=1 n=2 from met true/false", exec && exec.success === 1 && exec.miss === 1 && exec.n === 2, JSON.stringify(exec));
    check("(h) trust 0.5 ((1+1)/(2+2)) — baseline miss NOT counted", exec && exec.trust === 0.5, `got ${exec && exec.trust}`);
    check("(h) judge evidence carries assumed_current_config", exec && exec.assumed_current_config === true);
    // re-run with the same eval dir: still idempotent
    const again = run([repo, "--json", "--store", store], { ZODYSSEY_EVAL_DIR: evalDir });
    check("(h) judge lane idempotent on re-scan", JSON.parse(again.stdout).evidence_rows_new === 0);
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); rmSync(evalDir, { recursive: true, force: true }); }
}

// --- (k) duplicate-slug state files: in-scan dedup (round-3 advisory) -------------
{
  const repo = makeRepo();
  const store = mkdtempSync(join(tmpdir(), "zod-reg-store6-"));
  try {
    const st = { slug: "dupe", review: OKAY, consult: { history: [
      { round: 1, at: "2026-08-17T14:00:00Z", verdict: "ACCEPT", gaps: [] }] } };
    writeState(repo, "dupe", st);
    writeState(repo, "dupe-copy", st); // same slug field, different file
    const r = run([repo, "--json", "--store", store]);
    check("(k) duplicate-slug state counted once within one scan",
      r.code === 0 && JSON.parse(r.stdout).entries.find((e) => e.agent === "momus")?.n === 1,
      `got ${r.stdout.slice(0, 200)}`);
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); }
}

// --- (i) malformed state tolerated ------------------------------------------------
{
  const repo = makeRepo();
  const store = mkdtempSync(join(tmpdir(), "zod-reg-store5-"));
  try {
    writeFileSync(join(repo, ".zcode", "state", "broken.json"), "{not json");
    writeState(repo, "good", { slug: "good", review: OKAY, consult: { history: [
      { round: 1, at: "2026-08-17T13:00:00Z", verdict: "ACCEPT", gaps: [] }] } });
    const r = run([repo, "--json", "--store", store]);
    check("(i) malformed state → exit 0 with stderr warning", r.code === 0 && /skipping malformed state broken\.json/.test(r.stderr));
    const j = JSON.parse(r.stdout);
    check("(i) good state still counted", j.entries.some((e) => e.agent === "momus" && e.n === 1));
    // text mode smoke
    const txt = run([repo, "--store", store]);
    check("(j) text mode: legend line present", /trust = \(s\+1\)\/\(s\+m\+2\)/.test(txt.stdout));
    check("(j) text mode: momus@key row present", /momus@[0-9a-f]{12}\s+trust/.test(txt.stdout));
    check("(j) no crash output", !NO_CRASH.test(txt.stdout + txt.stderr));
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); }
}

console.log(`\n${pass}/${pass + fail} passed`);
rmSync(EMPTY_EVAL_DIR, { recursive: true, force: true });
exit(fail === 0 ? 0 : 1);
