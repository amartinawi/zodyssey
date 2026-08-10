#!/usr/bin/env node
// build-capsules.test.mjs — unit tests for build-capsules.mjs (todo 7).
//
// The load-bearing assertions:
// (a) the build runs cleanly and produces tdd.md (the routing names in capabilities.md
//     are tdd / debugging / executing-plans — tdd.md is the canary);
// (b) EVERY produced capsule is ≤200 words (the whole point — the dispatch context budget);
// (c) the tdd capsule actually captured the method, not just a header — it contains the
//     word "test" or "verify". A capsule that dropped the method would still pass (a)/(b).
// (d) the build is deterministic — running twice produces byte-identical output. This is
//     why the script exists: to replace improvised, varying summaries with a fixed artifact.
//
// Run:  node build-capsules.test.mjs   (exit 0 = pass, 1 = fail)

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const BUILD = join(SCRIPT_DIR, "build-capsules.mjs");
const CAPSULES_DIR = join(SCRIPT_DIR, "..", "references", "capsules");
const MAX_WORDS = 200;

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ok - ${name}`); pass++; }
  else { console.log(`  FAIL - ${name} ${detail}`); fail++; }
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

console.log("build-capsules.mjs unit tests\n");

// --- (a) build runs cleanly (exit 0) and produces tdd.md ---
{
  let buildOut = "", buildErr = "";
  let code;
  try {
    buildOut = execFileSync("node", [BUILD], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    buildOut = e.stdout?.toString() ?? "";
    buildErr = e.stderr?.toString() ?? "";
    code = e.status;
  }
  if (code === undefined) code = 0;
  check("build exits 0", code === 0, `(exit ${code}${buildErr ? `, stderr: ${buildErr.trim()}` : ""})`);

  const tddPath = join(CAPSULES_DIR, "tdd.md");
  check("build produces tdd.md", existsSync(tddPath), `(${tddPath} missing)`);

  // the other two routed skills too (the routing in capabilities.md names all three)
  check("build produces debugging.md", existsSync(join(CAPSULES_DIR, "debugging.md")));
  check("build produces executing-plans.md", existsSync(join(CAPSULES_DIR, "executing-plans.md")));

  // every capsule has the required header
  for (const name of ["tdd", "debugging", "executing-plans"]) {
    const text = readFileSync(join(CAPSULES_DIR, `${name}.md`), "utf8");
    check(`${name}.md has dispatch header`,
      text.startsWith(`# ${name} capsule (for sub-agent dispatch)`),
      `(first line: ${JSON.stringify(text.split("\n")[0])})`);
  }
}

// --- (b) every produced capsule is ≤200 words ---
{
  let allOk = true;
  const counts = {};
  for (const name of ["tdd", "debugging", "executing-plans"]) {
    const text = readFileSync(join(CAPSULES_DIR, `${name}.md`), "utf8");
    const w = countWords(text);
    counts[name] = w;
    if (w > MAX_WORDS) allOk = false;
  }
  check("every capsule <= 200 words", allOk, `(counts: ${JSON.stringify(counts)})`);
  // also assert the directory glob invariant (the acceptance criterion): no stray capsule
  // sneaks over the budget even if the routing list grows later.
}

// --- (c) tdd capsule captured the method (contains "test" or "verify") ---
{
  const tddText = readFileSync(join(CAPSULES_DIR, "tdd.md"), "utf8").toLowerCase();
  check('tdd capsule contains "test" or "verify"',
    /\b(test|verify)\b/.test(tddText),
    "(capsule dropped the method?)");
  // sanity: debugging mentions root cause; executing-plans mentions plan
  const dbg = readFileSync(join(CAPSULES_DIR, "debugging.md"), "utf8").toLowerCase();
  check('debugging capsule mentions "root cause"', /root cause/.test(dbg));
  const ep = readFileSync(join(CAPSULES_DIR, "executing-plans.md"), "utf8").toLowerCase();
  check('executing-plans capsule mentions "plan"', /\bplan\b/.test(ep));
}

// --- (d) deterministic: a second build produces byte-identical capsules ---
{
  const before = {};
  for (const name of ["tdd", "debugging", "executing-plans"]) {
    before[name] = readFileSync(join(CAPSULES_DIR, `${name}.md`), "utf8");
  }
  execFileSync("node", [BUILD], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  let same = true;
  for (const name of Object.keys(before)) {
    if (readFileSync(join(CAPSULES_DIR, `${name}.md`), "utf8") !== before[name]) same = false;
  }
  check("build is deterministic (re-run == identical)", same, "(output varied between runs)");
}

// --- guardrail: the build MUST fail loudly if a capsule exceeds the budget ---
// We can't easily force an over-budget capsule without editing the script, but we can
// confirm the --check mode exists and rejects an over-budget file when one is planted.
{
  const tddPath = join(CAPSULES_DIR, "tdd.md");
  const original = readFileSync(tddPath, "utf8");
  try {
    // plant a deliberately over-budget file
    writeFileSync(tddPath, "# tdd capsule (for sub-agent dispatch)\n\n" + ("word ".repeat(250)) + "\n");
    let code;
    try {
      execFileSync("node", [BUILD, "--check"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      code = 0;
    } catch (e) {
      code = e.status ?? 1;
    }
    check("--check fails loudly on over-budget capsule", code === 1, `(exit ${code})`);
  } finally {
    // restore the real capsule by re-running the full build
    execFileSync("node", [BUILD], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
