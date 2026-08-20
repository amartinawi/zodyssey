#!/usr/bin/env node
// scaffold.mjs — create a ZOdyssey plan skeleton + its initial state.json.
// Called by the prometheus planner once intent is classified and the plan is ready
// to be drafted. Mirrors omo's scaffold-plan.mjs (canonical section order) but adapted
// to ZCode conventions (.zcode/plans, .zcode/state) and our state schema (DESIGN.md §5).
//
// Resume-format borrow (prime-agent primitive #1, SEC-7 candidate): the scaffolded state
// includes `acceptance` (per-todo verify results) and `notepad_pointers` (per-todo notepad
// path) so `/orchestrate resume <slug>` can re-enter with structured per-todo progress
// instead of just phase + locks. This is the persistence-FORMAT extension only — NO daemon,
// NO scheduler, NO new invocation surface. The fields are OPTIONAL: existing runs that lack
// them load unchanged (consumers access them via `(state.acceptance || {})[id]`).
//
// Usage:
//   scaffold.mjs <repo-root> <slug> <title> <intent> [--reset]
//     repo-root : absolute path to the repo the work happens in
//     slug      : kebab-case slug (used for filenames)
//     title     : human title (goes in the plan H1)
//     intent    : trivial | standard | architecture
//     --reset   : recover a terminal/abandoned run of this slug (refuses on an ACTIVE run)
//   Writes:
//     <repo>/.zcode/plans/<slug>.md       (the plan skeleton)
//     <repo>/.zcode/state/<slug>.json     (initial state)
//   Prints the plan path on success.
//   exit: 0 ok · 2 missing args · 3 bad intent · 4 bad slug · 5 plan already exists

import { mkdirSync, writeFileSync, existsSync, readFileSync, openSync, closeSync, fstatSync, renameSync } from "node:fs";
import { join } from "node:path";
import { makeReviewDefault } from "./lib/verdict-schema.mjs";
import { stampMarker } from "./lib/state-auth.mjs";
import { resolveRepo } from "./lib/repo-path.mjs";
import { argv, exit, cwd } from "node:process";
import { execSync } from "node:child_process";

// exit codes (T10g: de-overloaded — each failure mode is distinct so callers can react):
//   0 ok · 2 missing args · 3 bad intent · 4 bad slug · 5 plan already exists
// The optional 5th arg (or --task <file> / stdin) is the phase-−1 primed brief, written to
// <repo>/.zcode/plans/<slug>.task.md (G5) so consult.mjs has the real original task to judge
// scope fidelity against. Lives under plans/ (bookkeeping, always writable).
const [repoRoot, slug, title, intent, taskArg] = argv.slice(2);

// --adopt: stamp the v0.5.0 authenticity marker onto an EXISTING run's state file. v0.5.0
// authenticates run discovery (CRITICAL T1-7), so a legitimate run created before the upgrade
// stops being discovered until it is adopted once. This is the sanctioned migration path — it
// only ever ADDS the marker to a file that is already on disk; it never creates a run, and it
// refuses if the state file does not exist (so it cannot be used to bless a dropped decoy that
// the operator has not already accepted).
if (argv.includes("--adopt")) {
  if (!repoRoot || !slug) {
    console.error("usage: scaffold.mjs <repo-root> <slug> --adopt");
    exit(2);
  }
  const adoptRepo = resolveRepo(repoRoot);
  const adoptPath = join(adoptRepo, ".zcode", "state", `${slug}.json`);
  if (!existsSync(adoptPath)) {
    console.error(`scaffold.mjs --adopt: no state file at ${adoptPath} (adopt only stamps an existing run)`);
    exit(3);
  }
  let st;
  try { st = JSON.parse(readFileSync(adoptPath, "utf8")); }
  catch { console.error(`scaffold.mjs --adopt: ${adoptPath} is not valid JSON`); exit(3); }
  stampMarker(st, slug);
  st.updated_at = new Date().toISOString();
  const atmp = adoptPath + ".tmp." + process.pid;
  writeFileSync(atmp, JSON.stringify(st, null, 2) + "\n");
  renameSync(atmp, adoptPath);
  console.log(`adopted: ${adoptPath} (phase=${st.phase}) — now discoverable under v0.5.0 run authentication`);
  exit(0);
}

if (!repoRoot || !slug || !title || !intent) {
  console.error("usage: scaffold.mjs <repo-root> <slug> <title> <intent> [task-brief-or-file]  |  scaffold.mjs <repo-root> <slug> --adopt");
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

// Item 12 (--criteria-state): record the PRIME criteria-confirmation round's outcome
// (confirmed|adjusted|skipped) as a first-line stamp on plans/<slug>.task.md (the G5 brief,
// written below). Parsed from the FULL argv so the flag may ride anywhere after <intent>.
// Validated HERE — after the positional/intent checks, BEFORE resolveRepo and every
// mkdirSync/write below — so a value outside the vocabulary fails closed with the existing
// bad-args exit 2 and nothing is written. The flag records, it does not authenticate: no
// consumer keys blocking behaviour on it, and no flag reproduces today's byte-identical output.
const VALID_CRITERIA_STATE = ["confirmed", "adjusted", "skipped"];
let criteriaState = "";
const criteriaFlagIdx = argv.indexOf("--criteria-state");
if (criteriaFlagIdx !== -1) {
  criteriaState = argv[criteriaFlagIdx + 1] || "";
  if (!VALID_CRITERIA_STATE.includes(criteriaState)) {
    console.error("usage: --criteria-state must be one of: " + VALID_CRITERIA_STATE.join(", "));
    exit(2); // bad args — existing grammar, no new exit code
  }
}

// Class B fix: every path derived from the repo arg is built from the RESOLVED root, so
// plan_path (persisted into state and read by 11 downstream sites that resolve it against
// their own cwd) can never be a relative string.
const repoAbs = resolveRepo(repoRoot);
const plansDir = join(repoAbs, ".zcode", "plans");
const stateDir = join(repoAbs, ".zcode", "state");
const notepadsDir = join(repoAbs, ".zcode", "notepads", slug);
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

## Capability routing
<!-- MANDATORY tri-state declaration (GATED). Replace BOTH placeholders below.
     Exactly ONE chosen token line:
       \`routed: skill:<name>\` (or \`mcp:<server>\` / \`agent:<name>\`) — an installed capability fits;
       \`discovered: find-skills\` — no installed capability fits, discovery attempted;
       \`generic: <one-line reason>\` — valid ONLY after discovery returned nothing reputable.
     parse-plan --lint fails OKAY while a placeholder is present; record-final-wave
     cross-checks the chosen token against state.capabilities[] (the hook-witnessed log of
     real Skill/mcp__* invocations). Transcribe from Metis's ## Capability routing field. -->
- \`<token>: <value>\`        <!-- e.g. \`routed: skill:aws-serverless\` -->
- Evidence: <one line — which capability fits + why / the search term + quality verdict (≥1K installs, official source, ~100★) / why generic>

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
- [ ] F5. Capability-routing cross-check

## Commit strategy
<!-- How the work is split into commits / MR. -->

## Success criteria
<!-- End-state criteria. The orchestrator judges success against these, not against
     the sequence of steps taken (paths are non-deterministic). -->
`;

writeFileSync(planPath, body);

// G5 (W5-minor): write the phase-−1 primed brief to <slug>.task.md under plans/ (bookkeeping —
// always writable, unlike state/). consult.mjs reads this as THE ORIGINAL TASK for scope-fidelity
// judgment. Accept the brief inline (5th arg), from --task <path>, or stdin.
// Only WRITE the file when a real brief was captured, so consult.mjs's missing-task warning can fire.
// --criteria-state is excluded from the taskArg fallback below (item 12): a flag given with
// no brief must fall through to the W5 no-brief warning, never be captured as an inline brief.
const rest = argv.slice(6);
let taskBrief = "";
const taskFlagIdx = rest.indexOf("--task");
if (taskFlagIdx !== -1 && rest[taskFlagIdx + 1]) {
  try { taskBrief = readFileSync(rest[taskFlagIdx + 1], "utf8"); } catch {}
} else if (taskArg && taskArg !== "--task" && taskArg !== "--criteria-state") {
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
  // Item 12: with a captured brief AND a valid --criteria-state, prepend exactly one
  // first-line stamp — criteria-confirmation: <state>@<ISO-8601> — on the task file ONLY
  // (plan.md above and state.json below are byte-unaffected). Additive by construction:
  // the body after line 1 is byte-identical to the brief. No brief → nothing to stamp
  // (the W5 warning below fired instead); no flag → today's byte-identical output.
  writeFileSync(taskPath,
    criteriaState
      ? `<!-- criteria-confirmation: ${criteriaState}@${new Date().toISOString()} -->\n${taskBrief}`
      : taskBrief);
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

// INHERITED DIRTY STATE (2026-08-12, shakedown round 2). F1 measures
// `git diff --name-only <run_start_sha>` ∪ untracked, so any file that was ALREADY modified or
// untracked before the run started lands in F1's `actual` set, is not in `declared`, and fails
// F1 as a scope violation the run never committed.
//
// Round 2 hit exactly this: an uncommitted pair from the previous run sat in the tree, F1 went
// red on it, and every sanctioned way to clean it (stash, `git checkout --`, editing the files)
// is blocked by the scope gate — because those files are, correctly, out of scope. The run could
// not reach `done` through any legitimate path. Committing does not help either: F1 diffs against
// run_start_sha, so a file committed mid-run still appears.
//
// Recording the dirty set here — the last moment before the run touches anything — lets F1
// subtract it. Same principle as the regression gate refusing to blame a run for a suite that was
// already red: a run answers for what it changed, not for what it walked into.
//
// Absent on runs scaffolded before this change; consumers treat that as an empty set, so the
// behaviour is unchanged for them.
let dirtyAtStart = [];
if (runStartSha) {
  try {
    const tracked = execSync("git diff --name-only HEAD", { cwd: repoRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    const untracked = execSync("git ls-files --others --exclude-standard", { cwd: repoRoot, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    // Exclude `.zcode/` — this scaffold has already written the plan and task files by now, so
    // they show up as "untracked" and would be recorded as pre-existing mess created by the very
    // run they belong to. F1 ignores `.zcode/` anyway; keeping it out here stops the field from
    // being confusing to read.
    dirtyAtStart = [...new Set((tracked + "\n" + untracked).split("\n").map((p) => p.trim()).filter(Boolean))]
      .filter((p) => !p.startsWith(".zcode/"));
  } catch {
    dirtyAtStart = []; // best-effort; an empty set just means F1 keeps its current behaviour
  }
}

const now = new Date().toISOString();
const state = {
  slug,
  title,
  plan_path: planPath,
  // NO top-level plan_sha256 (removed 2026-08-12, shakedown round 4).
  //
  // scaffold used to stamp one here, and nothing ever read it. Every real consumer — the hook's
  // plan-tamper guard (two sites), F1's tamper check — uses state.review.plan_sha256, which
  // record-review re-binds on each verdict. So the top-level copy was write-only and went stale
  // the moment the plan was edited, while sitting beside the authoritative field looking equally
  // official. Round 4 noticed the drift and had to reason out which one mattered.
  //
  // A duplicated value with one live consumer and one dead one is the same shape as the version
  // number living in three files: it does not fail, it just waits for someone to read the wrong
  // one. Deleted rather than kept fresh, because the correct field already exists.
  phase: "plan",
  intent,
  started_at: now,
  updated_at: now,
  run_start_sha: runStartSha,
  // Files already modified/untracked before this run began. F1 subtracts these so a run is not
  // failed for mess it inherited. See the capture above.
  dirty_at_start: dirtyAtStart,
  active_executor_session: null,
  todos: {},
  file_locks: {},
  in_flight_dispatches: 0,
  inherited_wisdom: [],
  review: makeReviewDefault(),
  consult: { rounds: 0, verdict: null, history: [], last_gaps: [] },
  checkpoints: [{ at: now, phase: "plan", note: "plan scaffolded" }],
  // Resume-format borrow (prime-agent #1, SEC-7 candidate): optional per-todo structured
  // progress populated by record-verify.mjs so /orchestrate resume <slug> re-enters with
  // acceptance results + notepad pointers. Consumers MUST treat them as optional
  // (`(state.acceptance || {})[id]`) — older runs lack these keys entirely.
  //   acceptance       : { [todoId]: { pass: bool, at: iso, evidence?: string } }
  //   notepad_pointers : { [todoId]: "/abs/path/to/.zcode/notepads/<slug>/<id>.md" }
  acceptance: {},
  notepad_pointers: {},
};
// CRITICAL T1-7: mint the authenticity marker so the hooks will discover this run. A state file
// without it is ignored (an unmarked file is exactly what the forged-run drop looked like).
stampMarker(state, slug);
writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");

// Probe the repo's toolchain at scaffold time so <repo>/.zcode/toolchain.json exists for the
// whole run.
//
// probe-toolchain.mjs had ZERO callers anywhere in the pipeline — no hook, no script, no line in
// SKILL.md — yet TWO consumers depend on the file it produces: post-tool.mjs's post-edit lint arm
// (which reads toolchain.lint_cmd) and parse-plan.mjs's toolchain-aware criterion lint. Neither
// had ever fired in a real run, because the file they read was never created. Both were shipped,
// documented, and dead.
//
// Wired here rather than as a SKILL.md instruction on purpose: a conductor prompt is exactly the
// kind of "enforcement" this project exists to replace. Doing it at scaffold means it happens
// once, before any executor runs, without depending on a model remembering to.
//
// Non-fatal by design: the probe never executes the detected commands, but a repo it cannot
// characterize must not block the run from being scaffolded. On failure the consumers simply
// stay inert, which is the behaviour they have today.
try {
  const probe = new URL("./probe-toolchain.mjs", import.meta.url).pathname;
  execSync(`node ${JSON.stringify(probe)} ${JSON.stringify(repoRoot)}`, { stdio: "ignore" });
} catch { /* probe is best-effort; the run proceeds without toolchain-aware checks */ }

console.log(planPath);
