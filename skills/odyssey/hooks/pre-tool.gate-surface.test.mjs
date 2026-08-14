#!/usr/bin/env node
// pre-tool.gate-surface.test.mjs — the invariants the v0.4.1 audit found UNTESTED.
//
// WHY THIS FILE EXISTS: the audit reproduced a CRITICAL end-to-end takeover against a tree whose
// own suite was fully green, and 11 gate invariants had no regression test at all. Every case
// below fails on the pre-v0.5.0 code. They are ported from the auditor's probes, which is the
// right shape: a gate is only as good as the probes that try to walk past it.
//
// The suite was ALSO structurally blind in two ways this file fixes:
//   · every fixture passed an ABSOLUTE repo path, so a guard comparing a realpath'd side against
//     an as-passed side could fail open unnoticed (three did);
//   · no fixture used a plugin-NAMESPACED capability name, so exact-match branches looked correct.
//
// Run:  node pre-tool.gate-surface.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stampMarker } from "../scripts/lib/state-auth.mjs";

const HOOK = join(new URL(".", import.meta.url).pathname, "pre-tool.mjs");
let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const cleanup = [];

function makeRun({ phase = "execute", verdict = "OKAY", declared = ["src/foo.js"], marked = true } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "zod-surface-")));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "notepads", "t"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "test"), { recursive: true });
  writeFileSync(join(repo, "src", "foo.js"), "// in scope\n");
  writeFileSync(join(repo, "src", "secret.js"), "// NOT declared\n");
  writeFileSync(join(repo, "test", "foo.test.js"), "it('a',()=>{});\n");
  writeFileSync(join(repo, ".zcode", "notepads", "t", "1.md"), "# evidence\n");
  const planPath = join(repo, ".zcode", "plans", "t.md");
  const planText = `# t\n\n## Todos\n\n- [ ] 1. go\n  Files: [${declared.map((f) => `\`${f}\``).join(", ")}]\n`;
  writeFileSync(planPath, planText);
  const st = {
    slug: "t", phase, updated_at: new Date().toISOString(), plan_path: planPath,
    started_at: "2026-08-15T00:00:00Z", run_start_sha: "abc123",
    review: { verdict, round: 1, max_rounds: 3, plan_sha256: createHash("sha256").update(planText).digest("hex") },
  };
  if (marked) stampMarker(st, "t");
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify(st, null, 2));
  return repo;
}
const gate = (repo, tool_name, tool_input, env = {}) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ tool_name, tool_input }), encoding: "utf8",
  env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ZODYSSEY_UNGATE_BASH: "", ZODYSSEY_NO_FIND_CACHE: "1", ...env },
}).status;
const bash = (repo, command) => gate(repo, "Bash", { command });

console.log("pre-tool.mjs — gate surface (the audit's untested invariants)\n");

// --- CRITICAL T1-1: write primitives that classified as READ-ONLY ------------
console.log("  write primitives (all must BLOCK pre-OKAY):");
{
  const repo = makeRun({ verdict: "REJECT", phase: "plan" });
  for (const cmd of [
    "sort -o src/secret.js src/foo.js",
    "touch src/newfile.js",
    "sponge src/foo.js",
    "crontab /tmp/evil",
    "scp remote:/x src/foo.js",
    "sqlite3 db.sqlite 'update t set x=1'",
    "dd if=/dev/zero of=src/foo.js",
  ]) check(`    ${cmd.slice(0, 34)}`, bash(repo, cmd) === 2, `(exit ${bash(repo, cmd)})`);
  check("    control: read-only still ALLOWED", bash(repo, "ls -la") === 0);
}

// --- CRITICAL T1-7: unauthenticated run discovery ----------------------------
console.log("\n  forged-run discovery:");
{
  const repo = makeRun({ verdict: "REJECT", phase: "plan" });
  // A decoy state file with verdict OKAY, hand-written exactly as an injected executor would.
  writeFileSync(join(repo, ".zcode", "state", "decoy.json"), JSON.stringify({
    slug: "decoy", phase: "execute", updated_at: new Date().toISOString(),
    plan_path: join(repo, ".zcode", "plans", "t.md"),
    review: { verdict: "OKAY", round: 1, max_rounds: 3 },
  }, null, 2));
  check("    a dropped unmarked state file does NOT govern the gate",
    gate(repo, "Edit", { file_path: join(repo, "src", "secret.js") }) === 2);
}
{
  const repo = makeRun({ marked: false });
  check("    an unmarked run is not discovered at all (fail closed)",
    gate(repo, "Edit", { file_path: join(repo, "src", "secret.js") }) === 0,
    "(no active run -> hook no-ops; the run must be adopted)");
}

// --- HIGH T1-2/T1-3/T1-4/T1-5/T1-6: Edit-path guards on the Bash path -------
console.log("\n  Bash path parity with the Edit path:");
{
  const repo = makeRun({});
  check("    T1-2 clobbering an existing notepad BLOCKS",
    bash(repo, "echo x > .zcode/notepads/t/1.md") === 2);
  check("    T1-2 appending to a notepad is ALLOWED",
    bash(repo, "echo x >> .zcode/notepads/t/1.md") === 0);
  check("    T1-2 creating a NEW notepad is ALLOWED",
    bash(repo, "echo x > .zcode/notepads/t/2.md") === 0);
  check("    T1-6 rewriting the plan post-OKAY BLOCKS",
    bash(repo, "echo x > .zcode/plans/t.md") === 2);
  check("    T1-3 sed -i with an out-of-scope operand BLOCKS",
    bash(repo, "sed -i 's/a/b/' src/secret.js src/foo.js") === 2);
  check("    T1-3 tee with an out-of-scope operand BLOCKS",
    bash(repo, "tee src/foo.js src/secret.js < src/foo.js") === 2);
  check("    T1-3 single in-scope sed -i is ALLOWED",
    bash(repo, "sed -i 's/a/b/' src/foo.js") === 0);
}
{
  const repo = makeRun({ phase: "verify" });
  check("    T1-4 sed -i on a test file in verify BLOCKS",
    bash(repo, "sed -i 's/it/x/' test/foo.test.js") === 2);
  check("    T1-4 sed -i on source in verify is ALLOWED",
    bash(repo, "sed -i 's/a/b/' src/foo.js") === 0);
}
{
  // The plan DECLARES state.json — which is what made this reachable at all.
  const repo = makeRun({ declared: ["src/foo.js", ".zcode/state/t.json"] });
  check("    T1-5 editing run state BLOCKS even when the plan declares it",
    gate(repo, "Edit", { file_path: join(repo, ".zcode", "state", "t.json") }) === 2);
}

// --- Class B: the protected-dirs guard must survive a symlinked root --------
console.log("\n  protected dirs (Class B — both sides normalized):");
{
  const repo = makeRun({});
  const link = join(tmpdir(), `zod-surface-link-${process.pid}`);
  try {
    symlinkSync(repo, link);
    check("    mcp write to .zcode/state via the real path BLOCKS",
      gate(repo, "mcp__fs__write_file", { path: join(repo, ".zcode", "state", "t.json") }) === 2);
    check("    mcp write via a SYMLINKED root also BLOCKS",
      gate(repo, "mcp__fs__write_file", { path: join(link, ".zcode", "state", "t.json") }) === 2);
    check("    mcp write to ordinary product code is ALLOWED",
      gate(repo, "mcp__fs__write_file", { path: join(repo, "src", "foo.js") }) === 0);
  } finally { try { rmSync(link, { force: true }); } catch {} }
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
