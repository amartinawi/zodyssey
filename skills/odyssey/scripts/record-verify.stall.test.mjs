#!/usr/bin/env node
// record-verify.stall.test.mjs — don't re-run a criterion against an unchanged workspace.
//
// The loop: a criterion fails, the executor is dispatched to fix it, it returns having changed
// nothing that matters, verify re-runs the identical command against an identical workspace and
// gets the identical failure — until the attempt cap. Failed agentic attempts burn ~3.5x the steps
// of successful ones, and this shape is much of why: the harness cannot distinguish "tried again"
// from "tried again with something different".
//
// Ported from prime-agent's `captureGitWorktreeSnapshot` (core/autonomous.ts) — the one borrowable
// primitive left after v0.2.0's fit study, because unlike the other five it needs no daemon.
//
// The assertions that matter most are the ones proving it does NOT misfire: a real fix must
// re-run, an untracked-file fix must re-run (status --porcelain lists untracked files by NAME, so
// hashing names alone would call a genuine fix a stall), a previously PASSING criterion is not a
// stall, and a non-git repo stays inert. A stall detector that blocks real progress is worse than
// none, because it stops a run that would have succeeded.
//
// Run:  node record-verify.stall.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = join(new URL(".", import.meta.url).pathname, "record-verify.mjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const git = (repo, ...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });

const cleanup = [];
function makeRepo({ useGit = true } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "zod-stall-"));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.js"), "// base\n");
  // A criterion that fails iff FIXED is absent — so "the executor fixed it" is expressible.
  writeFileSync(join(repo, "check.mjs"),
    `import { existsSync } from "node:fs";\n` +
    `process.exit(existsSync(new URL("./FIXED", import.meta.url)) ? 0 : 1);\n`);
  if (useGit) {
    git(repo, "init", "-q");
    git(repo, "config", "user.email", "t@t.t");
    git(repo, "config", "user.name", "t");
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", "base");
  }
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify({
    slug: "t", phase: "verify", updated_at: new Date().toISOString(),
    review: { verdict: "OKAY", round: 1, max_rounds: 3 },
  }, null, 2));
  return repo;
}
const verify = (repo, ...extra) => {
  const r = spawnSync(process.execPath,
    [SCRIPT, repo, "t", "1", "--criterion", `node ${join(repo, "check.mjs")}`, ...extra],
    { encoding: "utf8" });
  let state = null;
  try { state = JSON.parse(readFileSync(join(repo, ".zcode", "state", "t.json"), "utf8")); } catch {}
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), state };
};

console.log("record-verify.mjs — no-progress stall detector\n");

// --- the loop it exists to break ---------------------------------------------
{
  const repo = makeRepo();
  const first = verify(repo);
  check("first run executes and FAILS normally", first.code === 6, `(exit ${first.code})`);

  const second = verify(repo); // nothing changed
  check("second run REFUSES to re-run (exit 10)", second.code === 10, `(exit ${second.code})`);
  check("says the workspace is unchanged", /NOT RERUN|unchanged/i.test(second.out));
  check("counts the stall so the run still converges",
    (second.state?.verify?.history || []).some((h) => h.stall_attempts === 1));

  const third = verify(repo);
  check("stall count increments across repeats",
    third.code === 10 && (third.state?.verify?.history || []).some((h) => h.stall_attempts === 2));
}

// --- IT MUST NOT MISFIRE -----------------------------------------------------
{
  // A real fix to a TRACKED file must re-run.
  const repo = makeRepo();
  verify(repo);
  writeFileSync(join(repo, "src", "a.js"), "// actually fixed something\n");
  const r = verify(repo);
  check("a tracked-file change RE-RUNS (still fails, but it ran)", r.code === 6, `(exit ${r.code})`);
}
{
  // A fix that only adds an UNTRACKED file must re-run. `git status --porcelain` lists untracked
  // files by name only, so fingerprinting names alone would call this a stall and block the fix.
  const repo = makeRepo();
  verify(repo);
  writeFileSync(join(repo, "FIXED"), "x"); // untracked, and it makes the criterion pass
  const r = verify(repo);
  check("an untracked-file change RE-RUNS and now PASSES", r.code === 0, `(exit ${r.code})`);
}
{
  // Editing the CONTENT of an existing untracked file must also count as progress.
  const repo = makeRepo();
  writeFileSync(join(repo, "notes.txt"), "before");
  verify(repo);
  writeFileSync(join(repo, "notes.txt"), "after");
  const r = verify(repo);
  check("untracked CONTENT change RE-RUNS (names alone are not enough)", r.code === 6, `(exit ${r.code})`);
}
{
  // A criterion that PASSED is not a stall — re-running a passing check is legitimate.
  const repo = makeRepo();
  writeFileSync(join(repo, "FIXED"), "x");
  const first = verify(repo);
  check("passing criterion returns 0", first.code === 0);
  const second = verify(repo);
  check("re-running a PASSING criterion is not a stall", second.code === 0, `(exit ${second.code})`);
}
{
  // Different criterion index → different question → not a stall.
  const repo = makeRepo();
  verify(repo, "--n", "1");
  const r = verify(repo, "--n", "2");
  check("a DIFFERENT criterion index is not a stall", r.code === 6, `(exit ${r.code})`);
}

// --- inert where it cannot know ----------------------------------------------
{
  const repo = makeRepo({ useGit: false });
  verify(repo);
  const r = verify(repo);
  check("non-git repo → detector inert, normal failure", r.code === 6, `(exit ${r.code})`);
}
{
  const repo = makeRepo();
  verify(repo);
  const r = verify(repo, "--no-stall-check");
  check("--no-stall-check overrides the refusal", r.code === 6, `(exit ${r.code})`);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
