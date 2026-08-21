# 02 — Wire the zero-caller checks into phase transitions

Build order **02** · depends-on **—** (nothing precedes or blocks it) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `02 wire-zero-caller-checks` · not security-class · minor release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast. Do exactly this one change.

## What is broken

Three correctness-check scripts ship in this repo, each with a passing test suite, and **none of
them has a single code caller**. Census re-measured 2026-08-16 (this run, not an ideation-doc
number): grep for each script's name across `skills/`, `scripts/`, `agents/`, `commands/`
(`*.mjs`, `*.bash`), excluding the script itself and its `.test.mjs` → **zero hits for all three**.
Every remaining reference is doc prose: `check-imports` at
`skills/odyssey/references/scripts.md:47`, `docs/MEASUREMENT.md:85`, `README.md:133`;
`resolve-capabilities` at `skills/odyssey/SKILL.md:393`,
`skills/odyssey/references/capabilities.md:106`,
`skills/odyssey/references/scripts.md:50`, `docs/RESUME.md:124`, `docs/RESUME.md:210`,
`docs/DESIGN.md:458`; `coverage-delta` at `CHANGELOG.md:992` only (it has no
`references/scripts.md` entry at all). The three detectors:

- `skills/odyssey/scripts/check-imports.mjs` — exits **9** on an import that resolves against
  neither the declared dependencies nor `node_modules` (`:23` header, `exit(9)` at `:161`); offline
  by construction; inert in a repo with no git and no manifest (`:60`, and the `hasJsManifest` /
  `hasPyManifest` gates at `:107-108` skip files entirely).
- `skills/odyssey/scripts/coverage-delta.mjs` — parses a pre-existing coverage report for the
  changed files; "evidence, NOT a gate" (`:4-5`); **exit 0 always** (`:38`).
- `skills/odyssey/scripts/resolve-capabilities.mjs` — reconciles agent `tools:` grants against the
  capabilities their bodies reference; exits **6** on violations (`:32`). Its header claims "the
  orchestrator reads the lock file at dispatch time" (`:12-13`) — nothing reads
  `capabilities.lock.json` (grep: zero consumers).

The failure mode is **ceremony without mechanism**, in the repo's own words.
`skills/odyssey/references/scripts.md:47` ends: "Run it during verify on the run's changed
files." — an imperative addressed to the conductor. The repo's B8 comment explains why that is not
enforcement: `skills/odyssey/scripts/set-phase.mjs:353-355` — "Wired here rather than as a SKILL.md
instruction on purpose: an instruction to a conductor is the prompt-convention 'enforcement' this
project exists to replace." v0.3.2 shipped these as "the three gates `MEASUREMENT.md` promised and
never had" (`CHANGELOG.md:824`) — and shipped them unwired:
`docs/MEASUREMENT.md:74-78` still lists `check-imports.mjs` among "the mechanisms behind" the
factual-accuracy target, a claim with no mechanism behind it. Both ideation passes found this
independently (`docs/ideation-report.md:38`, `:263`, `:308` — "convention measurably failed to
fire"); this run's census is the third.

**Paired-probe result, broken direction (provable today):** in a scratch repo with a
`package.json` and one file importing a package that exists nowhere, `node
skills/odyssey/scripts/check-imports.mjs <repo>` exits **9** — the detector works. Drive an
orchestration run in that same repo from scaffold to `done`: no transition invokes the script, no
state lane records anything, nothing refuses. The hallucinated import ships. The detector is not
broken; the pipeline is deaf to it.

One finer-grained fact from this run's census, which both ideation documents missed and which sets
the design bar for this change: **the wiring precedent itself is half-wired.**
`skills/odyssey/scripts/set-phase.mjs:362` invokes only `regression-gate.mjs --snapshot`;
`regression-gate.mjs --check` — the only writer of `status: "regressed"`
(`skills/odyssey/scripts/regression-gate.mjs:179`) — has **no code caller either**, and
`skills/odyssey/SKILL.md` never mentions it (its only regression mention is the env var at
`:405`). The `done` refusal at `skills/odyssey/scripts/set-phase.mjs:131` therefore fires only if
a conductor happens to follow the prose in `references/scripts.md:46`. This change wires **both
sides — invoke and consume — as mechanism**, and leaves the regression-gate gap itself out of
scope (named under *Known, not fixed*).

## What fixed means

Stated as observable behaviour, not as a diff. All new state fields are OPTIONAL (`st.checks`,
`st.imports`, `st.coverage`, `st.capabilities` — read via `|| {}`); runs created before this change
load and transition unchanged.

**1. Entering `execute`** (in the B8 block at `skills/odyssey/scripts/set-phase.mjs:357-365`):
record the current `git rev-parse HEAD` as the run's baseline sha in state. A non-git repo records
`null`. This is the "before" marker the import check diffs against — mirroring how
`regression-gate --snapshot` at the same moment defines "before" for the suite
(`skills/odyssey/scripts/set-phase.mjs:349-351`).

**2. Entering `verify`**: `set-phase.mjs` invokes
`check-imports.mjs <repo> --since <baseline_sha>` and records `state.imports = { status,
exit_code, findings, at }`:

| check-imports result | recorded status | consequence |
|---|---|---|
| exit 9 (findings; manifest present) | `unresolved` + finding list | **`done` refuses** — new clause in `checkPrecondition`, mirroring the regression consumer at `skills/odyssey/scripts/set-phase.mjs:131-135` |
| exit 0 (manifest present) | `clean` | none |
| repo capability absent — no git work-tree, or no `package.json` AND no Python manifest | `inert` (recorded without invoking, or from the empty result) | none — **never a block** |
| anything else (timeout, crash, exit 2) | `inert` + reason | none — B8's own posture: a check that cannot run degrades (`skills/odyssey/scripts/set-phase.mjs:364`) |

Recovery from `unresolved`: fix the import or declare the dependency, then re-enter verify
(`verify → execute → verify` is legal, `TRANSITIONS` at `skills/odyssey/scripts/set-phase.mjs:91`)
— the check re-fires and re-records on every execute→verify edge. `--since` scoping means a
hallucinated import in a file this run never touched is invisible — inherited breakage is not this
run's fault, the same principle as `skills/odyssey/scripts/regression-gate.mjs:16-18`.

**3. Entering `final`** (verify→final, the moment before the final wave and its F5 routing
cross-check):

- `coverage-delta.mjs <repo> <changed-file>…` runs with the changed set derived from the same
  baseline diff; its single stdout line (JSON or a no-op message) is recorded verbatim as
  `state.coverage`. Exit 0 always (`skills/odyssey/scripts/coverage-delta.mjs:38`). **Nothing
  consumes it as a gate** — evidence only, exactly as the script's header contract demands
  (`:4-5`).
- `resolve-capabilities.mjs --check` (reconcile-only, no lock write — `:517`, `:538`) runs and
  records `state.capabilities = { status, at }`: exit 0 → `clean`; exit 6 → `violations`,
  **recorded and surfaced on stderr, never a precondition**; scan failure → `inert`. The
  `ZCAP_NO_CODEGRAPH` override (`:60`) already provides the graceful codegraph-absent path.

**Per-check gate-vs-inert decision, stated and justified against the Step-5 constraint** ("A
repo-capability check degrades to a recorded `inert`, never to a block"):

- `check-imports` **gates on findings** (exit 9 → `done` refuses) and **records inert when the
  capability is absent**. The distinction is capability, not verdict: exit 9 can only happen in a
  repo that HAS a manifest — the failure is real, this-run-scoped, and exactly the class the check
  exists for. A repo without `package.json`/`node_modules`/git cannot produce exit 9; the wiring
  must record `inert` there, never block.
- `coverage-delta` **never gates** — by its own contract ("evidence, NOT a gate",
  `skills/odyssey/scripts/coverage-delta.mjs:4-5`).
- `resolve-capabilities` **records only** — its violation classes describe the operator's entire
  installation (any agent on disk, any unrouted skill), not this repo's run. Blocking every run in
  every repo on cross-repo environment drift is over-blocking — a new failure of the class this
  change exists to remove.

Mechanism notes, secondary to the behaviour: invoke via `execFileSync` with a hard timeout (~60s)
AFTER the phase write and OUTSIDE the state lock (the B8 shape at
`skills/odyssey/scripts/set-phase.mjs:357-365`; note `LOCK_STALE_MS` is 60s at `:56` — do not hold
the lock across a scan); record each lane with the same atomic tmp+rename write the file already
uses. The three check scripts themselves are **untouched** — the wiring consumes their existing
exit codes and stdout.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/scripts/set-phase.mjs`
- `skills/odyssey/scripts/set-phase.check-wiring.test.mjs` (new — no `set-phase` suite exists
  today; confirmed by `ls skills/odyssey/scripts/*.test.mjs`)

Nothing else. `record-verify.mjs` is deliberately absent: all three checks are transition-scoped
(run-level), not per-criterion-scoped, so one wiring site in one file is the whole change — one
pattern to test, one place a future check extends. The three check scripts need no changes (their
exit-code contracts already express everything the wiring consumes); if a change to one seems
necessary mid-build, stop and re-read "Must NOT do". The docs listed under "Docs to update" belong
to the release pass, not the gated run — do not widen the set to include them by default.

## Must NOT do

- Never let a missing repo capability block anything. No `package.json`, no git, no toolchain, no
  coverage report → recorded `inert`. Over-blocking is the failure this change exists to remove.
- Do not modify `check-imports.mjs`, `coverage-delta.mjs`, or `resolve-capabilities.mjs`, and do
  not change any exit-code contract (0/2/9, 0/2, 0/2/6).
- Do not wire `resolve-capabilities` or `coverage-delta` as gates — record only.
- Do not touch `skills/odyssey/hooks/pre-tool.mjs` or any hook. F5 consuming
  `capabilities.lock.json` is a separate change; this one only records.
- Do not extend `--force` beyond `blocked`/`abandoned` (SEC-3,
  `skills/odyssey/scripts/set-phase.mjs:318`). There is deliberately no flag that skips an
  `unresolved` imports record — the recovery is fixing the import, not argv.
- Do not wire `regression-gate.mjs --check` in this change, tempting as it is given the finding
  above — it is named under *Known, not fixed* and is a natural follow-up using this change's
  pattern. Folding it in grows the diff past one-reviewable-change.
- Do not daemonize, background, or add async runners; no new env vars; no npm packages.
- Do not batch this into a release carrying queue items 01, 03, or 04 (one security change per
  release; this change is not security-class).
- New state fields must be optional everywhere (`|| {}`); runs mid-flight on the old schema must
  keep loading and transitioning.
- Do not add a reviewer, judge, or verifier agent. **No LLM opinion layer** — every check in this
  change is an exit code recorded by a transition.

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active
- **No argv flag authenticates anyone** — every script is invocable by any agent with the same argv
  surface the operator has. A flag can remove a *silent* path; it cannot grant authority.
- Fail closed. An unverifiable state blocks; it never passes.
- A repo-capability check degrades to a recorded `inert`, never to a block. Over-blocking is a new
  failure of the class the change exists to remove.

### Anchor-drift reconciliation (amendment, 2026-08-16)

`scripts/check-anchors.test.mjs` landed after this prompt was written and runs inside
`node scripts/run-tests.mjs`. It content-pins every `file:line` citation in the repo's docs, so
**editing a cited file makes the suite go red until the citations are reconciled.** That is the
check working, not a defect in your change.

**This change's exposure: 29 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/scripts/set-phase.mjs` (29).

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

1. `node --check skills/odyssey/scripts/set-phase.mjs` — expected exit **0**.
2. `node skills/odyssey/scripts/set-phase.check-wiring.test.mjs` — expected exit **0**. The suite
   must contain and pass, at minimum: (a) a manifest-bearing fixture repo with one unresolvable
   import — entering `verify` records `state.imports.status === "unresolved"`, and a crafted
   `done`-bound state (`final.verdict: "pass"` + that record) makes `set-phase … done` exit **6**
   naming the finding; (b) a bare fixture (no `package.json`, no git) — entering `verify` records
   `inert` and exits 0, `done` unaffected; (c) a clean fixture — records `clean`; (d) a fixture
   where `resolve-capabilities --check` reports violations — entering `final` exits **0** with
   `state.capabilities.status === "violations"` recorded; (e) entering `final` records a
   `state.coverage` line from `coverage-delta` (its no-op message in a bare fixture is a valid
   record).
3. `node --test skills/odyssey/scripts/set-phase.check-wiring.test.mjs` — expected exit **0**.
4. `node skills/odyssey/scripts/check-imports.test.mjs` — expected exit **0** (the untouched
   script's own suite, still green).
5. `node skills/odyssey/scripts/coverage-delta.test.mjs` — expected exit **0**.
6. `node skills/odyssey/scripts/resolve-capabilities.test.mjs` — expected exit **0**.
7. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16. The count may grow; the exit code must not change.
8. The paired direction — proof the new assertions actually run against the unwired code,
   re-provable on demand (in TDD order you demonstrate it BEFORE writing the wiring):
   `git stash push -- skills/odyssey/scripts/set-phase.mjs && node skills/odyssey/scripts/set-phase.check-wiring.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only the wiring reverted, the invocation/recording
   assertions fail (no lane is ever written) and the suite exits 1.
9. Source tripwire against silent unhooking, in the spirit of
   `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs`:
   `test $(grep -cE 'check-imports\.mjs|coverage-delta\.mjs|resolve-capabilities\.mjs' skills/odyssey/scripts/set-phase.mjs) -ge 3`
   — expected exit **0** (each check named at least once at its invoke site).

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** No lists are added; the wiring keys off exit codes the
   scripts already define. Nothing to enumerate, nothing to drift out of sync.
2. **A check that cannot detect the class of failure it exists for.** Criterion 8 is the tripwire:
   the wiring assertions are demonstrated failing against the unwired code, so a silently-skipped
   or never-run assertion cannot pass unnoticed. Criterion 9 catches silent unhooking after land.
3. **Ceremony without mechanism.** This is the change's own subject: it replaces three
   conductor-addressed imperatives (`references/scripts.md:47`) with transition invokes recorded
   in state and consumed by a precondition — mechanism, not convention.
4. **Self-grading.** Every criterion is machine-executed with a recorded exit code; the paired
   probe runs against both builds. Nobody grades prose.
5. **A fix that reopens its own class.** Covered in "The class it closes" — invoke-and-consume are
   asserted together, per check, precisely because this run found a half-wiring
   (`regression-gate --check`) that a one-sided test would have blessed.

## Paired probe

**Probe:** a run in a repo with a deliberately unresolvable import. Fixture: a git repo containing
`package.json` (name only, no dependencies) and `src/probe.js` with
`import x from "zodyssey-hallucination-probe";` — a package that exists nowhere and is declared
nowhere.

- **Before the fix (current HEAD): silent pass.** `node skills/odyssey/scripts/check-imports.mjs
  <fixture>` exits **9** when invoked by hand (the detector works), but no transition ever invokes
  it: scaffold → … → `done` completes with no `state.imports` lane, no record, no refusal. The
  hallucinated import ships inside a run that passed every gate.
- **After the fix: it fires and stamps.** Entering `verify` records
  `state.imports.status === "unresolved"` with the finding; `set-phase <fixture> <slug> done` (with
  `final.verdict: "pass"` crafted, isolating the new clause) exits **6** naming the unresolved
  import. Fixing `src/probe.js` and re-entering verify re-records `clean`, and `done` proceeds.

Unchanged controls, required on BOTH builds — a probe that moves any of them has over-blocked:

| Control | Before | After |
|---|---|---|
| Entering `verify`, bare repo (no manifest, no git) | 0, no record | 0, `state.imports.status === "inert"` |
| Entering `verify`, clean manifest repo | 0, no record | 0, `clean` |
| Entering `final`, repo whose operator inventory drifts (resolve-capabilities exit 6) | 0, no record | **0**, `state.capabilities.status === "violations"` |
| Entering `final`, repo with no coverage report | 0, no record | 0, no-op line recorded in `state.coverage` |
| A run created before this change (state lacks the new lanes) | transitions normally | transitions normally (fields optional) |
| `done` for a run with no `state.imports` lane at all | per existing preconditions | per existing preconditions — no new refusal |

## What it breaks

The intended break: a run in a manifest-bearing repo that lands an unresolvable import can no
longer reach `done` until the import is fixed or the dependency declared. That is the point, and
the honest blast radius beyond it is near zero by construction: bare repos, non-git repos, and
repos with no Python/JS manifest record `inert` and are untouched (asserted by the suite — the
degradation rule is a test, not a hope); inherited breakage is invisible to `--since` scoping;
in-flight old runs keep loading (optional fields); `resolve-capabilities` violations and
`coverage-delta` output block nothing, ever. Real costs to state plainly: (a) entering `final` now
synchronously scans the operator's plugin cache (~200+ files; sub-second to a few seconds; the
~60s timeout degrades to `inert` rather than wedging the transition); (b) `done` gains one more
refusal mode, so a stuck run has one more reason to use the standing `blocked`/`abandoned` escapes
(`TRANSITIONS` at `skills/odyssey/scripts/set-phase.mjs:86-98`) — recovery is re-entering verify
after the fix, not a bypass flag.

## The class it closes

**A check that exists, passes its own tests, and cannot fire from the pipeline** — ceremony
without mechanism, failure mode 3. Three instances shipped together on 2026-08-11 under the
heading "the three gates `MEASUREMENT.md` promised and never had" (`CHANGELOG.md:824`), each
documented with an imperative sentence addressed to a conductor
(`skills/odyssey/references/scripts.md:47`) that no mechanism ever executed. The class has a
finer-grained member this run found: a check wired on ONE side only — invoke without consumer, or
consumer without invoke (`regression-gate.mjs --snapshot` is wired at
`skills/odyssey/scripts/set-phase.mjs:362`; `--check`, the only writer of the `regressed` status
the `done` gate consumes at `:131`, is convention-only,
`skills/odyssey/scripts/regression-gate.mjs:179`).

How this change could reintroduce the class: a future check added as a `scripts.md` convention
again — "run it during X" with no transition invoke; or a half-wiring, an invoke whose recorded
state nothing consumes (or a consumer waiting on state nothing writes), which a one-sided test
would bless exactly as the regression gate's was blessed. What prevents it: (a) the wiring suite
asserts invoke AND record AND consume together, per check, from fixtures (criterion 2) — a check
missing any side fails the build; (b) the source tripwire (criterion 9) fails if an invocation is
silently removed; (c) a standing docs rule this change writes into `references/scripts.md`: a
correctness-check entry must name the transition that invokes it, never an instruction to run it.

## Docs to update

Every doc that states the claim this change alters ("these checks run during the pipeline"), each
checked against the 2026-08-16 tree:

- `skills/odyssey/references/scripts.md:47` — replace "Run it during verify on the run's changed
  files." with the mechanism sentence, mirroring the regression-gate entry's own phrasing at `:44`:
  invoked automatically by `set-phase.mjs` on entering `verify`; `done` refuses while
  `state.imports.status === "unresolved"`; inert without a manifest/git.
- `skills/odyssey/references/scripts.md:50` — `resolve-capabilities` gains the final-entry
  invocation and the `state.capabilities` lane; note `--drift-check` remains a manual diagnostic.
- `skills/odyssey/references/scripts.md` — **add** the missing `coverage-delta.mjs` entry (it has
  none today; the check is about to be wired before it is documented, which would be a fresh
  doc-code drift in the making).
- `skills/odyssey/SKILL.md:387-393` — the transition one-liners: entering `verify` / entering
  `final` note that the checks fire automatically (a conductor sentence that no longer needs to
  exist is the win; keep them to one clause each). `:393`'s diagnostics mention of
  `resolve-capabilities` stays true — manual invocation remains possible.
- `docs/MEASUREMENT.md:74-78` — the "Honest status" block: the `check-imports.mjs` clause now
  carries its enforcement clause ("invoked at verify entry, enforced at `done`, inert without a
  manifest") matching the regression-gate clause's form.
- `README.md:132-133` — comparison-table rows: "Imports resolve" (`:133`) can now name the
  invoking transition; the pass-to-pass row (`:128`) states "green→red blocks `done`" — that claim
  depends on the conventionally-invoked `--check` (see *Known, not fixed*); leave the row's text
  or add the caveat per the release's judgment, but do not silently let it outrun mechanism.
- `docs/DESIGN.md` — components table: row 17 (Phase-transition DAG, `:417`) gains the
  check-invokes; row 18 (Capability reconciliation, `:418`, currently bare "done") gains "wired at
  final entry". Verify the §6 table row at build time; this change adds no hook, so §6 likely
  needs no edit — record that rather than hunting.
- `CHANGELOG.md` — shape below.

## CHANGELOG entry shape

New version **0.6.0** (minor): three new state lanes plus a new `done` precondition is behaviour,
not a defect patch. Not batched with queue items 01/03/04 — one security change per release, and
this change is not security-class; it may share the v0.6 minor with other non-security items.

- **Added — the zero-caller checks now fire from phase transitions.** One entry per check stating:
  the transition that invokes it, the state lane recorded, and the gate-vs-record decision with
  its one-line justification (findings gate; capability-absent records `inert`). The
  `check-imports` entry cites the paired probe: hand-invocation exits 9 today while a full run
  passes silently; after, entering `verify` records `unresolved` and `done` refuses. This repo
  cites its probes, not just its diffs.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - `regression-gate.mjs --check` has no code caller: the snapshot is wired
    (`skills/odyssey/scripts/set-phase.mjs:362`) but the comparison — the only writer of the
    `regressed` status the `done` gate consumes (`skills/odyssey/scripts/regression-gate.mjs:179`,
    consumer at `set-phase.mjs:131`) — is invoked by prose convention only
    (`references/scripts.md:46`). Deliberately out of this change; wiring it is a follow-up using
    this change's pattern.
  - `capabilities.lock.json` still has no consumer; the header's dispatch-time read
    (`skills/odyssey/scripts/resolve-capabilities.mjs:12-13`) remains aspirational. F5 consuming
    the lock is a hooks change, out of scope.
  - `state.coverage` evidence is recorded but nothing renders it yet (dashboard / run-report
    display is separate work).
  - `skills/odyssey/scripts/build-capsules.mjs` is a fourth zero-caller (zero references of any
    kind) — outside this change's named set; see the INDEX observations.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the marketplace cache picks up the wiring — a fix that stays only in
  the repo fires in no run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is a pure code-logic change and the run's whole method is red-green: load the TDD skill via
the Skill tool in the executor thread, write the failing wiring assertions first (criterion 8's
demonstration — the suite must go red against the unwired `set-phase.mjs`), then make them green.
F5 cross-checks the declaration against hook-witnessed loads, so a declaration without a real load
fails the final wave — declare nothing speculative. No `discovered:`/`generic:` (no find-skills
call is planned) and no `mcp:` declarations (none will be loaded). If a test fails in a way two
fix attempts do not diagnose, loading `systematic-debugging` is correct — declare it only if it is
actually loaded, after the fact, never in anticipation.

## Estimated size

~70-90 lines in `skills/odyssey/scripts/set-phase.mjs`: the baseline-sha capture at execute entry,
the verify-entry `check-imports` invoke-and-record, the final-entry `coverage-delta` +
`resolve-capabilities` invokes, the capability probe that distinguishes `inert` from `clean`, and
one new `checkPrecondition` clause. ~180-220 lines of new test
(`set-phase.check-wiring.test.mjs`): three fixture repos (manifest+hallucination, bare, clean), the
crafted `done`-refusal states, the violations-recorded case, and the source tripwire. Minor
release; it may ride the v0.6 minor with other non-security items but never shares a release with
01, 03, or 04.
