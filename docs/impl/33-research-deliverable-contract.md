# Brief 33 — the research deliverable contract (commissioning + implementation)

2026-09-16 · QUEUED — implemented same-day hand-landed (this brief is both the commission and the record) · rides `## [Unreleased]`

Commissioned from the hyperresearch adaptation study (2026-09-16, chat-only; the study's
memory file carries the VIABLE/DUPLICATE/REJECTED map). hyperresearch's headline mechanism
transplanted: a research deliverable gets the same contract teeth the plan contract gives
CODE scope — atomic items decomposed from the verbatim ask, an ordered heading contract
("the single highest-leverage field for instruction-following scores", their step-1 skill),
period-pinned figures, and a coverage gate. ZOdyssey's plans bind code precisely (Files,
executable criteria) while research deliverables can drift thematically and pass every gate.
Every code fact below was ground-truthed against the tree 2026-09-16 (post-`63ff76a`, suite
59/59).

## What is broken

1. **No structure contract for research deliverables.** A research-intent run's deliverable
   (report, study, survey) is judged only by the generic rubric — the plan's acceptance
   criteria govern code-shaped checks, and nothing binds the deliverable's STRUCTURE to the
   ask: a thematically-organized answer to a per-entity question passes with every fact
   present and the rubric unmet (hyperresearch's measured widest-variance dimension).
2. **Period-pinned figures are the top silent miss.** Their finding, adopted verbatim as a
   risk: omitting period-pinned asks ("FY 2023", "Q3 2024") is "the #1 cause of 'agent had
   the topic right but missed the rubric's exact figures'" — nothing in ZOdyssey's contract
   surface names them.
3. **The judgment/mechanical split is right for this.** parse-plan cannot know the run's
   KIND (it reads the plan file only; intent lives in state), so a kind-conditional hard
   lint would need new plumbing — the house split instead: MECHANICAL shape validation in
   parse-plan (a vacuous contract is worse than none — same reasoning as the routing-token
   rule at `skills/odyssey/scripts/parse-plan.mjs:70-86`), JUDGMENT in momus (is this
   research-kind? then the contract is mandatory), and the external auditor judges the
   finished deliverable AGAINST the contract.

## What fixed means

1. **A new optional-but-gated plan section: `## Deliverable contract`** — written by
   zodyssey:prometheus when metis classifies the intent KIND as research. Three parts:
   - **Levers** — three typed lines: `register: teach|survey|analyze|advocate` (default
     `analyze`; an explicit user directive always wins), `format: short|structured|argumentative`
     (pairs with register; `short` ≈ ≤2K words no synthesis section, `structured` ≈ 2-5K
     scannable breadth-first, `argumentative` ≈ thesis-driven full synthesis),
     `tier: light|full` (`light` = bounded lookup/comparison; `full` = contested topics,
     synthesis of conflicting evidence; **when uncertain, tier up**).
   - **Headings** — an ordered list of literal H2 headings the deliverable must emit, in
     order. Populated: one per enumerated ask, one per "discuss/analyze/evaluate"-flagged
     entity, or 4-7 derived from sub-questions for narrative asks. Never empty.
   - **Items** — the atomic decomposition: sub-questions, entities (with required fields),
     required formats, **period-pinned time periods** (each with its primary source named),
     scope conditions. Plus a coverage note: every noun-phrase of the verbatim ask maps to
     an item (zero unmapped phrases — the coverage-matrix gate, compressed to a line).
2. **parse-plan `--lint` (shape, not presence):** if a `## Deliverable contract` section
   exists, lint fails (exit 6) when the Headings list is empty/missing or the register line
   is absent/untyped — mirroring the vacuous-routing-token refusal. A plan without the
   section lints unchanged (kind is momus's call, not the parser's).
3. **momus-prompt.md:** a research-kind plan WITHOUT a `## Deliverable contract` is a
   REJECT blocker — "thematic drift is unverifiable" — and a present-but-thin contract
   (headings not derived from the ask's entities/sub-questions) is a blocker too.
4. **auditor-prompt.md (EOF append — zero pin movement above):** when THE PLAN carries a
   Deliverable contract, the audit's plan-compliance pass extends to the deliverable:
   every required heading present and in order, every named entity covered, every
   period-pinned figure exact (or the gap is named).
5. **SKILL.md (one compact subsection after the routing-default block):** the contract
   rule for the conductor/planner + acceptance criteria written as grep-able heading checks
   (`grep -q "^## <Heading>" <deliverable>`).
6. **metis's IF RESEARCH arm gains the decomposition directive** (emit items + levers in
   her Directives for prometheus to transcribe) — see brief 34 for the dispatch-discipline
   half that rides the same agent file.

## Files

- `skills/odyssey/scripts/parse-plan.mjs` — the contract shape lint (additive rule inside `--lint`)
- `skills/odyssey/scripts/parse-plan.test.mjs` — appended cases: vacuous contract → exit 6; untyped register → exit 6; valid contract → clean; absent section → clean (today's behavior, byte-identical)
- `skills/odyssey/references/momus-prompt.md` — the presence blocker for research-kind plans
- `skills/odyssey/references/auditor-prompt.md` — EOF append (judgment extension)
- `skills/odyssey/SKILL.md` — the contract subsection (after the routing-default section)
- `agents/metis.md` — IF RESEARCH: the decomposition + levers directive
- `skills/odyssey/references/capabilities.md` — phase-1/2 detail: one block naming the contract + discipline
- `README.md` — one primitives-table row, appended AFTER the last row
- `CHANGELOG.md` — `## [Unreleased]` Added entry
- `scripts/anchors.lock.json` — mechanical re-baseline (fixed order)
- `docs/impl/00-INDEX.md` — row 33 outcome fill-in at close

## Must NOT do

- No hook changes, no state fields, no new scripts, no new LLM layers — the contract rides
  the existing plan/lint/momus/auditor surfaces only.
- parse-plan does NOT gate on kind-conditional presence (it cannot know kind); absence for
  non-research plans must lint byte-identically to today.
- The section never blocks non-research plans; `## Deliverable contract` on a code plan is
  ignored by lint shape rules only if present-and-malformed it still fails (shape is shape).
- auditor-prompt.md gains its extension as an EOF append — every pin above stays put.
- Zero npm dependencies · Node 18+ built-ins only · no claims-ledger behavior re-bound
  (check-claims must stay green unchanged).

## Acceptance criteria

- `node --check skills/odyssey/scripts/parse-plan.mjs` — exit 0
- `node skills/odyssey/scripts/parse-plan.test.mjs` — exit 0 with the appended cases (RED first: vacuous + untyped cases fail on the unmodified parser)
- `node scripts/run-tests.mjs` — exit 0, suite 59 → 59 (appends only; no new suite file)
- `grep -c "Deliverable contract" skills/odyssey/SKILL.md` — ≥2
- `grep -c "Deliverable contract" skills/odyssey/references/momus-prompt.md` — ≥1
- `grep -c "Deliverable contract" skills/odyssey/references/auditor-prompt.md` — ≥1
- `diff <(git show <run_start_sha>:skills/odyssey/references/auditor-prompt.md | head -181) <(head -181 skills/odyssey/references/auditor-prompt.md)` — empty (EOF append only)
- `node scripts/check-anchors.mjs` — exit 0 after the fixed-order reconciliation
- `node scripts/check-claims.mjs` — exit 0 (no gate-behaviour claim re-bound)

## Paired probe

RED: on the unmodified parser, a fixture plan with a vacuous `## Deliverable contract`
(empty headings) lints CLEAN — the drift class is invisible (record the RED). GREEN: the
same fixture fails exit 6 naming the section; a valid contract (typed register + ordered
headings + items) lints clean; a no-contract plan lints byte-identically to pre-change.

## What it breaks

Nothing for non-research plans (lint path unchanged; absent section = today's behavior).
Research plans gain a mandatory section — momus rejects its absence, which is the point.
Anchor collateral: SKILL.md pins below the inserted subsection (~:63+) shift;
momus-prompt.md pins below its insertion shift; metis.md pins below the IF RESEARCH arm
(~:166+) shift; parse-plan.mjs pins at/after the lint insertion (~:300+) shift. All one
mechanical re-baseline, fixed order. auditor-prompt.md: zero movement above the append.

## The class it closes

Instruction-following for research deliverables — the code lane's scope contract (Files,
executable criteria, F1 set-difference) never had a research twin; thematic drift and
missed period-pinned figures were invisible to every gate. Source: hyperresearch step-1
decomposition (atomic items, heading contract, coverage matrix), compressed to ZOdyssey's
plan-contract shape.

## Docs to update

`README.md` (primitives row), `CHANGELOG.md` ([Unreleased]), `docs/impl/00-INDEX.md` (row 33
outcome at close), this brief stays the commissioning + implementation record.

## CHANGELOG entry shape

```markdown
### Added
- Research deliverable contract: research-kind plans carry a `## Deliverable contract`
  (register/format/tier levers, ordered heading list, atomic items incl. period-pinned
  figures + a coverage note) — parse-plan lints its shape when present (vacuous contract
  fails), momus rejects a research plan without it, and the external auditor judges the
  finished deliverable against it (headings in order, entities covered, period figures
  exact). Transplanted from hyperresearch's prompt-decomposition + heading contract.
```

## Anchor-drift reconciliation

Fixed order (the repo's, `docs/impl/29-remediation-plan-contract.md:192`): write docs →
`node scripts/check-anchors.mjs` → fix each shifted citation at the source (verify content,
then repoint) → `node scripts/check-anchors.mjs --update` → suite. Declared exposure:
SKILL.md ≥ the insert point, momus-prompt.md below its insert, metis.md ≥:166,
parse-plan.mjs ≥:300, README near the appended row.

## Capability routing

`routed: skill:test-driven-development` — the lint cases are written RED-first against the
unmodified parse-plan (record the RED count in the implementation notepad), then GREEN with
zero edits to pre-existing tests.

## Estimated size

M — ~40 lines parse-plan + ~50 test appends + 4 prompt/doc surfaces + one anchor
re-baseline (~a dozen pins). Hand-landed same-day; rides `## [Unreleased]`; external audit
via `/orchestrate-consult` at operator discretion.
