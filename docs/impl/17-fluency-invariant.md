# 17 — Fluency-exclusion invariant for the judge rubric

Build order **17** · depends-on **—** (nothing precedes or blocks it) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `17 fluency-invariant` · not security-class · minor release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were derived on 2026-08-17 and this repo moves fast. Do exactly this one change.

## What is broken

`docs/MEASUREMENT.md:35` defines the quality rubric as five dimensions — correctness, scope
fidelity, verification rigor, code quality, efficiency — none of which scores HOW the output is
written. The judge prompt implements exactly that:
`skills/odyssey/scripts/judge.mjs:106` (`## Scoring rubric`, weights 0.4/0.2/0.2/0.1/0.1) and the
output-contract literal at `skills/odyssey/scripts/judge.mjs:131`. The external auditor prompt
carries the matching defense at `skills/odyssey/references/auditor-prompt.md:49` ("Do NOT reject
for style preferences the plan didn't specify").

Nothing enforces any of that. The rubric is clean **by accident**: a future edit that adds a
"clarity" or "readability" dimension — reads well, proves nothing — would land with no check
noticing, and style-correlated confidence is a measured judge failure mode
(`docs/ROADMAP.md:63`: judge accuracy 60-67% on hard cases, framing swings verdicts). This brief
ports rule **R8 (FASAHA / fluency exclusion)** from the ISNAD-engine study (2026-08-17): *no
stylistic, fluency, length, or verbosity feature may enter trust scoring, judge prompts, or human
rubrics.* It is the sixth standing doc-claim invariant suite (the five existing ones are named in
the `08` queue row).

**Paired-probe result, broken direction (provable today):** with a `Clarity of prose (0.1)` line
temporarily inserted after the Efficiency line in the judge prompt,
`node skills/odyssey/scripts/judge-rubric.test.mjs` exits **1** on two assertions (weights no
longer sum to 1.0; denylist matches the rubric segment). Reverted, it exits **0** (11/11).
Demonstrated in both directions on 2026-08-17 during this change's build.

## What fixed means

Stated as observable behaviour: `skills/odyssey/scripts/judge-rubric.test.mjs` exists, is
discovered by `scripts/run-tests.mjs`, and fails if any of the following stops holding —

1. the judge prompt contains a `## Scoring rubric` section followed by the task section;
2. the five documented dimensions appear **with their documented weights**, and the weights sum
   to 1.0;
3. the output-contract `dimensions` literal holds exactly the five documented keys — no sixth key;
4. no term matching `/style|fluency|verbos|eloquen|polish|\btone\b|readability|wording|clarity/i`
   appears in the rubric segment (scoped between `## Scoring rubric` and the next `##` heading —
   NOT the whole file, so the denylist cannot false-positive on unrelated prompt prose and get
   disabled);
5. `skills/odyssey/references/auditor-prompt.md` still contains the
   "Do NOT reject for style preferences" clause (the auditor prompt legitimately uses the word
   "style" inside its own prohibition, so that defense is pinned, not denylisted).

No production file changes behaviour. The suite is pure read-and-assert over source text.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/scripts/judge-rubric.test.mjs` (new — placed next to the file it defends, the
  same convention as `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs`)

Nothing else. `judge.mjs` and `auditor-prompt.md` are read-only inputs; the whole point is that
they cannot drift silently, which requires them not to be editable as part of landing the check.

## Must NOT do

- Do not modify `judge.mjs`, `references/auditor-prompt.md`, or any production file — this change
  adds an invariant, not a feature.
- Do not scope the denylist to the whole of `judge.mjs` — the surrounding prompt prose legitimately
  discusses summaries and wording; a denylist that false-positives gets disabled, and a disabled
  check is the failure mode this repo's bash-gate history already proved.
- Do not denylist `references/auditor-prompt.md` — it contains "style" inside the prohibition
  clause being defended. Pin the clause; do not forbid the word.
- Do not pin weights as a free-form "sums to 1.0" only — each dimension's individual weight is
  asserted, so reweighting (correctness 0.3, clarity 0.1…) is caught even when the sum still holds.
- No npm dependencies; no new env vars; no behavior change of any kind.

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

`scripts/check-anchors.test.mjs` runs inside `node scripts/run-tests.mjs` and content-pins every
`file:line` citation in the repo's docs, so **editing a cited file makes the suite go red until the
citations are reconciled.** This change creates a new citing document, so its own citations must be
pinned: after writing, run `node scripts/check-anchors.mjs`, confirm each `unlocked` entry points
where intended, then `--update` once. Procedure and the run-`--update`-first footgun: see
[`docs/impl/02-wire-zero-caller-checks.md`](02-wire-zero-caller-checks.md) §Anchor-drift
reconciliation.

## Acceptance criteria

Every criterion is an exact command from the repo root plus its expected exit code.

1. `node --check skills/odyssey/scripts/judge-rubric.test.mjs` — expected exit **0**.
2. `node skills/odyssey/scripts/judge-rubric.test.mjs` — expected exit **0** (11/11).
3. The paired direction, re-provable on demand:
   `sed -i 's|^- Efficiency (0.1): changes proportional to the task (not 10x over-engineered)$|- Efficiency (0.1): changes proportional to the task (not 10x over-engineered)\n- Clarity of prose (0.1): how readable and well-worded the diff is|' skills/odyssey/scripts/judge.mjs && node skills/odyssey/scripts/judge-rubric.test.mjs; ec=$?; git checkout -- skills/odyssey/scripts/judge.mjs; test $ec -eq 1`
   — expected exit **0** overall: with a style dimension injected, the suite fails.
4. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: **34/34** suites,
   2026-08-17 (the 33/33 stated by earlier prompts is stale; one suite landed since). This change
   grows it to 35/35.

### Failure-mode check (Step 6)

1. **Enumeration instead of structure.** The denylist enumerates style *terms*, but the structural
   assertion (exactly five dimension keys in the output literal) is what catches a dimension added
   under a term the denylist missed — the enumeration is the backstop, not the mechanism.
2. **A check that cannot detect the class it exists for.** Criterion 3 demonstrates the failure for
   real before declaring the check works.
3. **Ceremony without mechanism.** The suite is wired by existence into `run-tests.mjs` discovery —
   there is no caller to forget (the `check-anchors.test.mjs` wiring pattern).
4. **Self-grading.** All criteria are machine-executed exit codes; nobody grades prose.
5. **A fix that reopens its own class.** The denylist is segment-scoped precisely so it cannot
   false-positive its way into being deleted — the fate of two over-broad gates in this repo's
   history.

## Paired probe

**Probe:** a sixth rubric dimension scoring prose quality.

- **Before the check: silent.** Nothing compares the rubric to `MEASUREMENT.md` §2; any edit lands.
- **After the check: it fails the build.** Weights-sum and denylist assertions both trip (verified
  2026-08-17: `9/11 passed`, exit 1).

Unchanged controls, required on BOTH builds:

| Control | Before | After |
|---|---|---|
| `node skills/odyssey/scripts/judge.mjs` argv errors (bad args) | exit 2 | exit 2 (no behavior change) |
| `node skills/odyssey/scripts/dashboard.test.mjs` | exit 0 | exit 0 |
| Suite count | 34/34 | **35/35** |

## What it breaks

Nothing at run time — no production file changes. The intended break is temporal: any future edit
to the judge rubric or the auditor's anti-style clause must either reconcile this suite (argue the
new dimension is not stylistic and extend the suite's documented dimension list in the same change)
or revert. That friction is the deliverable.

## The class it closes

**A documented rubric claim with nothing comparing the code to the doc** — the same class as
`scripts/version-consistency.test.mjs` (three manifests, nothing comparing them), extended to the
eval's scoring surface. Reopened by: adding a dimension via prompt edit without touching
`MEASUREMENT.md`. Prevented by: the exact-keys assertion plus the pinned weights.

## Docs to update

- `docs/impl/00-INDEX.md` — DAG row 17 (this queue's record).
- `docs/MEASUREMENT.md` §2 — no text change required (the suite enforces the table as written);
  optionally a one-line note under the rubric naming `judge-rubric.test.mjs` as its enforcement.

## CHANGELOG entry shape

Minor release (may ride the v0.6 minor with other non-security items).

- **Added — fluency-exclusion invariant (ISNAD R8).** `judge-rubric.test.mjs` pins the judge rubric
  to the five documented dimensions and their weights, denies style/fluency terms in the rubric
  segment, and pins the auditor's no-style-rejections clause. Paired probe: an injected `Clarity of
  prose (0.1)` dimension fails the suite on two assertions.
- **Known, not fixed** — the denylist is term-enumerated; a stylistic dimension phrased outside the
  enumerated terms is caught only by the exact-five-keys structural assertion. That backstop is the
  load-bearing one and is not enumerable.

## Capability routing

`routed: skill:test-driven-development` — red-green: demonstrate criterion 3's failing direction
before landing the suite.

## Estimated size

~110 lines, one new file. No production edits.
