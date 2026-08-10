#!/usr/bin/env node
// probe-toolchain.mjs — detect a repo's test runner / package manager / lint command
// and write the result to <repo>/.zcode/toolchain.json. Foundation for todo 12
// (post-edit diagnostics, toolchain-aware lint) and todo 16 (coverage delta).
//
// Probe ONLY: this script inspects config files and never executes the detected
// test command. Bare repos (no package.json — the ~/.zcode case itself) work and
// report `bare: true` with test_runner `node-test`.
//
// Usage:
//   probe-toolchain.mjs <repo>
//     <repo>: repo root to probe (argv[2], the first positional arg)
//   exit: 0 on success (writes <repo>/.zcode/toolchain.json) · 2 bad args ·
//         non-zero on fatal fs error
//
// Atomic write: write to a temp file in .zcode/ then renameSync (see
// record-capability.mjs / record-momus-artifact.mjs for the codebase idiom).

import {
  existsSync, statSync, mkdirSync, writeFileSync, renameSync, unlinkSync, readFileSync,
} from "node:fs";
import { join } from "node:path";
import { argv, exit, version as nodeVersion } from "node:process";

const repo = argv[2];
if (!repo) {
  console.error("usage: probe-toolchain.mjs <repo>");
  exit(2);
}

// Resolve the repo root up front so every helper can take an absolute-ish path.
// We do NOT require it to pre-exist; missing dirs simply yield "no match" and the
// final fallback handles the bare case. (mkdir for .zcode happens at write time.)
function fileExists(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}
function dirExists(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}
const has = (rel) => fileExists(join(repo, rel));

// Read + parse package.json defensively. Returns {} for missing/invalid so every
// downstream `pkg.x` access is a clean no-match rather than a throw.
function readPackageJson() {
  const p = join(repo, "package.json");
  if (!fileExists(p)) return { __missing: true };
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}
const pkg = readPackageJson();
const hasPackageJson = !pkg.__missing;

// devDeps/deps may be undefined; normalize to objects for safe `in` checks.
const depNames = new Set([
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
  ...Object.keys(pkg.peerDependencies || {}),
]);

// --- test_runner detection (FIRST match wins) ---
//
// Order matters: jest → vitest → mocha → pytest → go → node-test → bare.
// Keep this order stable; todo 12 and todo 16 read test_runner verbatim.
function detectTestRunner() {
  // jest
  if (
    has("jest.config.js") || has("jest.config.ts") ||
    has("jest.config.mjs") || has("jest.config.cjs") ||
    pkg.jest ||
    fileExists(join(repo, "node_modules", ".bin", "jest"))
  ) {
    return { test_runner: "jest", test_cmd: "npx jest" };
  }
  // vitest
  if (has("vite.config.js") || has("vite.config.ts") || has("vite.config.mjs") || depNames.has("vitest")) {
    return { test_runner: "vitest", test_cmd: "npx vitest" };
  }
  // mocha
  if (
    has(".mocharc.yml") || has(".mocharc.yaml") || has(".mocharc.json") ||
    pkg.mocha
  ) {
    return { test_runner: "mocha", test_cmd: "npx mocha" };
  }
  // pytest
  if (has("pytest.ini")) return { test_runner: "pytest", test_cmd: "pytest" };
  if (fileExists(join(repo, "setup.cfg"))) {
    const txt = readFileSync(join(repo, "setup.cfg"), "utf8");
    if (/\[tool:pytest\]/i.test(txt)) return { test_runner: "pytest", test_cmd: "pytest" };
  }
  if (fileExists(join(repo, "pyproject.toml"))) {
    const txt = readFileSync(join(repo, "pyproject.toml"), "utf8");
    if (/\[tool\.pytest[.\]]/i.test(txt)) return { test_runner: "pytest", test_cmd: "pytest" };
  }
  // go
  if (has("go.mod")) return { test_runner: "go", test_cmd: "go test ./..." };
  // node-test default (package.json present)
  if (hasPackageJson) return { test_runner: "node-test", test_cmd: "node --test" };
  // bare: no package.json at all (the ~/.zcode case)
  return { test_runner: "node-test", test_cmd: "node --test", bare: true };
}

// --- package_manager detection (FIRST lockfile match wins) ---
function detectPackageManager() {
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  if (has("package-lock.json")) return "npm";
  return null;
}

// --- lint_cmd: from package.json scripts.lint only ---
function detectLintCmd() {
  if (pkg.scripts && typeof pkg.scripts.lint === "string") return pkg.scripts.lint;
  return null;
}

const runner = detectTestRunner();
const result = {
  test_runner: runner.test_runner,
  test_cmd: runner.test_cmd,
  package_manager: detectPackageManager(),
  lint_cmd: detectLintCmd(),
  node_version: nodeVersion,
  bare: runner.bare === true,
  detected_at: new Date().toISOString(),
};

// --- atomic write to <repo>/.zcode/toolchain.json ---
const zcodeDir = join(repo, ".zcode");
const outPath = join(zcodeDir, "toolchain.json");
let tmpPath;
try {
  mkdirSync(zcodeDir, { recursive: true });
  const payload = JSON.stringify(result, null, 2) + "\n";
  // temp file in the SAME dir as the target so rename is atomic on the same fs
  tmpPath = join(zcodeDir, `.toolchain.json.tmp.${process.pid}`);
  writeFileSync(tmpPath, payload);
  renameSync(tmpPath, outPath);
} catch (e) {
  // best-effort cleanup of the temp file on any failure
  if (tmpPath) { try { unlinkSync(tmpPath); } catch {} }
  console.error("probe-toolchain.mjs: failed to write " + outPath + ": " + e.message);
  exit(1);
}

console.log(JSON.stringify(result));
exit(0);
