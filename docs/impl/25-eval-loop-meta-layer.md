# Brief 25 — the eval-loop meta-layer: the corpus learns, staging-only (commissioning)

2026-08-21 · QUEUED — the build brief for the next `/orchestrate` run · target release decided by that run

## What is broken

The loop measures and never learns. `judge.mjs` scores every criterion; `run-report.mjs` appends
a scored record per run (`verify_origin`, `consult_rounds`, review rounds, wall clock, ungated
calls); `results.jsonl` holds hundreds of run outcomes and `judged.jsonl` the per-criterion
verdicts — and nothing feeds back ACROSS runs. `recall-corrections.mjs:32` names the missing
organ itself, as deliberate FUTURE WORK: *"a future pass could mine judged.jsonl / results.jsonl
for RECURRING failure patterns and PROPOSE staged, human-approved updates to agent prompts,
capabilities.md, and SKILL.md… recall-corrections is the capture half, not the edit half."* The
task-observer study called it the biggest adaptation gap; the ISNAD adaptation map kept it
(notes: "the fix is a cross-run meta-layer, not a Phase 7") while dropping chain-scoring,
corroboration, R6/R7 as duplicates or rigor-down. Today the only cross-run learning channel is
the operator's memory files — hand-curated, unversioned, invisible to the pipeline.

## What fixed means

1. A deterministic miner (Zero-LLM — pattern counting, no model calls) over the two corpora:
   recurring failure CLASSES, not singleton noise — a pattern qualifies only at recurrence
   (≥ N runs, N ≥ 3, configurable) within a class taxonomy fixed at: (i) criterion-shape
   failures (the same executable-command shape family failing verification across runs — e.g.
   count-greps, suite-runs, byte-exact copies); (ii) reject-blocker classes (momus blocker
   text clustered by section-name); (iii) verify-fail/supersede cycles per todo wave position;
   (iv) consult-gap categories from `state.consult.history`.
2. Output is a STAGED PROPOSAL, never a live edit: `mine-corrections.mjs <repo> [--corpora dir]`
   writes `.zcode/staging/proposals/<date>-<pattern-id>.md` — the pattern, its evidence (runs,
   slugs, verbatim failing criteria), and a PROPOSED edit (agent prompt line / capabilities.md
   row / SKILL.md clause) with the affected file named. It never writes outside staging.
3. Human-approved application only: applying a proposal is a separate deliberate action (the
   next run's plan, or the operator) — the task-observer staging-only model the comment
   prescribes. The miner's proposal cites its evidence so the approver can audit the induction.
4. Wiring the loop: `metis`'s consult dispatch (phase 1) gains one pointer — unread proposals in
   staging are listed as risk-input alongside recall-outcomes/recall-corrections, so unapplied
   patterns still inform the premortem. No new gates, no new LLM layers.

## Files

- `skills/odyssey/scripts/mine-corrections.mjs` — NEW, the deterministic miner (staging-only writer).
- `skills/odyssey/scripts/mine-corrections.test.mjs` — NEW suite: recurrence threshold honored,
  singleton noise excluded, taxonomy classes detected from fixture corpora, staging-only writes
  asserted (any attempt to write outside `.zcode/staging/` fails the suite).
- `skills/odyssey/references/scripts.md` — the new script's contract row.
- `skills/odyssey/SKILL.md` — the phase-1 consult list gains the proposal pointer (one line).
- `docs/impl/25-eval-loop-meta-layer.md` — this brief. `docs/impl/00-INDEX.md` — row 25 stamp.
- The corpora are READ-ONLY inputs: `~/.zcode/orchestration/eval/results.jsonl`,
  `judged.jsonl` — never written by the miner; tests use hermetic fixture corpora, never the
  real operator lane.

## Must NOT do

Auto-apply any proposal; write outside `.zcode/staging/`; call any LLM from the miner; mine the
synthetic lane (`results.synthetic.jsonl`) as if it were operator evidence; add a gate that
blocks runs on patterns (advisory forever); touch `recall-corrections.mjs` beyond keeping its
FUTURE-WORK comment accurate (the edit half now exists, the comment should say so); adapt the
ISNAD drops (chain-scoring, corroboration, R6/R7 — named rejected).

Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon · graceful no-op when optional tools are absent · every hook is a no-op unless a run is active · the trusted-script allowlist means any agent has the same argv surface the operator does, so no argv flag authenticates anyone.

Anti-goal: no more LLM opinion layers. Fail closed.

## Acceptance criteria

(To be finalized by the run's plan; shape:) `node --check` on both new files; the suite green
on hermetic fixture corpora (RED first on the unimplemented miner); a proposal file produced
from a fixture corpus with ≥3-recurrence and NOT produced from a 2-recurrence fixture; the
staging-only write guard; suite count 54 → 55; `mine-corrections.mjs` exits 0 with an empty/
absent corpus (graceful no-op); the SKILL.md pointer present; the real operator corpus untouched
(read-only proof).

## Paired probe

RED: on the unimplemented tree, no miner exists and the metis dispatch carries no proposal
pointer — the loop provably cannot learn (the miner's absence IS the red). GREEN: a fixture
corpus with three runs sharing one failing criterion-shape yields exactly one proposal with
evidence; a two-recurrence fixture yields none; the real corpus is byte-identical after the run.

## What it breaks

Nothing at runtime (new script + one SKILL.md pointer). The operator gains a new staging
artifact class to review; ignored proposals accumulate (bounded: metis lists only unapplied,
and the proposal files are dated/idempotent per pattern-id — re-mining the same corpus
overwrites, not appends).

## The class it closes

Failure mode 4's complement: the system grades itself (judge, run-report, trust registry) but
the grades never change behavior — measurement without memory. This is the adaptation study's
headline gap, closed at the only layer that respects the anti-goal: deterministic pattern
detection + staged human-approved proposals, not another opinion layer. NOT closed here:
signal-3 user-correction capture (recall-corrections.mjs's exclusion (b) — no capture channel
exists; still out of scope); the applied-proposal effectiveness measurement (does the pattern
stop recurring? — a natural follow-up once proposals exist to measure).

## Docs to update

`references/scripts.md` (contract row), `SKILL.md` (phase-1 pointer), `00-INDEX.md` (row 25),
CHANGELOG entry by the implementing run, this brief stays the commissioning record.

## CHANGELOG entry shape

```
### Added — the eval-loop meta-layer: the corpus learns, staging-only (item 25)

mine-corrections.mjs mines the run corpora for RECURRING failure patterns (criterion-shape
families, reject-blocker classes, verify-fail cycles, consult-gap categories; recurrence ≥ 3
runs) and writes STAGED PROPOSALS under .zcode/staging/proposals/ — deterministic pattern
counting, zero LLM calls, never a live edit. Metis's consult dispatch now lists unapplied
proposals as risk-input. Applying a proposal stays a separate human-approved action, exactly
the staging-only model recall-corrections.mjs:32 prescribed for its edit half. Suite 54 → 55.
```

## Capability routing

`routed: skill:test-driven-development` (the miner is logic: red-first on hermetic fixture
corpora) + `routed: agent:zodyssey:oracle` at plan review (cross-run design, the skill's
architecture-intent row).

## Estimated size

M — one new script (~200 lines) + one suite + three doc touches. The risk is not size but
taxonomy stability: the four classes are fixed at commissioning; growing the taxonomy is a
separate item, not this one.
