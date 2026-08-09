#!/usr/bin/env node
// parse-plan.test.mjs — unit tests for parse-plan.mjs (audit gap #6e).
//
// The load-bearing assertion: a FRESHLY SCAFFOLDED plan (scaffold.mjs output) parses to
// ZERO todos, because the scaffold's only `- [ ] N.` row lives inside an HTML comment as an
// EXAMPLE. Before the audit fix, parse-plan parsed that example as a real todo the executor
// would implement. Run:  node parse-plan.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const PARSE = join(SCRIPT_DIR, "parse-plan.mjs");
const SCAFFOLD = join(SCRIPT_DIR, "scaffold.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name} ${detail}`); fail++; }
}
function parsePlan(planText) {
  const dir = mkdtempSync(join(tmpdir(), "zod-parse-test-"));
  const planPath = join(dir, "plan.md");
  writeFileSync(planPath, planText);
  try {
    const out = execFileSync("node", [PARSE, planPath], { encoding: "utf8" });
    return JSON.parse(out).todos;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("parse-plan.mjs unit tests\n");

// --- Test 1: a freshly scaffolded plan yields ZERO todos ---
{
  const repoDir = mkdtempSync(join(tmpdir(), "zod-scaffold-test-"));
  try {
    execFileSync("node", [SCAFFOLD, repoDir, "unit-test", "Unit test", "standard"], {
      encoding: "utf8", stdio: "pipe", // silence the git-warning stderr
    });
    const planPath = join(repoDir, ".zcode", "plans", "unit-test.md");
    const out = execFileSync("node", [PARSE, planPath], { encoding: "utf8" });
    const todos = JSON.parse(out).todos;
    const nonFinal = todos.filter((t) => !t.final);
    check("freshly scaffolded plan → 0 non-final todos", nonFinal.length === 0,
      `(got ${nonFinal.length}: ${JSON.stringify(nonFinal.map((t) => t.id))})`);
    // The 4 final-wave rows (F1–F4) ARE real todos and SHOULD parse.
    check("scaffolded plan → 4 final-wave rows (F1–F4)", todos.length === 4,
      `(got ${todos.length})`);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
}

// --- Test 2: HTML comment with an example todo does NOT parse ---
{
  const plan = `# x
## Todos
<!-- example:
- [ ] 1. Add /healthz endpoint
  - Files: [src/server.js]
-->
## Final verification wave
`;
  const todos = parsePlan(plan);
  check("commented-out example todo not parsed", todos.filter((t) => !t.final).length === 0);
}

// --- Test 3: real todo with backticked acceptance command parses cleanly ---
{
  const plan = `# x
## Todos
- [ ] 1. Add healthz
  - Files: [src/server.js]
  - Acceptance criteria:
    - \`curl localhost:3000/healthz\` returns 200
    - \`npm test auth\` exits 0
## Final verification wave
`;
  const todos = parsePlan(plan);
  const t = todos.find((x) => x.id === "1");
  check("real todo parses", !!t);
  if (t) {
    check("files parsed", t.files.length === 1 && t.files[0] === "src/server.js",
      `(got ${JSON.stringify(t.files)})`);
    check("two acceptance criteria", t.acceptance.length === 2,
      `(got ${t.acceptance.length}: ${JSON.stringify(t.acceptance)})`);
    check("acceptance[0] is clean command (no stray backtick)",
      t.acceptance[0] === "curl localhost:3000/healthz returns 200",
      `(got ${JSON.stringify(t.acceptance[0])})`);
    check("acceptance[1] is clean command",
      t.acceptance[1] === "npm test auth exits 0",
      `(got ${JSON.stringify(t.acceptance[1])})`);
  }
}

// --- Test 4: indented nested bullet is NOT mistaken for a top-level todo ---
{
  const plan = `# x
## Todos
- [ ] 1. Real todo
  - What to do: implement
  - Must NOT do: break things
## Final verification wave
`;
  const todos = parsePlan(plan);
  check("only 1 non-final todo (nested bullets ignored)", todos.filter((t) => !t.final).length === 1);
}

// --- Test 5: QA scenarios parsed ---
{
  const plan = `# x
## Todos
- [ ] 1. Feature
  - QA scenarios:
    - Happy: works
    - Failure: error shown
## Final verification wave
`;
  const todos = parsePlan(plan);
  const t = todos.find((x) => x.id === "1");
  check("QA scenarios parsed (2)", t && t.qa.length === 2, `(got ${t?.qa.length})`);
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
