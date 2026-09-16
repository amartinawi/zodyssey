# Brief 34 — the research discipline pack (commissioning + implementation)

2026-09-16 · QUEUED — implemented same-day hand-landed (this brief is both the commission and the record) · rides `## [Unreleased]`

Commissioned from the hyperresearch adaptation study (2026-09-16). The prompt-layer trio:
every research dispatch carries the canonical question verbatim, findings land as
evidence-bound claims (verbatim quote + source id + contested-with), and synthesis must
surface tensions explicitly — plus the one-line drift check per research notepad. No
machinery, no gates, no new LLM layers: this is the research-shaped twin of row 20's
span-citation rule (which binds executor notepads and momus blockers to code spans).
Ground-truthed 2026-09-16 (post-`63ff76a`, suite 59/59).

## What is broken

1. **Research dispatches paraphrase the question.** The conductor summarizes the ask into
   dispatch prompts; hyperresearch's invariant ("canonical research query is gospel
   everywhere… verbatim, block-quoted — do not paraphrase, do not summarize") exists
   because paraphrase is where scope drift enters (`agents/metis.md:176-179` recommends
   dispatch PROMPTS the conductor writes; nothing pins them to the verbatim ask).
2. **Librarian/explore findings are prose-shaped.** `agents/librarian.md:89-102` already
   demands claim+permalink+code-block evidence for CODE, but doc-derived claims may
   paraphrase, nothing marks contested findings, and syndication is invisible ("five
   reprints of one press release argue with the weight of one source"). explore
   (`agents/explore.md:36-53`) returns file lists + answers with no span-citation rule.
3. **Synthesis merges silently.** SKILL.md's context-economy rule 3
   (`skills/odyssey/SKILL.md:208-214`) mandates synthesis-as-sub-agent but says nothing
   about CONFLICTS — contradictory findings from parallel workers get averaged or dropped
   with no trace (hyperresearch runs a dedicated contradiction-graph + source-tensions step
   pair for exactly this).

## What fixed means

1. **Dispatch discipline (SKILL.md, dispatch section — one clause):** research dispatches
   (to zodyssey:explore/zodyssey:librarian/oracle) must carry the canonical research
   question VERBATIM, block-quoted, sourced from the task brief — plus the delta (lens,
   scope) the conductor adds around it, never instead of it.
2. **Evidence contract (agents/librarian.md, PHASE 2 extension):** every doc-derived claim
   carries a VERBATIM block-quoted passage from the source (not a paraphrase) beside the
   permalink; a **contested** finding names what it conflicts with
   (`contested: <claim/source>`); syndication awareness — prefer the primary source and
   say so when the "sources" are derivative copies. (Code-claim rules unchanged.)
3. **Span rule for explore (agents/explore.md, Structured Results — one bullet):** every
   answer claim in `<answer>` cites the `path:line` span that witnessed it (the row-20
   twin for read-only research).
4. **Drift check (SKILL.md, notepad contract — one line):** a research todo's notepad
   ENDS with one line — `Answers the question: yes|partial|no — <one-line why>` — the
   conductor's cheap drift probe before synthesis.
5. **Tension surfacing (SKILL.md, context-economy rule 3 extension):** research synthesis
   sub-agents must emit an explicit **Tensions** section — claim vs claim, the sources on
   each side, which the deliverable adopts and WHY — contested pairs are never silently
   merged; workers are asked (dispatch clause) to flag conflicts with prior notepads.
6. **metis's IF RESEARCH arm** gains the corresponding recommendations: dispatch prompts
   carry the verbatim question; workers flag conflicts; synthesis emits Tensions (the
   decomposition + levers half rides brief 33 in the same file).

## Files

- `skills/odyssey/SKILL.md` — dispatch clause + notepad drift-check line + synthesis Tensions extension (3 small inserts)
- `agents/librarian.md` — PHASE 2 evidence contract extension
- `agents/explore.md` — Structured Results span bullet
- `agents/metis.md` — IF RESEARCH dispatch/synthesis recommendations (shared edit with brief 33's decomposition directive)
- `skills/odyssey/references/capabilities.md` — the phase-1/2 research block names the discipline (shared edit with brief 33)
- `README.md` — one primitives-table row, appended AFTER the last row
- `CHANGELOG.md` — `## [Unreleased]` Added entry
- `scripts/anchors.lock.json` — mechanical re-baseline (fixed order)
- `docs/impl/00-INDEX.md` — row 34 outcome fill-in at close

## Must NOT do

- No hooks, no scripts, no state, no new agents — prompt-layer only.
- No new mandatory output FORMAT for librarian/explore that breaks their existing response
  contracts (`<results>`/`<analysis>` blocks unchanged — additions are inside them).
- The verbatim-question rule binds the CONDUCTOR's dispatch prompts; sub-agents cannot be
  mechanically forced to comply (documented honestly — the auditor/verify lanes check the
  downstream effects: quotes present, Tensions section present, drift line present).
- Notepad drift check is a CONTRACT line (checked like other notepad content by the final
  wave / auditor), not a hook-enforced format — notepads stay append-only, unparseable by
  design.
- Zero npm dependencies · no test-suite changes (no code) · suite stays 59/59.

## Acceptance criteria

- `grep -c "verbatim" skills/odyssey/SKILL.md` — ≥2 (dispatch clause + drift context)
- `grep -c "Tensions" skills/odyssey/SKILL.md` — ≥1
- `grep -c "Answers the question" skills/odyssey/SKILL.md` — ≥1
- `grep -c "contested" agents/librarian.md` — ≥1
- `grep -c "syndicat" agents/librarian.md` — ≥1
- `grep -c "path:line" agents/explore.md` — ≥1
- `grep -c "verbatim" agents/metis.md` — ≥1
- `node scripts/run-tests.mjs` — exit 0, suite 59 → 59 (no code touched)
- `node scripts/check-anchors.mjs` — exit 0 after the fixed-order reconciliation

## Paired probe

No code → the probe is documentary: on the unmodified tree every grep above returns 0
(the discipline is absent — that IS the red). GREEN: all greps ≥ thresholds; a read of the
three agent files shows the additions sit INSIDE the existing phase/section structures
(librarian PHASE 2, explore Structured Results, metis IF RESEARCH) without displacing any
existing rule.

## What it breaks

Nothing mechanically (prompts only). Behavioral note: research dispatches get slightly
longer (the block-quoted question); librarian/explore answers get more structured — both
intended. Anchor collateral: SKILL.md pins below the three inserts shift; librarian.md,
explore.md, metis.md pins below their insert points shift (metis.md:110 and the
DELEGATE-REVIEW:189 pins move as one class with brief 33's edit). One re-baseline, fixed
order, shared with brief 33's landing.

## The class it closes

Evidence-binding and drift-visibility for the research lane — row 20 bound executor
notepads/momus blockers to code spans; nothing bound research dispatches to the verbatim
ask, findings to verbatim sources, or synthesis to explicit tension resolution. Source:
hyperresearch's canonical-query invariant, evidence digest ("an index, not a narrative"),
and contradiction-graph/source-tensions steps, compressed to prompt contracts.

## Docs to update

`README.md` (primitives row), `CHANGELOG.md` ([Unreleased]), `docs/impl/00-INDEX.md` (row 34
outcome at close).

## CHANGELOG entry shape

```markdown
### Added
- Research discipline pack: research dispatches carry the canonical question verbatim
  (block-quoted, from the task brief); librarian findings carry verbatim quoted passages +
  permalinks with contested/syndication markers; explore answers cite path:line spans;
  research notepads end with a one-line drift check; and research synthesis must emit a
  Tensions section (claim vs claim, sources, adopted resolution + why). Prompt-layer only.
```

## Anchor-drift reconciliation

Fixed order, shared with brief 33's landing (one `--update` pass after both): write docs →
`check-anchors` → fix at source → `--update` → suite. Declared exposure: SKILL.md (3
insert bands), librarian.md PHASE 2+, explore.md results block+, metis.md IF RESEARCH+,
README near the appended row.

## Capability routing

`generic: prompt-and-docs-only commissioning + implementation — no code surface, no test
surface; TDD does not apply` — declared here so any future plan transcription is honest.

## Estimated size

S/M — ~60 lines across 4 prompt files + 2 doc surfaces + the shared re-baseline.
Hand-landed same-day with brief 33; rides `## [Unreleased]`.
