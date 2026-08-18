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

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync, existsSync } from "node:fs";
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

// --- 10. The hatch must testify: every ungated call leaves a ledger row (item 04) -------------
// Both gate deletions were caused by this variable's SILENT ambient presence (header above);
// the committed decision is RECORD, not retire. The hatch still opens (section 6 asserts that),
// and every call that walks through it appends one JSON line {at, command} to
// .zcode/state/<slug>.ungated.jsonl — read-only calls included, because filtering by
// write-capability would re-run the gate analysis the hatch exists to skip: under the hatch the
// hook witnesses, it does not judge. Controls: a blocked call never took the hatch exit and so
// writes nothing; a read-only or trusted-script pass with the variable UNSET is ordinary
// traffic, not a bypass; with no active run the hook is a no-op and audits nothing. The run
// report counts the rows as ungated_bash_calls (0 with no ledger file).
{
  const { repo } = repoFor({ verdict: "REJECT" });
  const ledger = join(repo, ".zcode", "state", "t.ungated.jsonl");
  const rows = () => { try { return readFileSync(ledger, "utf8").split("\n").filter((l) => l.trim()); } catch { return []; } };

  // (a) write-capable, ungated: still exit 0 — recording never re-gates — and exactly one row.
  const uw = runHook(repo, { command: "sed -i 's/a/b/' src/secret.js" }, { env: { ZODYSSEY_UNGATE_BASH: "1" } });
  check("ungated write call: exit 0 (hatch still opens)", uw.code === 0, `(exit ${uw.code}, expected 0)`);
  check("ungated write call: exactly one ledger row", rows().length === 1, `(${rows().length} rows)`);
  let row = null; try { row = JSON.parse(rows()[0]); } catch {}
  check("ledger row carries { at, command }",
    !!(row && row.at && row.command === "sed -i 's/a/b/' src/secret.js"), JSON.stringify(row));

  // (b) read-only, ungated: ALSO recorded — the ledger is a witness, not a judgement.
  const ur = runHook(repo, { command: "ls -la" }, { env: { ZODYSSEY_UNGATE_BASH: "1" } });
  check("ungated read-only call: exit 0 AND recorded", ur.code === 0 && rows().length === 2,
    `(exit ${ur.code}, ${rows().length} rows)`);

  // (c) blocked call (variable empty): exit 2, and no new row — it never took the hatch exit.
  const blk = runHook(repo, { command: "sed -i 's/a/b/' src/secret.js" });
  check("blocked call: exit 2, NO ledger row added", blk.code === 2 && rows().length === 2,
    `(exit ${blk.code}, ${rows().length} rows)`);

  // (d) read-only with the variable unset: ordinary traffic, not a bypass.
  const ro = runHook(repo, { command: "ls -la" });
  check("read-only with variable unset: exit 0, NO ledger row", ro.code === 0 && rows().length === 2,
    `(exit ${ro.code}, ${rows().length} rows)`);

  // (e) trusted-script invoke with the variable unset: allowed via branch 2, not the hatch.
  const realSetPhase = join(new URL("..", import.meta.url).pathname, "scripts", "set-phase.mjs");
  const tr = runHook(repo, { command: `node ${realSetPhase} ${repo} t execute` });
  check("trusted-script invoke, variable unset: exit 0, NO ledger row", tr.code === 0 && rows().length === 2,
    `(exit ${tr.code}, ${rows().length} rows)`);

  // (f) variable set but no active run: the hook no-ops at the run check — nothing to audit into.
  const bare = realpathSync(mkdtempSync(join(tmpdir(), "zod-bare2-")));
  cleanup.push(bare);
  const nr = runHook(bare, { command: "rm -rf /" }, { env: { ZODYSSEY_UNGATE_BASH: "1" } });
  check("ungated with NO active run: exit 0, no ledger anywhere",
    nr.code === 0 && !existsSync(join(bare, ".zcode", "state", "t.ungated.jsonl")),
    `(exit ${nr.code}, ledger ${existsSync(join(bare, ".zcode", "state", "t.ungated.jsonl"))})`);

  // (g) report surface: run-report counts ledger rows as ungated_bash_calls; absent ledger -> 0.
  const REPORT = join(new URL("..", import.meta.url).pathname, "scripts", "run-report.mjs");
  const jsonOf = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };
  const rep = jsonOf(spawnSync(process.execPath, [REPORT, repo, "t", "--json"], { encoding: "utf8" }));
  check("run-report --json: ungated_bash_calls counts the ledger (2)",
    !!(rep && rep.ungated_bash_calls === 2), JSON.stringify(rep && rep.ungated_bash_calls));
  const { repo: repo0 } = repoFor({ verdict: "REJECT" });
  const rep0 = jsonOf(spawnSync(process.execPath, [REPORT, repo0, "t", "--json"], { encoding: "utf8" }));
  check("run-report --json: ungated_bash_calls === 0 with no ledger",
    !!(rep0 && rep0.ungated_bash_calls === 0), JSON.stringify(rep0 && rep0.ungated_bash_calls));

  // (h) STRUCTURAL — the class, not the instance: scan the hook's own source. Every
  // process.env.ZODYSSEY_* read whose guarded branch reaches an early exit(0) is a bypass site,
  // and the recorder must sit between the read and the exit. Exactly one such site exists today
  // (the UNGATE hatch); a future ZODYSSEY_SKIP_WHATEVER=1 copy-pasted beside it without a
  // recorder fails HERE the day it lands, not two releases later. The scan names no variable —
  // it asserts routing — so it also fails if the recorder helper is renamed or moved out from
  // between, and cannot rot into a tautology.
  const src = readFileSync(HOOK, "utf8").split("\n");
  let bypassSites = 0, unrouted = 0;
  for (let i = 0; i < src.length; i++) {
    if (!/process\.env\.ZODYSSEY_[A-Z_]+/.test(src[i])) continue;
    const win = [src[i], ...src.slice(i + 1, i + 7)]; // the env read + <=6 following lines
    const exitIdx = win.findIndex((l) => l.includes("exit(0)"));
    if (exitIdx === -1) continue; // env read not guarding an early pass — not a bypass site
    bypassSites++;
    const between = win.slice(0, exitIdx + 1).join("\n");
    const rec = between.lastIndexOf("recordUngatedBash");
    if (rec === -1 || rec > between.indexOf("exit(0)")) unrouted++;
  }
  check("structural: exactly one env-bypass site exists (the hatch)", bypassSites === 1,
    `(${bypassSites} sites — extend this scan deliberately if you add one)`);
  check("structural: every bypass site routes through recordUngatedBash before exit(0)",
    unrouted === 0, `(${unrouted} unrouted)`);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
