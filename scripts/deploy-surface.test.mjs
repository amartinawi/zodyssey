#!/usr/bin/env node
// deploy-surface.test.mjs — the drift gate must compare everything the deployer deploys.
//
// WHY: this invariant broke twice, and both times both release gates reported green.
//   · v0.4.1 (audit T4-4): --sync-cache copied 6 trees, the gates compared 3. A drifted
//     agents/momus.md ran a stale reviewer prompt.
//   · v0.5.0 (found running --verify during release): the widened list was still FLAT, so
//     skills/odyssey/hooks/lib/find-run.mjs was deployed but never compared — the file that
//     authenticates run discovery, i.e. the v0.5.0 CRITICAL fix itself.
//
// The failure mode is specific: a hand-maintained enumeration silently narrower than the copy.
// So the assertions below are about COVERAGE, not about a blessed list of names — a list would
// be the same bug in test form.
//
// Run:  node deploy-surface.test.mjs   (exit 0 = pass, 1 = fail)

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SYNC_TREES, enumerateDeployed } from "./lib/deploy-surface.mjs";

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

console.log("deploy surface — the gates must compare what the deployer deploys\n");

const files = enumerateDeployed(REPO);

// --- 1. Both gates read the same definition; neither keeps a private list. ----
for (const script of ["install.mjs", "smoke-gate.mjs"]) {
  const src = readFileSync(join(REPO, "scripts", script), "utf8");
  check(`${script} imports the shared enumeration`,
    /from\s+"\.\/lib\/deploy-surface\.mjs"/.test(src));
  // A revived flat SURFACES list is how this regressed before — catch it at the source level.
  check(`${script} keeps no private surface list`,
    !/const\s+SURFACES\s*=\s*\[/.test(src),
    "(a local SURFACES array is the exact shape that fell behind twice)");
}

// --- 2. The deployer copies SYNC_TREES, so the walk must start from the same. -
{
  const src = readFileSync(join(REPO, "scripts", "install.mjs"), "utf8");
  check("--sync-cache copies SYNC_TREES (one list, not two)",
    /const\s+entries\s*=\s*SYNC_TREES\b/.test(src));
}

// --- 3. Coverage is RECURSIVE: every nested dir under a synced tree is walked. -
{
  const walked = new Set(files.map((f) => dirname(f)));
  const expected = [];
  const collect = (rel) => {
    const abs = join(REPO, rel);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
    let hasCompared = false;
    for (const name of readdirSync(abs)) {
      if (name === "node_modules" || name === ".git") continue;
      const child = join(rel, name);
      if (statSync(join(REPO, child)).isDirectory()) collect(child);
      else if (name.endsWith(".mjs") || name.endsWith(".md")) hasCompared = true;
    }
    if (hasCompared) expected.push(rel);
  };
  for (const t of SYNC_TREES) collect(t);
  const uncovered = expected.filter((d) => !walked.has(d));
  check(`every deployed directory holding .mjs/.md is compared (${expected.length} dirs)`,
    uncovered.length === 0, `uncovered: ${uncovered.join(", ")}`);
}

// --- 4. Named regressions: the two files whose omission was invisible. --------
check("hooks/lib/find-run.mjs is compared (authenticates run discovery)",
  files.includes(join("skills", "odyssey", "hooks", "lib", "find-run.mjs")));
check("agents/momus.md is compared (prompts are enforcement — T4-4)",
  files.includes(join("agents", "momus.md")));
check("scripts/lib/state-auth.mjs is compared (mints the run marker)",
  files.includes(join("skills", "odyssey", "scripts", "lib", "state-auth.mjs")));

// --- 5. Sanity: the walk finds a plausible amount and excludes junk. ----------
check(`enumeration is non-trivial (${files.length} files)`, files.length > 80);
check("no node_modules leaked into the comparison",
  !files.some((f) => f.includes("node_modules")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
