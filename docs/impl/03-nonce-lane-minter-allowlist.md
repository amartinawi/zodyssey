# 03 — Allowlist the nonce-lane minters

Build order **03** · depends-on **—** (no build edge; sequenced after 01's release only by the
one-security-change-per-release cadence, `CHANGELOG.md:27` — grouped adjacently with 01/04 because
all three touch `skills/odyssey/hooks/pre-tool.mjs`, explicitly NOT merged with either) · queue
row: [`docs/impl/00-INDEX.md`](00-INDEX.md) `03 nonce-lane-minter-allowlist` · security-class ·
patch · shipped alone.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast. Do exactly this one change.

## What is broken (pre-fix — closed by this item, 2026-08-17)

The review nonce — the one-time credential that makes an OKAY verdict non-forgeable
(`skills/odyssey/SKILL.md:379`: "the nonce only exists after a real `Task(zodyssey:momus)` call the
hook witnessed") — is minted for **any dispatch whose agent name merely ends in `momus`**, not just
for `zodyssey:momus`. The lane decides identity with a routing-grade matcher:

- `skills/odyssey/hooks/pre-tool.mjs:1268` — `const isAgent = (want) => sameName(want, subagent);`
- `sameName` lives at `skills/odyssey/scripts/lib/capability-name.mjs:72-78`, and its deciding line
  `:77` reads `return lastSegment(na) === lastSegment(nb);       // bare <-> namespaced`. Final
  segment only: `evil:momus`, `someplugin:momus`, `feature-dev:momus` all compare equal to `momus`.
- The mint site consumed that matcher (pre-fix): `if (isAgent("momus")) {` →
  `mintNonceFor("review")`, which writes `state.review.pending_nonce` (the function at
  `skills/odyssey/hooks/pre-tool.mjs:1380-1409`, the write at `:1402`, the operator-visible stderr
  line at `:1407`). Post-fix the site is `if (isDeclaredMinter("review")) {` at `:1497`, minting
  at `:1503`. The namespacing extractor does not save it: `:1252-1253` strips only a leading
  `zodyssey:` prefix (`_rawSubagent.replace(/^zodyssey:/, "")`), so `zodyssey:momus` normalizes to
  the exact string `momus` — but `evil:momus` survived intact and then passed `sameName` anyway.

The same tolerant `isAgent` guarded the two sibling minters in the same block:
`skills/odyssey/hooks/pre-tool.mjs:1507` (was `isAgent("code-reviewer")` →
`mintNonceFor("final_f2")` at `:1513`) and `:1517` (was `isAgent("oracle")` →
`mintNonceFor("final_f4")` at `:1523`). An `evil:code-reviewer` or `evil:oracle` dispatch minted a
real F2/F4 nonce (pre-fix), exactly as `evil:momus` minted a review nonce.

**Proof by code reading that it was real, not hypothetical:** the repo's own regression suite
asserted the hole as *intended* behavior — pre-fix, the Class C block (now the lookalike loop at
`skills/odyssey/hooks/pre-tool.gate-surface.test.mjs:270-274`) looped
`["momus", "zodyssey:momus", "feature-dev:momus", "someplugin:momus"]` and checked each
`\`${agent}\` is dispatchable AND mints a review nonce` (`r.code === 0 && r.pending`). The suite
was green (33/33, 2026-08-16) with the tolerance enforced as a feature — the self-grading this
item flips. There is also an in-repo prior
that already named this exact shape as a bug: v0.5.1, audit-3 finding 7
(`CHANGELOG.md:64-66` and the comment at `skills/odyssey/hooks/pre-tool.mjs:1434-1441`) —
"`evil:momus` skipped the cap and the pre-dispatch lint, then minted a review nonce" — fixed the
round-cap twin (now `if (isDeclaredMinter("review"))` at `:1442`) by making **both** sites
tolerant, so the lookalike was capped but still minted.

**And the license for the hole was a false comment.** `skills/odyssey/scripts/lib/capability-name.mjs:17-18`
asserted: "F5 is a routing check, not a security boundary — the security gates are the nonce chain
and the scope gate." That was false in code for this lane: the nonce chain *itself* consumed
`sameName` via `isAgent` at `skills/odyssey/hooks/pre-tool.mjs:1268` (imported at `:32`). The
tolerance is fine for F5 routing; it is authority-bearing here. Correcting the header is part of
this change, not documentation polish — it is the sentence the next contributor will read before
reaching for `sameName` in an authority check.

Threat shape (stated precisely, not maximally): any agent that can issue a Task dispatch — or any
process that can pipe a Task payload into the hook, which is the same surface the harness uses —
gets a *hook-witnessed, genuine* review nonce for a `*:momus` dispatch. The credential chain then
treats whatever artifact follows as reviewed. The nonce lane is authority-bearing; segment
tolerance is a routing convenience. The one must not consume the other.

## What fixed means

Stated as observable behaviour, not as a diff:

1. In an active run, any phase: a Task dispatch with `subagent_type` exactly `zodyssey:momus`
   (or the bare `momus` form) exits **0** and writes `state.review.pending_nonce` with the stderr
   nonce line — unchanged from today.
2. A Task dispatch whose type's final segment is `momus` but which is not the declared minter
   (`evil:momus`, `someplugin:momus`, `feature-dev:momus`, …) exits **0** — the dispatch itself
   stays allowed, because read-only routing tolerance at the phase gate
   (`skills/odyssey/hooks/pre-tool.mjs:1295`, `inSet`) deliberately grants no authority — but
   mints **nothing**: no `pending_nonce` write, no nonce stderr line, and instead a one-line
   stderr warning naming the dispatch type and stating that only the declared minter type mints
   this lane. The artifact path from such a dispatch is unrecordable: `record-momus-artifact.mjs`
   without a matching nonce fails exactly as a forged one would. Refusing the *credential*, not
   the *dispatch*, is the correct posture — over-blocking dispatches would be a new failure of the
   class this change exists to remove.
3. The same exactness holds at the sibling lanes: `final_f2` mints only for the declared
   code-reviewer packagings (`code-reviewer`, `feature-dev:code-reviewer`); `final_f4` mints only
   for `oracle` / `zodyssey:oracle`. Any other `*:code-reviewer` / `*:oracle` warns and mints
   nothing.
4. The round-cap + pre-dispatch-lint site at `skills/odyssey/hooks/pre-tool.mjs:1442` agrees with
   the minter on what counts as `momus` (the rule v0.5.1's audit-3 finding 7 stated at
   `:1438-1439`: "the two sites must agree … or the guard is decorative"). A lookalike is neither
   capped, nor linted, nor minted — it is simply not the reviewer, and every write it attempts
   still passes through the same scope and verdict gates as before.
5. `skills/odyssey/scripts/lib/capability-name.mjs:15-18` no longer asserts the false exemption;
   the header states that `sameName` is routing-only and that any authority-bearing consumer must
   compare exact dispatch types at its own site.
6. Everything else is byte-identical: the phase-gate tolerance (`:1295`) is untouched; F5
   capability matching in `record-final-wave.mjs` is untouched (final-segment equivalence there is
   load-bearing — see Must NOT do); with no active run the hook remains a no-op exit 0.

**Preferred implementation (~15 lines):** compare the post-extractor `subagent` string against a
lane-local allowlist of exact minter types at the mint sites. The extractor at `:1252-1253`
already normalizes `zodyssey:x` → `x`, so an exact compare against `"momus"` covers both canonical
forms with zero tolerance; `feature-dev:code-reviewer` stays its own exact entry for F2. Add the
near-miss warning branch (`sameName` matches but the exact allowlist does not → stderr, no mint).
The criteria below are the contract, not the mechanism.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/hooks/pre-tool.mjs`
- `skills/odyssey/scripts/lib/capability-name.mjs`
- `skills/odyssey/hooks/pre-tool.gate-surface.test.mjs`

Nothing else. The docs listed under "Docs to update" belong to the release pass, not the gated
run: a post-OKAY executor cannot edit files outside this declared set (the scope gate enforces
exactly that). Do not widen the set by default.

## Must NOT do

- Do **not** tighten `sameName` / `lastSegment` in `skills/odyssey/scripts/lib/capability-name.mjs`.
  The loose match is deliberately load-bearing for F5 skill routing:
  `skills/odyssey/scripts/record-final-wave.mjs:539-544` records that a declared
  `skill:test-driven-development` never matched the observed
  `skill:superpowers:test-driven-development` — "34 of the installed skills are plugin-namespaced —
  this is the live F5 failure" — and final-segment matching is what fixed it. The only edit to
  that file is the header comment (lines 15-18). The allowlist fix belongs at the LANE, not in the
  shared matcher.
- Do not touch the artifact/record chain: `record-momus-artifact.mjs`, `record-review.mjs`,
  `record-final-wave.mjs`, `record-final-artifact.mjs` stay byte-identical. Nonce consumption is
  already correct; only minting identity is wrong.
- Do not tighten the read-only phase gate (`READONLY_AGENTS` / `inSet` at
  `skills/odyssey/hooks/pre-tool.mjs:1275-1295`). Its own comment (`:1281-1284`) is right: widening
  who counts as read-only "grants no write capability". Tightening it would block third-party
  read-only dispatches — over-blocking, a new failure of this change's own class.
- Do not modify any existing `SEC-*` member — security checks in this file are append-only; new
  checks are additive siblings.
- Do not batch this into 01's or 04's release in the CHANGELOG shape — one security change per
  release (`CHANGELOG.md:27`: a structural gate change "wants its own release and its own paired
  run").
- Do not add a reviewer, judge, or verifier agent. **No LLM opinion layer** — the warning is a
  deterministic stderr line, and every verification in this change is an exit code or a state-file
  read.

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active
- **No argv flag authenticates anyone** — every script is invocable by any agent with the same
  argv surface the operator has. A flag can remove a *silent* path; it cannot grant authority.
- Fail closed. An unverifiable state blocks; it never passes.
- A repo-capability check degrades to a recorded `inert`, never to a block. Over-blocking is a new
  failure of the class the change exists to remove.

### Anchor-drift reconciliation (amendment, 2026-08-16)

`scripts/check-anchors.test.mjs` landed after this prompt was written and runs inside
`node scripts/run-tests.mjs`. It content-pins every `file:line` citation in the repo's docs, so
**editing a cited file makes the suite go red until the citations are reconciled.** That is the
check working, not a defect in your change.

**This change's exposure: 63 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/hooks/pre-tool.mjs` (51), `skills/odyssey/hooks/pre-tool.gate-surface.test.mjs` (7), `skills/odyssey/scripts/lib/capability-name.mjs` (5).

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

1. `node --check skills/odyssey/hooks/pre-tool.mjs` — expected exit **0**.
2. `node --check skills/odyssey/scripts/lib/capability-name.mjs` — expected exit **0**.
3. `node skills/odyssey/hooks/pre-tool.gate-surface.test.mjs` — expected exit **0** (the suite
   prints `N passed, 0 failed`; the flipped and new cases from this change are included in N).
4. `node --test skills/odyssey/hooks/pre-tool.gate-surface.test.mjs` — expected exit **0**.
5. `node skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` — expected exit **0**. Mandatory after
   ANY `pre-tool.mjs` edit: this is the suite that exists to catch a third silent deletion of the
   Bash gate.
6. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16. The count may legitimately grow; the exit code must not change.
7. The paired direction — proof the flipped assertions actually run against the broken code. In
   TDD order you demonstrate this BEFORE writing the fix (flip the two lookalike assertions in the
   Class C block at `skills/odyssey/hooks/pre-tool.gate-surface.test.mjs:270-274`, watch the suite
   go red), and it stays re-provable on demand:
   `git stash push -- skills/odyssey/hooks/pre-tool.mjs && node skills/odyssey/hooks/pre-tool.gate-surface.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only the hook reverted, the lookalike cases fail (old hook
   mints, `r.pending` true, the new no-mint assertion ✗) and the suite exits 1.
8. Live probe, refused direction — the hook is invoked directly with a synthetic Task payload,
   which is exactly how the harness feeds it (no agent actually runs):
   `test "$(printf '%s' '{"tool_name":"Task","tool_input":{"subagent_type":"someplugin:momus","prompt":"p"}}' | node skills/odyssey/hooks/pre-tool.mjs 2>&1 | grep -c 'pending_nonce')" -eq 0`
   — expected exit **0** (zero mint-observable lines for a lookalike), run from the fix-run's own
   repo root so an active run is in scope.
9. Live probe, control direction (also the anti-false-pass control for criterion 8 — if the hook
   no-oped, this fails and 8 proves nothing):
   `test "$(printf '%s' '{"tool_name":"Task","tool_input":{"subagent_type":"zodyssey:momus","prompt":"p"}}' | node skills/odyssey/hooks/pre-tool.mjs 2>&1 | grep -c 'pending_nonce')" -ge 1`
   — expected exit **0**. Side effect, stated honestly: this mints a fresh
   `state.review.pending_nonce` into the fix-run's own state (overwrites the field; inert once the
   run's real review is recorded — nothing downstream reads a stale pending nonce). The hook's own
   exit code (0, dispatch allowed) and the dispatch-blocked controls are asserted by the suite
   cases, which use isolated fixture runs.

The warning's exact wording is free; only the mint/no-mint observable is pinned.

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** Not a deny-list of lookalike names: it is an identity
   allowlist of the three declared minter types — the same direction as the v0.5.2 terminus at
   `CHANGELOG.md:27` (classify by known-safe identity, not by denied shapes). There is no shape to
   bypass because nothing is matched loosely.
2. **A check that cannot detect the class of failure it exists for.** Criterion 7 is the tripwire:
   the flipped assertions are demonstrated failing against the broken code. Note the twist this
   change exists to fix: the current suite *passes* while asserting the hole — criterion 7 is what
   proves the new assertions execute.
3. **Ceremony without mechanism.** Hook code change plus flipped/extended regression assertions,
   all machine-executed. No convention is added.
4. **Self-grading.** The old suite graded this hole as correct behavior (the Class C block
   asserted `someplugin:momus` mints); flipping it is precisely the escape from self-grading.
   Every criterion here is an exit code recorded by `record-verify`.
5. **A fix that reopens its own class.** Covered in "The class it closes" — per-lane exact
   assertions for all three mint lanes, in one suite.

Anti-goal, absolute: no **LLM opinion layer**. This change adds no reviewer, judge, or verifier
agent; its only new output is a deterministic stderr line.

## Paired probe

**Probe:** a Task dispatch in an active run (the suite's `nonceFor` fixture at
`skills/odyssey/hooks/pre-tool.gate-surface.test.mjs:255-263` is the harness; the live form is
criteria 8-9). Both directions stated, plus the controls that prove no over-block:

| Dispatch | Before (current HEAD) | After |
|---|---|---|
| `zodyssey:momus` (control, unchanged) | exit 0, review nonce minted | exit 0, review nonce minted |
| `someplugin:momus` / `evil:momus` | exit 0, review nonce minted — **the hole** | exit 0, **no nonce**, warning |
| `feature-dev:code-reviewer` (control) | exit 0, `final_f2` nonce | exit 0, `final_f2` nonce |
| `evil:code-reviewer` | exit 0, `final_f2` nonce minted | exit 0, no nonce, warning |
| `someplugin:oracle` | exit 0, `final_f4` nonce minted | exit 0, no nonce, warning |
| `someplugin:sisyphus-junior` in phase `plan` (control) | exit **2** (executor phase-gated) | exit **2** (routing tolerance must not promote an executor) |

The "before" column is already machine-evidenced: today's green suite asserts the lookalike mint
as correct (`:257-260`), so the failing direction is demonstrated, not presumed — and criterion 7
re-demonstrates it on demand via the stash reversion. A probe that moves either control row has
over-blocked or over-tightened.

## What it breaks

Legitimate non-zodyssey momus-named agents: **none exist to break.** `momus` is ZOdyssey's own
reviewer, defined in this repo (`agents/momus.md`), dispatched as `zodyssey:momus`
(`skills/odyssey/SKILL.md:375`, `skills/odyssey/references/scripts.md:55`). The only
"legitimate third-party momus" instances in the tree are the Class C fixtures that assert the
tolerance itself — this change flips them deliberately. No agent loses the ability to be
*dispatched*; a lookalike loses only a credential it should never have had, and it is told so on
stderr at dispatch time.

The one real availability case is F2's, and it improves: a differently-packaged `code-reviewer`
previously minted silently and correctly; after this change it warns loudly at dispatch and mints
nothing, so a final-wave F2 rejection that used to surface as a silent deadlock
(the v0.5.1 Class C failure mode, `skills/odyssey/hooks/pre-tool.mjs:1254-1267`) now surfaces
immediately with the dispatch type named. An adapter who intends their packaging to be the F2
reviewer adds its exact type to the lane allowlist — a one-line, recorded decision, which is the
point: reviewer identity becomes an explicit declaration, not a substring accident.

## The class it closes

**Authority granted by name-segment tolerance** — a loose matcher built for routing (F5, phase
gates) consumed by an authority-bearing check (nonce minting). This is the same class family as
the v0.5.2 head-allowlist inversion named at `CHANGELOG.md:27`: identity questions ("who may
execute", "who may grant") answered by tolerant matching instead of exact identity, where the
structural fix is to invert to an allowlist of declared identities. The direct in-lane prior is
v0.5.1 audit-3 finding 7 (`CHANGELOG.md:64-66`): the round-cap twin and the minter disagreed, and
the fix agreed them **downward** (both tolerant) instead of upward (both exact) — closing the cap
bypass while leaving the mint open. This change completes that agreement in the right direction.

How this change could reintroduce the class: the next availability-motivated fix reaches for
`isAgent`/`sameName` at a new authority-bearing lane — the exact pull the Class C comment at
`skills/odyssey/hooks/pre-tool.mjs:1254-1267` documents (tolerance was chosen there to stop silent
no-mint deadlocks). What prevents it: (a) a **shared exact-minter assertion covering every
authority-bearing lane** — review, `final_f2`, `final_f4` — in one suite block, so a fourth lane
added with `sameName` has no passing assertion home unless the block is extended deliberately;
(b) the corrected header in `capability-name.mjs` removes the false "not a security boundary"
license that justified the consumption; (c) the loud near-miss warning removes the silent-deadlock
pressure that motivated the tolerance, so the next contributor's availability fix has a mechanism
that is not "match loosely".

## Docs to update

Every doc that states the claim this change alters ("a real Task(zodyssey:momus) dispatch mints the
nonce"), each checked against the 2026-08-16 tree:

- `CHANGELOG.md` — new version entry (shape below); do not touch the v0.5.1 audit-3 #7 entry at
  `:64-66` except by reference.
- `docs/DESIGN.md:264` — §6 hook table, "Nonce minting" row: extend to state minting is restricted
  to the exact declared minter types per lane (`zodyssey:momus`; `code-reviewer` /
  `feature-dev:code-reviewer`; `zodyssey:oracle`) and that lookalike namespaces mint nothing.
- `README.md:123` — comparison-table row "Review verdicts are read, not assumed": extend the
  ZOdyssey cell to state the nonce is minted only for the exact declared minter type, never for a
  lookalike namespace.
- `skills/odyssey/SKILL.md:375-381` — the review-gate chain description: the sentence "the nonce
  only exists after a real `Task(zodyssey:momus)` call the hook witnessed" becomes enforced by
  exact type; add the minter-allowlist fact and the lookalike warning.
- `skills/odyssey/references/scripts.md:55-66` — review-lane walkthrough, step 1: state that only
  the exact `subagent_type` mints and that a lookalike dispatch warns and mints nothing.

A fix that leaves any of these asserting the old behaviour has created the next doc-code drift.

## CHANGELOG entry shape

New patch version — the next free patch at ship time (`0.5.3` if nothing has shipped since
`0.5.2`; 01 and 02 each claim their own release ahead of this one in build order). **One security
change per release, shipped alone** — the repo rule with its precedent at `CHANGELOG.md:27`. Do
NOT batch queue items 01 or 04 into this release even though all three touch
`skills/odyssey/hooks/pre-tool.mjs`; that is a reason for adjacent sequencing, not for merging.

- **Fixed** — one entry: nonce minting is now restricted to the exact declared minter type per
  lane; a lookalike namespace (`evil:momus`, `someplugin:oracle`, …) dispatches but mints nothing
  and warns on stderr. State the mechanism in one clause (lane-local exact allowlist at the mint
  site; `sameName` tolerance retained only for routing), name the self-assertion honestly (the
  gate-surface suite had asserted the lookalike mint as intended behavior — say so), and cite the
  paired-probe evidence (mint → no-mint for lookalikes; canonical minter and dispatch controls
  unchanged, both directions). This repo cites its probes, not just its diffs.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - A lookalike `*:momus` dispatch is still ALLOWED by design — read-only routing tolerance grants
    no authority; every write the dispatched agent attempts remains scope- and verdict-gated.
  - The orchestrator-adversary residual stands unchanged (`skills/odyssey/SKILL.md:381`: the nonce
    binds a real dispatch, not what the reviewer returned).
  - A new legitimate reviewer packaging now requires a one-line allowlist edit, surfaced loudly by
    the near-miss warning rather than silently at the final wave.
  - Case variance narrows with the same stroke (found in run verification, pinned by no criterion):
    a mixed-case dispatch (`ZODYSSEY:momus`) minted before via `sameName`'s norm() lowercasing and
    now falls to the near-miss warning. Fail-closed is the intended direction and the harness
    dispatches lowercase (the extractor at `skills/odyssey/hooks/pre-tool.mjs:1252` strips
    only `zodyssey:`), but the narrowing rests on that harness behaviour — the release entry
    carries a line saying so rather than leaving it in a run report.
  - The `agent_type` / `type` fallback fields in the extractor at
    `skills/odyssey/hooks/pre-tool.mjs:1252` are unchanged and out of scope.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the marketplace cache picks up the hook — a fix that stays only in
  the repo protects no run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is a pure code-logic change and the run's whole method is red-green: load the TDD skill via
the Skill tool in the executor thread, flip the two lookalike assertions and add the refusal cases
first (criterion 7's demonstration), watch the suite go red, then make them green. F5 cross-checks
the declaration against hook-witnessed loads (`skills/odyssey/references/scripts.md:22`), so a
declaration without a real load fails the final wave — declare nothing speculative. No
`discovered:`/`generic:` (no find-skills call is planned) and no `mcp:` declarations (none will be
loaded). If a test fails in a way two fix attempts do not diagnose, loading
`systematic-debugging` is correct — declare it only if it is actually loaded, after the fact,
never in anticipation.

## Estimated size

~15 lines in `skills/odyssey/hooks/pre-tool.mjs` — the lane-local exact-minter allowlist, the
three mint-site comparisons, the near-miss warning branch, and a comment mirroring the audit-3 #7
rule — plus ~4 comment lines in `skills/odyssey/scripts/lib/capability-name.mjs` (header only),
plus ~30 lines flipped/added in `skills/odyssey/hooks/pre-tool.gate-surface.test.mjs` (flip the
two lookalike assertions in the Class C block, add the refusal cases and the `final_f2`/`final_f4`
lane assertions). Patch release, shipped alone.
