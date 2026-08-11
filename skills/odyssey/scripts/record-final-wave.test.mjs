#!/usr/bin/env node
// record-final-wave.test.mjs — the final wave must judge CONTENT, not ceremony.
//
// Before 2026-08-11 this file could not have existed, because there was nothing to assert:
//   F2/F4 confirmed a nonce consumed and set passed:true without ever opening the artifact. An
//   artifact reading {"verdict":"REJECT","blockers":["completely broken"]} passed both.
//   F1 computed only `actual \ declared`, so an EMPTY diff passed vacuously — the file's own
//   SEC-H1 comment conceded this. With --skip F2,F4 that was a clean path to `done` on a run
//   that changed nothing.
//   Nothing anywhere noticed a deleted or neutered test, even though weakening a test is the
//   cheapest way to make a failing acceptance criterion go green.
//
// Run:  node record-final-wave.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const SCRIPT = join(new URL(".", import.meta.url).pathname, "record-final-wave.mjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);
const git = (repo, ...a) => spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" });

// A real git repo with a run at phase=final, a plan declaring Files:, and one committed baseline.
function makeRepo({ declared = ["src/foo.js"], withTest = false } = {}) {
  const repo = mkdtempSync(join(tmpdir(), "zod-fw-"));
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "reviews"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "foo.js"), "// base\n");
  if (withTest) {
    mkdirSync(join(repo, "test"), { recursive: true });
    writeFileSync(join(repo, "test", "foo.test.js"),
      "it('a', () => expect(1).toBe(1));\nit('b', () => expect(2).toBe(2));\nit('c', () => expect(3).toBe(3));\n");
  }
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@t.t");
  git(repo, "config", "user.name", "t");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "base");
  const startSha = git(repo, "rev-parse", "HEAD").stdout.trim();

  const planPath = join(repo, ".zcode", "plans", "t.md");
  writeFileSync(planPath, `# t\n\n## Todos\n\n- [ ] 1. x\n  Files: [${declared.map((f) => `\`${f}\``).join(", ")}]\n`);
  writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify({
    slug: "t", phase: "final", updated_at: new Date().toISOString(),
    plan_path: planPath, run_start_sha: startSha,
    review: { verdict: "OKAY", round: 1, max_rounds: 3 },
  }, null, 2));
  return { repo, planPath, startSha };
}

// Mint a nonce the way the hook does, so consumeFinalNonce accepts it.
function armNonce(repo, field, artifactAbs) {
  const p = join(repo, ".zcode", "state", "t.json");
  const st = JSON.parse(readFileSync(p, "utf8"));
  const nonce = createHash("sha256").update(field + artifactAbs + "salt").digest("hex").slice(0, 32);
  // consumeFinalNonce reads `pending.nonce` — pending_nonce is an OBJECT, not a bare string
  // (record-final-wave.mjs:275). A string here makes every case fail at the nonce check, which
  // would let the REJECT/ambiguous assertions below pass for entirely the wrong reason.
  st[field] = { pending_nonce: { nonce, minted_at: new Date().toISOString() } };
  writeFileSync(p, JSON.stringify(st, null, 2));
  return nonce;
}

function run(repo, args) {
  const r = spawnSync(process.execPath, [SCRIPT, repo, "t", ...args], { encoding: "utf8" });
  let state = null;
  try { state = JSON.parse(readFileSync(join(repo, ".zcode", "state", "t.json"), "utf8")); } catch {}
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), state };
}

const cleanup = [];
const mk = (o) => { const f = makeRepo(o); cleanup.push(f.repo); return f; };

console.log("record-final-wave.mjs — the final wave judges content, not ceremony\n");

// --- F2/F4 must read the verdict ---------------------------------------------
{
  const { repo } = mk({});
  writeFileSync(join(repo, "src", "foo.js"), "// changed\n");
  const art = join(repo, ".zcode", "reviews", "f2.json");

  // THE REGRESSION: a REJECT artifact used to pass F2 outright.
  writeFileSync(art, JSON.stringify({ verdict: "REJECT", blockers: ["completely broken"] }));
  let n = armNonce(repo, "final_f2", art);
  let r = run(repo, ["--f2-artifact", art, "--f2-nonce", n, "--skip", "F3,F4"]);
  check("F2 REJECTS a REJECT artifact", r.state?.final?.results?.F2?.passed === false,
    `(passed=${r.state?.final?.results?.F2?.passed})`);

  // An artifact with no verdict at all must fail closed, not sail through.
  writeFileSync(art, "The reviewer looked at things and had opinions.\n");
  n = armNonce(repo, "final_f2", art);
  r = run(repo, ["--f2-artifact", art, "--f2-nonce", n, "--skip", "F3,F4"]);
  check("F2 fails closed on a verdict-less artifact", r.state?.final?.results?.F2?.passed === false);

  // Says both → we do not know → must NOT approve.
  writeFileSync(art, "VERDICT: APPROVE\nOn reflection...\nVERDICT: REJECT\n");
  n = armNonce(repo, "final_f2", art);
  r = run(repo, ["--f2-artifact", art, "--f2-nonce", n, "--skip", "F3,F4"]);
  check("F2 fails closed on a contradictory artifact", r.state?.final?.results?.F2?.passed === false);

  // Discussion mentioning the words is not a verdict.
  writeFileSync(art, "This would REJECT under the old rules, but I APPROVE of the approach.\n");
  n = armNonce(repo, "final_f2", art);
  r = run(repo, ["--f2-artifact", art, "--f2-nonce", n, "--skip", "F3,F4"]);
  check("F2 does not treat prose keywords as a verdict", r.state?.final?.results?.F2?.passed === false);

  // The happy path still works, or the gate is unusable.
  writeFileSync(art, JSON.stringify({ verdict: "APPROVE", findings: [] }));
  n = armNonce(repo, "final_f2", art);
  r = run(repo, ["--f2-artifact", art, "--f2-nonce", n, "--skip", "F3,F4"]);
  check("F2 ACCEPTS an APPROVE artifact", r.state?.final?.results?.F2?.passed === true,
    `(reason=${r.state?.final?.results?.F2?.reason})`);

  // Markdown form.
  writeFileSync(art, "# Review\n\nAll good.\n\nVERDICT: APPROVE\n");
  n = armNonce(repo, "final_f2", art);
  r = run(repo, ["--f2-artifact", art, "--f2-nonce", n, "--skip", "F3,F4"]);
  check("F2 accepts a markdown `VERDICT: APPROVE` line", r.state?.final?.results?.F2?.passed === true);
}

// --- F4 gets the same treatment ----------------------------------------------
{
  const { repo } = mk({});
  writeFileSync(join(repo, "src", "foo.js"), "// changed\n");
  const art = join(repo, ".zcode", "reviews", "f4.json");
  writeFileSync(art, JSON.stringify({ verdict: "REJECT" }));
  const n = armNonce(repo, "final_f4", art);
  const r = run(repo, ["--f4-artifact", art, "--f4-nonce", n, "--skip", "F2,F3"]);
  check("F4 REJECTS a REJECT artifact", r.state?.final?.results?.F4?.passed === false);
}

// --- F1: the vacuous empty-diff pass -----------------------------------------
{
  const { repo } = mk({});
  const r = run(repo, ["--skip", "F2,F3,F4"]); // declared a file, changed NOTHING
  check("F1 fails when the plan declares files but nothing changed",
    r.state?.final?.results?.F1?.passed === false, `(passed=${r.state?.final?.results?.F1?.passed})`);
  check("F1 reports which declared files were untouched",
    (r.state?.final?.results?.F1?.declared_untouched || []).includes("src/foo.js"));
}

// --- F1: scope creep still caught (no regression) ----------------------------
{
  const { repo } = mk({});
  writeFileSync(join(repo, "src", "foo.js"), "// changed\n");
  writeFileSync(join(repo, "src", "stray.js"), "// not declared\n");
  const r = run(repo, ["--skip", "F2,F3,F4"]);
  check("F1 still catches out-of-scope files", r.state?.final?.results?.F1?.passed === false);
  check("F1 names the out-of-scope file",
    (r.state?.final?.results?.F1?.out_of_scope || []).includes("src/stray.js"));
}

// --- F1: test-integrity guard -------------------------------------------------
{
  // Deleting a test file that IS in scope used to pass cleanly.
  const { repo } = mk({ declared: ["src/foo.js", "test/foo.test.js"], withTest: true });
  writeFileSync(join(repo, "src", "foo.js"), "// changed\n");
  rmSync(join(repo, "test", "foo.test.js"));
  const r = run(repo, ["--skip", "F2,F3,F4"]);
  check("F1 fails when an in-scope test file is DELETED", r.state?.final?.results?.F1?.passed === false);
  check("F1 names the deleted test",
    (r.state?.final?.results?.F1?.test_integrity?.deleted || []).some((p) => p.includes("foo.test.js")));
}
{
  // Assertions removed but the file kept — net-negative line count.
  const { repo } = mk({ declared: ["src/foo.js", "test/foo.test.js"], withTest: true });
  writeFileSync(join(repo, "src", "foo.js"), "// changed\n");
  writeFileSync(join(repo, "test", "foo.test.js"), "it('a', () => expect(1).toBe(1));\n");
  const r = run(repo, ["--skip", "F2,F3,F4"]);
  check("F1 fails when a test file loses assertions (net-negative)",
    r.state?.final?.results?.F1?.passed === false);
}
{
  // Test neutered in place with .skip — line count unchanged.
  const { repo } = mk({ declared: ["src/foo.js", "test/foo.test.js"], withTest: true });
  writeFileSync(join(repo, "src", "foo.js"), "// changed\n");
  writeFileSync(join(repo, "test", "foo.test.js"),
    "it.skip('a', () => expect(1).toBe(1));\nit('b', () => expect(2).toBe(2));\nit('c', () => expect(3).toBe(3));\n");
  const r = run(repo, ["--skip", "F2,F3,F4"]);
  check("F1 fails when a skip marker is added to a test",
    r.state?.final?.results?.F1?.passed === false);
}
{
  // Control: honest work on both source and tests must PASS, or the guard is unusable.
  const { repo } = mk({ declared: ["src/foo.js", "test/foo.test.js"], withTest: true });
  writeFileSync(join(repo, "src", "foo.js"), "// changed\n");
  writeFileSync(join(repo, "test", "foo.test.js"),
    "it('a', () => expect(1).toBe(1));\nit('b', () => expect(2).toBe(2));\nit('c', () => expect(3).toBe(3));\nit('d', () => expect(4).toBe(4));\n");
  const r = run(repo, ["--skip", "F2,F3,F4"]);
  check("F1 PASSES when source and tests both grow honestly",
    r.state?.final?.results?.F1?.passed === true,
    `(${JSON.stringify(r.state?.final?.results?.F1?.test_integrity)})`);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
