#!/usr/bin/env node
// sec6-repo-arg.test.mjs — SEC-6 must refuse regardless of how the repo argument is spelled.
//
// WHY: SEC-6 built its bookkeeping prefix from the repo argument AS PASSED and compared it against
// an absolute realpath. With a relative repo arg (`.` — the form the docs themselves used, and the
// form a live run used) the prefix was ".zcode/plans/" and the candidate was "/abs/…", so
// startsWith could never match and the guard was a silent no-op. record-final-artifact carried a
// byte-identical copy that nobody had found.
//
// The whole suite was blind to this: all 62 mkdtempSync fixtures pass ABSOLUTE paths, so the one
// input shape where the guard happens to work was the only one ever tested.
//
// Run:  node sec6-repo-arg.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { stampMarker } from "./lib/state-auth.mjs";

const SCRIPTS = new URL(".", import.meta.url).pathname;
let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

const repo = realpathSync(mkdtempSync(join(tmpdir(), "zod-sec6-")));
for (const d of ["state", "plans", "notepads", "staging", "reviews"]) {
  mkdirSync(join(repo, ".zcode", d), { recursive: true });
}
const verdict = JSON.stringify({ verdict: "OKAY", blockers: [] });
writeFileSync(join(repo, ".zcode", "plans", "forged.json"), verdict);
writeFileSync(join(repo, ".zcode", "notepads", "forged.json"), verdict);
writeFileSync(join(repo, ".zcode", "staging", "ok.json"), verdict);
writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify(stampMarker({
  slug: "t", phase: "review", started_at: "2026-08-15T00:00:00Z", run_start_sha: "abc",
  updated_at: new Date().toISOString(), review: { verdict: "REJECT", round: 0, max_rounds: 3 },
}, "t"), null, 2));

// Run a script from a given cwd with a given spelling of the repo arg. SEC-6 refusals are exit 6
// AND carry a distinctive message, so match the message — several later checks also exit 6.
function run(script, repoArg, fromFile, cwd) {
  const args = script === "record-momus-artifact.mjs"
    ? [join(SCRIPTS, script), repoArg, "t", "1", "--nonce", "fake", "--from", fromFile]
    : [join(SCRIPTS, script), repoArg, "t", "F2", "--nonce", "fake", "--from", fromFile];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd });
  return { code: r.status, sec6: /agent-writable bookkeeping/.test(r.stderr || "") };
}

console.log("SEC-6 — refusal must not depend on the repo argument's spelling\n");

for (const script of ["record-momus-artifact.mjs", "record-final-artifact.mjs"]) {
  console.log(`  ${script}:`);
  for (const dir of ["plans", "notepads"]) {
    const forged = join(repo, ".zcode", dir, "forged.json");
    const abs = run(script, repo, forged, repo);
    check(`    absolute repo arg refuses a verdict staged in ${dir}/`, abs.sec6, `(exit ${abs.code})`);
    // THE BUG: same file, same script, repo spelled "." — used to sail through.
    const rel = run(script, ".", forged, repo);
    check(`    RELATIVE repo arg also refuses it (was a silent bypass)`, rel.sec6, `(exit ${rel.code})`);
  }
  // The sanctioned path must stay open, or arming SEC-6 deadlocks the review gate (SEC-6b).
  const staged = run(script, ".", join(repo, ".zcode", "staging", "ok.json"), repo);
  check(`    .zcode/staging/ is NOT refused (the deadlock escape stays open)`, !staged.sec6,
    `(exit ${staged.code})`);
}

rmSync(repo, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
