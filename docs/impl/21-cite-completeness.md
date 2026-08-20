# 21 — Cite-completeness: every number of a citation is checked, CHANGELOG targets content-pinned (candidate C2)

Build order **21** · depends-on **—** (extends row 15's checker; no blocking edge — this is the
promotion of candidate C2, surfaced 2026-08-18) · queue row: [`docs/impl/00-INDEX.md`](00-INDEX.md)
`21 cite-completeness` · not security-class · patch release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-19 and this file moves fast. Do exactly this one change.

---

## What is broken

`scripts/check-anchors.mjs` verified only the FIRST number of a citation. Its `CITE` regex
(scripts/check-anchors.mjs:88) matched a path plus one number or range; everything after a comma,
slash, or bare colon was invisible, and invisible meant unpinned, unrange-checked, and unswept:

- **Comma pairs and chains.** CHANGELOG `[0.6.8]` documents two live ones: `ROADMAP.md:33` citing
  `harness.mjs:88,62` — where `:62` was the USAGE constant, never the gate the claim named — and
  `ideation-report.md:416` citing `harness.mjs:69-70,19,128-131`. In each, only the first number
  was ever checked; the rest were free to rot.
- **Slash and bare-colon continuations.** In `CHANGELOG.md:709/:853` — the gate-deletion history
  row 04 cites — only the `:653` half was ever seen, and prose continuations ("the verdict gate
  at :1105" after a path-form range) were equally invisible.
- **The half-shift, real.** When a release entry landed, the path-form CHANGELOG pins were
  re-anchored and the continuation halves silently kept their old numbers: 3afd81c (2026-08-18)
  fixed two such pairs by hand — `:631`→`:648` in the queue INDEX and the same pair in impl/08 —
  after the item-04 external audit flagged them. The pins these halves lacked are why a +16-line
  CHANGELOG insertion could pass with nothing noticing.
- **Reversed ranges passed vacuously.** A cite like `:272-258` made `lines.slice(271, 257)` an
  empty array, and an empty span slid through the contentless check — the defect real, the label
  (`contentless`) a lie.
- **CHANGELOG.md was a blind spot twice over.** Not scanned as a citing document (whole-file
  exempt), and its lines unpinned as targets (`NO_PIN_TARGETS`) — so the half-shift class could
  not fail the suite even in principle.

## What fixed means

Discovery is structural, not an enumeration of today's separator shapes. Per line of every scanned
document, the grammar at scripts/check-anchors.mjs:88-100 does three things: it matches a
path-form citation as before (`CITE`), absorbs the contiguous chain of further number elements
hanging off it — each `N` or `N-M`, en dash included, joined by `,` or `/` with an optional
leading colon (`CHAIN_ELEMENT`) — and binds each bare `:N`/`:N-M` token to the nearest preceding
path-form cite on the same line (`BARE_CONTINUATION`); a bare token with no same-line antecedent
is not a citation at all. Every number becomes its own key (`path:N`, `path:N-M`) with its own
range check, contentless check, pin, and drift check. Ambiguity and unresolvable bindings fail;
the grammar never guesses and never crosses a line boundary.

Three consequences, each enforced:

- **Reversed ranges are their own failure.** `a ≤ b` is validated at parse time, before any
  slicing: a reversed pair is problem kind `backwards-range` (scripts/check-anchors.mjs:313-319), and
  the empty-slice vacuous pass is gone.
- **CHANGELOG.md is a full citizen as a target.** No longer in `NO_PIN_TARGETS` — citations INTO
  it are content-pinned like any other target, so a +16-line release insertion fails as drift.
- **It is scanned as a citing document for its TOP SECTION only** — line 1 through just before
  the second `## [version]` heading (scripts/check-anchors.mjs:203-220). Released history below
  that line is never rescanned, never rewritten. This window is an operator-proxy decision,
  recorded as OVERRIDABLE in the checker's header; the fallback re-adds the exemption, and
  content-pinning of CHANGELOG targets stays either way. `EXEMPT_DOCS`
  (scripts/check-anchors.mjs:75-80) now stands empty, kept as that override.

Under-coverage is stated, not hidden: a bare `:N` with no same-line path-form antecedent is not
discovered (12:30, `impl/05:162`, `md:65,63` never match). Under-coverage is accepted where
inventing citations is not.

## Files

- `scripts/check-anchors.mjs` — the grammar, the `backwards-range` kind, the scan window, the
  `EXEMPT_DOCS` emptying, the `NO_PIN_TARGETS` deletion. ~100 lines added, ~30 removed
  (measured 2026-08-19).
- `scripts/check-anchors.test.mjs` — the four probe groups plus no-flood guards, +112 lines,
  purely additive; no new suite file (the suite count stays 44).
- Docs reconciliation, verified at source before the one `--update`: `README.md`'s invariant
  row, `docs/ideation-report.md`, the briefs quoting dialect specimens (15, 18, 08), the queue
  `docs/impl/00-INDEX.md`, `CHANGELOG.md` `[0.6.9]`, and the version triad.

## Must NOT do

- **No separator enumeration.** The mechanism is the contiguous-chain + same-line-binding
  grammar; a hardcoded list of "today's shapes" must never become the mechanism. Documenting
  observed dialects, as this file does, is fine.
- **No discovery across line boundaries.** Same line only. A bare `:N` with no same-line
  path-form antecedent stays invisible rather than guessed.
- **No `--update` before per-cite verification.** `--update` re-pins whatever is there; run on
  unverified citations it is exactly how an 11-line-stale anchor got sealed into item 15's own
  lock. Fixed order: change code → run the checker → verify or fix every citation at source →
  then the single `--update`.
- **No rewriting of released CHANGELOG history.** The only CHANGELOG lines this change writes
  sit above the pre-change second version heading; re-anchoring always edits the citing doc.
- **No new script, flag, or caller.** Enforcement stays `check-anchors.test.mjs` via
  `run-tests.mjs` discovery. No hooks, agents, or commands changes.
- **The fourth class is stated, not solved** — see *The class it closes*. No mechanical pin
  closes it; this change must not claim otherwise.

Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon · graceful no-op when optional tools are absent · every hook is a no-op unless a run is active · the trusted-script allowlist means any agent has the same argv surface the operator does, so no argv flag authenticates anyone.

## Acceptance criteria

Every criterion is an exact command from the repo root plus its expected exit code; `record-verify`
executes them verbatim. The ladder is deliberately red at two intermediate points, each pinned
here as an expected state, not an accident:

1. `node --check scripts/check-anchors.mjs && node --check scripts/check-anchors.test.mjs` —
   expected exit **0**.
2. RED, before any checker edit: `node scripts/check-anchors.test.mjs` — expected exit **1**,
   every ✗ naming a new probe case (`comma-pair`, `backwards-range`, `CHANGELOG shift`,
   `CHANGELOG top section`), zero pre-existing cases failing. RED evidence, captured 2026-08-19:
   exit 1, 43 passed, 11 failed.
3. Checker fixed, lock not yet re-baselined: `node scripts/check-anchors.test.mjs` — expected
   exit **1** with exactly one ✗, the real-tree case (`own citations all resolve`); all four
   probe groups green.
4. Same point: `node scripts/check-anchors.mjs --json` — expected exit **9**, and once the
   citing docs are reconciled every remaining problem is `unlocked` — never drift, ambiguous,
   unresolved, out-of-range, contentless, or backwards.
5. `grep 'backwards-range' scripts/check-anchors.mjs` — expected exit **0**.
6. Lock discipline: `git status --porcelain scripts/anchors.lock.json` stays empty until the
   single final `--update`; `git status --porcelain skills/ agents/ commands/` stays empty
   throughout.
7. After reconciliation and the ONE `--update`: `node scripts/check-anchors.mjs` — expected
   exit **0**; and `grep -q '"CHANGELOG.md:[0-9]' scripts/anchors.lock.json` — expected exit
   **0** (Class 2 proof: CHANGELOG targets are pinned in the lock).
8. `node scripts/run-tests.mjs` — expected exit **0**; suite count **44** (the probes extend
   the existing test file; no new suite file).
9. `test "$(wc -l < docs/impl/00-INDEX.md)" -eq 202` — expected exit **0**: row 21 lands
   line-count-neutral.

## Paired probe

Both directions were demonstrated before the fix landed — hermetic temp-dir fixtures in the same
style as the existing probes; RED captured 2026-08-19 (exit 1, 43 passed / 11 failed, every ✗ a
new case):

| probe | RED — unmodified checker | GREEN — after the change |
|---|---|---|
| **comma-pair**: edit the SECOND number of a `:2,4` pair in place | **exit 0** — the second number is invisible | **exit 9**, `[drift]` naming the second number's key; a chain with a range (`:2,4-5`) locks every element |
| **backwards-range**: cite a reversed pair | exit 9 but labeled **`[contentless]`** — the slice is empty and passes vacuously | **exit 9** as `[backwards-range]`, `[contentless]` absent; a reversed chain element (`:2,6-4`) is refused while its leading element still locks |
| **CHANGELOG shift**: +16 lines inserted at the top of a cited CHANGELOG | **exit 0** — the target was in `NO_PIN_TARGETS` | **exit 9**, `[drift]` — CHANGELOG lines are pinned like any target |
| **CHANGELOG top section**: a top-section cite's target is edited in place | **not checked at all** — CHANGELOG was exempt as a citing doc | **exit 9**, `[drift]`; broken cites in the FROZEN section below the second version heading stay ignored |

No-flood guards held in BOTH states: `12:30`, an orphan `:1105` (no same-line path-form
antecedent), `impl/05:162`, and `md:65,63` contribute zero problems. After the change the suite
read 53 ✓ / 1 ✗ — the one ✗ being the real-tree unlocked citations that the final `--update`
pins: the expected intermediate state, not a regression.

## What it breaks

- **The lock grows by ~105 entries at the single `--update`** (measured 2026-08-19 at the
  intermediate state: 533 keys / 60 documents / 106 problems — 29 formerly skipped CHANGELOG
  targets plus 76 brand-new grammar discoveries; every one verified at source before the
  re-baseline).
- **Editing any cited file now reddens more of the suite** — comma halves and continuations
  that used to be invisible are pinned. Expect a reconciliation step in every doc-touching
  change; that work used to be skipped silently.
- **CHANGELOG's top section is live** — entries above the second version heading must keep
  their own citations true while that section is open; released history below is untouched.
- **Prose stays safe where it always was**: time-like `12:30`, extensionless shorthand, and
  orphan bare colons still match nothing; the grammar binds only tokens with a same-line
  path-form antecedent.

## The class it closes

**"A citation whose second half is invisible."** Item 15 made the first number of every citation
tamper-evident; this makes every number so, and removes the two CHANGELOG blind spots — unpinned
target, unscanned citing document — that let 3afd81c's +17 half-shift ship unnoticed.

One class is explicitly NOT closed: the fourth. A citation resolves, the fingerprint matches, and the claim is false — semantic drift no mechanical pin can see. This change pins what a line
SAYS, not whether it says what the citing claim means; closing that needs a judge, not a hash.
The live instance this run opened on: a queue row cites its gate-deletion evidence at
`CHANGELOG.md:857`, which resolves and will pin happily — and points at installer prose, not the
deletion history, which sits 17 lines lower. Mechanical checks make such lies stable; only
reading closes them.

## Docs to update

- **`docs/impl/00-INDEX.md`** — row 21 lands line-count-neutral (202 lines held); candidate
  C2's paragraph takes its promotion stamp in place.
- **`README.md`** — the invariant-table row drops its "27 into CHANGELOG.md are exempt —
  unstable by format" claim: every citation is content-pinned, with the top-section scan
  window stated.
- **Every CHANGELOG-citing doc** — each `CHANGELOG.md:N` cite repo-wide is re-anchored by the
  measured shift the `[0.6.9]` entry causes (hunk-derived, never from memory), verified at its
  new number before moving on. Version-heading cites (`[0.6.8]`-style) never shift — prefer
  them.
- **`CHANGELOG.md`** — the `[0.6.9]` entry above the current second version heading; the
  claims-ledger row's `documented_at` moves by the same measured shift.

## CHANGELOG entry shape

```markdown
### Fixed — every number of a citation is checked; CHANGELOG targets content-pinned (item 21)

The anchor checker verified only the first number of a citation: its regex required a path
prefix per number, so comma pairs (`harness.mjs:88,62`), slash continuations, and bare-colon
continuations were invisible — unpinned and unswept. CHANGELOG.md lines were not pinned at
all, which is how 3afd81c's +17 half-shift shipped unnoticed: the path-form halves were
re-anchored and the continuation halves silently kept their old numbers.

Discovery is now structural: a contiguous number chain binds to its path-form cite, a bare
`:1105`-style token binds to the nearest preceding path form on the same line, ambiguity
fails, and every number gets its own range, contentless, pin, and drift check. Reversed
ranges are refused as `backwards-range` instead of passing the contentless check vacuously.
CHANGELOG.md is pinned as a target and scanned as a citing document for its TOP SECTION only
(operator-proxy decision, OVERRIDABLE — released history below the second version heading is
never rescanned; the fallback restores the exemption, not the pinning).

Paired probes, RED first: four groups (comma-pair, backwards-range, a +16-line CHANGELOG
shift, the CHANGELOG top section) failed against the unmodified checker — exit 1, 43 passed,
11 failed — and pass after the change. `--update` ran ONCE, after every newly discovered
citation was verified at source.
```

## Capability routing

```
routed: skill:test-driven-development
```

Non-negotiable for code in this repo, and the deliverable is literally a red-then-green probe
sequence: the four defect probes were demonstrated RED against the unmodified checker, exit
codes captured, before the fix landed. Load the skill in the parent thread — F5 cross-checks
the declaration against hook-witnessed loads, and a sub-agent cannot load a skill on the
orchestrator's behalf.

## Estimated size

~100 lines added, ~30 removed in `scripts/check-anchors.mjs`; +112 purely-additive test lines
in `scripts/check-anchors.test.mjs` (suite count stays 44); ~105 new lock entries at the single
`--update`; doc reconciliation across the CHANGELOG-citing docs plus README's row, the queue
row, and the version triad. No runtime surface, no hook, no dependency. **Patch release
0.6.9.**
