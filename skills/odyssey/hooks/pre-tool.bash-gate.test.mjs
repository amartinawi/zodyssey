#!/usr/bin/env node
// pre-tool.bash-gate.test.mjs — regression suite for the Bash write-gate.
//
// WHY THIS FILE EXISTS: the Bash gate has been silently deleted TWICE.
//   v0.1.1 (5c99927) shipped it deleted — the author's local ZODYSSEY_UNGATE_BASH=1 copy was
//                    mirrored to the public repo verbatim.
//   v0.1.2 (433c037) restored it and wrote a public post-mortem.
//   v0.2.0 (e57b01b) deleted it AGAIN (-170 lines -> `if (isBash) exit(0);`), and three
//                    independent external audits did not notice, because each audit reviews the
//                    diff in front of it and none re-checks an invariant established two
//                    releases earlier.
//
// Audits verify that code matches its documentation locally. They are not a regression suite.
// This is the regression suite. If the gate is removed a third time, this file fails.
//
// Every assertion below is an invariant the README/DESIGN.md already CLAIM. Nothing here is new
// policy — it is the existing promises, made executable.
//
// The hook is spawned as a real subprocess with a real stdin payload and a real temp repo; no
// mocking. exit 0 = pass (tool allowed), exit 2 = block.
//
// Run:  node pre-tool.bash-gate.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stampMarker } from "../scripts/lib/state-auth.mjs";

const HOOK = join(new URL(".", import.meta.url).pathname, "pre-tool.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name} ${detail}`); fail++; }
}

// --- fixture -----------------------------------------------------------------
// A temp repo with an active run. `verdict` and `planFiles` are the levers each case varies.
function makeRepo({ verdict = "REJECT", phase = "execute", planFiles = ["src/foo.js"], bindSha = true } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "zod-gate-")));
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "foo.js"), "// in scope\n");
  writeFileSync(join(repo, "src", "secret.js"), "// NOT in the plan\n");

  // isTrustedScriptInvoke resolves SCRIPTS_DIR as <PROJECT_DIR>/skills/odyssey/scripts (a
  // zodyssey checkout) or ~/.zcode/skills/odyssey/scripts (installed), then realpath-contains
  // the node operand inside it. Model the checkout layout so case 7 exercises the real path.
  // The hook only classifies the command string — it never executes it — so a stub suffices.
  mkdirSync(join(repo, "skills", "odyssey", "scripts"), { recursive: true });
  writeFileSync(join(repo, "skills", "odyssey", "scripts", "set-phase.mjs"), "// stub\n");

  const planPath = join(repo, ".zcode", "plans", "t.md");
  const planText = `# Plan t\n\n## Scope\n\nDo the thing.\n\n## Todos\n\n- [ ] 1. do it\n  Files: [${planFiles.map((f) => `\`${f}\``).join(", ")}]\n`;
  writeFileSync(planPath, planText);

  const state = {
    slug: "t",
    phase,
    updated_at: new Date().toISOString(),
    plan_path: planPath,
    review: {
      verdict,
      round: 1,
      max_rounds: 3,
      ...(bindSha ? { plan_sha256: createHash("sha256").update(planText).digest("hex") } : {}),
    },
  };
  // v0.5.0: run discovery is authenticated (CRITICAL T1-7), so a fixture state file must carry
  // the marker a real scaffold mints — otherwise the hook correctly ignores it and every
  // "expected 2" assertion below silently degrades to "no active run, exit 0".
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify(stampMarker(state, "t"), null, 2));
  return { repo, planPath };
}

// Spawn the hook exactly as the harness does: JSON on stdin, read the exit code.
function runHook(repo, toolInput, { toolName = "Bash", env = {} } = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ZODYSSEY_UNGATE_BASH: "", ...env },
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const cleanup = [];
function repoFor(opts) { const f = makeRepo(opts); cleanup.push(f.repo); return f; }

console.log("pre-tool.mjs — Bash write-gate regression suite\n");

// --- 1. THE REGRESSION ITSELF ------------------------------------------------
// README.md: "hook gates write-capable Bash (sed -i, >, git apply, …) the same as Edit."
{
  const { repo } = repoFor({ verdict: "REJECT" });
  for (const cmd of [
    "sed -i 's/a/b/' src/foo.js",
    "echo pwned > src/foo.js",
    "git apply /tmp/p.patch",
    "tee src/foo.js < /dev/null",
    "python -c \"open('src/foo.js','w').write('x')\"",
  ]) {
    const { code } = runHook(repo, { command: cmd });
    check(`pre-OKAY BLOCKS: ${cmd.slice(0, 38)}`, code === 2, `(exit ${code}, expected 2)`);
  }
}

// --- 2. No false positives: read-only Bash must always pass -------------------
// A gate that blocks `ls` would be abandoned within a day. This is what keeps it usable.
{
  const { repo } = repoFor({ verdict: "REJECT" });
  for (const cmd of ["ls -la", "cat src/foo.js", "grep -rn TODO src/", "git status", "npm test"]) {
    const { code } = runHook(repo, { command: cmd });
    check(`read-only ALLOWED pre-OKAY: ${cmd}`, code === 0, `(exit ${code}, expected 0)`);
  }
}

// --- 3. SEC-H5 scope isolation: post-OKAY, in-scope only ---------------------
// DESIGN.md: the executor may only mutate files the plan declares.
{
  const { repo } = repoFor({ verdict: "OKAY", planFiles: ["src/foo.js"] });
  const inScope = runHook(repo, { command: "sed -i 's/a/b/' src/foo.js" });
  check("post-OKAY ALLOWS in-scope write", inScope.code === 0, `(exit ${inScope.code}, expected 0)`);

  const outScope = runHook(repo, { command: "sed -i 's/a/b/' src/secret.js" });
  check("post-OKAY BLOCKS out-of-scope write", outScope.code === 2, `(exit ${outScope.code}, expected 2)`);
}

// --- 4. Fail closed when scope is unverifiable -------------------------------
// Write-capable constructs with no parseable target (make, docker run, patch) can write ANY
// path. Allowing them post-OKAY with no scope check IS the SEC-H5 isolation failure.
{
  const { repo } = repoFor({ verdict: "OKAY" });
  for (const cmd of ["make install", "docker run -v /:/host img", "patch < /tmp/p.diff"]) {
    const { code } = runHook(repo, { command: cmd });
    check(`fails closed on unparseable target: ${cmd.slice(0, 30)}`, code === 2, `(exit ${code}, expected 2)`);
  }
}

// --- 5. SEC-4 plan-tamper guard ----------------------------------------------
// .zcode/plans/ is agent-writable. Without this, Bash is the bypass: rewrite the plan to widen
// Files:, then sed -i the newly "in-scope" file — all post-OKAY.
{
  const { repo, planPath } = repoFor({ verdict: "OKAY", planFiles: ["src/foo.js"] });
  writeFileSync(planPath, "# Plan t\n\n## Todos\n\n- [ ] 1. do it\n  Files: [`src/foo.js`, `src/secret.js`]\n");
  const { code } = runHook(repo, { command: "sed -i 's/a/b/' src/secret.js" });
  check("BLOCKS write after plan tampered (sha drift)", code === 2, `(exit ${code}, expected 2)`);
}

// --- 6. The documented escape hatch must actually exist ----------------------
// README.md + INSTALL.md + install.mjs all tell users this env var works. After e57b01b it
// appeared in ZERO lines of executable code while still being documented in four places.
{
  const { repo } = repoFor({ verdict: "REJECT" });
  const { code } = runHook(repo, { command: "sed -i 's/a/b/' src/secret.js" }, { env: { ZODYSSEY_UNGATE_BASH: "1" } });
  check("ZODYSSEY_UNGATE_BASH=1 opens the gate (documented hatch is real)", code === 0, `(exit ${code}, expected 0)`);
}

// --- 7. Recorder machinery must survive the gate ------------------------------
// record-review writes the verdict; set-phase advances phases. If the gate blocked these, no
// run could ever reach OKAY — the gate would deadlock the pipeline it protects.
{
  const { repo } = repoFor({ verdict: "REJECT" });
  const realSetPhase = join(new URL("..", import.meta.url).pathname, "scripts", "set-phase.mjs");

  // LAYOUT INDEPENDENCE (v0.3.0 plugin-cache relocation): the realistic deployment is a user
  // repo that contains no ZOdyssey scripts of its own, invoking the recorder from wherever
  // ZOdyssey is installed. SCRIPTS_DIR must resolve from the HOOK's own location. If this
  // fails, every run deadlocks at the review gate — record-review can never be invoked, so no
  // verdict can ever be recorded, so the gate never opens.
  const { code } = runHook(repo, { command: `node ${realSetPhase} ${repo} t execute` });
  check("recorder ALLOWED from installed location", code === 0, `(exit ${code}, expected 0)`);

  // ...but the allowlist must not be a shell-injection hole (SEC-H3).
  const inject = runHook(repo, { command: `node ${realSetPhase} x; sed -i 's/a/b/' src/secret.js` });
  check("trusted-script allowlist REJECTS chained metacharacters", inject.code === 2, `(exit ${inject.code}, expected 2)`);

  // HOSTILE-REPO TRUST HOLE (closed 2026-08-11): SCRIPTS_DIR used to fall back to
  // <PROJECT_DIR>/skills/odyssey/scripts — a path inside the USER'S repo, i.e. attacker-
  // controlled. A repo shipping that directory could have any script in it allowlisted past
  // the Bash gate. The audited repo must never get to nominate what bypasses the audit.
  const planted = join(repo, "skills", "odyssey", "scripts", "set-phase.mjs"); // fixture plants this
  const hostile = runHook(repo, { command: `node ${planted} ${repo} t execute` });
  check("script planted INSIDE the audited repo is NOT trusted", hostile.code === 2, `(exit ${hostile.code}, expected 2)`);
}

// --- 8. The safety guarantee: no active run => total no-op --------------------
// README.md: "All hooks are NO-OP unless an orchestration run is active."
{
  const bare = realpathSync(mkdtempSync(join(tmpdir(), "zod-bare-")));
  cleanup.push(bare);
  const { code } = runHook(bare, { command: "rm -rf /" });
  check("no active run => hook is a no-op", code === 0, `(exit ${code}, expected 0)`);
}

// --- 9. Terminal phase disarms the gate --------------------------------------
{
  const { repo } = repoFor({ verdict: "REJECT", phase: "done" });
  const { code } = runHook(repo, { command: "sed -i 's/a/b/' src/secret.js" });
  check("terminal phase (done) disarms the gate", code === 0, `(exit ${code}, expected 0)`);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
