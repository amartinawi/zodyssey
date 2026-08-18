# 07 — B10: the pre-edit lint baseline

Build order **07** · depends-on **—** (nothing precedes or blocks it) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `07 b10-pre-edit-lint-baseline` · not security-class ·
patch-level fix with its own CHANGELOG entry.

This file is a complete, standalone brief. You are assumed competent and to know nothing about
this repo. Verify every anchor against the tree you are standing in before building — the line
numbers below were re-derived on 2026-08-16 and this file moves fast. Do exactly this one change.

## What is broken

The repo ships half a diagnostics mechanism. When an executor edits a file during a run, the
post-edit arm at `skills/odyssey/hooks/post-tool.mjs:104` (gated on
`Edit|Write|MultiEdit`; the matcher already carries the family at
`.zcode-plugin/plugin.json:44`) reads the target repo's `.zcode/toolchain.json`
(`skills/odyssey/hooks/lib/lint-invocation.mjs:44-48`), takes its `lint_cmd` (`:49-50`), and runs the repo's own lint command against the
edited file — AFTER the edit (`spawnSync` at `:53`, 5s timeout at `:56`). Any non-zero exit
injects a `decision: "block"` reason back to the executor (`skills/odyssey/hooks/post-tool.mjs:140-147`). That is the whole
mechanism, and it has no "before": nothing anywhere captures the file's lint state prior to the
edit. `pre-tool.mjs` never lints a file — its single `spawnSync` call site is the momus
plan-lint at `skills/odyssey/hooks/pre-tool.mjs:1546` (`parse-plan --lint`; verified by grep
against the whole file). So the comparison at `:133` is against nothing: a file that was already
failing lint before the run started produces the same block as a file the edit just broke.
"Did this edit introduce new diagnostics" — the question the arm exists to answer — is
undecidable per-edit, and the misattribution is load-bearing: pre-existing noise is reported to
the executor as this edit's failure, which the executor then pays to "fix" or argue with.

This is the one Phase B item genuinely unshipped. The Phase B scorecard
(`docs/ROADMAP.md:211`, row B10 at `:227`) still reads "`post-tool.mjs` has no baseline, so
pre-existing lint noise is attributed to the edit"; the arbitration table agrees
(`docs/ideation-report.md:428` — "REFUTED (not shipped…) no baseline mechanism exists; the lint
arm blocks on any non-zero lint of the edited file"; `:479-480` — B1-B9 shipped, B10 not;
`docs/OPPORTUNITY-MAP.md:108` — "**absent** — `post-tool.mjs` lints the edited file with no
before-reading"). Two adjacent facts frame the fix:

- `lint-untrusted.mjs` is a DIFFERENT mechanism — untrusted-content scanning of plan/notepad
  text (`skills/odyssey/scripts/lint-untrusted.mjs:1-3`, per `docs/ideation-report.md:414`) —
  not this arm, not touched by this change.
- The toolchain producer is wired and green: `scaffold.mjs` invokes `probe-toolchain.mjs`
  (`skills/odyssey/scripts/scaffold.mjs:327`, rationale at `:313-316`, asserted by
  `skills/odyssey/scripts/pipeline-integration.test.mjs:98`), and the probe derives `lint_cmd`
  from the target repo's `package.json` `scripts.lint` ONLY
  (`skills/odyssey/scripts/probe-toolchain.mjs:110-114`, field at `:121`) — it never installs or
  assumes a linter. This repo itself has no `scripts.lint` (`package.json` scripts: test,
  verify, smoke), so its own `lint_cmd` is `null`: the mechanism must be inert here by
  construction, and that is correct.

One latent defect rides in the same lines and belongs to this fix: a lint that TIMES OUT returns
`status: null` from `spawnSync`, and `null !== 0` is true at `:133` — a slow linter is reported
to the executor as a lint failure it did not cause. A capability failure is being graded as a
diagnostic.

**Paired-probe result, broken direction (provable today):** in a scratch repo whose fake
`scripts.lint` exits 1 whenever the target contains the marker `FAIL-MARKER`, seed `src/probe.js`
WITH the marker, start a run in `execute`, then make a purely benign edit (append a comment).
The arm at `skills/odyssey/hooks/post-tool.mjs:140-147` emits `decision: "block"` blaming the
edit — for noise the file carried before the run existed. The true-positive direction (an edit
that introduces the marker) emits a byte-indistinguishable block. The arm cannot tell its true
positives from its false positives, and only one of those two directions should exist.

## What fixed means

Stated as observable behaviour, not as a diff. Comparison is exit-code-level only (no parsing of
lint output), every degradation is recorded, and no `state.json` field is added — the baseline
is a per-run side-file in the state dir, the same pattern as `<slug>.inflight.json`
(`skills/odyssey/hooks/post-tool.mjs:261`).

**1. First-touch baseline capture (pre-tool).** On the FIRST `Edit`/`Write`/`MultiEdit` call to
a given target during an active run whose phase is `execute`, `verify`, or `final` — the same
phase guard the existing arm applies (`skills/odyssey/hooks/post-tool.mjs:108-111`; edits during
`plan`/`review`/`consult` are never linted or baselined, for the reason the guard's own comment
gives at `:105-107`: planner/reviewer scratch is not a product edit) — `pre-tool.mjs`, on the
allow path just before `exit(0)` (`:996` is the allow exit today), runs the target repo's
`lint_cmd` against the target and records the exit status in
`.zcode/state/<slug>.lint-baseline.json`, keyed by repo-relative target path, written with the
atomic tmp+rename idiom. The capture set is exactly the set the existing post arm lints (same
tool-name gate, same toolchain read) — no narrower, no wider. Rules:

- Absent `toolchain.json` or null `lint_cmd` → nothing is spawned; the run is recorded
  `inert` for lint. A repo without a lint script (including this one) sees zero new spawns.
- Capture happens only on the allow path — an edit the gates block never baselines.
- Once per target per run: the baseline is FROZEN at first touch, so "new" always means "not
  present when the run first touched this file". Later edits compare against the frozen value;
  noise introduced by edit 1 stays attributed until fixed.
- A `Write` creating a file that did not exist records an implicit clean baseline — any
  diagnostic in a file this run created is this run's.
- Capture failure (timeout, ENOENT, unreadable state dir) records `inert` for that target and
  blocks nothing. **A baseline that cannot be taken never blocks the edit.**

**2. Attributed post-edit comparison (post-tool).** The existing arm keeps its shape —
toolchain read, single-file lint, `decision: "block"` JSON, exit 0 always — but the block at
`:133-169` fires only on diagnostics attributable to the edit:

| baseline for target | post-edit lint exit | behaviour after the fix |
|---|---|---|
| clean (0) | 0 | silent pass, unchanged (`:170`) |
| clean (0) | non-zero | block — reason names the target and states the diagnostics are NEW to this edit |
| failing (non-zero) | non-zero | **no block** — pre-existing; recorded in the side-file as seen-not-new (today's false block, removed) |
| failing (non-zero) | 0 | no block — the edit fixed pre-existing noise |
| absent (no entry) | any | **no block**, recorded `inert` — covers runs created before this change and any path that never baselined; the arm never guesses a "before" it does not have |
| `inert` (capture failed) | any | no block, recorded `inert` |

**3. Capability failures are never diagnostics, on either side.** A lint that times out (5s cap,
`skills/odyssey/hooks/lib/lint-invocation.mjs:38`), cannot spawn, or whose baseline capture failed,
records `inert` and blocks nothing. This deletes the timeout-blocks defect above: after the
fix, a slow linter costs one recorded `inert`, not a false block.

**4. Blast discipline.** The Task/Agent ledger-drain path (`:218` onward), the
`Skill`/`mcp__*` capability-recording arm (`:184-216`), and every pre-tool gate (review gate,
scope boundary, file locks, Bash gate) behave byte-identically. Hooks remain no-ops without an
active run. The regression gate's own design comment states the shared principle this change
adopts verbatim in spirit: "baseline already failing → recorded, never fails the gate"
(`skills/odyssey/scripts/regression-gate.mjs:15-21`).

**5. Discovery isolation.** `find-run.mjs` parses every `*.json` in `.zcode/state/` and skips
side-files by explicit suffix (`skills/odyssey/hooks/lib/find-run.mjs:80-81` skips
`.inflight.json` with the comment "not a run state file"). The new side-file gets the same
explicit skip — one additive condition on the line after `:80` — so run discovery never depends
on `verifyMarker` happening to reject it. This is following the file's own precedent, not new
machinery.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and
complete:

- `skills/odyssey/hooks/pre-tool.mjs` — the first-touch capture arm (allow path, Edit-family
  tools, phase-guarded, never blocks)
- `skills/odyssey/hooks/post-tool.mjs` — the attributed comparison replacing the unconditional
  block at `:133-169`
- `skills/odyssey/hooks/lib/lint-invocation.mjs` (new) — the single shared helper both hooks
  call: read `toolchain.json`, take `lint_cmd`, split on whitespace, `spawnSync` argv-array with
  `shell: false` and the 5s timeout, normalize to `{ spawned, status, timedOut, stderr }`. NOT
  a convenience: pre and post must run byte-identical invocations or the comparison measures
  two different things — a shared module makes that divergence structurally impossible.
- `skills/odyssey/hooks/lib/find-run.mjs` — the one-line side-file skip described above
- `skills/odyssey/hooks/lint-baseline.test.mjs` (new) — the paired pre+post suite. No post-tool
  suite exists today (confirmed: `ls skills/odyssey/hooks/*.test.mjs` is all `pre-tool.*`).

Nothing else. `probe-toolchain.mjs` is the untouched producer — its `lint_cmd` contract
(`scripts.lint`-only, `:110-114`) is consumed as-is; extending detection is deliberately out of
scope. `scaffold.mjs` already wires the probe. The docs listed under "Docs to update" belong to
the release pass, not the gated run — do not widen the set to include them by default.

## Must NOT do

- Do not add, install, vendor, or recommend a lint tool or dependency — not for the target repo,
  not for this one. The command is derived from the target repo's `package.json` `scripts.lint`
  via `probe-toolchain.mjs`; if absent, the mechanism records `inert` and never blocks.
  Zero npm dependencies is absolute.
- Do not block any edit on baseline-capture failure — timeout, ENOENT, unreadable files:
  record `inert`, allow the edit. Over-blocking is the failure this change exists to remove.
- Do not lint or baseline during `plan`/`review`/`consult` — the existing phase guard at
  `skills/odyssey/hooks/post-tool.mjs:108-111` exists for a reason (its own comment at `:105-107`
  says why); mirror it exactly on the pre side.
- Do not change the Task/Agent ledger-drain path, the `Skill`/`mcp__*` capability arm, or any
  pre-tool gate; do not touch `probe-toolchain.mjs`'s detection order or fields.
- Do not parse lint output beyond exit status and captured stderr. Per-diagnostic diffing
  (which message is new) is a deliberately-unbuilt known-limit — runner-specific output parsing
  is the conceded-to-rot class (`skills/odyssey/scripts/regression-gate.mjs:15-21`).
- No new `state.json` schema (side-file only, and the side-file is optional everywhere it is
  read); no new env vars; no async; no daemon.
- Do not batch this into a release carrying queue items 01, 03, or 04 (one security change per
  release; this change is not security-class).
- Do not add a reviewer, judge, or verifier agent, and do not route lint output through any
  model. **No LLM opinion layer** — the attribution is two exit codes compared by a hook.

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active
- **No argv flag authenticates anyone** — every script is invocable by any agent with the same argv
  surface the operator has. A flag can remove a *silent* path; it cannot grant authority.
- Fail closed. An unverifiable state blocks; it never passes.
- A repo-capability check degrades to a recorded `inert`, never to a block. Over-blocking is a new
  failure of the class the change exists to remove.

(One note so the executor does not agonize over the apparent tension: "fail closed" governs
states the mechanism must VERIFY — an unreadable plan refuses edits. A missing repo capability
is not an unverifiable state; it is an absent input the run never claimed, and the degradation
rule governs it. The two constraints are a pair, not a contradiction.)

### Anchor-drift reconciliation (amendment, 2026-08-16)

`scripts/check-anchors.test.mjs` landed after this prompt was written and runs inside
`node scripts/run-tests.mjs`. It content-pins every `file:line` citation in the repo's docs, so
**editing a cited file makes the suite go red until the citations are reconciled.** That is the
check working, not a defect in your change.

**This change's exposure: 67 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/hooks/pre-tool.mjs` (51), `skills/odyssey/hooks/post-tool.mjs` (14), `skills/odyssey/hooks/lib/find-run.mjs` (2).

Procedure, in this order:

1. Make the code change and get your own criteria passing.
2. Run `node scripts/check-anchors.mjs`. Every reported `[drift]` names the citing document, the
   cited file and line, and what that line now holds.
3. **Reconcile each one at the source** — fix the citation to point where the content actually
   moved. Do not skip to step 4.
4. Only then run `node scripts/check-anchors.mjs --update` to re-pin, and re-run the suite.

**The footgun is running `--update` first.** It re-pins whatever is there, including citations that
were already wrong, and the drift becomes invisible. That happened during item 15's own build: the
lock was seeded over a README citation that had already drifted 11 lines, and the check
could only flag the *next* shift. The lock records "unchanged since seeding", never "correct".

## Acceptance criteria

Every criterion is an exact command from the repo root plus its expected exit code.
`record-verify` executes these and records the codes as evidence; a criterion a human must read
and agree with is not a criterion.

1. `node --check skills/odyssey/hooks/pre-tool.mjs` — expected exit **0**.
2. `node --check skills/odyssey/hooks/post-tool.mjs` — expected exit **0**.
3. `node --check skills/odyssey/hooks/lib/lint-invocation.mjs` — expected exit **0**.
4. `node skills/odyssey/hooks/lint-baseline.test.mjs` — expected exit **0**. The suite builds
   each scenario as a temp repo (`.zcode/state/<slug>.json` with an active `execute`-phase run,
   `.zcode/toolchain.json` with a fixture `lint_cmd` — a script exiting 1 with a one-line
   message iff the target file contains `FAIL-MARKER`) and drives BOTH hooks by piping their
   hook JSON on stdin, asserting at minimum:
   (a) pre-existing failure + benign edit → pre-tool records a failing baseline for the target,
   post-tool emits NO block — this is today's false block, the assertion the whole change
   exists for;
   (b) clean baseline + edit introducing `FAIL-MARKER` → post-tool emits `decision: "block"`
   whose reason names the target and states the diagnostics are NEW to this edit;
   (c) no `lint_cmd` (toolchain.json absent, and separately `lint_cmd: null`) → no lint spawned
   (assert zero spawns), `inert` recorded, no block;
   (d) timed-out lint (fixture lint that sleeps past the cap) → `inert` on the side that timed
   out, edit allowed, no block from either side;
   (e) first-touch only → a second edit to the same target spawns no second capture and the
   frozen baseline value is unchanged;
   (f) phase guard → an Edit event during `plan` spawns nothing and writes no baseline file;
   (g) `Write` creating a new file records the implicit clean baseline, and a new file that
   fails lint blocks;
   (h) discovery isolation → `findActiveRuns` on a state dir holding `<slug>.json` plus
   `<slug>.lint-baseline.json` returns exactly one run.
5. `node --test skills/odyssey/hooks/lint-baseline.test.mjs` — expected exit **0**.
6. `node --test skills/odyssey/scripts/probe-toolchain.test.mjs` — expected exit **0** (the
   untouched producer this change consumes; green on arrival 2026-08-16, 1 test).
7. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16. The count may grow; the exit code must not change.
8. The paired failing direction — proof the attribution assertions actually run against the
   broken code, re-provable on demand (in TDD order you demonstrate it BEFORE touching the
   hooks): `git stash push -u -- skills/odyssey/hooks/pre-tool.mjs skills/odyssey/hooks/post-tool.mjs skills/odyssey/hooks/lib/lint-invocation.mjs && node skills/odyssey/hooks/lint-baseline.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only the hook changes reverted, scenario (a) re-blocks
   (the defect, live) and the suite exits 1.
9. Both-sides tripwire against silent one-sided unhooking (the half-wiring shape this repo has
   already shipped once in `regression-gate --check`):
   `grep -q 'lint-baseline' skills/odyssey/hooks/pre-tool.mjs && grep -q 'lint-baseline' skills/odyssey/hooks/post-tool.mjs`
   — expected exit **0** (each hook names the baseline store at its consumption site).

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** No pattern lists are added; the mechanism is two exit
   codes and a map lookup. The `FAIL-MARKER` fixture tests the mechanism, not a vocabulary.
2. **A check that cannot detect the class of failure it exists for.** Criterion 8 demonstrates
   the suite failing against the code that has the defect; criterion 9 catches post-land silent
   unhooking of either side. The check can see its own failure.
3. **Ceremony without mechanism.** Ships mechanism: two hook arms, one shared invocation
   module, one side-file with an explicit discovery skip. No conductor prose is added — the
   SKILL.md clause under "Docs to update" is explanatory, not imperative.
4. **Self-grading.** Every criterion is machine-executed with a recorded exit code; the paired
   probe runs against both builds. Nobody grades prose.
5. **A fix that reopens its own class.** Covered in "The class it closes" — one scenario
   driving pre AND post together is the specific counter to the quiet degradation.

## Paired probe

**Probe fixture:** a temp repo with `package.json` (`scripts.lint: "node lint-fixture.mjs"`),
`lint-fixture.mjs` exiting 1 with a one-line message iff the target file contains
`FAIL-MARKER`, `.zcode/toolchain.json` (`{"lint_cmd": "node lint-fixture.mjs"}`), and an active
run in `execute`.

- **Before the fix (current HEAD): the false block.** Seed `src/probe.js` containing
  `FAIL-MARKER`; make a benign edit (append a comment). The post-tool arm emits
  `decision: "block"` blaming the edit (`skills/odyssey/hooks/post-tool.mjs:140-147`) — for noise
  the file carried before the run. Then start clean and introduce the marker VIA the edit: the
  same block fires, byte-indistinguishable from the false one. Today the arm cannot tell its
  true positive from its false positive, and both cost the executor a round.
- **After the fix: attribution.** Same two edits. Benign edit on the pre-failing file: no block
  (baseline failing, post failing, not-new — recorded in the side-file). Marker-introducing
  edit on a clean file: block, with the reason naming `src/probe.js` and stating the
  diagnostics are NEW to this edit.

Unchanged controls, required on BOTH builds — a probe that moves any of them has over-blocked
or leaked into a neighbouring arm:

| Control | Before | After |
|---|---|---|
| Same edits in a repo with no `lint_cmd` | no block | no block, `inert` recorded |
| Edit during `plan` phase | no lint, no block | no lint, no block, no baseline file |
| `Task` completion (ledger drain, `:218` onward) | drains the slot | drains identically |
| `Skill` load (capability arm, `:184-216`) | records `observed:true` | identical |
| Review/scope/file-lock gates on the same repo | unchanged | unchanged |
| Run created before the change (no side-file) | blocks on any non-zero lint | no block, `inert` — strictly fewer blocks, never more |

## What it breaks

The honest cost is latency, paid once per file: a run's FIRST edit to each file now spawns the
repo lint BEFORE the edit, in addition to the existing post-edit run
(`skills/odyssey/hooks/lib/lint-invocation.mjs:53`). In a repo with a slow lint, executors pay up to the
5s cap (`:38`) twice on first touch instead of once. The stance, deliberate: the 5s cap is kept
on both sides, and a timed-out lint degrades to a recorded `inert` — a slow linter must never
wedge an edit or masquerade as a diagnostic (it does the latter today: timeout →
`status: null` → `null !== 0` → block at `post-tool.mjs:133`). Per-run side-file storage is bounded by the
number of distinct files the run edits. Legitimate workflows that start failing: none — the
change strictly removes blocks (the pre-existing-failure and timeout cases) and adds
attribution to the one block that remains. What actually changes for a human: an executor who
previously treated every post-edit block as self-inflicted can now trust that a block means the
edit introduced it, and an orchestrator watching a noisy file sail through unblocked knows why
(the noise was baselined, not missed).

## The class it closes

**Measurement without a baseline** — a check that observes the after-state and grades it with
no recorded before-state, so it cannot distinguish what the run did from what it inherited.
This repo has already closed two twins and treats the shape as known: the pass-to-pass
regression gate snapshots the suite at `phase→execute` because that is "the last moment before
any product code changes… the only point a truthful 'before' reading exists"
(`skills/odyssey/scripts/set-phase.mjs:326-331`), and its design rule is exactly this change's
rule — "baseline already failing → recorded, never fails the gate"
(`skills/odyssey/scripts/regression-gate.mjs:15-21`); `coverage-delta.mjs` derives its tool
from the same toolchain file and reports a delta, never a raw number
(`skills/odyssey/scripts/coverage-delta.mjs:1-5`). The post-edit lint arm shipped as the
exception: post-only, comparing against nothing. B10 is the name the Phase B scorecard gave to
finishing it (`docs/ROADMAP.md:227`).

How this change could reintroduce the class: (a) another post-only check added later — any new
after-state measurement without a captured before-state; (b) the quiet version — the pre-side
capture silently deleted or never firing, which degrades the arm back to block-on-anything
while every visible behaviour (lints run, blocks arrive) looks unchanged, exactly the
half-wiring shape this repo shipped in `regression-gate --check` (snapshot wired, comparison
convention-only); (c) pre and post drifting apart — different timeout, different command
splitting — so the comparison stops comparing like with like. Prevented by: the paired suite
drives pre AND post in every scenario, so deleting or breaking the pre side fails the
attribution assertions (criterion 8 proves the suite detects precisely this); the both-sides
tripwire (criterion 9); and the shared `lint-invocation.mjs` module, which makes (c)
structurally impossible rather than merely unlikely.

## Docs to update

Every doc that states the claim this change alters, each checked against the 2026-08-16 tree:

- `docs/ROADMAP.md:227` — the B10 row ("`post-tool.mjs` has no baseline, so pre-existing lint
  noise is attributed to the edit") moves to the shipped side of the Phase B scorecard
  (`:211`): B1-B10 all shipped.
- `docs/DESIGN.md` §6 (`:245`) — the hooks table has NO PostToolUse row today (verified: the
  table carries PreToolUse and Stop rows only; the file's sole PostToolUse mention is the
  components table at `:406`). Add the row: post-edit lint against a first-touch pre-edit
  baseline; blocks only on NEW diagnostics; `inert` without `lint_cmd` or on capture failure.
- `skills/odyssey/SKILL.md:8` — the conductor's one-line summary of what the hooks hard-block
  gains one clause: post-edit lint blocks only diagnostics the edit introduced. This is so an
  executor seeing a block knows it is attributable and an orchestrator seeing none on a noisy
  file knows why — explanatory, not a new instruction.
- `skills/odyssey/references/scripts.md` — has no `probe-toolchain` entry today (grep: zero
  hits). Add one: what it writes, that `lint_cmd` is `scripts.lint`-only, and its consumers —
  the (now baseline-aware) post-edit lint arm, `parse-plan`'s toolchain-aware criterion lint,
  `coverage-delta`, `regression-gate`.
- `CHANGELOG.md` — shape below.

## CHANGELOG entry shape

Patch-level `fix(hooks)` entry, its own entry even if it rides the v0.6 minor:

- **Fixed — post-edit lint failures are attributed against a pre-edit baseline.** State the
  paired probe in the entry itself (this repo cites its probes): pre-existing lint noise on a
  file the run edits no longer blocks the executor; a block now means the edit introduced the
  diagnostics, and the reason names the target. Also name the two riding fixes in the same
  entry: timed-out lints record `inert` instead of blocking (`status: null` was grading a
  capability failure as a diagnostic), and runs created before the change degrade to `inert`
  rather than misattribute.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - Attribution is exit-code-level. Per-diagnostic diffing (which message is new) is
    deliberately unbuilt — runner-specific output parsing is the conceded-to-rot class
    (`skills/odyssey/scripts/regression-gate.mjs:15-21`).
  - The baseline is per-run, frozen at first touch. Cross-file induced diagnostics (editing A
    changes what B's lint reports) are baselined at B's first touch, not at run start — chosen
    to bound cost; a full-repo lint at execute entry was rejected as too slow for big repos.
  - `lint_cmd` comes from `package.json` `scripts.lint` only
    (`skills/odyssey/scripts/probe-toolchain.mjs:110-114`): a repo with an eslint config but no
    lint script records `inert`. Extending detection is probe-side work, out of scope.
  - First-touch capture adds one pre-edit lint run per file per run — the latency statement in
    "What it breaks", bounded by the 5s cap, is the accepted cost.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the marketplace cache picks up the hook change — a hook fix that
  stays only in the repo blocks nothing in any run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

Pure code-logic change, red-green method: load the TDD skill via the Skill tool in the executor
thread, write the failing attribution assertions first (criterion 8's demonstration — the suite
must go red against the unmodified hooks, because scenario (a) blocks today and that block IS
the defect), then make them green. F5 cross-checks the declaration against hook-witnessed
loads, so declare nothing speculative. No `discovered:`/`generic:` tokens (no find-skills call
is planned) and no `mcp:` declarations (none will be loaded). If a test fails in a way two fix
attempts do not diagnose, loading `systematic-debugging` is correct — declare it only if it is
actually loaded, after the fact, never in anticipation.

## Estimated size

~90-120 lines of hook code: ~35-45 in `pre-tool.mjs` (the phase-guarded first-touch capture on
the allow path), ~20-30 reworking `post-tool.mjs:117-171` (baseline read plus the attributed
decision), ~40 in the new `skills/odyssey/hooks/lib/lint-invocation.mjs`, 1 line in
`skills/odyssey/hooks/lib/find-run.mjs`; plus ~160-200 lines of new test
(`skills/odyssey/hooks/lint-baseline.test.mjs`: fixture-repo builder, the marker lint, scenarios
a-h, the controls table). The ~35-line estimate carried by `docs/ROADMAP.md:227` and
`docs/OPPORTUNITY-MAP.md:268` counted only the post-side diff — it ignored the pre-side capture
and the pairing suite, which are the parts that make the fix real. Patch release as its own
entry; may ride the v0.6 minor with other non-security items, never shares a release with queue
items 01, 03, or 04.
