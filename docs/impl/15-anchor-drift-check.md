# 15 — Anchor-drift check: a cited line must still say what the citation claims

Build order **15** · depends-on **—** (no blocking edge; see *What fixed means* for why it should be
pulled forward) · queue row: [`docs/impl/00-INDEX.md`](00-INDEX.md) `15 anchor-drift-check` ·
not security-class · patch release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast. Do exactly this one change.

---

## What is broken

This repository documents itself by `file:line` citation. Measured on 2026-08-16 across tracked
`.md` files: **761 citations, in 28 documents, pointing into 68 distinct files.** The convention is
load-bearing — `docs/implementation-prompt.md:34` makes it a rule ("Cite `file:line` for every
load-bearing claim … A claim without an anchor is a claim you did not check"), and every prompt in
this queue is built on it.

**Nothing verifies that a citation still points at what it claimed.** A one-line insertion into a
cited file silently shifts every anchor below it. No test, hook, or CI step notices.

This is not hypothetical. It happened twice in the week this queue was written:

- **`agents/sisyphus-junior.md:93`** cited `pre-tool.mjs:906-962` for the Bash write-gate and
  `pre-tool.mjs:817` for the `ZODYSSEY_UNGATE_BASH` hatch. Both had drifted. The gate is at
  `:1072-1226`; the hatch is at `:978`; and `:807` had become `if (rel) {` — the Edit-path
  containment escape, an unrelated line. The executor's own trust-model briefing pointed at the
  wrong code, and `docs/impl/00-INDEX.md` had to flag the file as unciteable.
- **While fixing that**, an edit to `skills/odyssey/references/scripts.md` inserted one line and
  shifted `check-imports.mjs` from `:45` to `:46`. That silently invalidated two citations written
  minutes earlier *and seven pre-existing ones in `docs/ideation-report.md`*, a committed audit
  artifact. It was caught only because the author re-ran a verification pass by hand. The edit was
  reshaped to be line-count-neutral to preserve them.

The exposure is concentrated exactly where this queue works. Citation counts into the files items
01–07 will edit:

| cited-into file | citations | edited by queue item |
|---|---|---|
| `skills/odyssey/hooks/pre-tool.mjs` | 89 | 01, 03, 04 |
| `skills/odyssey/scripts/set-phase.mjs` | 62 | 02, 05, 11 |
| `skills/odyssey/hooks/post-tool.mjs` | 23 | 07 |

**Executing this queue is the largest single threat to the repository's citation surface**, and the
queue currently contains nothing that would notice.

Current state, measured 2026-08-16: **0 citations out of range.** The surface is clean right now,
which is the cheapest moment to pin it.

## What fixed means

Stated as observable behaviour, not as a diff.

`node scripts/run-tests.mjs` fails when a tracked `.md` file cites `path:line` and that line no
longer carries the content it carried when the citation was last verified. It passes when every
citation resolves, is in range, and matches its recorded fingerprint. It fails — never passes —
when zero citations are discovered.

Three moving parts:

1. **`scripts/anchors.lock.json`** — a baseline mapping `"<path>:<line>"` to a short hash of that
   line's whitespace-normalized content. This is the "before" reading, exactly as
   `regression-gate.mjs --snapshot` is for the test suite.
2. **`scripts/check-anchors.mjs`** — extracts citations, resolves them, and compares against the
   lock. `--update` rewrites the lock deliberately (the analogue of `--resnapshot`).
3. **`scripts/check-anchors.test.mjs`** — asserts the check passes over the current tree.

**The resolver must handle the repo's actual citation dialects, or it ships false positives on day
one.** This was measured, not guessed: a first-cut extractor that resolved only repo-root-relative
paths reported **25 false failures** across `.zcode/reports/v0-4-1-full-audit-findings.md`,
`README.md`, `docs/MEASUREMENT.md`, `docs/deep-audit-prompt.md`, `docs/ideation-report.md`,
`docs/impl/02` and `docs/impl/11`. Every one of them resolves correctly under the right root. The
dialects in live use:

| written as | resolves to |
|---|---|
| `skills/odyssey/references/scripts.md:45` | itself (repo-root-relative) |
| `references/scripts.md:45` | `skills/odyssey/references/scripts.md` |
| `scripts.md:45`, `capabilities.md:10` | `skills/odyssey/references/` |
| `SKILL.md:355` | `skills/odyssey/SKILL.md` |
| `trusted-invoke.test.mjs:105` | `skills/odyssey/hooks/pre-tool.trusted-invoke.test.mjs` (basename suffix match) |
| `.zcode-plugin/plugin.json:44` | itself — **leading dot; a naive `[A-Za-z]`-anchored regex drops it** |
| `pre-tool.mjs:817`, `set-phase.mjs:339` | `skills/odyssey/hooks/`, `skills/odyssey/scripts/` |

Resolution order must be deterministic and **ambiguity must fail, not guess** — if a bare basename
matches two files, that is a citation defect to report, not a coin flip. A false positive here is
worse than no check, because a noisy gate gets switched off; that is the repo's own stated reason
for `regression-gate.mjs` never punishing inherited breakage.

**Ship the enforcement as a test file. This is the whole design.** `scripts/run-tests.mjs`
auto-discovers `**/*.test.mjs` (`scripts/run-tests.mjs:39-...`) and CI runs `npm test`, so a test
file is wired the moment it exists — there is no caller to add and none to forget. A
`--check` flag on a script would need something to invoke it, and this repo has two mechanisms that
were built, tested, and never invoked (`check-imports.mjs`, `regression-gate.mjs --check`; see
`docs/impl/02-wire-zero-caller-checks.md`). **Do not create a third.**

**On position:** this has no blocking edge, so it sits at 15 rather than renumbering a committed
queue. Its *value*, however, is highest before items 01–07 run, because those are what will shift
the anchors. Recommend executing it first in practice; the id is a label, not a schedule.

## Files

```
scripts/check-anchors.mjs           (new)
scripts/check-anchors.test.mjs      (new)
scripts/anchors.lock.json           (new, generated by --update on first run)
docs/impl/00-INDEX.md               (add row 15)
CHANGELOG.md
README.md
```

## Must NOT do

- **Do not add a `--check` flag whose only caller is prose.** The test file is the invocation. If
  you find yourself writing "run this during verify" in `references/scripts.md`, you have rebuilt
  the defect this item exists to prevent.
- **Do not rewrite any citation to make the check pass.** Drift is reported; a human decides whether
  the citation or the code is wrong. An auto-fixer that silently re-anchors would destroy exactly
  the signal being bought.
- **Do not touch `CHANGELOG.md`'s existing entries.** It is a historical record and is exempt from
  the check for that reason (49 citations point into it, and its own citations describe past state).
- **Do not extend this to prose claims, semantic accuracy, or whether the cited line *supports* the
  claim.** This check answers one question: does the line still say what it said. Scope creep here
  turns a deterministic check into a judgment call, and a judgment call needs a judge.
- **Do not make an unlocked citation pass.** A citation absent from the lock is an unchecked
  citation. See *Failure-mode check*.

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active *(not applicable — this ships no hook)*
- No argv flag authenticates anyone — `--update` is a convenience, not an authorization; anyone who
  can run it can also edit the lock file directly. It removes a *silent* path, nothing more.
- Fail closed. An unverifiable state blocks; it never passes.
- A repo-capability check degrades to a recorded `inert`, never to a block. *Not applicable —
  citations are repo content, always present. Zero discovered is a defect, not an inert repo.*

## Acceptance criteria

Every criterion is an exact command from the repo root plus its expected exit code. `record-verify`
executes them and records the codes as evidence; a criterion a human must read and agree with is not
a criterion.

1. `node --check scripts/check-anchors.mjs && node --check scripts/check-anchors.test.mjs` —
   expected exit **0**.
2. `node scripts/check-anchors.mjs --update` — expected exit **0**; writes
   `scripts/anchors.lock.json`.
3. `node scripts/check-anchors.mjs` — expected exit **0** against the seeded lock; prints the
   citation count it verified.
4. `node scripts/check-anchors.test.mjs` — expected exit **0**.
5. `node scripts/run-tests.mjs --filter check-anchors` — expected exit **0**. Proves the suite
   discovers the new file, which is the entire wiring mechanism.
6. `node scripts/run-tests.mjs` — expected exit **0**; the suite count is **33**, up from 32.
7. Drift is detected. Expected exit **nonzero** from `check-anchors.mjs` after a line is inserted
   above a cited line in a scratch copy — see *Paired probe* for the exact construction.
8. Empty discovery fails: run `check-anchors.mjs` with its document glob pointed at an empty
   directory — expected exit **nonzero**, never 0.
9. `git diff --stat -- skills/ agents/ commands/` — expected empty output. This change adds tooling
   and must not edit a single cited file, or it perturbs the surface it is measuring.

### Failure-mode check (Step 6)

1. **Enumeration instead of structure.** No. Citations are derived mechanically by regex over
   tracked `.md`; there is no list of known citations to maintain. The exemption set is exactly one
   entry (`CHANGELOG.md`) plus an inline marker, and both are documented in the lock's header.
2. **A check that cannot detect the class of failure it exists for.** The live risk. Three
   defences, all mandatory: **(a)** zero citations discovered exits nonzero — the `harness.mjs`
   rule (`scripts/run-tests.mjs:20-22`, "ZERO TESTS DISCOVERED IS A FAILURE … a runner reporting
   success over an empty set is the same false green"); **(b)** a citation present in the docs but
   absent from the lock exits nonzero, because an unlocked citation is an unchecked one; **(c)** the
   checker's own source contains citations and is not exempt, so it checks itself.
3. **Ceremony without mechanism.** No — the mechanism *is* the wiring. Shipped as a discovered test,
   it cannot become a zero-caller.
4. **Self-grading.** No LLM is involved at any point. The comparison is a hash equality.
5. **A fix that reopens its own class.** The risk is the lock going stale by blanket `--update`
   after every red. Mitigate by requiring the CHANGELOG entry to state that `--update` is a
   deliberate re-baseline, and by having the check print *which* citation drifted and what the line
   now says, so the cheap path is fixing the citation rather than re-baselining.

## Paired probe

Both directions must be demonstrated. A test asserting drift-detection that never runs is
indistinguishable from a passing one.

Construct a hermetic scratch copy (temp dir, `cpSync` of `docs/` + the cited file):

| probe | before this change | after this change |
|---|---|---|
| Insert one blank line at the top of a file cited at `:45`, then check | **exit 0** — nothing notices | **exit nonzero**, naming the citation and the line it now points at |
| Edit the *content* of a cited line in place, without changing line count | **exit 0** | **exit nonzero** — the fingerprint, not just the line number, is what is pinned |
| Add a new citation to a doc without updating the lock | **exit 0** | **exit nonzero** — unlocked is unchecked |
| Point the document glob at an empty dir | **exit 0** | **exit nonzero** — zero discovered is a failure |
| Unmodified tree | exit 0 | **exit 0** — no false positive |

The second row is the one that matters. A line-number-only check would pass it, and in-place content
edits are how the `sisyphus-junior.md:93` anchors went wrong — the line numbers were plausible, the
content had moved elsewhere.

## What it breaks

- **CI goes red whenever a cited file is edited without the citing doc being updated.** That is the
  deliverable, and it will bite immediately: items 01–07 all edit heavily-cited files. Expect the
  first few queue items to carry a citation-update step. That step is work the repo is currently
  doing by accident and calling done.
- **A new failure mode for contributors**: editing `pre-tool.mjs` can now fail a suite for reasons
  in `docs/`. The error message must name the citing document, the cited file, the line, and what
  the line now contains — a bare "anchor drift" would be worse than nothing.
- **`--update` is a footgun** if used reflexively. Named in *Must NOT do* and in the CHANGELOG.
- Nothing at runtime. This ships no hook, touches no gate, and adds no dependency.

## The class it closes

**"A reference that silently stops referring."** Distinct from item 08's class — 08 asks *does this
claim have an assertion*, this asks *does this pointer still point there*. A claim can be fully
covered by 08's ledger and still cite a line that moved three commits ago.

It is the same shape as the repo's canonical failure, one level out: the Bash write-gate was deleted
and three audits missed it because nothing re-checked a standing invariant. An anchor is a standing
invariant whose subject is a line of code. This repo has 761 of them and checks none.

**Reopening risk:** the checker becomes another mechanism nobody runs. Prevented structurally — it
is a test file, and `run-tests.mjs` discovers tests rather than being told about them. That is the
same inversion `scripts/deploy-surface.test.mjs:2` uses ("the drift gate must compare everything the
deployer deploys"), and the reason it has held.

## Docs to update

- **`README.md`** — add a row to the invariant table: *"Citations still point where they claim"*,
  ZOdyssey column describing the lock + test. Only after the check is green, and note it is
  genuinely enforced, unlike the two rows corrected on 2026-08-16.
- **`docs/impl/00-INDEX.md`** — add row 15 and the out-of-rank note explaining the pull-forward
  recommendation.
- **`skills/odyssey/references/scripts.md`** — a short entry. **Do not write "run it during
  verify."** State that it runs automatically via `npm test` and that `--update` is the deliberate
  re-baseline.
- **Not `docs/implementation-prompt.md`** — its Step-7 line "Every `file:line` you cite resolves in
  the current tree — spot-check them, do not assume" becomes mechanically enforced rather than
  aspirational, but the instruction stays correct as written.

## CHANGELOG entry shape

```markdown
### Added — anchor-drift check

This repo documents itself by `file:line`: 761 citations across 28 documents into 68 files,
with nothing verifying that a cited line still says what the citation claims. Two anchors
broke in one week — `agents/sisyphus-junior.md:93` had drifted onto an unrelated line, and a
one-line insertion into `references/scripts.md` invalidated nine citations at once, seven of
them in a committed audit artifact.

`scripts/anchors.lock.json` pins each cited line's normalized content hash;
`check-anchors.test.mjs` fails the suite on drift. Shipped as a test rather than a script with
a flag, deliberately: `run-tests.mjs` discovers tests, so there is no invocation to forget.
Two mechanisms in this repo were built, tested, and never invoked; this is not a third.

Re-baselining is `--update`, and it is a deliberate act — the check names the drifted citation
and what the line now holds, so correcting the citation is the cheaper path.

**Known, not fixed:** the check verifies that a line is unchanged, not that it *supports* the
claim citing it. A citation can be perfectly anchored and still be wrong about what the code
does. That is a judgment call, and judgment calls need a judge.
```

## Capability routing

```
routed: skill:test-driven-development
```

Non-negotiable for code in this repo, and the paired probe is literally a red-then-green sequence.
Load it in the parent thread — F5 cross-checks the declaration against hook-witnessed loads, and a
sub-agent cannot load a skill on the orchestrator's behalf. Declare the bare token; matching is
segment-tolerant, but prose after the token breaks the parse.

## Estimated size

~130 lines of checker, ~120 lines of test, plus a generated lock (~761 entries, machine-written).
No runtime surface, no hook, no dependency. **Patch release.** Can ship alongside any non-security
item; must not ship in the same release as 01, 03 or 04, whose whole purpose is editing the
most-cited file in the repo — land those first and re-baseline, or land this first and let it catch
them. Either order works; sharing a release does not.

## Note — 2026-08-17: the checker-invisible citation dialects (external-audit rounds 2-3)

Two continuation dialects are invisible to `check-anchors.mjs` because the CITE regex requires
the filename before the line number, and CHANGELOG.md keys are exempt from the lock entirely
(unstable-by-format, `scripts/check-anchors.mjs` NO_PIN_TARGETS):

- **bare continuations** — a full cite of `file.mjs` line 120 followed by a sibling `` `:138-149` ``
  that carries no
  filename, so a shifted file leaves it stale while the suite stays green (found by external
  audit round 2; reconciled via git-hunk-derived shift bands, commit `7b33454`).
- **comma/slash continuations** — `CHANGELOG.md:486, :592`, `:415/:554`, `md:33,31` — same
  blindness inside the exempt CHANGELOG target (found by round 3).

Until the dialects are either lockable or linted, reconciliation passes here must grep for
`` `: `` (backtick-colon-digit) and `[0-9]+[,:/] ?[0-9]+` after every cited-file edit. The
hunk-derived band tables used in `7b33454` are the reusable method: never re-derive shifts from
memory, read `git diff <base>..HEAD -U0` hunk headers.
