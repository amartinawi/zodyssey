#!/usr/bin/env node
// lint-baseline.test.mjs — the paired pre+post lint-baseline suite (item 07 / B10, todo 1).
//
// WHAT THIS PROVES: the post-edit lint arm must attribute its blocks against a
// first-touch pre-edit baseline captured by the pre-edit hook. Scenario (a) is
// the defect this run exists for: a file that was ALREADY failing lint before
// the run ever touched it must sail through a benign edit unblocked. Against
// the UNMODIFIED hooks this suite is RED (exit 1) — that is the TDD
// demonstration, not a bug in the suite; todo 2 makes it green. Brief criterion
// 8's stash-dance re-proves the red direction on demand post-fix.
//
// FIXTURE-GATE TRAP (bit items 02/03 — read before touching the fixtures): the
// temp repos must satisfy pre-tool's OTHER gates or this suite measures the
// gates, not the lint arm. Every fixture repo carries:
//   · a stamped (stampMarker) state file in phase `execute` (plus a `plan`-phase
//     variant for scenario (f)) — an unmarked state file is ignored by
//     findActiveRuns and every case would degrade to "no active run";
//   · a recorded review verdict of OKAY bound to the plan's sha256 (the SEC-4
//     tamper guard re-hashes the plan on every gated edit);
//   · a parse-plan-lint-clean plan at state.plan_path whose Files: declares
//     BOTH edit targets (the scope gate is fail-closed on anything undeclared).
//
// SIDE-FILE CONTRACT (todo 2 implements; this suite is the spec):
//   .zcode/state/<slug>.lint-baseline.json — a JSON object keyed by
//   repo-relative target path, value exactly one of:
//     "clean"   — the pre-edit lint exited 0 (a Write creating a file that did
//                 not exist records this implicitly)
//     "failing" — the pre-edit lint exited non-zero
//     "inert"   — no lint_cmd, or the capture failed (timeout/ENOENT/unreadable
//                 state dir) — never blocks anything
//   Frozen at first touch per target; written atomically (same-dir tmp+rename);
//   the capture arm NEVER blocks and never prints a decision.
//
// Dual-mode like the repo's other hook suites: plain `node lint-baseline.test.mjs`
// (exit 0 pass / 1 fail) and `node --test lint-baseline.test.mjs` (same verdict).
//
// Run:  node lint-baseline.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, appendFileSync, mkdirSync, rmSync, realpathSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stampMarker } from "../scripts/lib/state-auth.mjs";
import { findActiveRuns } from "./lib/find-run.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const PRE_HOOK = join(HERE, "pre-tool.mjs");
const POST_HOOK = join(HERE, "post-tool.mjs");
const SLUG = "t";

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

const cleanup = [];

// The marker lint: exits 1 with a one-line message iff the target contains FAIL-MARKER,
// and logs EVERY invocation to lint-spawns.log so "zero spawns" / "no second capture"
// are assertable. Fixture-repo only — never installed anywhere.
const LINT_FIXTURE_SRC = `#!/usr/bin/env node
// lint-fixture.mjs — deterministic marker lint for the paired suite.
import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const target = process.argv[2] || "";
try { appendFileSync(fileURLToPath(new URL("lint-spawns.log", import.meta.url)), target + "\\n"); } catch {}
let src = "";
try { src = readFileSync(target, "utf8"); } catch { /* absent target: not a diagnostic */ }
if (src.includes("FAIL-MARKER")) {
  console.error("lint: FAIL-MARKER present in " + target);
  process.exit(1);
}
process.exit(0);
`;
// The slow lint: sleeps past the hook's 5s cap (scenario (d) — a capability failure
// must be recorded inert, never graded as a diagnostic).
const LINT_SLOW_SRC = `#!/usr/bin/env node
// lint-slow.mjs — a lint that sleeps past the hook's 5s timeout cap.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
try { appendFileSync(fileURLToPath(new URL("lint-spawns.log", import.meta.url)), "SLOW\\n"); } catch {}
setTimeout(() => process.exit(1), 7000); // killed by the hook's 5s timeout before this fires
`;
// The stdout lint: identical marker semantics to the fixture lint, but reports via
// console.log (the eslint/ruff/flake8/pylint/tsc shape — the common case for
// scripts.lint-derived commands). Consult remediation round 1: b553da1's rewrite
// dropped the block reason's stdout fallback, so these linters blocked with an
// EMPTY diagnostic payload — and this suite could not see it because its marker
// lint reports via console.error. Scenario (i) closes that blind spot.
const LINT_STDOUT_SRC = `#!/usr/bin/env node
// lint-stdout.mjs — a stdout-reporting marker lint for the paired suite.
import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const target = process.argv[2] || "";
try { appendFileSync(fileURLToPath(new URL("lint-spawns.log", import.meta.url)), target + "\\n"); } catch {}
let src = "";
try { src = readFileSync(target, "utf8"); } catch { /* absent target: not a diagnostic */ }
if (src.includes("FAIL-MARKER")) {
  console.log("STDOUT-LINT: FAIL-MARKER present in " + target);
  process.exit(1);
}
process.exit(0);
`;

// A tmpdir fixture repo, hermetic (never global ~/.zcode state; the state-auth key
// is the per-install HMAC key the hooks themselves verify against).
// opts:
//   withRun (true)  — write the authenticated run state (false → no active run)
//   phase ("execute")
//   verdict ("OKAY") — review verdict recorded in state (null for plan-phase repos)
//   toolchain (true) — write .zcode/toolchain.json
//   lintCmd ("node lint-fixture.mjs") — lint_cmd value (null → {"lint_cmd": null})
//   fileLocks — optional pre-seeded file_locks map (the file-lock control)
function makeRepo(opts = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "zod-lintbase-")));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  mkdirSync(join(repo, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  const lintCmd = opts.lintCmd === undefined ? "node lint-fixture.mjs" : opts.lintCmd;
  writeFileSync(join(repo, "package.json"),
    JSON.stringify({ name: "lint-fixture-repo", private: true, scripts: { lint: lintCmd } }, null, 2) + "\n");
  writeFileSync(join(repo, "lint-fixture.mjs"), LINT_FIXTURE_SRC);
  writeFileSync(join(repo, "lint-slow.mjs"), LINT_SLOW_SRC);
  writeFileSync(join(repo, "lint-stdout.mjs"), LINT_STDOUT_SRC);
  if (opts.toolchain !== false) {
    writeFileSync(join(repo, ".zcode", "toolchain.json"), JSON.stringify({ lint_cmd: lintCmd }) + "\n");
  }
  // parse-plan-lint-clean plan (same shape pre-tool.trusted-invoke.test.mjs proved clean)
  // declaring BOTH edit targets — the scope gate is fail-closed on undeclared paths.
  const planText = "# t\n\n## Capability routing\n- `routed: skill:prompt-master`\n- Evidence: fixture.\n\n## Todos\n\n- [ ] 1. go\n  - Files: [`src/probe.js`, `src/new-file.js`]\n  - Acceptance criteria:\n    - `node --check src/probe.js` exits 0\n\n## Final verification wave\n";
  const planPath = join(repo, ".zcode", "plans", `${SLUG}.md`);
  writeFileSync(planPath, planText);
  if (opts.withRun !== false) {
    const st = {
      slug: SLUG,
      phase: opts.phase || "execute",
      updated_at: new Date().toISOString(),
      plan_path: planPath,
      review: {
        verdict: opts.verdict === undefined ? "OKAY" : opts.verdict,
        round: 1,
        max_rounds: 3,
        plan_sha256: createHash("sha256").update(planText).digest("hex"),
      },
    };
    if (opts.fileLocks) st.file_locks = opts.fileLocks;
    writeFileSync(join(repo, ".zcode", "state", `${SLUG}.json`),
      JSON.stringify(stampMarker(st, SLUG), null, 2) + "\n");
  }
  return repo;
}

// Drive a hook by piping its hook JSON on stdin, CLAUDE_PROJECT_DIR at the fixture repo.
const runHook = (hook, repo, payload) => spawnSync(process.execPath, [hook], {
  input: typeof payload === "string" ? payload : JSON.stringify(payload),
  encoding: "utf8",
  env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  timeout: 30000,
});
const runPre = (repo, payload) => runHook(PRE_HOOK, repo, payload);
const runPost = (repo, payload) => runHook(POST_HOOK, repo, payload);
const editPayload = (repo, rel, tool = "Edit") => ({
  tool_name: tool,
  tool_use_id: "tu-" + Math.random().toString(36).slice(2, 8),
  tool_input: { file_path: join(repo, rel), old_string: "", new_string: "" },
});

// A pre-blocked edit never happens, so post-tool never fires for it — mirror that.
function pairedEdit(repo, rel, apply, payload) {
  const p = payload || editPayload(repo, rel);
  const pre = runPre(repo, p);
  if (pre.status === 0 && apply) apply();
  const post = pre.status === 0 ? runPost(repo, p) : null;
  return { pre, post, payload: p };
}

const spawned = (repo) => {
  const p = join(repo, "lint-spawns.log");
  if (!existsSync(p)) return 0;
  return readFileSync(p, "utf8").split("\n").filter((l) => l.trim()).length;
};
const baselinePath = (repo) => join(repo, ".zcode", "state", `${SLUG}.lint-baseline.json`);
const readBaseline = (repo) => {
  const p = baselinePath(repo);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return "unparseable"; }
};
const preBlocked = (r) => r.status === 2;
const postBlocked = (r) => !!r && /"decision"\s*:\s*"block"/.test(r.stdout || "");
const excerpt = (s) => String(s || "").replace(/\s+/g, " ").slice(0, 160);

console.log("lint-baseline paired suite — pre-edit baseline vs post-edit attribution\n");
console.log("  (against unmodified hooks this suite is RED by design: scenario (a) is the defect)\n");

// --- control 0: hooks are no-ops without an active run -------------------------
{
  const repo = makeRepo({ withRun: false });
  writeFileSync(join(repo, "src", "probe.js"), "// FAIL-MARKER\n");
  const { pre, post } = pairedEdit(repo, "src/probe.js", null);
  check("no active run → pre-tool passes silently", pre.status === 0 && !(pre.stdout || "").trim(),
    `status=${pre.status} out=${excerpt(pre.stdout)}`);
  check("no active run → post-tool passes silently", post.status === 0 && !(post.stdout || "").trim(),
    `status=${post.status} out=${excerpt(post.stdout)}`);
  check("no active run → nothing spawned, no baseline file", spawned(repo) === 0 && !existsSync(baselinePath(repo)),
    `spawns=${spawned(repo)}`);
}

// --- (a) THE defect: pre-existing failure + benign edit → NO block ------------
{
  const repo = makeRepo();
  writeFileSync(join(repo, "src", "probe.js"), "// FAIL-MARKER: noise that predates the run\nconst a = 1;\n");
  const { pre, post } = pairedEdit(repo, "src/probe.js",
    () => appendFileSync(join(repo, "src", "probe.js"), "// benign comment\n"));
  check("(a) pre-tool ALLOWS the benign edit (capture never blocks)", pre.status === 0,
    `status=${pre.status} out=${excerpt(pre.stdout)}`);
  const b = readBaseline(repo);
  check("(a) pre-tool recorded a FAILING baseline for src/probe.js (first touch)",
    b && b["src/probe.js"] === "failing", `baseline=${JSON.stringify(b)}`);
  check("(a) post-tool emits NO block for pre-existing noise — today's false block, removed",
    post.status === 0 && !postBlocked(post), `stdout=${excerpt(post.stdout)}`);
  check("(a) the no-block is attribution, not silence — the post-edit lint DID run",
    spawned(repo) >= 1, `spawns=${spawned(repo)}`);
}

// --- (b) clean baseline + edit introducing FAIL-MARKER → attributed block ------
{
  const repo = makeRepo();
  writeFileSync(join(repo, "src", "probe.js"), "const a = 1;\n");
  const p = editPayload(repo, "src/probe.js");
  const pre = runPre(repo, p);
  check("(b) pre-tool allows the edit", pre.status === 0, `status=${pre.status}`);
  const b = readBaseline(repo);
  check("(b) clean file → CLEAN baseline recorded", b && b["src/probe.js"] === "clean",
    `baseline=${JSON.stringify(b)}`);
  writeFileSync(join(repo, "src", "probe.js"), "const a = 2; // FAIL-MARKER introduced by this edit\n");
  const post = runPost(repo, p);
  check("(b) post-tool BLOCKS, naming the target",
    postBlocked(post) && (post.stdout || "").includes("src/probe.js"), `stdout=${excerpt(post.stdout)}`);
  check("(b) the reason states the diagnostics are NEW to this edit",
    /new to this edit/i.test(post.stdout || ""), `stdout=${excerpt(post.stdout)}`);
  check("(b) post-tool still exits 0 (PostToolUse never blocks the call)", post.status === 0,
    `status=${post.status}`);
}

// --- (c) no lint_cmd: toolchain absent, and separately lint_cmd:null ----------
for (const [label, opts] of [
  ["toolchain.json ABSENT", { toolchain: false }],
  ["lint_cmd null", { lintCmd: null }],
]) {
  const repo = makeRepo(opts);
  writeFileSync(join(repo, "src", "probe.js"), "// FAIL-MARKER: pre-existing noise\n");
  const { post } = pairedEdit(repo, "src/probe.js",
    () => appendFileSync(join(repo, "src", "probe.js"), "// benign\n"));
  check(`(c) ${label} → ZERO lint spawns`, spawned(repo) === 0, `spawns=${spawned(repo)}`);
  check(`(c) ${label} → inert recorded for the target`,
    readBaseline(repo)?.["src/probe.js"] === "inert", `baseline=${JSON.stringify(readBaseline(repo))}`);
  check(`(c) ${label} → no block from either side`,
    post && post.status === 0 && !postBlocked(post), `stdout=${excerpt(post?.stdout)}`);
}

// --- (d) timed-out lint: capability failure is never a diagnostic -------------
{
  const repo = makeRepo({ lintCmd: "node lint-slow.mjs" });
  writeFileSync(join(repo, "src", "probe.js"), "const a = 1;\n");
  const { pre, post } = pairedEdit(repo, "src/probe.js",
    () => appendFileSync(join(repo, "src", "probe.js"), "// benign\n"));
  check("(d) pre-tool allows the edit despite the timing-out lint", pre.status === 0,
    `status=${pre.status}`);
  check("(d) no block from either side (a slow linter is not a diagnostic)",
    post.status === 0 && !postBlocked(post), `stdout=${excerpt(post.stdout)}`);
  check("(d) the timed-out side records inert",
    readBaseline(repo)?.["src/probe.js"] === "inert", `baseline=${JSON.stringify(readBaseline(repo))}`);
}

// --- (e) first touch only: frozen baseline, no second capture -----------------
{
  const repo = makeRepo();
  writeFileSync(join(repo, "src", "probe.js"), "// FAIL-MARKER: pre-existing noise\n");
  pairedEdit(repo, "src/probe.js", () => appendFileSync(join(repo, "src", "probe.js"), "// edit one\n"));
  const b1 = readBaseline(repo);
  const s1 = spawned(repo);
  check("(e) first touch recorded the failing baseline", b1?.["src/probe.js"] === "failing",
    `baseline=${JSON.stringify(b1)}`);
  const { post } = pairedEdit(repo, "src/probe.js", () => appendFileSync(join(repo, "src", "probe.js"), "// edit two\n"));
  const b2 = readBaseline(repo);
  check("(e) second edit spawns NO second capture (only the post-edit lint runs)",
    spawned(repo) - s1 === 1, `spawns ${s1} → ${spawned(repo)}`);
  check("(e) frozen baseline value unchanged by the second edit",
    JSON.stringify(b2?.["src/probe.js"]) === JSON.stringify(b1?.["src/probe.js"]),
    `${JSON.stringify(b1)} → ${JSON.stringify(b2)}`);
  check("(e) benign edits on the failing-baselined file never block",
    post.status === 0 && !postBlocked(post), `stdout=${excerpt(post.stdout)}`);
}

// --- (f) phase guard: an Edit event during plan lints and baselines nothing ---
{
  const repo = makeRepo({ phase: "plan", verdict: null });
  writeFileSync(join(repo, "src", "probe.js"), "// FAIL-MARKER\n");
  const p = editPayload(repo, "src/probe.js");
  const pre = runPre(repo, p);
  check("(f) plan-phase Edit is blocked by the review gate (verdict not OKAY)",
    preBlocked(pre) && /blocked until the plan passes review/.test(pre.stdout || ""),
    `status=${pre.status} out=${excerpt(pre.stdout)}`);
  const post = runPost(repo, p); // would never fire for a blocked edit; proves the phase guard
  check("(f) post-tool lints NOTHING during plan (zero spawns)", spawned(repo) === 0,
    `spawns=${spawned(repo)}`);
  check("(f) no block from post-tool during plan", post.status === 0 && !postBlocked(post),
    `stdout=${excerpt(post.stdout)}`);
  check("(f) no baseline file written during plan", !existsSync(baselinePath(repo)));
}

// --- (g) Write creating a new file: implicit clean baseline; new-failing blocks
{
  const repo = makeRepo();
  const rel = "src/new-file.js";
  const p = editPayload(repo, rel, "Write");
  const pre = runPre(repo, p);
  check("(g) pre-tool allows the Write creating a new file", pre.status === 0,
    `status=${pre.status} out=${excerpt(pre.stdout)}`);
  check("(g) new-file Write records the implicit CLEAN baseline",
    readBaseline(repo)?.[rel] === "clean", `baseline=${JSON.stringify(readBaseline(repo))}`);
  writeFileSync(join(repo, rel), "// FAIL-MARKER in a file this run created\n");
  const post = runPost(repo, p);
  check("(g) a new file that fails lint BLOCKS (any diagnostic in a run-created file is the run's)",
    postBlocked(post) && (post.stdout || "").includes(rel), `stdout=${excerpt(post.stdout)}`);
  check("(g) that block is attributed NEW to this edit",
    /new to this edit/i.test(post.stdout || ""), `stdout=${excerpt(post.stdout)}`);
}

// --- (h) discovery isolation: the side-file is never parsed as run state ------
{
  const repo = makeRepo();
  writeFileSync(baselinePath(repo), JSON.stringify({ "src/probe.js": "failing" }, null, 2) + "\n");
  const runs = findActiveRuns({ projectDir: repo });
  check("(h) <slug>.json + <slug>.lint-baseline.json → exactly ONE run discovered",
    runs.length === 1 && runs[0].state.slug === SLUG,
    `runs=${JSON.stringify(runs.map((r) => r.state.slug))}`);
}

// --- (i) stdout-reporting lint: its diagnostics AND the cmd clause reach the
// block reason (consult remediation round 1 — the dropped stdout fallback made
// eslint/ruff/tsc-shaped linters block with an EMPTY payload) ------------------
{
  const repo = makeRepo({ lintCmd: "node lint-stdout.mjs" });
  writeFileSync(join(repo, "src", "probe.js"), "const a = 1;\n");
  const p = editPayload(repo, "src/probe.js");
  runPre(repo, p); // first touch: the stdout lint passes a clean file → clean baseline
  writeFileSync(join(repo, "src", "probe.js"), "const a = 2; // FAIL-MARKER via a stdout reporter\n");
  const post = runPost(repo, p);
  check("(i) a stdout-reporting lint's message AND the (cmd: …) clause reach the block reason",
    postBlocked(post)
      && (post.stdout || "").includes("STDOUT-LINT: FAIL-MARKER present")
      && (post.stdout || "").includes("(cmd: node lint-stdout.mjs)"),
    `stdout=${excerpt(post.stdout)}`);
}

// --- unchanged controls: behaviour that must be identical on BOTH builds ------
{
  // Task completion drains the parallel-cap ledger (post-tool ledger path)
  const taskRepo = makeRepo();
  const ledger = join(taskRepo, ".zcode", "state", `${SLUG}.inflight.json`);
  writeFileSync(ledger, JSON.stringify([{ id: "tu-drain", at: Date.now() }]));
  const r = runPost(taskRepo, { tool_name: "Task", tool_use_id: "tu-drain" });
  const drained = existsSync(ledger) ? JSON.parse(readFileSync(ledger, "utf8")) : null;
  check("ctl: Task completion drains the inflight ledger", r.status === 0 && Array.isArray(drained) && drained.length === 0,
    `status=${r.status} ledger=${JSON.stringify(drained)}`);

  // Skill load records an OBSERVED capability (post-tool capability arm)
  const skillRepo = makeRepo();
  const rs = runPost(skillRepo, { tool_name: "Skill", tool_input: { skill: "test-driven-development" } });
  const st = JSON.parse(readFileSync(join(skillRepo, ".zcode", "state", `${SLUG}.json`), "utf8"));
  const cap = (st.capabilities || []).find((c) => c.capability === "skill:test-driven-development" && c.observed === true);
  check("ctl: Skill load records observed:true capability", rs.status === 0 && !!cap,
    `status=${rs.status} caps=${JSON.stringify(st.capabilities || [])}`);

  // Scope gate: OKAY verdict + undeclared target still blocks
  const scopeRepo = makeRepo();
  writeFileSync(join(scopeRepo, "src", "other.js"), "const x = 1;\n");
  const rscope = runPre(scopeRepo, editPayload(scopeRepo, "src/other.js"));
  check("ctl: scope gate still blocks an out-of-scope edit",
    preBlocked(rscope) && /SCOPE VIOLATION/.test(rscope.stdout || ""),
    `status=${rscope.status} out=${excerpt(rscope.stdout)}`);

  // File-lock gate: a target locked by another in-flight todo still blocks
  const lockRepo = makeRepo({ fileLocks: { "src/probe.js": { session: "someone-else", todo: 9, acquired_at: new Date().toISOString() } } });
  writeFileSync(join(lockRepo, "src", "probe.js"), "const a = 1;\n");
  const rlock = runPre(lockRepo, editPayload(lockRepo, "src/probe.js"));
  check("ctl: file-lock gate still blocks another owner's target",
    preBlocked(rlock) && /file lock held by another/.test(rlock.stdout || ""),
    `status=${rlock.status} out=${excerpt(rlock.stdout)}`);

  // Pre-change run (no side-file, no pre-side capture ever ran): post-tool must
  // not guess a "before" it does not have — absent entry → no block.
  const oldRepo = makeRepo();
  writeFileSync(join(oldRepo, "src", "probe.js"), "// FAIL-MARKER: pre-existing noise\n");
  const rpost = runPost(oldRepo, editPayload(oldRepo, "src/probe.js"));
  check("ctl: pre-change run with no side-file → NO block (strictly fewer blocks, never more)",
    rpost.status === 0 && !postBlocked(rpost), `stdout=${excerpt(rpost.stdout)}`);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
