#!/usr/bin/env node
// coverage-delta.test.mjs — unit tests for coverage-delta.mjs.
//
// Offline + fast by construction: tests build tmp-dir fixtures with synthetic
// toolchain.json + synthetic coverage reports (in the EXACT shape each tool
// emits). No jest/pytest/go/c8/nyc is ever invoked. This is what makes the
// graceful-no-op paths and the parsing logic independently testable.
//
// Fixtures (built with mkdtempSync, torn down with rmSync):
//   (a) no toolchain.json   → graceful no-op, exit 0, "no toolchain" in output
//   (b) bare:true toolchain → graceful no-op, exit 0, "no toolchain" in output
//   (c) jest toolchain + istanbul coverage-summary.json → extracts %, JSON out
//   (d) vitest toolchain    → same istanbul shape, tool field = vitest
//   (e) node-test + c8      → tool field = c8, istanbul shape
//   (f) mocha + nyc         → tool field = nyc, istanbul shape
//   (g) pytest + coverage.py JSON → parses percent_covered, tool field = coverage.py
//   (h) go + coverage.out (text)  → parses coverprofile, tool field = go cover
//   (i) jest toolchain but NO report file present → graceful no-op ("no coverage report")
//   (j) --baseline below threshold → dropped:true in JSON, STILL exit 0 (flag not gate)
//   (k) absolute changed-file path resolves to the same istanbul key as a relative one
//   (l) unknown test_runner → graceful no-op
//   (m) file present in repo but absent from report → found:false, pct:null (not dropped)
//
// Run:  node coverage-delta.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const COV = join(SCRIPT_DIR, "coverage-delta.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  \u2713 ${name}`); pass++; }
  else { console.log(`  \u2717 ${name} ${detail}`); fail++; }
}

// runCov: build a tmp repo, run coverage-delta.mjs against it, return { code, stdout, stderr }.
function runCov(setup, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "zod-cov-test-"));
  try {
    setup(dir);
    // run in a child process but suppress inherit; we want stdout/stderr + exit code
    const result = runRaw(dir, args);
    return { dir, ...result };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
function runRaw(dir, args) {
  // execFileSync throws on non-zero exit; capture via spawnSync for the code.
  const { spawnSync } = require0();
  const r = spawnSync("node", [COV, dir, ...args], { encoding: "utf8", timeout: 30000 });
  return {
    code: r.status === null ? (r.signal ? 128 : 127) : r.status,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}
// Tiny shim: node's child_process.spawnSync is ESM-importable, but we already used
// execFileSync import above. Use spawnSync via a fresh dynamic require-equivalent.
import { spawnSync } from "node:child_process";
function require0() { return { spawnSync }; }

// Helper to write a toolchain.json into <repo>/.zcode/
function writeToolchain(dir, overrides = {}) {
  const tc = {
    test_runner: "jest",
    test_cmd: "npx jest",
    package_manager: "npm",
    lint_cmd: null,
    node_version: "v20.0.0",
    bare: false,
    detected_at: "2026-08-09T20:00:00.000Z",
    ...overrides,
  };
  mkdirSync(join(dir, ".zcode"), { recursive: true });
  writeFileSync(join(dir, ".zcode", "toolchain.json"), JSON.stringify(tc, null, 2) + "\n");
}

// istanbul json-summary fixture (jest/vitest/c8/nyc shared shape)
function istanbulSummary(dir, entries) {
  mkdirSync(join(dir, "coverage"), { recursive: true });
  const data = {};
  for (const [key, pct] of Object.entries(entries)) {
    // pretend total=100 lines, covered=pct
    const covered = Math.round((pct / 100) * 100);
    data[key] = { lines: { total: 100, covered, pct }, statements: { total: 100, covered, pct }, functions: { total: 10, covered: Math.round((pct / 100) * 10), pct }, branches: { total: 8, covered: Math.round((pct / 100) * 8), pct } };
  }
  writeFileSync(join(dir, "coverage", "coverage-summary.json"), JSON.stringify(data, null, 2) + "\n");
}

console.log("coverage-delta.mjs unit tests\n");

// --- (a) no toolchain.json → graceful no-op, exit 0 ---
{
  const { code, stdout } = runCov(() => {}, ["src/a.js"]);
  check("no toolchain → exit 0", code === 0, `(got ${code})`);
  check("no toolchain → output contains 'no toolchain'", /no toolchain/i.test(stdout),
    `(got ${JSON.stringify(stdout)})`);
}

// --- (b) bare:true toolchain → graceful no-op, exit 0 ---
{
  const { code, stdout } = runCov(
    (dir) => writeToolchain(dir, { test_runner: "node-test", test_cmd: "node --test", bare: true }),
    ["src/a.js"]
  );
  check("bare:true → exit 0", code === 0, `(got ${code})`);
  check("bare:true → output contains 'no toolchain'", /no toolchain/i.test(stdout),
    `(got ${JSON.stringify(stdout)})`);
}

// --- (c) jest toolchain + istanbul coverage-summary.json → extracts %, JSON ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "jest", test_cmd: "npx jest" });
    istanbulSummary(dir, { "src/a.js": 92.5, "src/b.js": 80.0 });
  }, ["src/a.js"]);
  check("jest → exit 0", code === 0, `(got ${code})`);
  const j = JSON.parse(stdout.trim());
  check("jest → tool jest", j.tool === "jest", `(got ${j.tool})`);
  check("jest → one file entry", Array.isArray(j.files) && j.files.length === 1);
  check("jest → src/a.js coverage_pct 92.5", j.files[0].coverage_pct === 92.5,
    `(got ${j.files[0].coverage_pct})`);
  check("jest → found true", j.files[0].found === true);
  check("jest → dropped false (no baseline)", j.dropped === false);
  check("jest → report path", j.report === "coverage/coverage-summary.json");
}

// --- (d) vitest toolchain → tool field vitest ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "vitest", test_cmd: "npx vitest" });
    istanbulSummary(dir, { "src/a.js": 75.0 });
  }, ["src/a.js"]);
  const j = JSON.parse(stdout.trim());
  check("vitest → tool vitest", j.tool === "vitest", `(got ${j.tool})`);
  check("vitest → coverage_pct 75", j.files[0].coverage_pct === 75);
}

// --- (e) node-test + c8 → tool field c8 ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "node-test", test_cmd: "node --test" });
    istanbulSummary(dir, { "src/a.js": 100 });
  }, ["src/a.js"]);
  const j = JSON.parse(stdout.trim());
  check("node-test → tool c8", j.tool === "c8", `(got ${j.tool})`);
  check("node-test → coverage_pct 100", j.files[0].coverage_pct === 100);
}

// --- (f) mocha + nyc → tool field nyc ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "mocha", test_cmd: "npx mocha" });
    istanbulSummary(dir, { "src/a.js": 60 });
  }, ["src/a.js"]);
  const j = JSON.parse(stdout.trim());
  check("mocha → tool nyc", j.tool === "nyc", `(got ${j.tool})`);
}

// --- (g) pytest + coverage.py JSON → parses percent_covered ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "pytest", test_cmd: "pytest" });
    const cov = {
      meta: { format: 2, version: "7.0" },
      totals: { percent_covered: 90.0 },
      files: {
        "src/a.py": { summary: { percent_covered: 88.0, num_statements: 50 }, missing_lines: 6 },
        "src/b.py": { summary: { percent_covered: 95.0, num_statements: 20 }, missing_lines: 1 },
      },
    };
    writeFileSync(join(dir, "coverage.json"), JSON.stringify(cov, null, 2) + "\n");
  }, ["src/a.py"]);
  const j = JSON.parse(stdout.trim());
  check("pytest → tool coverage.py", j.tool === "coverage.py", `(got ${j.tool})`);
  check("pytest → src/a.py coverage_pct 88", j.files[0].coverage_pct === 88,
    `(got ${j.files[0].coverage_pct})`);
  check("pytest → found true", j.files[0].found === true);
  check("pytest → report path coverage.json", j.report === "coverage.json");
}

// --- (h) go + coverage.out (coverprofile text) → parses statement coverage ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "go", test_cmd: "go test ./..." });
    // 10 statements, 8 covered → 80%. Real Go coverprofile format:
    //   <importpath>/<file>.go:<start.line.col,end.line.col> <numStatements> <count>
    // count is 1 if the block ran (covered), 0 if not (mode: set).
    const cov = [
      "mode: set",
      "example.com/pkg/foo.go:1.1,10.20 8 1",   // 8 statements, covered
      "example.com/pkg/foo.go:11.1,12.20 2 0",   // 2 statements, NOT covered
      "example.com/pkg/bar.go:1.1,5.10 5 1",     // different file, ignored
    ].join("\n") + "\n";
    writeFileSync(join(dir, "coverage.out"), cov);
  }, ["foo.go"]);
  const j = JSON.parse(stdout.trim());
  check("go → tool go cover", j.tool === "go cover", `(got ${j.tool})`);
  check("go → foo.go found true", j.files[0].found === true);
  // foo.go: 8 covered of 10 statements → 80
  check("go → foo.go coverage_pct 80", j.files[0].coverage_pct === 80,
    `(got ${j.files[0].coverage_pct})`);
}

// --- (i) jest toolchain but NO report file → graceful no-op ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "jest", test_cmd: "npx jest" });
    // intentionally no coverage/ dir
  }, ["src/a.js"]);
  check("no report → exit 0", code === 0, `(got ${code})`);
  check("no report → output contains 'no coverage report' or 'skipping'",
    /no coverage report|skipping/i.test(stdout), `(got ${JSON.stringify(stdout)})`);
}

// --- (j) --baseline below threshold → dropped:true, STILL exit 0 (flag not gate) ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "jest", test_cmd: "npx jest" });
    istanbulSummary(dir, { "src/a.js": 70.0 });
  }, ["src/a.js", "--baseline", "80"]);
  check("below baseline → exit 0 (flag not gate)", code === 0, `(got ${code})`);
  const j = JSON.parse(stdout.trim());
  check("below baseline → dropped true", j.dropped === true, `(got ${j.dropped})`);
  check("below baseline → baseline 80", j.baseline === 80);
}

// --- (j2) --baseline met → dropped:false ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "jest", test_cmd: "npx jest" });
    istanbulSummary(dir, { "src/a.js": 90.0 });
  }, ["src/a.js", "--baseline", "80"]);
  const j = JSON.parse(stdout.trim());
  check("at-or-above baseline → dropped false", j.dropped === false);
}

// --- (k) absolute changed-file path resolves to same istanbul key as relative ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "jest", test_cmd: "npx jest" });
    istanbulSummary(dir, { "src/a.js": 92.5 });
  }, [join("{DIR}", "src/a.js")]); // placeholder, see below
  // NOTE: {DIR} can't be used before we know dir; redo with a second call
}
// (k) done properly: build the dir ourselves so we can pass an absolute path
{
  const dir = mkdtempSync(join(tmpdir(), "zod-cov-abs-"));
  try {
    writeToolchain(dir, { test_runner: "jest", test_cmd: "npx jest" });
    istanbulSummary(dir, { "src/a.js": 92.5 });
    const r = spawnSync("node", [COV, dir, join(dir, "src/a.js")], { encoding: "utf8" });
    const code = r.status === null ? 127 : r.status;
    const j = JSON.parse((r.stdout || "").trim());
    check("absolute path → exit 0", code === 0, `(got ${code})`);
    check("absolute path → resolves to istanbul key", j.files[0].found === true && j.files[0].coverage_pct === 92.5,
      `(got found=${j.files[0].found} pct=${j.files[0].coverage_pct})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- (l) unknown test_runner → graceful no-op ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "rust-cargo", test_cmd: "cargo test" });
  }, ["src/a.rs"]);
  check("unknown runner → exit 0", code === 0, `(got ${code})`);
  check("unknown runner → output contains 'no toolchain' or 'skipping'",
    /no toolchain|skipping/i.test(stdout), `(got ${JSON.stringify(stdout)})`);
}

// --- (m) file present in repo but absent from report → found:false, pct:null, not dropped ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "jest", test_cmd: "npx jest" });
    istanbulSummary(dir, { "src/covered.js": 100 });
  }, ["src/uncovered.js", "--baseline", "80"]);
  const j = JSON.parse(stdout.trim());
  check("absent-from-report → found false", j.files[0].found === false);
  check("absent-from-report → coverage_pct null", j.files[0].coverage_pct === null);
  // pct:null is NOT counted as dropped (we have no number to compare)
  check("absent-from-report → dropped false (no number)", j.dropped === false);
}

// --- (n) no changed files → graceful no-op ---
{
  const { code, stdout } = runCov((dir) => {
    writeToolchain(dir, { test_runner: "jest", test_cmd: "npx jest" });
    istanbulSummary(dir, { "src/a.js": 100 });
  }, []);
  check("no changed files → exit 0", code === 0, `(got ${code})`);
  check("no changed files → output contains 'skipping'", /skipping/i.test(stdout),
    `(got ${JSON.stringify(stdout)})`);
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
