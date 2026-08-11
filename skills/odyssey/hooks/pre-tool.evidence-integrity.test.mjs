#!/usr/bin/env node
// pre-tool.evidence-integrity.test.mjs — the inputs to a verdict must be as protected as the
// verdict itself.
//
// TWO HOLES THIS DEFENDS (both open until 2026-08-11):
//
// B2 — NOTEPADS WERE FREELY DESTROYABLE. `if (bookkeeping) exit(0)` (pre-tool.mjs) let any agent,
//      in any phase, before or after the review verdict, replace a notepad wholesale. Notepads
//      are what F1-F4 read. ZOdyssey hook-mints nonces, consumes them once, and sha-anchors them
//      so a verdict cannot be forged — then left the evidence behind that verdict writable by
//      the party being judged.
//
// B5 — TESTS WERE EDITABLE WHILE BEING RUN. The cheapest way to turn a failing acceptance
//      criterion green is to weaken the test. ImpossibleBench measures this directly: 76%
//      (GPT-5), 46% (Claude Opus 4.1); restricting access drops it to near zero, prompting does
//      not work, and stronger models cheat more.
//
// The B5 rule is scoped to verify/final ON PURPOSE. During `execute`, writing tests IS the work
// (this project mandates TDD). The tests below assert that scoping explicitly, because a blanket
// ban would be the kind of "safe" rule that gets disabled within a week for making the tool
// unusable.
//
// Run:  node pre-tool.evidence-integrity.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const HOOK = join(new URL(".", import.meta.url).pathname, "pre-tool.mjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

const cleanup = [];
function makeRepo({ phase = "execute", verdict = "OKAY", extraDeclared = [] } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "zod-ev-")));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "notepads", "t"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "test"), { recursive: true });
  writeFileSync(join(repo, "src", "foo.js"), "// src\n");
  writeFileSync(join(repo, "test", "foo.test.js"), "it('a',()=>{});\n");
  writeFileSync(join(repo, ".zcode", "notepads", "t", "1.md"), "# findings\n- did the thing\n");

  const planPath = join(repo, ".zcode", "plans", "t.md");
  // Everything a case will touch must be DECLARED, or the scope gate blocks it and the assertion
  // passes for the wrong reason — which is exactly what the first draft of this file did.
  const declared = ["src/foo.js", "test/foo.test.js", ...extraDeclared];
  const planText = `# t\n\n## Todos\n\n- [ ] 1. x\n  Files: [${declared.map((f) => `\`${f}\``).join(", ")}]\n`;
  writeFileSync(planPath, planText);
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify({
    slug: "t", phase, updated_at: new Date().toISOString(), plan_path: planPath,
    review: { verdict, round: 1, max_rounds: 3, plan_sha256: createHash("sha256").update(planText).digest("hex") },
  }, null, 2));
  return repo;
}

const hook = (repo, tool_name, tool_input) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ tool_name, tool_input }), encoding: "utf8",
  env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ZODYSSEY_UNGATE_BASH: "" },
}).status;

console.log("pre-tool.mjs — evidence integrity (notepads + test files)\n");

// --- B2: notepads are append-only -------------------------------------------
{
  const repo = makeRepo({});
  const np = join(repo, ".zcode", "notepads", "t", "1.md");

  check("Write over an EXISTING notepad is BLOCKED",
    hook(repo, "Write", { file_path: np }) === 2);

  check("Edit of an existing notepad is ALLOWED (append/amend is the intended use)",
    hook(repo, "Edit", { file_path: np }) === 0);

  check("Write of a NEW notepad is ALLOWED (creation is not destruction)",
    hook(repo, "Write", { file_path: join(repo, ".zcode", "notepads", "t", "2.md") }) === 0);

  check("plans remain freely writable (bookkeeping unchanged)",
    hook(repo, "Write", { file_path: join(repo, ".zcode", "plans", "t.md") }) === 0);
}

// --- B2: the hole is closed regardless of verdict ----------------------------
{
  const repo = makeRepo({ verdict: "REJECT" });
  check("notepad Write blocked pre-OKAY too",
    hook(repo, "Write", { file_path: join(repo, ".zcode", "notepads", "t", "1.md") }) === 2);
}

// --- B5: tests are writable during execute, frozen during verify/final -------
{
  const repo = makeRepo({ phase: "execute" });
  check("execute: editing a test is ALLOWED (TDD is the workflow)",
    hook(repo, "Edit", { file_path: join(repo, "test", "foo.test.js") }) === 0);
  check("execute: editing source is ALLOWED",
    hook(repo, "Edit", { file_path: join(repo, "src", "foo.js") }) === 0);
}
{
  const repo = makeRepo({ phase: "verify" });
  check("verify: editing a test is BLOCKED",
    hook(repo, "Edit", { file_path: join(repo, "test", "foo.test.js") }) === 2);
  check("verify: editing SOURCE is still ALLOWED (fix the code, not the test)",
    hook(repo, "Edit", { file_path: join(repo, "src", "foo.js") }) === 0);
}
{
  const repo = makeRepo({ phase: "final" });
  check("final: editing a test is BLOCKED",
    hook(repo, "Edit", { file_path: join(repo, "test", "foo.test.js") }) === 2);
}

// --- B5: the pattern must catch real-world test layouts ---------------------
{
  const TEST_LAYOUTS = [
    ["src/foo.spec.ts", "*.spec.ts"],
    ["src/foo.test.jsx", "*.test.jsx"],
    ["tests/thing.js", "tests/ dir"],
    ["__tests__/thing.js", "__tests__/ dir"],
    ["pkg/thing_test.go", "Go _test.go"],
    ["app/test_thing.py", "Python test_*.py"],
  ];
  // Ordinary source whose NAME merely contains a test-ish substring. If these get blocked the
  // rule is unusable and someone will switch it off.
  const DECOYS = ["src/latest.js", "src/contest.js", "src/protester.ts", "src/attestation.js"];

  const repo = makeRepo({
    phase: "verify",
    extraDeclared: [...TEST_LAYOUTS.map(([r]) => r), ...DECOYS], // in scope, so scope is NOT the variable
  });
  for (const [rel, label] of TEST_LAYOUTS) {
    mkdirSync(join(repo, rel, ".."), { recursive: true });
    writeFileSync(join(repo, rel), "x\n");
    check(`verify: blocked for ${label}`, hook(repo, "Edit", { file_path: join(repo, rel) }) === 2);
  }
  for (const rel of DECOYS) {
    writeFileSync(join(repo, rel), "x\n");
    check(`verify: NOT blocked for ${rel} (false-positive guard)`,
      hook(repo, "Edit", { file_path: join(repo, rel) }) === 0);
  }
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
