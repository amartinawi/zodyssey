# Brief 29 — on REJECT, the auditor ships the complete remediation surface (commissioning)

2026-09-06 · QUEUED — the build brief for the next `/orchestrate` run · target release decided by that run

Commissioned directly from the consult-round-cost scoping session (no C-candidate round): the
operator reported 8-round non-convergent `/orchestrate-consult` loops in target repos (2026-09-06;
consult state is per-repo, so those runs are outside this tree's measurement), and asked that a
REJECT arrive carrying a detailed remediation plan sufficient to make round 2 green. Every
spawn-site and prompt fact below was ground-truthed against the tree 2026-09-06 (post-`1d96f18`).

## What is broken

The REJECT verdict is tuned for judge precision, but the remediation loop consumes it for
convergence — and each half optimizes against the other. Three mechanisms multiply rounds:

1. **The prompt caps and parks the rejection surface.** The auditor is told to "Keep `gaps` to the
   most important issues (typically ≤5). Don't pad" (`skills/odyssey/references/auditor-prompt.md:85`)
   and to park borderline items as advisories under the approval bias (`:40-42`). On ACCEPT that is
   correct discipline. On REJECT it is a scheduled future round: every re-audit is a FRESH judge —
   the post-done prompt is built from auditor-prompt.md + original task + plan + diff ONLY
   (`skills/odyssey/scripts/consult.mjs:1163-1197`); no `consult.history`, no prior gaps, no
   remediation claims are ever passed — so a ground withheld as an advisory in round N arrives as a
   new REJECT in round N+1. This exact escalation is on record inside this repo's own runs (the
   audit-wave loop needed 5 rounds).
2. **`fix` is a one-liner with no proof.** Each gap's `fix` is one instruction line
   (`auditor-prompt.md:68`); nothing requires a runnable proof that the fix landed. The loop's
   re-verify step — "run any affected acceptance commands" (`commands/orchestrate-consult.md:30`,
   mirrored `skills/odyssey/SKILL.md:303`) — is discretionary and unbound from the auditor's words,
   so an incomplete remediation is discovered only by spending a full external audit round, the most
   expensive possible check.
3. **Nothing plan-shaped survives the round.** `consult.last_gaps`
   (`consult.mjs:1428-1431`, history push `:1432-1444`) is the only remediation surface that
   persists; ordering or collision hazards ("these two gaps touch the same file") are lost, and
   `normalizeConsultVerdict` whitelists its output (`skills/odyssey/scripts/lib/verdict-schema.mjs:98-104`),
   so a new auditor-emitted `remediation_plan` field would survive only buried in `.raw` — never
   surfaced for the loop.

Measured 2026-09-06 from this repo's own `.zcode/state/*.json`: 22 consult-carrying runs, 42
external rounds total (mean ≈ 1.9), 7/22 needed ≥3 rounds — worst are `impl-08-claim-ledger` and
`retro-audit-fix-wave-v1` at 5 each — plus the operator's 8-round report from target repos. The
floor of 1 is structural (the first audit always runs); every round above it that these three
mechanisms cause is the target.

## What fixed means

A REJECT arrives with its complete, executable remediation surface, and the loop cannot re-audit
past a failing proof.

1. **auditor-prompt.md — the REJECT-path contract** (the file's own header names it the lever:
   "Tuning this prompt = tuning the whole gate", `:6`). On REJECT only:
   - the gap list is the **complete rejection surface for this round**: every real ground the
     auditor would reject this diff for, listed now — borderline items that could fail a fresh
     judge go in as `minor` gaps, not advisories, because the next round sees nothing of this one.
     The `:80` cap text is rewritten for the REJECT path ("list every real ground; prefer
     completeness over brevity") while the trivial-nits bar (`:26-38`) and the must-not list
     (`:46-52`) are untouched — exhaustiveness of real grounds, never nit-inflation.
   - each gap gains a required `verify` field: a single-line runnable command (test / grep / build)
     whose exit 0, run from the repo root, proves the fix landed — the plan contract's
     executable-criteria principle (`docs/DESIGN.md:188-204`) extended to the audit lane.
   - a required top-level `remediation_plan`: an ordered array of `{ "gaps": [<indices>], "note": "…" }`
     steps capturing ordering and collision hazards (e.g. two gaps editing `consult.mjs`).
   - The ACCEPT path is byte-identical in behavior: approval bias stays, gaps stay `[]`.
2. **verdict-schema.mjs — append `extractRemediationPlan(raw)`.** A pure, appended export: a valid
   array passes through verbatim; absent/malformed → `[]`; a verdict of ACCEPT → `[]` (a plan on an
   ACCEPT is contradictory — fail to absence, never to a verdict change). Per-gap `verify` strings
   ride inside `gaps`, which already pass through untouched. `normalizeConsultVerdict` itself stays
   byte-identical — the plan rides the `.raw` field it already preserves (`verdict-schema.mjs:103`).
3. **consult.mjs — extract + persist.** Post-done: `consult.last_remediation_plan` beside
   `last_gaps`, and the field on the history entry, inside the existing SEC-M14 lock/merge.
   Multi-auditor: the consensus winner (`consult.mjs:760-789`) carries pass1's extracted plan
   (pass2's if pass1 emitted none — deterministic). Plan-audit lane: `buildPlanAuditPrompt`
   (`:205-308`; its own `fix` field at `:274`, cap rule at `:286`) mirrors the same three contract
   points — same JSON fields, plan-flavored wording; the lane write (`:401-407`) gains
   `remediation_plan`. Stdout JSON shape is unchanged; the plan goes to state only.
4. **The loop — plan-ordered dispatch + pre-audit verify gate** (`commands/orchestrate-consult.md`
   Remediation section + the SKILL.md consult box, `:285-293`). Dispatch follows
   `last_remediation_plan` step order (independent single-gap steps stay parallel-by-default;
   the step notes govern collisions). NEW: before re-running `consult.mjs`, run every gap's
   `verify` command as an ordinary Bash call — any non-zero exit loops back to remediation for
   that gap WITHOUT burning an audit round. A verify that is absent or not a single usable line
   falls back to today's discretionary re-verify (old/foreign auditors degrade gracefully, never
   wedge). The NOT-do list gains: "Do NOT re-audit while a listed verify command still fails."
   `verify` execution never happens inside a script — it is the conductor's Bash lane, under the
   session's permission mode, the same trust class as the auditor's `fix` text flowing into
   executor dispatches today (the auditor's remediation words are already instruction-grade; this
   adds no new spawn surface and no script-side execution of foreign strings).

Verdict independence is untouched: round N+1 still receives nothing from round N; the
`remediation_plan` orders dispatch, it is never shown to the next auditor.

## Files

- `skills/odyssey/references/auditor-prompt.md` — the REJECT-path contract; edits confined to the JSON block (`:59-75`) and below, plus an EOF append, so every pinned region `≤:57` survives byte-identical
- `skills/odyssey/scripts/consult.mjs` — extract + persist (post-done, multi-auditor, plan-audit mirror)
- `skills/odyssey/scripts/lib/verdict-schema.mjs` — appended `extractRemediationPlan` (nothing above it changes)
- `skills/odyssey/scripts/lib/verdict-schema.test.mjs` — extractor cases, appended
- `skills/odyssey/scripts/consult.test.mjs` — persistence cases, appended (suite count unchanged)
- `commands/orchestrate-consult.md` — remediation section: plan-ordered dispatch, pre-audit verify gate, NOT-do line
- `skills/odyssey/SKILL.md` — consult box mirror of the loop change
- `skills/odyssey/references/scripts.md` — consult.mjs entry: `last_remediation_plan` + verify semantics
- `README.md` — one primitives-table row, appended AFTER the last row (`:295`)
- `CHANGELOG.md` — v0.7.4 entry (shape below)
- `scripts/anchors.lock.json` — mechanical re-baseline (fixed order)
- `docs/impl/00-INDEX.md` — row 29 outcome fill-in at run close only (not mid-run)

## Must NOT do

- `normalizeConsultVerdict` stays byte-identical (`verdict-schema.mjs:88-105`) — the gap-#8
  fail-closed ACCEPT semantics are the gate's floor; the plan rides `.raw` via the appended extractor.
- No new process/spawn surface anywhere: scripts never execute `verify` strings (execution is the
  conductor's permissioned Bash lane); consult.mjs gains zero new subprocess calls.
- No cross-round context, ever: round N+1's prompt gains nothing from round N — independence
  (`auditor-prompt.md:12`) is the gate's value and stays whole.
- The judgment-scope and must-not sections (`auditor-prompt.md:26-52`) are untouched — the
  trivial-nits bar and the no-style/no-enhancement rules survive; exhaustiveness ≠ padding.
- No verdict negotiation: the plan is dispatch-ordering DATA, never an argument to the next auditor.
- Backward-compatible state: every `last_remediation_plan` reader uses `|| {}`/`|| []`; runs from
  older plugin versions load unchanged.
- Zero npm dependencies · Node 18+ built-ins only · synchronous · no hook changes, no new phase.

## Acceptance criteria

- `node --check skills/odyssey/scripts/consult.mjs` and `node --check skills/odyssey/scripts/lib/verdict-schema.mjs` — exit 0
- `node skills/odyssey/scripts/lib/verdict-schema.test.mjs` — exit 0, covering at minimum: valid plan → verbatim passthrough; string/object/null/malformed → `[]`; absent → `[]`; ACCEPT with stray plan → `[]` and verdict still ACCEPT; per-gap `verify` strings ride `gaps` untouched
- `node skills/odyssey/scripts/consult.test.mjs` — exit 0, extended with stub-spawn cases: post-done REJECT with verify+plan → `consult.last_remediation_plan` verbatim + history entry carries it; malformed plan → `[]` recorded; multi-auditor consensus → winner carries pass1's plan; plan-audit stub → `state.plan_audit.remediation_plan` recorded
- `node skills/odyssey/scripts/consult.tripwire.test.mjs` — exit 0 (untouched; same file family — run anyway)
- `node scripts/run-tests.mjs` — exit 0, suite 59 → 59 (extensions only; no new suite file; pre-existing tests byte-identical except the two declared appends)
- `grep -c "rejection surface" skills/odyssey/references/auditor-prompt.md` — ≥1
- `grep -c '"verify"' skills/odyssey/references/auditor-prompt.md` — ≥1
- `grep -c "remediation_plan" skills/odyssey/references/auditor-prompt.md` — ≥2
- `grep -q "Do NOT re-audit" commands/orchestrate-consult.md` — exit 0
- `diff <(git show <run_start_sha>:skills/odyssey/references/auditor-prompt.md | head -57) <(head -57 skills/odyssey/references/auditor-prompt.md)` — empty (the pinned region `:1-57` is byte-identical; check-anchors independently content-pins `:12`/`:26-38`/`:40-42`/`:46-52`/`:49`/`:55-57`)
- `node scripts/check-anchors.mjs` — exit 0 after the fixed-order reconciliation
- `test -z "$(git diff --name-only <run_start_sha>..HEAD | grep -vE '^(skills/odyssey/references/auditor-prompt\.md|skills/odyssey/scripts/consult\.mjs|skills/odyssey/scripts/lib/verdict-schema\.mjs|skills/odyssey/scripts/lib/verdict-schema\.test\.mjs|skills/odyssey/scripts/consult\.test\.mjs|commands/orchestrate-consult\.md|skills/odyssey/SKILL\.md|skills/odyssey/references/scripts\.md|README\.md|CHANGELOG\.md|scripts/anchors\.lock\.json|docs/impl/00-INDEX\.md)$')"` — exit 0 (scope = exactly the declared Files plus the INDEX close-fill)

## Paired probe

Hermetic triple-run through the injectable `spawn` (offline, no real CLI), plus one conductor-seat
check — all outputs recorded in the run notepad:

1. Stub REJECT: `gaps:[{category:"bug",severity:"major",issue:"…",fix:"…",verify:"node --check skills/odyssey/scripts/consult.mjs"}]`, `remediation_plan:[{gaps:[0],note:"single-file fix"}]` → assert `consult.last_remediation_plan` equals the verbatim array, the history entry carries it, and the gap's `verify` survives normalization.
2. Same REJECT with `remediation_plan:"fix everything"` (a string) → recorded `[]`; verdict still REJECT; `verify` intact (fail-to-absence, never a verdict change).
3. Stub ACCEPT (empty gaps) with a stray `remediation_plan` → verdict ACCEPT, `last_remediation_plan` `[]`.
4. Conductor seat: with a stubbed failing `verify`, confirm the pre-audit gate loops back to remediation WITHOUT invoking `consult.mjs` — notepad the dispatch/verify sequence proving no audit round was spent.

## What it breaks

Nothing for honest old data: state readers fall back (`|| []`); old or foreign CLIs that omit
`verify`/`remediation_plan` degrade to today's discretionary re-verify; the stdout JSON shape is
unchanged so no CLI consumer breaks. The prompt grows ~12 lines (negligible against the 200KB diff
cap). The anchor surface moves in two declared places: consult.mjs edits (the `:265+` plan-audit
mirror, the `:745+` winner merge, the `:1430+` persist) shift every consult.mjs pin below `:265` —
the INDEX C6 block's pins and `skills/odyssey/scripts/consult.mjs:593-596` (pinned from
`docs/DELEGATE-REVIEW.md:213`) — and the SKILL.md consult-box edit shifts
`skills/odyssey/SKILL.md:364-372` and `:374-378` (pinned from `docs/DELEGATE-REVIEW.md:71`); both
are inside the one mechanical re-baseline below. auditor-prompt.md needs NO re-baseline — placement
keeps every pin `≤:57` intact, and the head-57 diff criterion proves it.

## The class it closes

Verdicts designed for judge precision but consumed by a convergence loop. Every round is a fresh
independent judge, so a withheld ground is a scheduled future round and an unverifiable fix is a
round spent discovering it — the audit lane never had the teeth the plan contract already demands
(record-verify refuses non-executable plan criteria, `docs/DESIGN.md:188-204`; gaps get the same
executable form). The item-25 miner's consult-gap class (iv) consumes gap categories unchanged —
the closed vocabulary `compliance|quality|bug|security` is untouched.

## Docs to update

- `skills/odyssey/references/scripts.md` — consult.mjs entry: `last_remediation_plan`, per-gap `verify`, the pre-audit gate pointer
- `README.md` — primitives table row: "REJECT remediation contract · auditor-prompt.md + consult.mjs — complete rejection surface, per-gap `verify`, ordered `remediation_plan`, pre-audit verify gate"
- `CHANGELOG.md` — v0.7.4 Added entry
- `docs/impl/00-INDEX.md` — row 29 outcome column at close

## CHANGELOG entry shape

```markdown
## [0.7.4] — 2026-XX-XX
### Added
- Consult REJECTs now carry a complete, executable remediation surface: the auditor's gap list is
  the round's complete rejection surface (borderline grounds become minor gaps, not advisories —
  the next round is a fresh judge), every gap carries a runnable `verify` command, and an ordered
  `remediation_plan` persists to `consult.last_remediation_plan` / the plan-audit lane. The
  remediation loop dispatches in plan order and runs a pre-audit verify gate: a failing verify
  loops back to remediation without spending an external audit round. Auditor independence is
  unchanged — round N+1 still receives nothing from round N; verify execution stays in the
  conductor's permissioned Bash lane (scripts never execute auditor strings).
```

## Anchor-drift reconciliation

Fixed order (the repo's, `docs/impl/28-readonly-audit-tripwire.md:90`): write docs →
`node scripts/check-anchors.mjs` → fix each shifted citation at the source (verify content, then
repoint) → `node scripts/check-anchors.mjs --update` → suite. Declared exposure: consult.mjs pins
below `:265` (the 00-INDEX C6 block and DELEGATE-REVIEW:213), SKILL.md pins below `:293`
(DELEGATE-REVIEW:71), README pins near `:291` (append-only after `:295`; verify the pin hash
byte-identical, not the arithmetic). auditor-prompt.md needs NO re-baseline — placement keeps
every pin `≤:57` intact, and the head-57 diff criterion proves it.

## Capability routing

`routed: skill:test-driven-development` — the extractor and persistence cases are written RED-first
against the unmodified consult.mjs/verdict-schema.mjs (record the RED count in the run notepad),
then GREEN with zero edits to pre-existing tests. `routed: agent:zodyssey:oracle` for phase-3
co-review is NOT warranted (single-lane mechanism, no cross-system tradeoff; momus alone) —
declared here so the future plan transcribes exactly this.

## Estimated size

M — ~15 lines of prompt contract, ~45 lines consult.mjs, ~40 lines extractor + test appends, two
loop docs, three doc surfaces, one anchor re-baseline (~a dozen pins). One run, one release
(v0.7.4), no migration, no state-format break, no hook changes.
