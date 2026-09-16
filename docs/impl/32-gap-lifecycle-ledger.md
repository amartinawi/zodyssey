# Brief 32 — the gap lifecycle ledger: deterministic finding identity across audit rounds (commissioning)

2026-09-15 · QUEUED — the build brief for the next `/orchestrate` run · target release decided by that run

Commissioned from the open-code-review adaptation study (2026-09-15). The study's third
VIABLE adaptation, transplanted from OCR's session-compare mechanism
(`internal/session/compare.go`): findings need an identity that survives rewording of
coordinates, and comparisons need buckets that never congratulate — OCR's `findingKey`
(path | category | whitespace-collapsed snippet; line numbers deliberately absent so drift
survives) plus `Compare` buckets New / Persisting / Resolved / **NotReviewed** — where a
finding whose file the later run never looked at is NOT resolved, because nobody re-checked
it. ZOdyssey's remediation loop has neither: its only convergence signal is the round
count, and SKILL.md claims convergence it cannot measure. Every fact below was
ground-truthed against the tree 2026-09-15 (post-`eaeb427`, suite 59/59).

## What is broken

1. **The loop's convergence claim is unmeasured.** "The remediation loop converges because
   each round shrinks the gap list — if it doesn't, the 5-round check-in surfaces it"
   (`skills/odyssey/SKILL.md:343-345`). Nothing measures whether the gap list shrinks: the
   history entry stores each round's gaps verbatim
   (`skills/odyssey/scripts/consult.mjs:1562-1575`) and the report carries only
   `consult_rounds` (`skills/odyssey/scripts/run-report.mjs:184`) — a count, blind to
   content. Row 29's evidence made this load-bearing: operator-reported 8-round
   non-convergent loops (`docs/impl/29-remediation-plan-contract.md:6-8`), and every round
   is a FRESH judge — so round N+1's REJECT is indistinguishable between "new information"
   and "the same ground re-raised against a fix that didn't land or didn't address it".
2. **The filter-miss signal is prose, not mechanism.** "a new-round gap matching a prior
   round's `[refuted]` advisory surfaces to the operator" (`SKILL.md:327-328`) — the
   conductor eyeballs the match; no deterministic key exists to match on.
3. **Row 29's verify gate proves the fix, not the judge's agreement.** The pre-audit verify
   gate (`SKILL.md:320-326`) checks each gap's `verify` command exits 0 — mechanical proof
   a fix landed. It cannot see the case where the verify passes but the next fresh judge
   re-raises the same ground (the fix addressed the letter, not the finding). Detecting
   THAT requires finding identity across rounds — which nothing has.

## What fixed means

1. **NEW `skills/odyssey/scripts/lib/gap-ledger.mjs`** — pure, deterministic, zero-LLM:
   - `gapKey(gap)` — `lower(category) + "|" + collapse-whitespace(issue)` (fallback:
     `collapse(fix)` when `issue` is empty; gaps are `{category, severity, issue, fix, …}`
     per `auditor-prompt.md:59-80`, riding `gaps` untouched through normalization —
     `lib/verdict-schema.mjs:98-104`). No line numbers exist on gaps, so the OCR drift
     concern maps to REWORDING: a reworded finding reads as resolved+new — OCR documents
     the same limitation on its own key and accepts it; so do we, stated in the module
     header. Key strings capped at 300 chars.
   - `compareGaps(before, after)` → `{ new, persisting, resolved }` — multiset
     min-matching on `gapKey` (OCR's discipline: min(N,M) persisting, remainder to the
     longer side), every bucket sorted deterministically (path-free: by category, then
     key) so JSON output is diffable run-to-run.
2. **`consult.mjs` — one additive field on every history push.** Before each push, when
   `state.consult.history` already has an entry, compute the delta of this round's KEPT
   gaps (`last_gaps` — post-routing/post-refute, `consult.mjs:1553`) against the previous
   round's kept gaps; store `gap_delta: { round, new, persisting, resolved }` (counts +
   the persisting keys array) on the new entry at both push sites — post-done
   (`consult.mjs:1562-1575`) and the multi-auditor lane (`consult.mjs:797`). First round →
   no field (nothing to compare). Verdict, gaps, exit codes, stdout JSON: untouched.
3. **`run-report.mjs` — the report finally measures the claim.** Additive fields after
   `consult_rounds` (`run-report.mjs:184`): `consult_gap_lifecycle: { last_new,
   last_persisting, last_resolved, max_persisting_streak }` (null when no consult history),
   computed from `state.consult.history` (`run-report.mjs:62-64` already reads it); one
   scorecard line after the verify-origin line (`run-report.mjs:227-229`) rendered only
   when the fields exist (byte-identical output for pre-32 runs, the row-27 additive
   discipline). `max_persisting_streak` is the honest non-convergence signal: a gap
   persisting ≥3 rounds is exactly the operator's 8-round pathology, named per finding.
4. **`open_at_close`, the NotReviewed port.** When a run is terminal with
   `consult.verdict === "REJECT"` and kept gaps, those gaps are OPEN — the report line
   says `open at close: N`, never "resolved" (OCR's anti-self-congratulation property:
   absent is not cleared). The scorecard renders it; no gate reads it.
5. **Cross-run recurrence (advisory, bounded).** `scanRecurredGaps(repoRoot, slug, keys)` in
   gap-ledger.mjs, called by run-report: reads sibling `.zcode/state/*.json`
   (`*.inflight.json` skipped — the mine-corrections idiom,
   `skills/odyssey/references/scripts.md:54`), matches this run's final kept-gap keys
   against prior runs' final kept gaps, returns count + ≤5 prior slugs; emitted as
   `recurred_gaps_from_prior_runs` (0 when none). This is the per-finding twin of item 25's
   class-level recurrence — consumption by `mine-corrections.mjs` stays item 25's
   extension, not this brief's scope.

## Files

- `skills/odyssey/scripts/lib/gap-ledger.mjs` — NEW (gapKey, compareGaps, scanRecurredGaps; pure functions)
- `skills/odyssey/scripts/lib/gap-ledger.test.mjs` — NEW suite (hermetic fixtures: key stability under whitespace collapse, reword→resolved+new documented, multiset min, deterministic ordering, recurrence scan skipping inflight + self)
- `skills/odyssey/scripts/consult.mjs` — the `gap_delta` computation at both history-push sites
- `skills/odyssey/scripts/run-report.mjs` — the four lifecycle fields + scorecard line + recurrence field
- `skills/odyssey/scripts/run-report.version.test.mjs` — append the additive-field shape case (pre-32 state fixture renders byte-identically minus the new fields)
- `skills/odyssey/SKILL.md` — consult box: ONE sentence on the history entry's `gap_delta` (read `|| {}`) + the mechanical filter-miss note (match via recorded keys)
- `skills/odyssey/references/scripts.md` — run-report entry: the new fields; consult entry: `gap_delta`
- `README.md` — one primitives-table row, appended AFTER the last row
- `CHANGELOG.md` — entry (shape below)
- `scripts/anchors.lock.json` — mechanical re-baseline (fixed order)
- `docs/impl/00-INDEX.md` — row 32 outcome fill-in at run close only

## Must NOT do

- **Never inject prior-round gaps into the next auditor's prompt** — round independence is
  load-bearing (`docs/impl/29-remediation-plan-contract.md:113-114`); the ledger reports
  to humans and the operator, never argues to the judge. The post-done prompt
  (`consult.mjs:1286-1320`) gains nothing.
- Never gate on deltas — `gap_delta` and every report field are advisory evidence; no
  exit code, no verdict, no phase transition reads them (the item-19/25 advisory-only
  discipline).
- Zero LLM, zero subprocess, zero network in gap-ledger.mjs (deterministic string
  arithmetic only).
- Backward-compatible state: readers use `|| {}`; old history entries without `gap_delta`
  load unchanged; `compareGaps` handles missing/empty fields without throwing.
- `normalizeConsultVerdict` and `extractRemediationPlan` stay byte-identical
  (`lib/verdict-schema.mjs:88-105`, `:179-186`) — the ledger is downstream of KEPT gaps
  only; routing/refute semantics (`consult.mjs:1508-1547`) are not re-derived, consumed
  as-is.
- The multi-auditor push (`consult.mjs:797`) gets the same one field — nothing else on that
  lane changes; plan-audit (writes `state.plan_audit`, no history) is out of scope.

## Acceptance criteria

- `node --check` on gap-ledger.mjs, consult.mjs, run-report.mjs — exit 0
- `node skills/odyssey/scripts/lib/gap-ledger.test.mjs` — exit 0 (RED first on the
  unimplemented lib; record the RED count in the run notepad)
- `node skills/odyssey/scripts/run-report.version.test.mjs` — exit 0 with the appended case
- `node skills/odyssey/scripts/consult.test.mjs` — exit 0 (untouched or append-only; run
  anyway — same file family)
- `node scripts/run-tests.mjs` — exit 0, suite 59 → 60 (one NEW suite file; pre-existing
  tests byte-identical except declared appends)
- Real-data smoke (read-only, hermetic to emit): `node -e` is gated mid-run — instead a
  notepad-recorded run of `compareGaps` over `.zcode/state/retro-audit-fix-wave-v1.json`'s
  multi-round `consult.history` prints per-round buckets and exits 0 via the new suite's
  fixture copy of that history's gap arrays (copied read-only; no live-state writes)
- `grep -c "gap_delta" skills/odyssey/scripts/consult.mjs` — ≥2 (compute + field)
- `grep -c "consult_gap_lifecycle" skills/odyssey/scripts/run-report.mjs` — ≥2
- `node scripts/check-anchors.mjs` — exit 0 after the fixed-order reconciliation
- `test -z "$(git diff --name-only <run_start_sha>..HEAD | grep -vE '^(skills/odyssey/scripts/lib/gap-ledger\.mjs|skills/odyssey/scripts/lib/gap-ledger\.test\.mjs|skills/odyssey/scripts/consult\.mjs|skills/odyssey/scripts/run-report\.mjs|skills/odyssey/scripts/run-report\.version\.test\.mjs|skills/odyssey/SKILL\.md|skills/odyssey/references/scripts\.md|README\.md|CHANGELOG\.md|scripts/anchors\.lock\.json|docs/impl/00-INDEX\.md)$')"` — exit 0 (scope = exactly the declared Files plus the INDEX close-fill)

## Paired probe

1. RED: on the unmodified tree, `gap-ledger.mjs` does not exist and no history entry
   carries `gap_delta` — the loop provably cannot see gap identity (the lib's absence IS
   the red). GREEN: hermetic fixture — round 1 gaps A,B,C; round 2 gaps A(reworded
   whitespace),C,D → buckets new=1 (D), persisting=2 (A,C), resolved=1 (B); the A match
   proves whitespace collapse; a fully reworded E→F pair reports resolved+new (the
   documented limitation, asserted as expected behavior, not silently passed).
2. Persistence streak: a 4-round fixture where gap C appears in every round →
   `max_persisting_streak: 3` (three transitions), and the run-report scorecard line
   renders `gap lifecycle new/persisting/resolved` + `open at close` when the final verdict
   is REJECT with kept gaps.
3. Recurrence: two sibling fixture state files where run2's final kept gap key equals
   run1's → `recurred_gaps_from_prior_runs: 1` naming run1; the run's own state file and
   `*.inflight.json` are never counted.

## What it breaks

Nothing at runtime for old state (all readers `|| {}`; pre-32 runs render the scorecard
byte-identically minus the new line). The report object gains sibling fields after
`consult_rounds` — additive, no reordering (row 27 precedent). Anchor collateral,
pre-declared as a class: consult.mjs pins at/after the push site (~`:1432`) and the
multi-auditor push (~`:790`) shift; run-report.mjs pins `≥:134` shift; SKILL.md consult-box
pins (`:303-:322` band) shift by the one added sentence. All inside the one mechanical
re-baseline, fixed order. The new suite file bumps the suite count 59 → 60 — every
suite-count citation elsewhere (README/INDEX rows that state 59) is IN SCOPE to update as
declared doc surfaces.

## The class it closes

Measurement without memory, at the audit lane's inner loop. Items 19/25 gave the corpus
cross-run class-level learning; row 29 gave each REJECT a complete executable surface and
a pre-audit proof gate. What none of them capture is the finding ITSELF across rounds —
so a non-convergent loop is visible only as a round count, and "shrinks each round" remains
a claim. The ledger ports OCR's proven primitives (content-keyed finding identity,
multiset compare, the never-congratulate bucket discipline) at zero LLM cost, and turns
the filter-miss rule from prose into recorded keys. NOT closed here: automatic escalation
on persistence streaks (advisory forever — a streak surfacing to the operator is the
5-round check-in's better-informed sibling, not a replacement); miner consumption of keys
(item 25's extension).

## Docs to update

- `skills/odyssey/references/scripts.md` — run-report entry (four lifecycle fields +
  recurrence field, null semantics) + consult entry (`gap_delta` on history entries)
- `README.md` — primitives table row: "Gap lifecycle ledger · lib/gap-ledger.mjs + consult.mjs + run-report.mjs — deterministic finding identity (category + collapsed issue) across audit rounds; new/persisting/resolved + open-at-close + cross-run recurrence on every report; advisory only"
- `CHANGELOG.md` — Added entry
- `docs/impl/00-INDEX.md` — row 32 outcome column at close

## CHANGELOG entry shape

```markdown
### Added
- Gap lifecycle ledger: every consult history entry gains `gap_delta` (new/persisting/
  resolved vs the previous round, computed from a deterministic finding key — category +
  whitespace-collapsed issue), and run-report emits `consult_gap_lifecycle` (including
  max_persisting_streak — the honest non-convergence signal) plus
  `recurred_gaps_from_prior_runs` and `open at close` (kept gaps on a terminal REJECT are
  never counted as resolved). Advisory evidence only: nothing gates on it, and the next
  auditor round still receives nothing from the previous one. Mechanism transplanted from
  alibaba/open-code-review's session-compare (findingKey + New/Persisting/Resolved/
  NotReviewed buckets). Suite 59 → 60.
```

## Anchor-drift reconciliation

Fixed order (the repo's, `docs/impl/29-remediation-plan-contract.md:192`): write docs →
`node scripts/check-anchors.mjs` → fix each shifted citation at the source (verify content,
then repoint) → `node scripts/check-anchors.mjs --update` → suite. Declared exposure:
consult.mjs pins `≥:790` (both push sites) — INDEX C5/C6 + DELEGATE-REVIEW consult pins
move as one class; run-report.mjs `≥:134`; SKILL.md consult-box band (`:303-:322`); README
near the appended row. Pre-declared citing-doc class: `docs/impl/00-INDEX.md`,
`docs/DELEGATE-REVIEW.md` — content-first reconciliation, never a blanket sed of pairs.

## Capability routing

`routed: skill:test-driven-development` — gap-ledger is pure logic; the suite is RED-first
on the unimplemented lib, GREEN with zero edits to pre-existing tests. `routed:
agent:zodyssey:oracle` for phase-3 co-review is warranted here (touches the consult lane's
persistence + the report contract consumed by the trend corpus — one cross-run design
question: whether report fields belong on the trend record; momus + oracle both).

## Estimated size

M — ~120 lines lib + ~100 lines new suite + ~25 lines consult.mjs + ~25 lines
run-report.mjs + 4 doc surfaces + one anchor re-baseline (~a dozen pins, one class). One
run, one release, no migration (additive state), no hook changes.
