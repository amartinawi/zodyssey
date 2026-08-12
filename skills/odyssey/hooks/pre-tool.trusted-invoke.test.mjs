#!/usr/bin/env node
// pre-tool.trusted-invoke.test.mjs — the trusted-script allowlist must distinguish shell syntax
// from quoted data, WITHOUT letting a real injection through.
//
// WHY: the allowlist rejected any command containing `; & | \` $ < > ( )` anywhere, including
// inside a quoted argument where the shell would never act on it. Shakedown round 3 paid for it:
// `record-verify.mjs --criterion "node -e 'process.exit(0)'"` was blocked over the parens inside
// the criterion, so only 1 of 4 acceptance criteria could be recorded and the run reached `done`
// with acceptance {pass:false, criteria_run:1, criteria_declared:4}. A rule meant to protect the
// evidence chain was degrading it, and it silently excluded most real-world criteria.
//
// The whole value of this file is the INJECTION half. Loosening a security rule is only
// defensible if the cases it exists to stop are still stopped, so those are enumerated first and
// in more detail than the happy path. If any of them regress, this loosening was a mistake.
//
// Run:  node pre-tool.trusted-invoke.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const HOOK = join(new URL(".", import.meta.url).pathname, "pre-tool.mjs");
const SCRIPTS = join(new URL(".", import.meta.url).pathname, "..", "scripts");
const RV = join(SCRIPTS, "record-verify.mjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

// A run held PRE-OKAY, so the ONLY thing that can let a Bash command through is the trusted-script
// allowlist. Any hole shows up as an exit 0 that should have been 2.
const repo = realpathSync(mkdtempSync(join(tmpdir(), "zod-ti-")));
mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
mkdirSync(join(repo, "src"), { recursive: true });
writeFileSync(join(repo, "src", "a.js"), "const a = 1;\n");
const planPath = join(repo, ".zcode", "plans", "t.md");
const planText = "# t\n\n## Todos\n\n- [ ] 1. go\n  - Files: [`src/a.js`]\n";
writeFileSync(planPath, planText);
writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify({
  slug: "t", phase: "plan", updated_at: new Date().toISOString(), plan_path: planPath,
  review: { verdict: "REJECT", round: 1, max_rounds: 3, plan_sha256: createHash("sha256").update(planText).digest("hex") },
}, null, 2));

const run = (command) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ZODYSSEY_UNGATE_BASH: "" },
}).status;
const allowed = (c) => run(c) === 0;
const blocked = (c) => run(c) === 2;

console.log("pre-tool.mjs — trusted-script allowlist, quote-aware\n");

// --- INJECTION: every one of these must stay BLOCKED -------------------------
console.log("  injection attempts (all must be BLOCKED):");
for (const [label, cmd] of [
  ["chained with ;",            `node ${RV} ${repo} t 1 ; rm -rf /`],
  ["chained with &&",           `node ${RV} ${repo} t 1 && sed -i s/a/b/ src/a.js`],
  ["chained with ||",           `node ${RV} ${repo} t 1 || sed -i s/a/b/ src/a.js`],
  ["backgrounded with &",       `node ${RV} ${repo} t 1 & sed -i s/a/b/ src/a.js`],
  ["piped",                     `node ${RV} ${repo} t 1 | tee /tmp/x`],
  ["output redirect",           `node ${RV} ${repo} t 1 > /tmp/pwned`],
  ["input redirect",            `node ${RV} ${repo} t 1 < /etc/passwd`],
  ["command substitution $()",  `node ${RV} ${repo} t 1 --criterion $(echo pwned)`],
  ["command substitution ``",   "node " + RV + " " + repo + " t 1 --criterion `echo pwned`"],
  ["subshell",                  `(node ${RV} ${repo} t 1)`],
  ["$() INSIDE double quotes",  `node ${RV} ${repo} t 1 --criterion "$(rm -rf /tmp/x)"`],
  ["backtick INSIDE double q",  "node " + RV + " " + repo + ' t 1 --criterion "`id`"'],
  ["var expansion in double q", `node ${RV} ${repo} t 1 --criterion "$HOME/evil"`],
  ["escaped quote then chain",  `node ${RV} ${repo} t 1 --criterion \\"; rm -rf /`],
  ["unterminated single quote", `node ${RV} ${repo} t 1 --criterion 'oops`],
  ["unterminated double quote", `node ${RV} ${repo} t 1 --criterion "oops`],
  ["not node",                  `python3 ${RV} ${repo} t 1`],
  ["node outside scripts dir",  `node /tmp/evil.mjs ${repo} t 1`],
  ["path traversal out",        `node ${SCRIPTS}/../hooks/pre-tool.mjs`],
]) {
  check(`    ${label}`, blocked(cmd), `(exit ${run(cmd)})`);
}

// --- LEGITIMATE: quoted metachars are data, and must be ALLOWED --------------
console.log("\n  legitimate criteria (all must be ALLOWED):");
for (const [label, cmd] of [
  ["plain criterion",           `node ${RV} ${repo} t 1 --criterion 'npm test'`],
  ["parens in single quotes",   `node ${RV} ${repo} t 1 --criterion 'node -e process.exit(0)'`],
  ["parens in double quotes",   `node ${RV} ${repo} t 1 --criterion "node -e process.exit(0)"`],
  ["nested quotes (round 3's)", `node ${RV} ${repo} t 1 --criterion "node -e 'process.exit(0)'"`],
  ["semicolon inside quotes",   `node ${RV} ${repo} t 1 --criterion 'node -e "a=1; b=2"'`],
  ["pipe inside quotes",        `node ${RV} ${repo} t 1 --criterion 'grep -c x file | wc -l'`],
  ["redirect inside quotes",    `node ${RV} ${repo} t 1 --criterion 'cmd > out.txt'`],
  ["ampersand inside quotes",   `node ${RV} ${repo} t 1 --criterion 'a && b'`],
  ["dollar in SINGLE quotes",   `node ${RV} ${repo} t 1 --criterion 'echo $NOT_EXPANDED'`],
  ["env prefix then node",      `FOO=bar node ${RV} ${repo} t 1 --criterion 'npm test'`],
]) {
  check(`    ${label}`, allowed(cmd), `(exit ${run(cmd)})`);
}

// --- the end-to-end case round 3 actually hit --------------------------------
console.log("\n  end-to-end:");
{
  // record-verify must now be able to RUN a criterion containing metacharacters.
  const r = spawnSync(process.execPath,
    [RV, repo, "t", "1", "--criterion", `node -e "process.exit(0)"`, "--n", "9"],
    { encoding: "utf8" });
  check("    record-verify executes a metachar criterion", r.status === 0, `(exit ${r.status})`);
}

// --- lint-before-dispatch: do not spend a review round on a doomed plan ------
//
// record-review gates OKAY on a clean `parse-plan --lint`, but that ran at the END of the review.
// Round 3: momus approved, record-review rejected on non-executable criteria, the fix changed the
// plan-sha, the review was invalidated, and momus had to be dispatched again — a full round spent
// learning something the parser knew before it started.
{
  const planPath2 = join(repo, ".zcode", "plans", "t.md");
  const setPhase = (phase) => {
    const sp = join(repo, ".zcode", "state", "t.json");
    const st = JSON.parse(readFileSync(sp, "utf8"));
    st.phase = phase; st.review = { verdict: null, round: 0, max_rounds: 3 };
    writeFileSync(sp, JSON.stringify(st, null, 2));
  };
  const dispatchMomus = () => spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: "Task", tool_input: { subagent_type: "zodyssey:momus", prompt: "review" } }),
    encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: repo, ZODYSSEY_UNGATE_BASH: "" },
  });

  writeFileSync(planPath2, "# t\n\n## Todos\n\n- [ ] 1. go\n  - Files: [`src/a.js`]\n  - Acceptance criteria:\n    - The thing returns 200.\n\n## Final verification wave\n");
  setPhase("review");
  let r = dispatchMomus();
  check("    momus dispatch BLOCKED when the plan fails lint", r.status === 2, `(exit ${r.status})`);
  check("    ...and names the specific problem", /not an executable command/.test(r.stdout + r.stderr));

  writeFileSync(planPath2, "# t\n\n## Todos\n\n- [ ] 1. go\n  - Files: [`src/a.js`]\n  - Acceptance criteria:\n    - `node --check src/a.js` exits 0\n\n## Final verification wave\n");
  setPhase("review");
  r = dispatchMomus();
  check("    momus dispatch ALLOWED when the plan lints clean", r.status === 0, `(exit ${r.status})`);
  check("    ...and the nonce is still minted", /pending_nonce/.test(r.stderr));
}

rmSync(repo, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
