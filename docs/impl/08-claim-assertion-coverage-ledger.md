# 08 — Claim→assertion coverage ledger (A4 as a registry, not a list)

Build order **08** · depends-on **01, 02, 03, 04** (all four fixes land first so their claims
arrive as ledger rows on day one rather than as retrofits) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `08 claim-assertion-coverage-ledger` · not security-class ·
minor release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this repo moves fast. Do exactly this one change.

## What is broken

No artifact in this repo can answer "which documented guarantee currently has no test?". Both
ideation passes found the same absence: `docs/ROADMAP.md:158` names it the missing organ ("A4 ·
`invariants.test.mjs` — the doc-code registry"; goal statement at `docs/ROADMAP.md:89` — "Something
notices when a safeguard breaks. This is the missing organ."), and `docs/ideation-report.md:56-73`
(§1 entry 2) and `:248-259` (S1) propose inverting "tests I wrote" into "claims that exist". A
`find` for an invariants registry returns zero hits (re-confirmed this run, notepad 3 of
`impl-prompts-v0-6`, row 3). Meanwhile the function already exists **five times over**, scattered,
one domain each — every one born from an incident:

1. `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:3-11` — regression suite for the Bash
   write-gate, which was silently deleted twice (v0.1.1, v0.2.0) while three external audits
   passed. Header: "If the gate is removed a third time, this file fails."
2. `skills/odyssey/hooks/pre-tool.gate-surface.test.mjs:2-5` — the 11 gate invariants the v0.4.1
   audit found had no regression test at all.
3. `scripts/version-consistency.test.mjs:15-16` — "a documented-but-unenforced invariant — the
   exact class this repo keeps being bitten by. This is the check."
4. `scripts/smoke-gate.mjs:1-7` — the release gate answering "is enforcement actually live?",
   built after v0.3.0 shipped the whole enforcement chain offline while `--verify` stayed green
   (it checked paths, not liveness).
5. `scripts/deploy-surface.test.mjs:2-7` — "the drift gate must compare everything the deployer
   deploys", built after two release gates reported green over a hand-maintained enumeration
   narrower than the copy (commit `26af48b`).

Row 5 is a **correction to this queue's own inputs**: notepads 2-3 and the INDEX counted four
scattered equivalents; a fresh census of the current tree counts five. That is itself the
finding — the equivalent suites accrete one per incident, and nothing indexes them.

The structural defect, in one sentence: each suite binds its domain's claims to assertions
internally, but the binding lives only in each file's header comment, so **a new claim has no
forced home and a deleted assertion orphans a documented claim silently**. Concrete
demonstration, today, provable: `scripts/version-consistency.test.mjs` defends the claim stated at
`docs/DEVELOPMENT.md:43` ("`version-consistency.test.mjs` fails if any of the three disagree").
Delete that test file tomorrow and `node scripts/run-tests.mjs` stays green — the runner fails only
on a failed suite or on **zero** suites discovered (`scripts/run-tests.mjs:25`, exit 4), never on
one that silently vanished from 33 to 32. The claim at `docs/DEVELOPMENT.md:43` becomes doc-code
drift with no detector, which is exactly how every incident above started. The same holds for a
doc that states a new claim with no test behind it: nothing reports it until an external audit
does, months later.

One design correction to carry, because the ideation text gets it half wrong: S1
(`docs/ideation-report.md:254-256`) proposes "extract every enforced / blocks / requires /
guarantees sentence from README, DESIGN.md, and references into a machine-readable file" — prose
extraction. **Rejected.** Extracting claims from prose is either regex fragility (the
enumeration-instead-of-structure failure, mode 1) or an LLM opinion layer (the absolute
anti-goal). The ledger data is **hand-maintained**; only the checking is mechanical. See Must NOT
do.

**Paired-probe result, broken direction (provable today):** there is nothing to run. Write a
one-row claim file binding any claim to a marker string, then delete the marker from the target
file — no tool in the tree reports the orphan. The five equivalents above catch a deleted *gate*;
nothing catches a deleted *binding*.

## What fixed means

Stated as observable behaviour, not as a diff. Three new files under `scripts/` — the same home
as the existing repo-level equivalents (`scripts/version-consistency.test.mjs`,
`scripts/smoke-gate.mjs`) — because the registry indexes repo-level and plugin-level suites alike
and belongs to neither domain. Nothing existing is edited.

**1. A hand-maintained ledger data file** — `scripts/claims-ledger.mjs`, exporting
`export const CLAIMS = [...]`. Each row binds one documented claim to the executable assertion
that defends it:

```js
{
  id: "BASH-GATE-REGRESSION",      // unique, SCREAMING-KEBAB; the checker's failure lines name it
  claim: "the Bash write-gate's regression suite fails if the gate is deleted a third time",
  documented_at: "AGENTS.md:43",   // where the claim is STATED (a doc), file:line
  asserted_by: "skills/odyssey/hooks/pre-tool.bash-gate.test.mjs", // where it is PROVEN (code)
  marker: "silently deleted TWICE", // literal string that must occur in asserted_by — the binding
  kind: "suite",                   // "suite" = run by run-tests.mjs · "release-gate" = release cadence
  note: "v0.1.1/v0.2.0 deletions; CHANGELOG.md:824, :947", // optional context
}
```

The `marker` is what makes the binding mechanical: prefer the asserting test's own `test("…")`
name string or a distinctive header literal. Deleting or rewriting the assertion while keeping
the file removes the marker → the row goes red → the row must be consciously re-bound. Markers
must be distinctive multi-word strings, never a token that occurs incidentally.

**2. A checker** — `scripts/check-claims.mjs`, invocable as
`node scripts/check-claims.mjs [--ledger <path>]` (default: the sibling `claims-ledger.mjs`;
`--ledger` is an *input selector* for fixtures, never a suppressor). Exit semantics, satisfying
**fail closed within the ledger's domain, inert when the capability is absent**:

| situation | stdout/stderr | exit |
|---|---|---|
| every row resolves | one OK line per row id + summary | **0** |
| any finding (below) | one line per finding, each naming its row id | **1** |
| no ledger file at the resolved path | `inert: no claims ledger at <path>` | **0** |

Findings — each mechanical, none judgmental: duplicate id · missing/empty required field ·
`asserted_by` is not an executable file (a `.md` `asserted_by` is a **hard finding**: prose is not
an assertion) · `asserted_by` missing on disk · marker string absent from `asserted_by` · unknown
`kind` · `kind: "suite"` but `asserted_by` does not end `.test.mjs` or sits under a `run-tests.mjs`
skip directory (`scripts/run-tests.mjs:36`) — a row bound to a suite nothing runs is a claim bound
to nothing · `documented_at` file missing or line beyond EOF (liveness of the anchor, not its
content — anchor drift within the file is tolerated, a deleted doc is not). `kind:
"release-gate"` rows (smoke-gate) verify file + marker only; their execution cadence is stated in
the row's contract, and the registry's honest scope is coverage, not scheduling (named under
*Known, not fixed*).

**3. Wiring comes free from discovery, and the ledger cannot become the next zero-caller.**
`scripts/check-claims.test.mjs` (node:test, also directly runnable) is a `*.test.mjs` under the
repo root, so `run-tests.mjs` discovers it (`scripts/run-tests.mjs:39-47`) and `npm test`
(`package.json:12`) plus CI (`.github/workflows/ci.yml`) go red the moment any ledger row stops
resolving. No hook, no phase transition, no `set-phase.mjs` change — this is repo-dev tooling,
not run-scoped state; a live orchestration run must never block on it.

**4. The initial row set — nine rows, all verifiable the day this lands:**

| id | binds | asserted_by (kind) |
|---|---|---|
| `BASH-GATE-REGRESSION` | AGENTS.md:43 → the twice-deleted gate's regression suite | `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` (suite) |
| `GATE-SURFACE-INVARIANTS` | the 11 audit-found invariants (DESIGN.md §6, `docs/DESIGN.md:245`; CHANGELOG v0.5.0 — re-anchor at build time) | `skills/odyssey/hooks/pre-tool.gate-surface.test.mjs` (suite) |
| `VERSION-CONSISTENCY` | docs/DEVELOPMENT.md:43 → the three manifests cannot disagree | `scripts/version-consistency.test.mjs` (suite) |
| `SMOKE-GATE-LIVE` | docs/DEVELOPMENT.md:79 → the release gate checks enforcement liveness | `scripts/smoke-gate.mjs` (release-gate) |
| `DEPLOY-SURFACE-COVERAGE` | the drift gate compares everything deployed (CHANGELOG entry for `26af48b` — re-anchor at build time) | `scripts/deploy-surface.test.mjs` (suite) |
| `EDIT-PATH-CONTAINMENT` | prompt 01's claim: post-OKAY, no Edit-family path skips the scope gate | `skills/odyssey/hooks/pre-tool.scope.test.mjs` (suite) |
| `CHECKS-WIRED-AT-TRANSITIONS` | prompt 02's claim: the three checks fire from phase transitions; findings block `done`; absent capability records `inert` | `skills/odyssey/scripts/set-phase.check-wiring.test.mjs` (suite) |
| `NONCE-MINTER-EXACT` | prompt 03's claim: only declared minter types mint the nonce lanes | `skills/odyssey/hooks/pre-tool.gate-surface.test.mjs` (suite — 03's own Files set) |
| `UNGATED-CALLS-RECORDED` | prompt 04's claim: every `ZODYSSEY_UNGATE_BASH=1` call under an active run is recorded | `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` (suite — 04's own Files set) |

Rows 1-5 use **existing header literals as markers** (e.g. `"silently deleted TWICE"`,
`"the v0.4.1 audit found UNTESTED"`, `"documented-but-unenforced invariant"`,
`"is enforcement actually live"`, `"must compare everything the deployer deploys"`) — zero edits to
the five suites. Rows 6-9 take their markers from the landed code of prompts 01-04 (a `test("…")`
name string). Nine rows sits inside `docs/ROADMAP.md:159-161`'s own rot guard ("Deliberately
small — 8–12 load-bearing claims. An exhaustive registry rots"). The dependency on 01-04 is
exactly this table: without the fixes landed, rows 6-9 have no assertion to bind.

**Preferred implementation:** ~100-130 lines of checker (read ledger via `import()`, `readFileSync`
the two anchored files per row, `includes()` the marker), ~90-120 lines of commented data,
~170-200 lines of test. The criteria below are the contract, not the mechanism.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `scripts/claims-ledger.mjs` (new — the hand-maintained data)
- `scripts/check-claims.mjs` (new — the checker)
- `scripts/check-claims.test.mjs` (new — the suite run-tests.mjs discovers)

Nothing else. **No existing file is edited** — the five scattered suites are indexed in place via
their own header literals, not consolidated (consolidating them is a rewrite of five incident
memorials argued nowhere; see Must NOT do). The docs listed under "Docs to update" belong to the
release pass, not the gated run.

## Must NOT do

- **No LLM opinion layer — this is the queue item where the anti-goal bites hardest.** Do not
  parse claims out of prose, by regex or by model; do not auto-generate ledger rows from README,
  DESIGN.md, or any doc; do not add a "claim quality" grader, judge, or reviewer agent. The
  ledger binds claims to *executable assertions*, never to judgments. S1's extraction step
  (`docs/ideation-report.md:254-256`) is explicitly rejected; hand-maintained data, mechanically
  checked.
- Do not merge, rewrite, move, or "clean up" the five scattered equivalent suites. They stay
  where their incidents put them; the registry indexes them. Any consolidation argument is a
  separate change with its own prompt.
- `asserted_by` must never be a `.md` file. A row bound to prose is the third failure mode
  wearing the registry's badge — and the checker must treat it as a finding, not a style note.
- Do not add a flag, env var, comment marker, or condition that suppresses a finding. The only
  legitimate greens are: bind a real assertion, or change the doc so it stops claiming (same
  diff). **No argv flag authenticates anyone.**
- Do not grow the initial ledger past twelve rows or chase exhaustive README/DESIGN §6/SKILL.md
  coverage — `docs/ROADMAP.md:160` is the repo's own warning that exhaustive registries rot.
  Unbound claims are named under *Known, not fixed*, not silently bound.
- Do not touch any hook, `pre-tool.mjs`, `set-phase.mjs`, `run-tests.mjs`, or any run-state
  schema. This change is repo-dev tooling; a live orchestration run must never block on it.
- Ledger absent → recorded `inert`, exit 0 — never a block (the adapted-fork path,
  `docs/ADAPT.md`).
- Zero npm dependencies; Node 18+ built-ins only; synchronous, no daemon; no new env vars.
- Do not batch into a release carrying queue items 01, 03, or 04 (one security change per
  release; this change is not security-class).

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active
- **No argv flag authenticates anyone** — every script is invocable by any agent with the same argv
  surface the operator has. A flag can remove a *silent* path; it cannot grant authority.
- Fail closed. An unverifiable state blocks; it never passes.
- A repo-capability check degrades to a recorded `inert`, never to a block. Over-blocking is a new
  failure of the class the change exists to remove.

(The two rules coexist here without tension: *fail closed* governs rows — an unverifiable row is a
finding; *inert* governs the ledger itself — a repo with no ledger is a missing capability, not a
violation.)

## Acceptance criteria

Every criterion is an exact command from the repo root plus its expected exit code. `record-verify`
executes them and records the codes as evidence; a criterion a human must read and agree with is
not a criterion.

1. `node --check scripts/claims-ledger.mjs && node --check scripts/check-claims.mjs &&
   node --check scripts/check-claims.test.mjs` — expected exit **0**.
2. `node scripts/check-claims.mjs` — expected exit **0**: nine OK lines (one per row id) plus a
   summary; every row of the seed table above resolves against the tree.
3. `node --test scripts/check-claims.test.mjs` — expected exit **0**. The suite must contain and
   pass, at minimum: (a) real-ledger end-to-end → zero findings and **≥ 8 rows** (green over an
   emptied ledger is the `run-tests.mjs` zero-discovered bug one level up — a floor, pinned);
   (b) the five incident ids present (`BASH-GATE-REGRESSION`, `GATE-SURFACE-INVARIANTS`,
   `VERSION-CONSISTENCY`, `SMOKE-GATE-LIVE`, `DEPLOY-SURFACE-COVERAGE` — deletable only by
   failing this suite); (c) a fixture row whose marker is absent from its target → finding naming
   the row id; (d) a fixture row with `asserted_by: "README.md"` → hard finding (prose is not an
   assertion); (e) a fixture `kind: "suite"` row pointing at a non-`.test.mjs` file → finding;
   (f) a fixture duplicate id → finding; (g) a fixture `documented_at` whose file is missing →
   finding; (h) CLI end-to-end against a broken fixture → process exit **1**.
4. `node scripts/check-claims.test.mjs` — expected exit **0** (direct invocation, the
   `version-consistency.test.mjs` convention).
5. `node scripts/run-tests.mjs --filter check-claims` — expected exit **0**, and the runner's
   output names the suite: this is the wiring proof, the anti-zero-caller criterion.
6. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33 suites plus every
   suite added by already-landed queue items (01-04); the count grows by exactly this change's
   one suite; the exit code must not change.
7. `node --test skills/odyssey/scripts/coverage-delta.test.mjs` — expected exit **0**: an indexed
   equivalent, byte-untouched by this change, still green — the registry must never perturb what
   it indexes.
8. Uncovered-claim detection, demonstrated on demand (the deliverable's headline):
   `cp scripts/claims-ledger.mjs /tmp/ledger-probe.mjs && sed -i 's/silently deleted TWICE/silently deleted THRICE/' /tmp/ledger-probe.mjs && node scripts/check-claims.mjs --ledger /tmp/ledger-probe.mjs; ec=$?; rm -f /tmp/ledger-probe.mjs; test $ec -eq 1`
   — expected exit **0** overall: one mutated marker (a claim whose assertion no longer says what
   the row binds) makes the checker exit 1 naming `BASH-GATE-REGRESSION`. Before this change,
   nothing in the tree can produce that report at all.
9. Inert path, demonstrated:
   `node scripts/check-claims.mjs --ledger /tmp/ledger-that-does-not-exist.mjs` — expected exit
   **0** with an `inert:` line (absent ledger is a missing capability, never a block).
10. The paired direction, proof the new assertions actually run against the code without the
    checker (TDD order: demonstrate it BEFORE the implementation is finished):
    `git stash push -- scripts/check-claims.mjs scripts/claims-ledger.mjs && node scripts/check-claims.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
    — expected exit **0** overall: with only the checker and data reverted, the suite exits 1.

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** The ledger is not a deny-list of patterns; it is a
   hand-maintained index, and the one thing it mechanically forbids (prose `asserted_by`) is
   structure, not a name. The rot risk is row bloat, capped by Must NOT do and criterion 3(a).
2. **A check that cannot detect the class of failure it exists for.** Criterion 3(a) is the exact
   guard: an emptied ledger cannot report green. Criterion 8 demonstrates detection on demand;
   criterion 5 proves the checker itself is in the executed set — this change cannot become the
   sixth zero-caller it exists to index.
3. **Ceremony without mechanism.** The change's own subject: today the binding between claim and
   test lives in header comments (ceremony); after, it is data checked by an exit code that
   `npm test` consumes (mechanism).
4. **Self-grading.** The checker grades rows mechanically — file existence, string membership,
   path shape. No author grades their own prose; no model grades anything.
5. **A fix that reopens its own class.** Covered in "The class it closes": the reopening moves
   are prose-binding (a hard finding by design), silent row deletion (pinned ids fail the suite;
   the degradation rule governs the rest), and exhaustive rot (capped).

## Paired probe

**Probe:** an orphaned claim — a ledger row whose binding no longer resolves.

- **Before the fix (current HEAD): nothing reports it.** There is no ledger and no checker; the
  five equivalent suites each catch only their own gate's deletion. Delete
  `scripts/version-consistency.test.mjs` outright: `node scripts/run-tests.mjs` stays green (it
  fails only on zero suites discovered, `scripts/run-tests.mjs:25`), while the claim at
  `docs/DEVELOPMENT.md:43` keeps asserting a check that no longer exists. A doc stating a claim
  with no test is discoverable today only by an external audit — months late, the pattern of
  every incident in "What is broken".
- **After the fix: it is a red row.** The same deletion makes `BASH-GATE`-style orphaning
  impossible for every registered claim: `node scripts/check-claims.mjs` exits **1** naming the
  row id and the broken binding; `npm test` is red the same push (discovery, criterion 5). The
  mutated-marker variant is criterion 8: claim present, assertion rewrote its binding string →
  exit 1.

Both directions, plus controls, required on BOTH builds — a probe that moves a control has
over-blocked:

| Control | Before | After |
|---|---|---|
| The five indexed suites, run individually | exit 0 | exit 0, files byte-identical (zero edits) |
| `node scripts/run-tests.mjs` | 0 (N suites) | 0 (N+1 suites — only the new one added) |
| A repo/fork with no ledger file (inert path) | n/a (no checker exists) | exit 0, one `inert:` line, nothing blocked |
| Any live orchestration run in a target repo | unaffected | unaffected — no hook, no run-state read |
| `--ledger <broken-fixture>` | n/a | exit 1, one line per finding |

## What it breaks

The intended break: **every future change that deletes, renames, or rewrites a bound assertion —
or rewords its binding string — turns CI red until the row is re-bound.** That friction is the
deliverable, and it lands on this repo's own developers immediately: renaming a bound test's
`test("…")` name or moving a suite file orphans its rows. The degradation rule, stated so the red
is triaged, never muted: the ONLY legitimate greens are (a) bind a real executable assertion, or
(b) edit the doc so it no longer makes the claim — row deletion and doc edit in the same diff.
Deleting the row while the doc still claims, commenting it out, or weakening its marker to a
common token reopens the class (a silenced registry is the ideation report's own warned failure,
`docs/ideation-report.md:73-75`); the five incident ids additionally cannot be dropped at all
without failing criterion 3(b). Real costs, plainly: docs authors pay a registration tax (a new
load-bearing claim in README/DESIGN §6/SKILL.md now needs a row — a maintenance rule, not yet a
mechanism; see *Known, not fixed*); and the honest blast radius beyond registered claims is zero
by construction — the checker reads two files per row and touches nothing else.

## The class it closes

**Ceremony without mechanism + self-grading, in their doc-test form** — failure modes 3 and 4.
This repo's history is acceptance criteria as ritual with the executable part skipped: the Bash
gate deleted twice under three passing audits, `--verify` green over an offline enforcement
chain, acceptance criteria unexecuted for months (`docs/implementation-prompt.md:159-163`). In
every case a document claimed a property and nothing mechanically connected the claim to an
assertion. The ledger's whole job is that connection as data, graded by a checker with exit-code
semantics — the assertion side is executable by construction (`asserted_by` must be code), and
the grading is string membership and file existence. **No LLM opinion layer anywhere**: the
checker is deliberately dumber than a reviewer, which is why it is trustworthy — it cannot be
persuaded, and it cannot decline.

How this change could reintroduce the class, and what prevents each move:

- **Rows bound to prose** (a judgment dressed as a row) — prevented structurally: `.md`
  `asserted_by` is a hard finding, asserted by criterion 3(d).
- **Silent row deletion to go green** — the five incident ids are pinned by criterion 3(b);
  non-pinned rows can be deleted in a diff, which is the honest residual (named under *Known, not
  fixed*), guarded by the degradation rule and review, not by code.
- **The registry rots exhaustive** — capped at 12 initial rows, and `docs/ROADMAP.md:160`'s
  rot warning is carried into the ledger data file's own header comment.
- **Green over an emptied ledger** — the zero-discovered failure one level up; prevented by the
  ≥ 8-row floor in criterion 3(a), mirroring `scripts/run-tests.mjs:25`'s own rule.
- **The checker itself becomes a zero-caller** — prevented by criterion 5 (discovery proof) —
  the fate that befell `check-imports.mjs` for three releases cannot recur by construction.

## Docs to update

Every doc that states the claim this change alters ("no registry answers which guarantees are
tested"), each re-anchored against the tree at build time:

- `docs/ROADMAP.md:158-161` — A4 must stop describing the registry as missing: name the three
  files, the nine seed rows, and the command that answers the question.
- `docs/MEASUREMENT.md:74-79` — the "Honest status" block gains the registry as a mechanism line:
  "which documented guarantee has no test?" is answerable by `node scripts/check-claims.mjs`;
  stamp the initial coverage (9 rows, measured at build time).
- `docs/DESIGN.md:245` (§6) — each §6 load-bearing guarantee gains its ledger id where bound;
  §6 rows with neither a binding nor a *Known, not fixed* name are the next doc-code drift in
  the making (bound-or-named rule).
- `skills/odyssey/SKILL.md` — one clause where enforcement behaviour is described: gate-behaviour
  claims are ledger rows; a change that alters gated behaviour re-binds its row. (SKILL.md states
  many of the claims rows 1-9 defend; it gains a pointer, not a rewrite.)
- `skills/odyssey/references/scripts.md` — add the `check-claims.mjs` entry: what it checks, its
  exit semantics (0 clean / 1 findings / inert when absent), that `npm test` runs it via
  discovery, and the maintenance rule (a new load-bearing claim gets a row; red is resolved by
  binding or by changing the doc, never by deleting the row).
- `docs/DEVELOPMENT.md:43-47,79` — the dev-loop and scripts-table entries: the ledger check sits
  beside `version-consistency` and `smoke-gate` as the third repo-level invariant check; a
  release runs all three.
- `CHANGELOG.md` — shape below.

## CHANGELOG entry shape

New version **0.6.0** (minor — an Added feature with no behaviour change to any shipped
mechanism; may share the v0.6 minor with other non-security items, never with 01/03/04).

- **Added — the claim→assertion coverage ledger.** `scripts/claims-ledger.mjs` (hand-maintained
  rows binding documented claims to executable assertions), `scripts/check-claims.mjs` (0 clean /
  1 findings / inert when no ledger exists), `scripts/check-claims.test.mjs` (auto-discovered by
  `run-tests.mjs`, so `npm test` is the wiring). Cites its probe, per this repo's convention:
  before, deleting `scripts/version-consistency.test.mjs` left the suite green and the claim at
  `docs/DEVELOPMENT.md:43` unbacked; after, any broken binding is a named red row. Initial
  coverage: the five scattered equivalents — including `deploy-surface.test.mjs`, counted for
  the first time in this run — plus the claims of queue items 01-04, as nine rows.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - Initial coverage is nine rows only. README's comparison table, DESIGN.md §6 beyond the rows
    bound, and SKILL.md's gate claims are not exhaustively registered — deliberately
    (`docs/ROADMAP.md:160`: an exhaustive registry rots). Growth is by incident.
  - A claim that was never registered remains invisible to the checker — the registry sees its
    own rows. The guard is the docs rule in `references/scripts.md` (new claims get rows), not
    code; that is the residual gap between registry and total coverage.
  - Non-pinned rows can be deleted in a diff without failing anything; only the five incident
    ids are suite-pinned.
  - `kind: "release-gate"` rows verify existence and binding, not execution cadence — nothing in
    CI proves `smoke-gate.mjs` actually ran at release time.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the marketplace cache picks it up — a fix that stays only in the
  repo fires in no run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

Pure code-logic change; the run's method is red-green: load the TDD skill via the Skill tool in
the executor thread, write the failing checker assertions first (criterion 10's demonstration —
the suite must go red with the checker reverted), then make them green. F5 cross-checks the
declaration against hook-witnessed loads, so nothing speculative may be declared: no
`discovered:`/`generic:` (no find-skills call is planned), no `mcp:` declarations (none will be
loaded). If a test fails in a way two fix attempts do not diagnose, loading
`systematic-debugging` is correct — declare it only if actually loaded, after the fact.

## Estimated size

~100-130 lines checker (`scripts/check-claims.mjs`), ~90-120 lines commented data
(`scripts/claims-ledger.mjs`), ~170-200 lines test (`scripts/check-claims.test.mjs`) — roughly
360-450 lines, all new files. **Minor release** (an Added mechanism, no patched defect); it may
ride the v0.6 minor with other non-security items but never shares a release with 01, 03, or 04.
