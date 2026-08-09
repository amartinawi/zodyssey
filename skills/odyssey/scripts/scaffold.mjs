#!/usr/bin/env node
// scaffold.mjs — create a ZOdyssey plan skeleton + its initial state.json.
// Called by the prometheus planner once intent is classified and the plan is ready
// to be drafted. Mirrors omo's scaffold-plan.mjs (canonical section order) but adapted
// to ZCode conventions (.zcode/plans, .zcode/state) and our state schema (DESIGN.md §5).
//
// Usage:
//   scaffold.mjs <repo-root> <slug> <title> <intent>
//     repo-root : absolute path to the repo the work happens in
//     slug      : kebab-case slug (used for filenames)
//     title     : human title (goes in the plan H1)
//     intent    : trivial | standard | architecture
//   Writes:
//     <repo>/.zcode/plans/<slug>.md       (the plan skeleton)
//     <repo>/.zcode/state/<slug>.json     (initial state)
//   Prints the plan path on success.
//   exit: 0 ok · 2 missing args · 3 bad intent · 4 bad slug · 5 plan already exists

import { mkdirSync, writeFileSync, existsSync, readFileSync, openSync, closeSync, fstatSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, cwd } from "node:process";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

// exit codes (T10g: de-overloaded — each failure mode is distinct so callers can react):
//   0 ok · 2 missing args · 3 bad intent · 4 bad slug · 5 plan already exists
// The optional 5th arg (or --task <file> / stdin) is the phase-−1 primed brief, written to
// <repo>/.zcode/plans/<slug>.task.md (G5) so consult.mjs has the real original task to judge
// scope fidelity against. Lives under plans/ (bookkeeping, always writable).
const [repoRoot, slug, title, intent, taskArg] = argv.slice(2);
if (!repoRoot || !slug || !title || !intent) {
  console.error("usage: scaffold.mjs <repo-root> <slug> <title> <intent> [task-brief-or-file]");
  exit(2);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error("slug must be kebab-case (lowercase, digits, hyphens)");
  exit(4); // bad slug
}
const VALID_INTENT = ["trivial", "standard", "architecture"];
if (!VALID_INTENT.includes(intent)) {
  console.error("intent must be one of: " + VALID_INTENT.join(", "));
  exit(3); // bad intent
}

const plansDir = join(repoRoot, ".zcode", "plans");
const stateDir = join(repoRoot, ".zcode", "state");
const notepadsDir = join(repoRoot, ".zcode", "notepads", slug);
mkdirSync(plansDir, { recursive: true });
mkdirSync(stateDir, { recursive: true });
mkdirSync(notepadsDir, { recursive: true });

const planPath = join(plansDir, `${slug}.md`);
const statePath = join(stateDir, `${slug}.json`);

if (existsSync(planPath)) {
  console.error("plan already exists: " + planPath);
  exit(5); // plan already exists (distinct from bad slug/intent)
}
// SEC-M8 (external audit #10): the OLD code refused only on plan-existence; state.json was
// overwritten UNCONDITIONALLY. So deleting the plan (via commands the gate doesn't cover) and
// re-scaffolding reset review.round to 0 — reopening the max_rounds budget that record-review.mjs
// exists to enforce. Now: refuse if state.json already exists, unless --reset is passed AND the
// existing run is in a recoverable phase (abandoned/blocked/done/audited). An active run's round
// budget cannot be reset by re-scaffolding.
const _allArgs = argv.slice(2);
const _reset = _allArgs.includes("--reset");
if (existsSync(statePath) && !_reset) {
  console.error("state already exists: " + statePath + " (re-scaffolding would reset review.round and reopen the round budget). To recover a finished/abandoned run, delete the plan too and pass --reset; otherwise use a different slug.");
  exit(5);
}
if (existsSync(statePath) && _reset) {
  let _prior = null;
  try { _prior = JSON.parse(readFileSync(statePath, "utf8")); } catch {}
  const _priorPhase = _prior && _prior.phase;
  const RECOVERABLE = new Set(["abandoned", "blocked", "done", "audited"]);
  if (_priorPhase && !RECOVERABLE.has(_priorPhase)) {
    console.error("scaffold --reset refused: existing run is in active phase=" + _priorPhase + ". --reset only recovers terminal/abandoned runs; an active run's review.round must not be silently reset. Use set-phase <repo> <slug> abandoned first, or a different slug.");
    exit(5);
  }
}

// Canonical section order — Momus and the parser both rely on this.
const body = `# ${title}

## TL;DR (for humans)
<!-- Written LAST. Plain English, no paths or numbers. One paragraph. -->

## Scope
### Must have
### Must NOT have

## Verification strategy
<!-- How, overall, we will know the work is correct. -->

## Execution strategy
### Parallel execution waves
<!-- Group todos that can run together because they have no named dependency. -->
### Dependency matrix
<!-- Todo -> what it blocks / is blocked by. -->

## Todos
<!-- Work rows. Grammar: \`- [ ] N. <title>\` then nested bullets.
     Required nested fields: What to do, Must NOT do, Files, Wave, Blocked by,
     References, Acceptance criteria (executable commands), QA scenarios.
     Example:
     - [ ] 1. Add /healthz endpoint
       - What to do: express route returning 200 {ok:true}
       - Must NOT do: auth, rate limiting
       - Files: [src/server.js]
       - Wave: 1
       - Blocked by: []
       - References: src/server.js:12
       - Acceptance criteria:
         - \`curl localhost:3000/healthz\` returns 200
       - QA scenarios:
         - Happy: returns {ok:true}; Failure: server down -> connection refused
-->

## Final verification wave
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity check

## Commit strategy
<!-- How the work is split into commits / MR. -->

## Success criteria
<!-- End-state criteria. The orchestrator judges success against these, not against
     the sequence of steps taken (paths are non-deterministic). -->
`;

const planSha = createHash("sha256").update(body).digest("hex");
writeFileSync(planPath, body);

// G5 (W5-minor): write the phase-−1 primed brief to <slug>.task.md under plans/ (bookkeeping —
// always writable, unlike state/). consult.mjs reads this as THE ORIGINAL TASK for scope-fidelity
// judgment. Accept the brief inline (5th arg), from --task <path>, or stdin.
// Only WRITE the file when a real brief was captured, so consult.mjs's missing-task warning can fire.
const rest = argv.slice(6);
let taskBrief = "";
const taskFlagIdx = rest.indexOf("--task");
if (taskFlagIdx !== -1 && rest[taskFlagIdx + 1]) {
  try { taskBrief = readFileSync(rest[taskFlagIdx + 1], "utf8"); } catch {}
} else if (taskArg && taskArg !== "--task") {
  if (existsSync(taskArg)) {
    try { taskBrief = readFileSync(taskArg, "utf8"); } catch {}
  } else {
    taskBrief = taskArg; // treat as inline text
  }
}
// W6-minor: read stdin when it's NOT a TTY (a pipe always reports fstat size 0, so the old
// `st.size > 0` guard silently dropped piped briefs — `echo brief | scaffold.mjs` lost the brief).
if (!taskBrief && process.stdin && !process.stdin.isTTY) {
  try { taskBrief = readFileSync(0, "utf8"); } catch {}
}
const taskPath = join(plansDir, `${slug}.task.md`);
// W5-minor: only write the task file when a real brief was captured, so consult.mjs's
// missing-task warning can actually fire (and the file's absence is a visible signal).
if (taskBrief && taskBrief.trim()) {
  writeFileSync(taskPath, taskBrief);
} else {
  process.stderr.write(`scaffold.mjs: WARNING no primed brief captured — consult.mjs will warn that the auditor judges scope fidelity without the original task. Pass the brief as the 5th arg, via --task <file>, or stdin.\n`);
}

// Capture the repo's HEAD sha at run start so /orchestrate-consult can diff exactly what
// this run changed (run_start_sha..HEAD). Best-effort: '' if not a git repo.
let runStartSha = "";
try {
  runStartSha = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
} catch {
  runStartSha = ""; // not a git repo — consult will diff the whole working tree
}

const now = new Date().toISOString();
const state = {
  slug,
  title,
  plan_path: planPath,
  plan_sha256: planSha,
  phase: "plan",
  intent,
  started_at: now,
  updated_at: now,
  run_start_sha: runStartSha,
  active_executor_session: null,
  todos: {},
  file_locks: {},
  in_flight_dispatches: 0,
  inherited_wisdom: [],
  review: { round: 0, max_rounds: 3, verdict: null, history: [] },
  consult: { rounds: 0, verdict: null, history: [], last_gaps: [] },
  checkpoints: [{ at: now, phase: "plan", note: "plan scaffolded" }],
};
writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

console.log(planPath);
