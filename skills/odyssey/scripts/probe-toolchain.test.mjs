#!/usr/bin/env node
// probe-toolchain.test.mjs — unit tests for probe-toolchain.mjs.
//
// Fixtures (built with mkdtempSync, torn down with rmSync):
//   (a) bare repo (no package.json) → test_runner node-test, bare true
//   (b) fake jest config             → test_runner jest
//   (c) package-lock.json            → package_manager npm
// plus extra: vitest, go, mocha, pytest, pnpm/yarn lockfiles, lint from scripts.lint,
// and the precedence of jest over vitest when both are present.
//
// Run:  node probe-toolchain.test.mjs   (exit 0 = pass, 1 = fail)
// Probe ONLY: tests never execute the detected command.

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const PROBE = join(SCRIPT_DIR, "probe-toolchain.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  \u2713 ${name}`); pass++; }
  else { console.log(`  \u2717 ${name} ${detail}`); fail++; }
}

function probeRepo(setup) {
  const dir = mkdtempSync(join(tmpdir(), "zod-probe-test-"));
  try {
    setup(dir);
    const out = execFileSync("node", [PROBE, dir], { encoding: "utf8" });
    const detected = JSON.parse(out);
    const written = JSON.parse(readFileSyncNoRequire(join(dir, ".zcode", "toolchain.json")));
    return { detected, written };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// readFileSync import kept here so the helper is self-contained
import { readFileSync as readFileSyncNoRequire } from "node:fs";

console.log("probe-toolchain.mjs unit tests\n");

// --- (a) bare repo: no package.json → node-test + bare:true ---
{
  const { detected, written } = probeRepo(() => {});
  check("bare repo → test_runner node-test", detected.test_runner === "node-test",
    `(got ${detected.test_runner})`);
  check("bare repo → bare true", detected.bare === true, `(got ${detected.bare})`);
  check("bare repo → test_cmd node --test", detected.test_cmd === "node --test",
    `(got ${detected.test_cmd})`);
  check("bare repo → written file matches stdout JSON",
    JSON.stringify(detected) === JSON.stringify(written));
  check("bare repo → node_version present (string)",
    typeof detected.node_version === "string" && detected.node_version.length > 0);
  check("bare repo → detected_at present (ISO-ish)",
    typeof detected.detected_at === "string" && detected.detected_at.endsWith("Z"));
  check("bare repo → package_manager null", detected.package_manager === null);
  check("bare repo → lint_cmd null", detected.lint_cmd === null);
}

// --- (b) jest config → test_runner jest ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    writeFileSync(join(dir, "jest.config.js"), "module.exports = {};\n");
  });
  check("jest.config.js → test_runner jest", detected.test_runner === "jest",
    `(got ${detected.test_runner})`);
  check("jest → test_cmd npx jest", detected.test_cmd === "npx jest",
    `(got ${detected.test_cmd})`);
  check("jest fixture → bare false", detected.bare === false);
}

// --- jest via package.json jest key (no jest.config.* file) ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "package.json"),
      JSON.stringify({ name: "x", jest: { testMatch: ["**/*.test.js"] } }));
  });
  check("package.json jest key → test_runner jest", detected.test_runner === "jest",
    `(got ${detected.test_runner})`);
}

// --- (c) package-lock.json → package_manager npm ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    writeFileSync(join(dir, "package-lock.json"),
      JSON.stringify({ name: "x", lockfileVersion: 3 }));
  });
  check("package-lock.json → package_manager npm",
    detected.package_manager === "npm", `(got ${detected.package_manager})`);
  check("package-lock fixture → test_runner node-test (default)",
    detected.test_runner === "node-test", `(got ${detected.test_runner})`);
}

// --- vitest via vite.config.js ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    writeFileSync(join(dir, "vite.config.js"), "export default {};\n");
  });
  check("vite.config.js → test_runner vitest", detected.test_runner === "vitest",
    `(got ${detected.test_runner})`);
}

// --- vitest via devDependency only ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "package.json"),
      JSON.stringify({ name: "x", devDependencies: { vitest: "^1.0.0" } }));
  });
  check("package.json devDeps vitest → test_runner vitest",
    detected.test_runner === "vitest", `(got ${detected.test_runner})`);
}

// --- mocha via .mocharc.json ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    writeFileSync(join(dir, ".mocharc.json"), JSON.stringify({ spec: "test/*.js" }));
  });
  check(".mocharc.json → test_runner mocha", detected.test_runner === "mocha",
    `(got ${detected.test_runner})`);
}

// --- pytest via pytest.ini ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "pytest.ini"), "[pytest]\ntestpaths = tests\n");
  });
  check("pytest.ini → test_runner pytest", detected.test_runner === "pytest",
    `(got ${detected.test_runner})`);
  check("pytest.ini → test_cmd pytest", detected.test_cmd === "pytest",
    `(got ${detected.test_cmd})`);
}

// --- pytest via setup.cfg [tool:pytest] ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "setup.cfg"), "[tool:pytest]\ntestpaths = tests\n");
  });
  check("setup.cfg [tool:pytest] → test_runner pytest",
    detected.test_runner === "pytest", `(got ${detected.test_runner})`);
}

// --- pytest via pyproject.toml [tool.pytest...] ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "pyproject.toml"), "[tool.pytest.ini_options]\ntestpaths = [\"tests\"]\n");
  });
  check("pyproject.toml [tool.pytest] → test_runner pytest",
    detected.test_runner === "pytest", `(got ${detected.test_runner})`);
}

// --- go via go.mod ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "go.mod"), "module example.com/x\ngo 1.21\n");
  });
  check("go.mod → test_runner go", detected.test_runner === "go",
    `(got ${detected.test_runner})`);
  check("go.mod → test_cmd 'go test ./...'", detected.test_cmd === "go test ./...",
    `(got ${detected.test_cmd})`);
}

// --- pnpm/yarn lockfile detection ---
{
  const { detected: pn } = probeRepo((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    writeFileSync(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '6.0'\n");
  });
  check("pnpm-lock.yaml → package_manager pnpm",
    pn.package_manager === "pnpm", `(got ${pn.package_manager})`);

  const { detected: yr } = probeRepo((dir) => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    writeFileSync(join(dir, "yarn.lock"), "# yarn lockfile v1\n");
  });
  check("yarn.lock → package_manager yarn",
    yr.package_manager === "yarn", `(got ${yr.package_manager})`);
}

// --- lint_cmd from package.json scripts.lint ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "package.json"),
      JSON.stringify({ name: "x", scripts: { lint: "eslint ." } }));
  });
  check("scripts.lint → lint_cmd 'eslint .'",
    detected.lint_cmd === "eslint .", `(got ${detected.lint_cmd})`);
}

// --- precedence: jest beats vitest when both signals present ---
{
  const { detected } = probeRepo((dir) => {
    writeFileSync(join(dir, "package.json"),
      JSON.stringify({ name: "x", devDependencies: { vitest: "^1.0.0" } }));
    writeFileSync(join(dir, "jest.config.js"), "module.exports = {};\n");
  });
  check("jest beats vitest (detection order)", detected.test_runner === "jest",
    `(got ${detected.test_runner})`);
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
