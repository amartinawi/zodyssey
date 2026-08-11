#!/usr/bin/env node
// run-tests.mjs — discover and run every *.test.mjs, aggregate exit codes.
//
// WHY THIS EXISTS: the repo accumulated 17 test suites and had no way to run them. No
// package.json, no runner, no CI. Files that are never executed are documentation, and this
// project's entire failure history is checks that existed but never fired:
//
//   · the Bash write-gate was deleted twice and shipped both times
//   · install.mjs --verify reported 18/18 green while the deployed hook was not the repo's
//   · harness.mjs --list printed ✓ for 5 seeds it could not run, because it matched a sentinel
//     string the seeds had stopped using
//   · v0.3.0-verdict.json was 0 bytes and still read as "audited"
//   · F2/F4 confirmed a reviewer was summoned and never read what it said
//
// Every one of those was detectable. None was detected, because nothing ran.
//
// ZERO TESTS DISCOVERED IS A FAILURE. That is not pedantry — it is the harness.mjs bug exactly:
// a runner reporting success over an empty set is the same false green, one level up. If a glob
// breaks or a directory is renamed, this must go red rather than quietly pass.
//
// Zero dependencies, Node built-ins only, matching every other script here.
//
// Usage:
//   node scripts/run-tests.mjs [--filter <substring>]
//   exit: 0 all passed · 1 a suite failed · 4 no suites discovered

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { argv, exit } from "node:process";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const filterIdx = argv.indexOf("--filter");
const filter = filterIdx !== -1 ? argv[filterIdx + 1] : null;

const SKIP_DIRS = new Set(["node_modules", ".git", ".zcode", "dist", "build", "coverage",
  ".claude-flow", ".swarm"]);

function discover(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      discover(join(dir, e.name), out);
    } else if (e.name.endsWith(".test.mjs")) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

let suites = discover(ROOT).sort();
if (filter) suites = suites.filter((s) => s.includes(filter));

if (suites.length === 0) {
  console.error(
    filter
      ? `no test suites matched --filter ${filter}`
      : "NO TEST SUITES DISCOVERED. Something is wrong with the tree or this runner's glob.\n" +
        "  Reporting success here would be the same false green as harness.mjs printing ✓ for\n" +
        "  seeds it could not run. Failing instead."
  );
  exit(4);
}

console.log(`running ${suites.length} suite(s)\n`);
const failed = [];
const started = process.hrtime.bigint();

for (const suite of suites) {
  const rel = relative(ROOT, suite);
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [suite], { encoding: "utf8", timeout: 10 * 60 * 1000 });
  const ms = Number((process.hrtime.bigint() - t0) / 1000000n);
  if (r.status === 0) {
    console.log(`  ✓ ${rel} (${ms}ms)`);
  } else {
    console.log(`  ✗ ${rel} (${ms}ms, exit ${r.status})`);
    failed.push({ rel, out: ((r.stdout || "") + (r.stderr || "")).trim() });
  }
}

const totalMs = Number((process.hrtime.bigint() - started) / 1000000n);

if (failed.length) {
  console.log(`\n${"=".repeat(70)}`);
  for (const f of failed) {
    console.log(`\nFAILED: ${f.rel}\n${"-".repeat(70)}`);
    // Only the failing assertions matter; a full replay of every ✓ buries them.
    const lines = f.out.split("\n").filter((l) => /✗|failed|Error|error:/i.test(l));
    console.log((lines.length ? lines : f.out.split("\n").slice(-30)).join("\n"));
  }
  console.log(`\n${"=".repeat(70)}`);
}

console.log(`\n${suites.length - failed.length}/${suites.length} suite(s) passed in ${totalMs}ms`);
exit(failed.length === 0 ? 0 : 1);
