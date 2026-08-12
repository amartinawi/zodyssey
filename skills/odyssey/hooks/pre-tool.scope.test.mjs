#!/usr/bin/env node
// pre-tool.scope.test.mjs — two failures found by the FIRST end-to-end shakedown run (2026-08-12).
//
// Both had survived every unit test in the repo, because both are properties of how the pieces
// combine rather than of any one piece.
//
// SEC-M7b — A PROHIBITION GRANTED ACCESS. declaredScopeForRun harvests backtick-quoted paths from
//   the whole `## Scope` section. A plan-level `### Must NOT have` subsection lives INSIDE
//   `## Scope`, so the sentence "`src/unrelated.js` MUST NOT be touched" ADDED that file to the
//   declared set. The scope gate inverted: the more emphatically a plan forbade a file, the more
//   certainly it authorised writing to it. Caught live — a probe expecting a scope violation was
//   ALLOWED. SEC-M7 had fixed only the per-todo "Must NOT do" case.
//
// SEC-6b — TOTAL DEADLOCK IN PHASE 3. To reach execute, review.verdict must be OKAY, which only
//   record-review.mjs sets, which requires an artifact from record-momus-artifact.mjs, which takes
//   the verdict via --from or stdin. Pre-OKAY: SEC-6 refuses --from under plans/ and notepads/;
//   the Write gate allowed ONLY plans/ and notepads/; and any stdin pipe contains a metachar, so
//   it is not a trusted-script invoke and falls through to the write-capable gate, which blocks
//   pre-OKAY. Every route closed — no gated run could leave phase 3.
//
//   It hid because the Bash gate was DELETED from v0.1.1 through v0.3.1. SEC-6 landed 2026-08-04
//   while it was off; the two were never armed together until the gate was restored 2026-08-11.
//   Restoring a dormant guard can wake a deadlock that was latent the whole time.
//
// Run:  node pre-tool.scope.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const HOOK = join(new URL(".", import.meta.url).pathname, "pre-tool.mjs");
let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

const cleanup = [];
// Builds a run whose ONLY declared file is src/text.js, with `scopeBody` as the ## Scope content.
function repoWithScope(scopeBody, { phase = "execute", verdict = "OKAY" } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "zod-scope-")));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "text.js"), "// declared\n");
  writeFileSync(join(repo, "src", "unrelated.js"), "// NOT declared\n");
  const planPath = join(repo, ".zcode", "plans", "t.md");
  const planText = `# t\n\n## Scope\n\n${scopeBody}\n\n## Todos\n\n- [ ] 1. go\n  - Files: [\`src/text.js\`]\n`;
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
const editUnrelated = (repo) => hook(repo, "Edit", { file_path: join(repo, "src", "unrelated.js") });

console.log("pre-tool.mjs — scope prohibitions and the phase-3 staging path\n");

// --- SEC-M7b: forbidding a file must not authorise it ------------------------
{
  const repo = repoWithScope("### Must NOT have\n\n- `src/unrelated.js` MUST NOT be touched by any todo.");
  check("a `### Must NOT have` subsection does NOT grant scope", editUnrelated(repo) === 2);
}
{
  const repo = repoWithScope("Do the work. `src/unrelated.js` must not be modified.");
  check("an inline must-not line does NOT grant scope", editUnrelated(repo) === 2);
}
{
  const repo = repoWithScope("### Out of scope\n\n- `src/unrelated.js`");
  check("an `### Out of scope` subsection does NOT grant scope", editUnrelated(repo) === 2);
}
{
  const repo = repoWithScope("### Never touch\n\n- `src/unrelated.js`");
  check("a `### Never touch` subsection does NOT grant scope", editUnrelated(repo) === 2);
}

// --- SEC-M7c: `## Scope` prose now grants NOTHING ----------------------------
//
// This reverses an assertion written earlier the same day ("a positive Scope mention DOES still
// grant scope"). The harvest is gone entirely; `Files:` is the single source of truth for both
// this gate and F1.
//
// Why the reversal: the harvest needed two fixes in two days for the same bug shape (SEC-M7, then
// SEC-M7b) because reading paths out of prose cannot distinguish "edit this" from "do not edit
// this" from "this is what the style looks like". Round 2 showed the third case biting — a plan
// naming `test/text.test.js` as a STYLE REFERENCE thereby granted write access to it. And F1
// never honoured the harvest at all, so anything it granted passed the gate and then guaranteed
// an F1 failure. The gate authorised exactly what the final wave would reject.
{
  const repo = repoWithScope("This work also updates `src/unrelated.js` alongside the main change.");
  check("a positive Scope mention no longer grants scope (Files: is the only source)",
    editUnrelated(repo) === 2);
}
{
  const repo = repoWithScope("### Must have\n\n- `src/unrelated.js` is updated too.");
  check("a `### Must have` subsection no longer grants scope", editUnrelated(repo) === 2);
}
{
  // The case that motivated the removal: naming a file as a reference must not grant write access.
  const repo = repoWithScope("Match the existing style — see `src/unrelated.js` for the conventions.");
  check("naming a file as a STYLE REFERENCE does not grant write access", editUnrelated(repo) === 2);
}

// --- the declared file is unaffected in every case ---------------------------
{
  const repo = repoWithScope("### Must NOT have\n\n- `src/unrelated.js` MUST NOT be touched.");
  check("the plan's declared file is still editable", hook(repo, "Edit", { file_path: join(repo, "src", "text.js") }) === 0);
}

// --- SEC-6b: phase 3 has a writable path for the verdict ---------------------
{
  const repo = repoWithScope("Edit `src/text.js`.", { phase: "plan", verdict: "REJECT" });
  check("pre-OKAY: .zcode/staging/ is writable (the deadlock escape)",
    hook(repo, "Write", { file_path: join(repo, ".zcode", "staging", "verdict.json") }) === 0);
  check("pre-OKAY: plans/ still writable (unchanged)",
    hook(repo, "Write", { file_path: join(repo, ".zcode", "plans", "t2.md") }) === 0);
  check("pre-OKAY: product code still BLOCKED (staging did not widen the gate)",
    hook(repo, "Write", { file_path: join(repo, "src", "text.js") }) === 2);
  check("pre-OKAY: an arbitrary non-bookkeeping path is still BLOCKED",
    hook(repo, "Write", { file_path: join(repo, "verdict.json") }) === 2);
  check("pre-OKAY: .zcode/state/ is still BLOCKED (never bookkeeping)",
    hook(repo, "Write", { file_path: join(repo, ".zcode", "state", "forged.json") }) === 2);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
