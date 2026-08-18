# 11 — Wire compaction to the final-phase transition

Build order **11** · depends-on **—** (nothing precedes or blocks it) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `11 compaction-phase-wiring` · not security-class · patch release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast. Do exactly this one change.

## What is broken

`skills/odyssey/scripts/compact.mjs` is a deterministic, $0 context-saver that nothing ever runs.
Census re-measured 2026-08-16 (this run, not an ideation-doc number): grep for `compact` across
`skills/`, `scripts/`, `agents/`, `commands/` (`*.mjs`, `*.bash`), excluding `compact.mjs` itself →
**zero code callers**. Every remaining reference is doc prose: `skills/odyssey/SKILL.md:158` ("MAY
run `scripts/compact.mjs <repo> <slug>`" — an instruction addressed to the conductor, inside the
phase-6 OPTIONAL COMPACTION box at `:157-164`), `skills/odyssey/SKILL.md:212` ("the **optional**
`_compact-brief.md`"), `skills/odyssey/references/scripts.md:17` ("OPTIONAL pre-final-wave
notepad compactor"), `README.md:59`, `README.md:81`, `README.md:280`, `CHANGELOG.md:602`. The
script's own header admits it: `skills/odyssey/scripts/compact.mjs:20-21` — "OPT-IN: the
orchestrator MAY call this before phase-6 dispatch. It is not mandatory and not wired into any
phase transition or hook."

The consequence, in the repo's own framing (`skills/odyssey/SKILL.md:202-212`): notepads are the
run's load-bearing working memory and grow with the run, and for a large run the final-wave
sub-agents (F1-F4) are supposed to consume `_compact-brief.md` instead of the full doc set — a
per-notepad-truncated derived view (`compact.mjs:37` `MAX_LINES_PER_NOTEPAD = 40`, applied at
`:75`). Because the only wiring is a "MAY" sentence, that economy path fires only when a conductor
remembers prose. **A run entering the final phase today produces no brief, ever** — the paired-probe
broken direction below proves it on the current build. This is the opt-in flavor of the class
prompt 02 closed for the zero-caller checks: a mechanism that exists, works when hand-invoked, and
cannot fire from the pipeline.

A second defect rides along and sets the design bar: the property the whole final-wave evidence
chain depends on is a **comment, not a test**. `skills/odyssey/scripts/compact.mjs:16-17` —

> `//   - ADDITIVE: writes `<slug>/_compact-brief.md` only. NEVER reads, modifies, or deletes any`
> `//     source notepad.`

— and `compact.mjs` ships **no test file at all** (`ls skills/odyssey/scripts/ | grep compact` →
`compact.mjs` only). The one invariant that keeps F1-F4's evidence intact if compaction ever
auto-fires is exactly the kind of documented-but-unenforced claim this repo has been bitten by
before (`scripts/version-consistency.test.mjs:15-16`). Wiring an unwritten invariant into an
automatic transition without asserting it would be manufacturing the next audit finding.

## What fixed means

Stated as observable behaviour, not as a diff. **No new state fields** — the brief's existence and
its `Generated:` header (`compact.mjs:83-87`) are the record; old runs load and transition
unchanged.

**1. Entering `final` auto-compacts above a stated threshold.** `skills/odyssey/scripts/set-phase.mjs`
gains a `phase === "final"` block, a sibling of the B8 execute block at `:206-211` and the CRIT-4a
terminal block at `:217-228` (if prompt 02 has landed, extend its final-entry block instead of
adding a second — the assertion is the same `phase === "final"`). It invokes
`compact.mjs <repo> <slug> --min-lines <N>` and behaves as:

| Condition at final entry | Behaviour |
|---|---|
| Aggregate non-empty lines across source notepads > N | `_compact-brief.md` is (re)written; the brief path is printed (existing `compact.mjs:108`, via `stdio: "inherit"`); transition exits 0 |
| Aggregate ≤ N | **Inert**: exit 0, no brief written, nothing deleted, one line printed saying below-threshold |
| `ZODYSSEY_NO_AUTO_COMPACT=1` in the environment | Wiring skipped entirely — no invocation, no brief |
| No notepad dir / any compact failure or timeout | Best-effort: a warning line on stderr, transition still exits 0 (the B8/CRIT-4a posture at `set-phase.mjs:341`, `:441`) |

The threshold unit is **aggregate non-empty lines across source notepads** — line count, not token
count, because that is compact.mjs's own deterministic unit (`compact.mjs:30-31`, the same
`l.trim().length > 0` filter the truncation uses at `:75`). The default is a named constant in
`set-phase.mjs`, `AUTO_COMPACT_MIN_LINES = 400` — 10× the per-notepad 40-line cap, i.e. the point
at which the full brief is ~10× smaller than the sources it stands in for. It is a stated judgment
call, not a measurement; see *Known, not fixed*.

**2. Direct invocation is byte-for-byte unchanged.** `compact.mjs <repo> <slug>` (two args) always
compacts, exactly as documented at `compact.mjs:23-28` — the operator's explicit ask remains the
opt-in. `--min-lines <N>` is optional; a non-integer or negative N exits **2** (bad args, the
existing code at `compact.mjs:41-44` — malformed input fails closed); below-threshold exits **0**
(conditional behavior was requested and delivered — not an error). No new exit codes: the contract
stays `0 ok · 2 bad args · 3 no notepad dir · 1 other error` (`compact.mjs:28`).

**3. The additive invariant becomes an asserted test.** After auto-compaction fires — and after
every other code path in this change — every source notepad is **byte-identical** to before. The
below-threshold path writes nothing and deletes nothing, including a pre-existing brief left by a
manual mid-run invocation (deletion is non-additive; staleness is handled by the per-entry printed
line, not by cleanup). Re-entering `final` is legal (`final: ["done", "verify", …]`,
`set-phase.mjs:92`), so a verify-loop re-entry above threshold refreshes the brief — idempotence is
already compact.mjs's contract (`compact.mjs:17-18`).

**4. The conductor's pointer signal is mechanical, not remembered.** When the brief is written, its
path appears on stdout of the `set-phase … final` invocation; SKILL.md's final-wave box then points
F1-F4 at the brief *when that line appeared* — prose still, but prose anchored to a signal that
cannot be forgotten into a silent no-op. Compaction **never gates anything**: no precondition, no
refusal, no state lane. Context economy that could block a transition would be over-blocking — a
new failure of the class this change exists to remove.

Mechanism notes, secondary to the behaviour: invoke via `execFileSync` with a hard timeout (~10s —
a directory walk, not a suite run; contrast B8's 15min at `set-phase.mjs:339-340`) AFTER the phase
write and OUTSIDE the state lock (the B8 shape; the lock is released in the `finally` at
`:197-199`); policy (threshold constant, opt-out env var) lives in `set-phase.mjs`, keeping
`compact.mjs` policy-free.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/scripts/set-phase.mjs`
- `skills/odyssey/scripts/compact.mjs` (only the `--min-lines` flag and its below-threshold
  short-circuit — nothing else)
- `skills/odyssey/scripts/compact.test.mjs` (new — no compact suite exists today; confirmed by
  `ls skills/odyssey/scripts/*.test.mjs`. `scripts/run-tests.mjs` discovers every `*.test.mjs`
  recursively, so the suite count grows by one with no runner change.)

Nothing else. `skills/odyssey/SKILL.md`, `references/scripts.md`, `README.md`, and `DESIGN.md`
belong to the release pass, not the gated run — do not widen the set to include them by default.
Hooks are untouched (no `pre-tool.mjs` change can be needed: the brief write happens inside a
trusted script the gate already allows). `record-final-wave.mjs` is untouched — F1-F4 keep reading
notepads; where they read the brief instead is conductor dispatch text, not reader code.

## Must NOT do

- **Never read-modify, truncate, prune, or delete any source notepad — not in compact.mjs, not in
  set-phase.mjs, not "for tidiness" after the brief is written.** The additive invariant
  (`compact.mjs:16-19`) is absolute: the notepads are the final wave's evidence chain, and a
  compaction that consumes its inputs to "save disk" destroys the very record F1-F4 exist to
  audit.
- Never delete `_compact-brief.md` in the below-threshold or opt-out paths. Below threshold means
  inert — no writes, no deletions, of anything.
- Do not make compaction mandatory for small runs: the below-threshold path must stay a complete
  no-op, and the opt-out (`ZODYSSEY_NO_AUTO_COMPACT=1`) must exist and work. Compaction becomes
  automatic-above-threshold, never compulsory.
- Do not gate any transition on compaction. No `done` precondition, no new refusal, no state lane.
  A context-economy step that can block is an over-block waiting to happen.
- Do not add state fields (backward-compat stays trivially true — there is nothing to be
  backward-compatible about).
- Do not change compact.mjs's exit-code contract beyond fail-closed `--min-lines` parsing; no new
  exit codes, no new output format for the two-arg invocation.
- Do not put an LLM anywhere in the brief path — no summarizer agent, no "smarter" truncation.
  Determinism is the script's stated point (`compact.mjs:13-15`) and the reason it costs $0.
- Do not touch `skills/odyssey/hooks/*`, `record-final-wave.mjs`, or the notepad-writing contract
  executors follow.
- Do not daemonize, background, or add async runners; no npm packages.
- Do not batch this into a release carrying queue items 01, 03, or 04 (one security change per
  release; this change is not security-class).
- Do not add a reviewer, judge, or verifier agent. **No LLM opinion layer** — the brief is a
  deterministic structural view; nothing in this change expresses a judgment.

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active
- **No argv flag authenticates anyone** — every script is invocable by any agent with the same argv
  surface the operator has. A flag can remove a *silent* path; it cannot grant authority.
  (`ZODYSSEY_NO_AUTO_COMPACT=1` is exactly the allowed shape: it removes the silent automatic
  brief write; it grants nothing — compaction is additive-only, so opting out removes an artifact,
  never creates authority.)
- Fail closed. An unverifiable state blocks; it never passes. (Parse errors in `--min-lines` exit
  2; a failed compaction never *passes silently as if done* — it warns and records its absence in
  the transition's output.)
- A repo-capability check degrades to a recorded `inert`, never to a block. Over-blocking is a new
  failure of the class the change exists to remove. (No notepad dir → warning, transition
  proceeds.)

### Anchor-drift reconciliation (amendment, 2026-08-16)

`scripts/check-anchors.test.mjs` landed after this prompt was written and runs inside
`node scripts/run-tests.mjs`. It content-pins every `file:line` citation in the repo's docs, so
**editing a cited file makes the suite go red until the citations are reconciled.** That is the
check working, not a defect in your change.

**This change's exposure: 83 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/scripts/set-phase.mjs` (29), `skills/odyssey/SKILL.md` (24), `skills/odyssey/scripts/compact.mjs` (15).

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

Every criterion is an exact command from the repo root plus its expected exit code. `record-verify`
executes them and records the codes as evidence; a criterion a human must read and agree with is
not a criterion.

1. `node --check skills/odyssey/scripts/compact.mjs` — expected exit **0**.
2. `node --check skills/odyssey/scripts/set-phase.mjs` — expected exit **0**.
3. `node skills/odyssey/scripts/compact.test.mjs` — expected exit **0**. The suite must contain
   and pass, at minimum: (a) a fixture with 5 notepads × 100 non-empty lines each —
   `compact.mjs <repo> <slug>` exits 0, `_compact-brief.md` exists, **every source notepad is
   byte-identical** to its pre-invocation bytes (sha256 or Buffer equality — the additive
   invariant as an executable assertion, not a comment); (b) the same fixture with
   `--min-lines 400` — exit 0, brief exists, sources byte-identical, each section truncated at 40
   lines carrying the truncation marker (`compact.mjs:78`); (c) a small fixture (2 notepads × 20
   lines) with `--min-lines 400` — exit 0, **no brief written**, and a pre-seeded brief from a
   "manual earlier run" remains byte-identical (never deleted); (d) the small fixture with plain
   two-arg invocation — exit 0, brief **exists** (the legacy contract is unchanged); (e) a
   missing notepad dir — exit **3** (`compact.mjs:47-50` unchanged); (f) a crafted run state at
   phase `verify` (entering `final` has no precondition — `checkPrecondition` at
   `skills/odyssey/scripts/set-phase.mjs:100-107` gates only `execute` and `done`; the separate
   `--force` FORCEABLE restriction at `:167-175` concerns recovery targets, not `final`) plus the
   large notepad set — `set-phase.mjs <repo> <slug> final` exits **0** AND the
   brief exists AND sources are byte-identical AND the brief path appears in the invocation's
   stdout; (g) the same crafted state with the small notepad set — exit 0, no brief; (h) the same
   crafted state, large set, with `ZODYSSEY_NO_AUTO_COMPACT=1` — exit 0, no brief; (i) a crafted
   state whose run has no notepad dir — entering `final` still exits **0** (best-effort, warning
   only); (j) idempotence — invoking compaction twice leaves sources byte-identical and the brief
   regenerated.
4. `node --test skills/odyssey/scripts/compact.test.mjs` — expected exit **0**.
5. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16; after this change it must read 33/33 (the new suite is discovered — a count that
   stays 32 means the file is misnamed or misplaced, and a runner that reports success over an
   empty set is this repo's documented false-green).
6. The paired direction — proof the new wiring assertions actually run against the unwired code,
   re-provable on demand (in TDD order you demonstrate it BEFORE writing the wiring):
   `git stash push -- skills/odyssey/scripts/set-phase.mjs && node skills/odyssey/scripts/compact.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only the wiring reverted, cases (f)/(g)/(h) fail (no
   transition ever invokes compact.mjs) and the suite exits 1.
7. Source tripwire against silent unhooking, in the spirit of
   `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs`:
   `test $(grep -c 'compact\.mjs' skills/odyssey/scripts/set-phase.mjs) -ge 1`
   — expected exit **0** (the invoke site names the script).
8. The invariant tripwire — the header comment is now the *documented* form of a tested claim:
   `test $(grep -c 'NEVER reads, modifies, or deletes any' skills/odyssey/scripts/compact.mjs) -ge 1`
   — expected exit **0** (if a refactor rewords the additive invariant, the test and the comment
   must be reconciled in the same change, never the comment alone).

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** No lists are added; the wiring keys off one phase value
   and one aggregate line count. Nothing to enumerate, nothing to drift out of sync.
2. **A check that cannot detect the class of failure it exists for.** Criterion 6 is the tripwire:
   the wiring assertions are demonstrated failing against the unwired code; criterion 7 catches
   silent unhooking after land; criterion 3(a) makes the additive invariant self-verifying on
   every run of the suite.
3. **Ceremony without mechanism.** This is the change's own subject: a "MAY run" sentence
   addressed to a conductor (`SKILL.md:158`) becomes a transition invoke with a printed signal —
   the exact transformation the repo's B8 comment prescribes (`set-phase.mjs:330-332`).
4. **Self-grading.** Every criterion is machine-executed with a recorded exit code; the paired
   probe runs against both builds. Nobody grades prose.
5. **A fix that reopens its own class.** Covered in "The class it closes" — the dangerous
   reopening here is destructive wiring, and the byte-identity assertion is precisely the fence.

## Paired probe

**Probe:** a scratch repo with a crafted run at phase `verify` and a large notepad set — 5 files in
`.zcode/notepads/<slug>/`, each 100 non-empty lines (500 aggregate > 400).

- **Before the fix (current HEAD): no brief, ever.** `node skills/odyssey/scripts/compact.mjs
  <repo> <slug>` works by hand (exit 0, brief written, sources untouched — the mechanism works),
  but drive the run forward: `node skills/odyssey/scripts/set-phase.mjs <repo> <slug> final`
  exits 0 with **no** `_compact-brief.md` — zero code callers; the only wiring is the "MAY"
  prose at `SKILL.md:158`. F1-F4 dispatch consumes the full doc set the brief was designed to
  replace.
- **After the fix: it fires, additively.** The same transition exits 0, prints the brief path,
  and `_compact-brief.md` exists with every source notepad byte-identical (probe with
  `sha256sum .zcode/notepads/<slug>/*.md` before and after — excluding `_compact-brief.md`, which
  is the new artifact, not a mutation).

Unchanged controls, required on BOTH builds — a probe that moves any of them has over-blocked or
over-reached:

| Control | Before | After |
|---|---|---|
| Entering `final`, small notepad set (2 × 20 lines) | 0, no brief | **0, no brief** (below threshold — inert) |
| Entering `final`, large set, `ZODYSSEY_NO_AUTO_COMPACT=1` | 0, no brief | **0, no brief** (opt-out) |
| Entering `final`, run with no notepad dir | 0 | **0** + warning line (best-effort, never a block) |
| A manually created `_compact-brief.md` from mid-run, then a below-threshold final entry | brief stays | **brief stays, byte-identical** (never deleted) |
| Direct `compact.mjs <repo> <slug>` (two args, any size) | 0, brief written | **0, brief written** (legacy contract unchanged) |
| Any transition other than `final` (execute, verify, done…) | no compaction side-effects | **no compaction side-effects** |
| A run created before this change (state lacks nothing new — there are no new fields) | transitions normally | transitions normally |

## What it breaks

The intended break: for large runs, F1-F4 dispatches now consume a ~40-line-per-notepad brief
instead of the full set. That is the point, and its cost must be stated exactly: **the brief is
pointers, not content.** Each truncated section carries `_(truncated to first 40 non-empty
lines)_` (`compact.mjs:78`), the source notepads remain on disk byte-identical as the
full-fidelity path, and SKILL.md's own framing (`:211`) already positions the brief as the
large-run alternative to delegated full reads — an F-wave needing depth reads the source by path;
the brief is the map. Blast radius beyond that, honestly: (a) every "(optional)" claim about
compaction goes stale the moment it auto-fires — `README.md:59`, `README.md:81`, `README.md:280`,
`references/scripts.md:17`, `SKILL.md:157-164`, `:211` — a doc-code drift manufactured by this
change unless the doc pass lands with it (see "Docs to update"); (b) the `final` transition gains
one node child-process spawn and a directory walk — milliseconds, with a ~10s timeout and a
best-effort catch, so it cannot wedge the transition; (c) anything that assumed the notepad dir
contains only `<todo-id>.md` files now sees `_compact-brief.md` appear — harmless by
construction (compact.mjs excludes it from its own input set at `:56`, and downstream todos read
notepads by explicit path, never by glob); (d) a run that re-enters `final` below threshold keeps
a possibly stale brief from an earlier entry — accepted deliberately (deletion is non-additive);
the per-entry printed line is the freshness signal.

## The class it closes

**A mechanism that exists, works when hand-invoked, and cannot fire from the pipeline** — the
same class prompt 02 closed for `check-imports`/`coverage-delta`/`resolve-capabilities`.
`compact.mjs` is a member of the class in its polite form: the header *documents* the unwired
state as a design choice ("not mandatory and not wired into any phase transition or hook",
`compact.mjs:20-21`), which makes it convention rather than oversight — but a convention with a
$0 deterministic payoff that never fires is still ceremony without mechanism, and the census
(zero code callers, doc-prose references only) is the same evidence shape that condemned the
other three.

How this change could reintroduce the class:

- **Destructive wiring** — a future change "improves" compaction by pruning notepads after
  building the brief (to save disk, or to force F1-F4 onto the brief). That destroys the
  final-wave evidence chain the additive invariant exists to protect. Prevented by: criterion
  3(a) asserts byte-identity of every source notepad across every code path, turning the
  `compact.mjs:16-19` comment into an enforced invariant — the exact transformation this repo's
  own history prescribes for documented-but-unenforced claims
  (`scripts/version-consistency.test.mjs:15-16`). Criterion 8 reconciles comment and test so they
  cannot drift apart silently.
- **Silent unwiring** — someone removes the invoke and the behavior quietly reverts to opt-in.
  Prevented by the stash-shaped criterion 6 (the wiring assertions demonstrably fail without the
  wiring) and the source tripwire at criterion 7.
- **Half-wiring** — brief produced but nothing points F1-F4 at it (invoke without consumer, the
  finer-grained member of the class this run found in the regression gate, per prompt 02).
  Mitigated, with an honest limit: the invoke and the printed path signal are asserted together
  (criterion 3f), but the act of *pointing* the F1-F4 dispatches at the brief remains conductor
  prose — it cannot be mechanism without rewriting dispatch prompts, and is named under
  *Known, not fixed* rather than pretended away.

## Docs to update

Every doc that states the claim this change alters ("compaction is optional and never fires on
its own"), each checked against the 2026-08-16 tree:

- `skills/odyssey/SKILL.md:158-164` — the phase-6 OPTIONAL COMPACTION box: from "you MAY run" to
  the mechanism sentence — compaction fires automatically at `final` entry above the threshold,
  is inert below it, opt-out via `ZODYSSEY_NO_AUTO_COMPACT=1`, and the printed path line is the
  conductor's signal to point F1-F4 at the brief. Keep the determinism/additivity clauses.
- `skills/odyssey/SKILL.md:212` — the "load-bearing working memory" paragraph: "optional
  `_compact-brief.md`" becomes "auto-derived at final entry above the size threshold (additive —
  sources never modified)".
- `skills/odyssey/SKILL.md:386-390` region — the env-var list gains
  `ZODYSSEY_NO_AUTO_COMPACT` (set to 1 to skip auto-compaction at final entry; default unset =
  enabled), phrased like the `ZODYSSEY_REGRESSION_TIMEOUT_MS` entry at `:388`.
- `skills/odyssey/references/scripts.md:17` — the `compact.mjs` entry: invoked automatically by
  `set-phase.mjs` on entering `final` above `AUTO_COMPACT_MIN_LINES`; direct two-arg invocation
  unchanged; `--min-lines` documented; the additive invariant stated as tested, not promised.
- `README.md:59`, `README.md:81` — the diagram and phase-list "(optional)" qualifiers update to
  "automatic for large runs".
- `README.md:280` — the comparison-table row ("Notepad compaction (#8)") states the transition
  and the never-mutates-sources claim now carries "asserted by test".
- `docs/DESIGN.md` — the phase-transition/state-flow description gains the final-entry compaction
  as a derived artifact (verify the exact section — §6 and the components table — at build time;
  if §6's scope rows are unaffected, record that rather than hunting for an edit).
- `CHANGELOG.md` — shape below.

## CHANGELOG entry shape

Patch release (v0.6.x line): an existing script gains an automatic invoke plus one flag; no
interface, contract, or state change reaches any consumer that does not opt in to reading the
brief. Not batched with queue items 01/03/04 (one security change per release; this is not
security-class).

- **Added — compaction now fires from the final-phase transition.** One entry stating: the
  transition that invokes it (`final` entry), the threshold (aggregate non-empty notepad lines >
  `AUTO_COMPACT_MIN_LINES = 400`), inert-below-threshold, the `ZODYSSEY_NO_AUTO_COMPACT=1`
  opt-out, the unchanged direct-invocation contract, and — in its own sentence — that the
  additive invariant (source notepads byte-identical, `compact.mjs:16-19`) is now an asserted
  test rather than a comment. Cite the paired probe: hand-invocation works today while entering
  `final` produces no brief; after, the same transition produces one with sources unchanged.
  This repo cites its probes, not just its diffs.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - The threshold value (400) is a stated judgment (10× the per-notepad cap), not a derived
    number. The two-arm eval (queue items 09/10) is the instrument that could measure real
    context cost and replace the constant with data; until then it is a named guess.
  - Pointing F1-F4 dispatches at the brief remains conductor prose anchored to the printed path
    signal — mechanism guarantees the brief exists and is signalled, not that anyone reads it.
  - A below-threshold re-entry of `final` never deletes a stale brief from an earlier entry
    (deletion is non-additive); freshness is the per-entry printed line, not cleanup.
  - `skills/odyssey/scripts/build-capsules.mjs` remains a zero-caller outside this change's
    scope (already named in prompt 02's Known-not-fixed; still true).
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the marketplace cache picks up the wiring — a fix that stays only
  in the repo fires in no run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is a pure code-logic change and the run's whole method is red-green: load the TDD skill via
the Skill tool in the executor thread, write the failing assertions first (criterion 6's
demonstration — the suite must go red against the unwired `set-phase.mjs`), then make them green.
F5 cross-checks the declaration against hook-witnessed loads, so a declaration without a real load
fails the final wave — declare nothing speculative. No `discovered:`/`generic:` (no find-skills
call is planned) and no `mcp:` declarations (none will be loaded). If a test fails in a way two
fix attempts do not diagnose, loading `systematic-debugging` is correct — declare it only if it is
actually loaded, after the fact, never in anticipation.

## Estimated size

~15-20 lines in `skills/odyssey/scripts/set-phase.mjs` (the `final` block, the threshold constant,
the opt-out check, the best-effort catch); ~15-25 lines in `skills/odyssey/scripts/compact.mjs`
(`--min-lines` parse with fail-closed exit 2, the aggregate count, the below-threshold
short-circuit and its message); ~150-200 lines of new test (`compact.test.mjs`): two notepad-set
fixtures plus the crafted verify-state fixtures, the byte-identity assertions, the opt-out and
no-dir controls, and idempotence. Patch release; it may ride the v0.6 line with other
non-security items but never shares a release with 01, 03, or 04.
