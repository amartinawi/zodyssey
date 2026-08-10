#!/usr/bin/env node
// parse-plan.test.mjs — unit tests for parse-plan.mjs (audit gap #6e).
//
// The load-bearing assertion: a FRESHLY SCAFFOLDED plan (scaffold.mjs output) parses to
// ZERO todos, because the scaffold's only `- [ ] N.` row lives inside an HTML comment as an
// EXAMPLE. Before the audit fix, parse-plan parsed that example as a real todo the executor
// would implement. Run:  node parse-plan.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
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

// --- Test 6: toolchain-aware lint — `node` references always pass (node-test repo) ---
// A plan whose criteria reference `node` must pass lint against a node-test toolchain.json.
// `node` is always present and must NEVER be flagged (todo 15 MUST NOT).
{
  const dir = mkdtempSync(join(tmpdir(), "zod-tc-node-"));
  try {
    mkdirSync(join(dir, ".zcode", "plans"), { recursive: true });
    writeFileSync(join(dir, ".zcode", "toolchain.json"), JSON.stringify({
      test_runner: "node-test",
      test_cmd: "node --test",
      package_manager: null,
      lint_cmd: null,
      node_version: process.version,
      bare: true,
      detected_at: new Date().toISOString(),
    }));
    const planPath = join(dir, ".zcode", "plans", "p.md");
    writeFileSync(planPath, `# x
## Todos
- [ ] 1. Use node
  - Files: [src/a.js]
  - Acceptance criteria:
    - \`node --check src/a.js\` exits 0
    - \`node src/a.js\` prints done
## Final verification wave
`);
    // Lint mode: exit 0 = pass. We capture stdout/stderr separately; non-zero = failure.
    let code = 0, errMsg = "";
    try {
      execFileSync("node", [PARSE, planPath, "--lint"], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      code = e.status ?? 1;
      errMsg = (e.stderr || "").slice(0, 200);
    }
    check("node references pass against node-test toolchain", code === 0,
      `(exit ${code}; ${errMsg})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Test 7: toolchain-aware lint — `jest` reference vs node-test toolchain FAILS ---
// This is the empirically-observed mismatch class (arch-01 plan referenced jest, repo used
// node --test). Lint must catch it: exit 6, and the problems array mentions the jest mismatch.
{
  const dir = mkdtempSync(join(tmpdir(), "zod-tc-jest-"));
  try {
    mkdirSync(join(dir, ".zcode", "plans"), { recursive: true });
    writeFileSync(join(dir, ".zcode", "toolchain.json"), JSON.stringify({
      test_runner: "node-test",
      test_cmd: "node --test",
      package_manager: "npm",
      lint_cmd: null,
      node_version: process.version,
      bare: false,
      detected_at: new Date().toISOString(),
    }));
    const planPath = join(dir, ".zcode", "plans", "p.md");
    writeFileSync(planPath, `# x
## Todos
- [ ] 1. Run jest
  - Files: [src/a.js]
  - Acceptance criteria:
    - \`jest src/a.test.js\` exits 0
## Final verification wave
`);
    let code = 0, stdout = "";
    try {
      stdout = execFileSync("node", [PARSE, planPath, "--lint"], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      code = e.status ?? 0;
      stdout = e.stdout || "";
    }
    check("jest reference vs node-test toolchain fails lint (exit 6)", code === 6,
      `(exit ${code})`);
    let problemsOk = false;
    try {
      const r = JSON.parse(stdout);
      problemsOk = Array.isArray(r.problems) && r.problems.some(
        (p) => /jest/.test(p.issue || "") && /test_runner is node-test/.test(p.issue || ""),
      );
    } catch {}
    check("lint problem names jest + the declared test_runner", problemsOk,
      `(stdout: ${stdout.slice(0, 200)})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Test 8: toolchain-aware lint — graceful no-op when toolchain.json absent ---
// A repo with no .zcode/toolchain.json must NOT regress: a jest reference should still pass
// because the check is skipped entirely (many repos won't have probed yet).
{
  const dir = mkdtempSync(join(tmpdir(), "zod-tc-absent-"));
  try {
    mkdirSync(join(dir, ".zcode", "plans"), { recursive: true });
    // NOTE: no toolchain.json written.
    const planPath = join(dir, ".zcode", "plans", "p.md");
    writeFileSync(planPath, `# x
## Todos
- [ ] 1. Run jest
  - Files: [src/a.js]
  - Acceptance criteria:
    - \`jest src/a.test.js\` exits 0
## Final verification wave
`);
    let code = 0, errMsg = "";
    try {
      execFileSync("node", [PARSE, planPath, "--lint"], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      code = e.status ?? 1;
      errMsg = (e.stderr || "").slice(0, 200);
    }
    check("jest reference passes lint when toolchain.json absent (graceful no-op)",
      code === 0, `(exit ${code}; ${errMsg})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- Test 9: toolchain-aware lint — `npm run <script>` vs bare repo FAILS ---
// A bare repo (package_manager null, bare true) has no package.json, so `npm run X` is invalid.
{
  const dir = mkdtempSync(join(tmpdir(), "zod-tc-bare-"));
  try {
    mkdirSync(join(dir, ".zcode", "plans"), { recursive: true });
    writeFileSync(join(dir, ".zcode", "toolchain.json"), JSON.stringify({
      test_runner: "node-test",
      test_cmd: "node --test",
      package_manager: null,
      lint_cmd: null,
      node_version: process.version,
      bare: true,
      detected_at: new Date().toISOString(),
    }));
    const planPath = join(dir, ".zcode", "plans", "p.md");
    writeFileSync(planPath, `# x
## Todos
- [ ] 1. Run build
  - Files: [src/a.js]
  - Acceptance criteria:
    - \`npm run build\` exits 0
## Final verification wave
`);
    let code = 0, stdout = "";
    try {
      stdout = execFileSync("node", [PARSE, planPath, "--lint"], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      code = e.status ?? 0;
      stdout = e.stdout || "";
    }
    check("npm run X vs bare toolchain fails lint (exit 6)", code === 6, `(exit ${code})`);
    let problemsOk = false;
    try {
      const r = JSON.parse(stdout);
      problemsOk = Array.isArray(r.problems) && r.problems.some(
        (p) => /npm run build/.test(p.issue || "") && /bare=true/.test(p.issue || ""),
      );
    } catch {}
    check("lint problem names npm run X + bare=true", problemsOk,
      `(stdout: ${stdout.slice(0, 200)})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
