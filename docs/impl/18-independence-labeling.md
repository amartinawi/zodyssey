# 18 — Verification-origin labeling (ISNAD R4)

Build order **18** · depends-on **—** · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `18 independence-labeling` · not security-class · minor release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were derived on 2026-08-17 and this repo moves fast. Do exactly this one change.

## What is broken

A run that reached `done` behind an external `/orchestrate-consult` audit and a run that reached
`done` verified only in-session are **indistinguishable in every report the system emits**. The
hierarchy is real — `skills/odyssey/SKILL.md` says the consult auditor "is stronger verification
than any in-session reviewer because the auditor cannot inherit the run's assumptions" — and the
ISNAD-engine study (2026-08-17) named the principle: F1–F5 all read the same plan + notepads, so
they are **one origin**; the external auditor is the only second origin a run can have
(rule R4, tawātur / independence-weighted corroboration). The signal exists on disk
(`state.consult.history`, written by `skills/odyssey/scripts/consult.mjs:1096`; phase `audited`,
set per `skills/odyssey/SKILL.md:283`) but nothing reports it: `run-report.mjs`'s `--json` record —
auto-appended to the trend corpus on every done|audited transition
(`skills/odyssey/scripts/set-phase.mjs:477-504`) — carries `success: true|false` with no statement
of **what verified it**. A corpus consumer reading `success: true` cannot tell an audited run from
an in-session-only one.

**Paired-probe result, broken direction (provable today):** craft two state files identical except
one has a `consult.history` lane; `node skills/odyssey/scripts/run-report.mjs <repo> <slug> --json`
emits byte-identical records for both (modulo timestamps). After the change the two records differ
in `verify_origin`, and `node skills/odyssey/scripts/run-report.test.mjs` fails (exit 1) with the
derivation reverted — demonstrated both directions 2026-08-17.

## What fixed means

Stated as observable behaviour:

1. `run-report.mjs --json` emits two new fields on every record:
   `verify_origin: "external-audit" | "in-session-only"` and `consult_rounds: number | null`.
   Derivation: `external-audit` iff `state.consult.history` is non-empty OR `state.phase ===
   "audited"` (the phase alone is the weaker signal — remediation loops end at `done` with a
   consult lane present, and that run WAS audited). `consult_rounds` = `state.consult.rounds`,
   falling back to `history.length`, else `null`. All reads guarded (`?.`, `|| {}`) — legacy state
   lacking the lane grades `in-session-only` and reports `null`.
2. The text scorecard prints one line: `external audit (N rounds)` or
   `in-session only — never externally audited`.
3. `dashboard.mjs`'s Recent-runs table gains a `verify` column read from the new field; records
   predating the field render `-` (the corpus holds both shapes; tolerance is asserted, not hoped).
4. No gate changes. This is a labeling change: enforcement stays binary, the report stops being
   silent about provenance. Nothing consumes `verify_origin` as a precondition.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/scripts/run-report.mjs`
- `skills/odyssey/scripts/dashboard.mjs`
- `skills/odyssey/scripts/run-report.test.mjs` (new — run-report had **no** test file; the trend
  corpus is written by an untested writer)
- `skills/odyssey/scripts/dashboard.test.mjs`
- `docs/MEASUREMENT.md` (one table row)

Nothing else. `consult.mjs`, `set-phase.mjs`, and the hooks are untouched — the signal already
exists on disk; this change only reads it.

## Must NOT do

- Do not gate on `verify_origin` — no precondition, no refusal, no hook. A label that blocks is a
  new failure surface, and the ROADMAP's non-goals already forbid adding enforcement ceremony to
  reporting (`docs/ROADMAP.md` §3).
- Do not change `consult.mjs`, `set-phase.mjs`, `state.json` shape, or any hook.
- Do not backfill or rewrite existing `results.jsonl` records — legacy records render `-`; history
  stays as written.
- Do not score, weight, or aggregate the field in `dashboard.mjs` beyond rendering the column.
- New state reads must be optional (`?.`, defaults) — old runs keep reporting, graded
  `in-session-only`.
- No npm dependencies; no new env vars; no async.

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

Exposure on arrival: **7 pinned citations** into `run-report.mjs` + 3 into `dashboard.test.mjs`,
reconciled at source during this change (impl/04:98, impl/05:162/:320/:324/:409, impl/06:19/:53,
impl/09:214, `00-INDEX.md:30`, `docs/ideation-report.md:88` — shifted by the inserted derivation
block). Procedure: [`docs/impl/02-wire-zero-caller-checks.md`](02-wire-zero-caller-checks.md)
§Anchor-drift reconciliation; never `--update` before reconciling.

## Acceptance criteria

1. `node --check skills/odyssey/scripts/run-report.mjs` — exit **0**.
2. `node --check skills/odyssey/scripts/dashboard.mjs` — exit **0**.
3. `node skills/odyssey/scripts/run-report.test.mjs` — exit **0** (17/17: args/state exits, both
   grades, the rounds-fallback, text lines, legacy state, no-crash).
4. `node skills/odyssey/scripts/dashboard.test.mjs` — exit **0** (16 checks incl. the verify column
   and legacy `-`).
5. Paired direction:
   `git stash push -- skills/odyssey/scripts/run-report.mjs && node skills/odyssey/scripts/run-report.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — exit **0** overall.
6. `node scripts/run-tests.mjs` — exit **0**, suite count 35 → **36** (run-report.test.mjs is new).

### Failure-mode check (Step 6)

1. **Enumeration instead of structure.** The two grades are closed-world by construction (a boolean
   expression), not a list to drift.
2. **A check that cannot detect its class.** Criterion 5 proves the assertions run against the
   unlabeled build and fail.
3. **Ceremony without mechanism.** The field lands in the corpus via the existing set-phase
   auto-append — no new habit, no conductor instruction.
4. **Self-grading.** All criteria machine-executed; the label derives from consult-lane facts, not
   from any agent's self-report.
5. **A fix that reopens its own class.** The column tolerates legacy records (asserted `-`), so it
   cannot be the reason the corpus gets "cleaned".

## Paired probe

**Probe:** two state files differing only in consult-lane presence.

- **Before: identical reports.** `--json` output byte-identical (modulo `generated_at`).
- **After: the reports differ** in `verify_origin` (`external-audit` vs `in-session-only`) and the
  text scorecards carry the respective origin line.

Unchanged controls, required on BOTH builds:

| Control | Before | After |
|---|---|---|
| Legacy state (no consult, no final lane), `--json` | exit 0 | exit 0, `verify_origin: "in-session-only"` |
| `dashboard.mjs` over the real eval dir | exit 0 | exit 0, legacy rows render `-` |
| `set-phase.mjs` auto-append on done | unchanged | unchanged (it shells run-report verbatim) |

## What it breaks

Nothing at run time. The intended break is presentational honesty: a `success: true` from an
in-session-only run can no longer be mistaken for an audited one by anyone reading the corpus or
the dashboard. Cost: `results.jsonl` records gain two keys (consumers today are
`dashboard.mjs`/`harness.mjs`, both tolerant readers of extra keys — confirmed by the existing
records already differing in shape, first line lacking `tokens`).

## The class it closes

**A provenance fact that exists on disk but is never reported** — the reporting twin of the
"verification layer checks provenance rather than correctness" critique (`docs/ROADMAP.md` §1).
Reopened by: aggregating or averaging the field away, or deleting the column when it is
inconvenient. Prevented by: the test asserting both grades, the fallback, and the legacy `-`.

## Docs to update

- `docs/MEASUREMENT.md:72` — the §2 table row naming the field (done in this change).
- `docs/impl/00-INDEX.md` — DAG row 18.

## CHANGELOG entry shape

Minor release.

- **Added — verification-origin labeling (ISNAD R4).** Every run report and results.jsonl record
  now states whether `success` stands on an external audit (`external-audit`, with consult rounds)
  or in-session verification only (`in-session-only`); dashboard's Recent-runs renders the column,
  legacy records render `-`. Enforcement is untouched — labeling, not gating.
- **Known, not fixed** — the label reflects that a consult happened, not the auditor's diligence;
  and pre-field corpus records are permanently `-`.

## Capability routing

`routed: skill:test-driven-development` — criterion 5's red direction first.

## Estimated size

~20 lines in `run-report.mjs`, ~4 in `dashboard.mjs`, ~150 new test lines, ~10 in
`dashboard.test.mjs`, one table row.
