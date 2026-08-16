# ZOdyssey v0.6 implementation-prompt generator

**Purpose:** hand this to an agent. It reads the two ideation documents, re-verifies every claim
against the code, derives the correct build order from dependencies rather than from rank alone,
and writes one detailed implementation prompt per feature.

**It does not implement anything.** Its only output is `docs/impl/00-INDEX.md` plus one
`docs/impl/NN-<slug>.md` per feature. Writing code is a later, separate act — each generated prompt
is the brief for its own `/orchestrate` run.

---

## Your task

Produce a complete, ordered set of implementation prompts for ZOdyssey v0.6.

Each prompt must be good enough that an agent handed **only that file** — no chat history, no
memory of this session — can plan, build, verify and ship that one feature correctly. Assume the
reader is competent and knows nothing about this repo.

---

## Step 1 — Establish ground truth. Do not trust the inputs.

Read, in this order:

1. `docs/OPPORTUNITY-MAP.md` — the first discovery pass (ranked opportunity map)
2. `docs/ideation-report.md` — an independent blind second pass, with a Reconciliation section
   that arbitrates the disagreements between the two
3. `docs/ROADMAP.md`, `docs/DESIGN.md`, `docs/MEASUREMENT.md`, `CHANGELOG.md` (v0.5.0 → head),
   `skills/odyssey/SKILL.md`

Then **verify every claim you intend to build on against the code.** Both ideation documents are
dated and this repo moves fast — `docs/ROADMAP.md` was five releases stale within four days, and
three of the four "confirmed open" items in `docs/ideation-prompt.md`'s own commit message were
wrong. The same rot applies to the documents you are reading now.

Rules, in force for the whole task:

- **Code wins.** Over both ideation documents, over the CHANGELOG, over this file.
- **Cite `file:line` for every load-bearing claim** you carry into a prompt. A claim without an
  anchor is a claim you did not check.
- **Run the suite** (`node scripts/run-tests.mjs`) before you start and record the result. If it is
  not green on arrival, stop and report — you are looking at a different problem than this one.
- **Re-derive, don't relay.** If a number appears in an ideation doc, re-measure it. Both documents
  disagreed with each other on `results.jsonl`'s record count three times because the file is live.

If an item has already been fixed, or the code has moved such that the proposal no longer makes
sense, **say so and drop it** — with the `file:line` that shows it. A dropped item is a good
outcome, not a failure.

## Step 2 — The candidate set

Below is the merged queue both passes converged on, with the divergences already arbitrated by code
in `docs/ideation-report.md`'s Reconciliation section. **Treat it as a starting list to verify, not
a specification to obey.**

| Candidate | Map | Report | Status to verify |
|---|---|---|---|
| Edit-path containment escape — `if (rel)` skips the scope gate for targets outside `PROJECT_DIR` | #1 | M1 | Demonstrated against the deployed hook; both passes agree it goes first |
| Wire the zero-caller checks into phase transitions (`check-imports`, `coverage-delta`, `resolve-capabilities`) | #2 | §1.1 | Highest-confidence finding in either document — two independent censuses |
| Claim→assertion coverage ledger (A4 done as coverage, not as a list) | #3 | §1.2 / S1 | Registry absent; four scattered equivalents exist |
| Decontaminate the metrics corpus (test fixtures write to the operator's trend log) | #4 | D3 | ~83% synthetic and growing |
| Two-arm eval: `judge.mjs --arm` + an automated baseline arm | #5 | §1.5 / S3 | The settling experiment; unblocks the prompt-surface item |
| `ZODYSSEY_UNGATE_BASH` — retire it, or record every ungated call | #6 | M2 | One env var disables the whole Bash gate |
| Nonce-lane minter allowlist (segment tolerance grants any `*:momus` the lane) | #12 | M3 | Header asserts an exemption that is false in code |
| Token telemetry wired at run close (populated in 1 of 177 records) | — | §1.3 | Report-only; the map missed it |
| Compaction wired to a phase transition (opt-in, unwired, truncates to 40 lines) | — | §1.4 | Report-only; must stay additive or it destroys final-wave evidence |
| B10 pre-edit lint baseline | #11 | §1.6 | The one Phase B item genuinely unshipped |
| Prune stale plugin-cache versions | #13 | §1.8 | 5 stale + 1 live confirmed on disk |
| User-confirmed acceptance criteria at PRIME | #10 | not adjudicated | The only strong-evidence accuracy item; carry its caveats |
| OTel GenAI span emission | #8 | not adjudicated | Semconv attributes are still "Development" stability |
| Prompt-surface measurement | #9 | not adjudicated | **Blocked on the two-arm eval** |
| ~~Per-test regression granularity~~ | cut | — | Both passes say do not build. Confirm, then leave it out |
| ~~OS-level process confinement (full)~~ | #7 | cut | Cannot wrap the harness's Bash tool. The in-constraint target-oriented gate is folded into item 1 |

## Step 3 — Derive the order from dependencies, not from rank

Rank is an input. The build order is a DAG. Establish it yourself and show your working.

Sequencing rules that apply here:

- **Blocking dependencies win over rank.** The prompt-surface item cannot start before the eval
  runs. No measurement item should land before the corpus is decontaminated, or its first number is
  drawn from a poisoned set.
- **The registry wants the fixes ahead of it**, so their claims land in it as rows rather than
  needing retrofit.
- **One security change per release.** The repo's own rule, stated in `CHANGELOG.md` v0.5.2:
  head-allowlist inversion "wants its own release and its own paired run." Do not batch a
  containment fix with unrelated work.
- **Group by file only when it does not violate the above.** Several candidates touch
  `pre-tool.mjs`; that is a reason to sequence them adjacently, not a reason to merge them.
- **Cheap and severe goes first.** Item 1 is ~5 lines and is the most severe open defect.

Record the DAG in `docs/impl/00-INDEX.md` as a table: id · slug · depends-on · why-here · one-line
outcome. Any item whose position differs from its ideation rank gets a sentence explaining why.

## Step 4 — Write one prompt per feature

**Path:** `docs/impl/NN-<kebab-slug>.md`, `NN` being build order (`01`, `02`, …).

Every prompt must contain all of the following. A prompt missing any section is not finished.

1. **What is broken, with anchors.** The defect in two or three sentences, every claim carrying
   `file:line`. Include the paired-probe result or code reading that proves it is real *today*.
2. **What "fixed" means, behaviourally.** Stated as observable behaviour, not as a diff. "Exit 2
   instead of 0 for target X in state Y", not "add a guard to line N."
3. **Files:** the declared editable set, as literal repo-relative paths. This becomes the plan's
   `Files:` list, so it must be complete — the scope gate fails closed on anything outside it, and
   `parse-plan --lint` rejects an empty set.
4. **Must NOT do.** The scope prohibitions. Be specific; the file-scope harvest reads `Files:`
   only, so prohibitions here are for the executor's judgment, not the gate's.
5. **Acceptance criteria — executable commands, every one.** `parse-plan --lint` rejects criteria
   that are not runnable, and `record-verify` executes them and records the exit code as evidence.
   A criterion that a human has to read and agree with is not a criterion. Write them as the exact
   command plus the expected exit code.
6. **The paired probe.** Name the probe that must fail against the current build and pass against
   the fixed one, and state both expected results. This repo's rule: *a new invariant test must be
   demonstrated failing against the broken code before it counts.* A test asserting `exit === 2`
   that silently never runs is indistinguishable from a passing one.
7. **What it breaks.** Blast radius, including the legitimate workflows that will start failing.
   If the honest answer is "nothing", say why.
8. **The class it closes, and how it avoids reopening it.** v0.5.1 shipped a hole and its fix in the
   same regex. Name the class; state the specific way this change could reintroduce it; state what
   prevents that.
9. **Docs to update in the same change.** Every doc that states the claim this change alters:
   `README.md`'s comparison table, `DESIGN.md §6`, `references/scripts.md`, `SKILL.md`,
   `CHANGELOG.md`. A fix that leaves a doc asserting the old behaviour has created the next
   doc-code drift.
10. **CHANGELOG entry shape**, including a *Known, not fixed* line for anything the change
    deliberately leaves open. This repo names its residuals rather than letting the next audit find
    them.
11. **Capability routing.** The tri-state declaration the plan will need
    (`routed:` / `discovered:` / `generic:`). F5 cross-checks it against hook-witnessed skill and
    MCP loads, so declare only what will actually be loaded in the parent thread.
12. **Estimated size** in lines, and whether it is a patch, a minor, or wants its own release.

## Step 5 — Constraints every generated prompt must carry forward

Copy these into each prompt. A proposal that violates one is cut, not footnoted.

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active
- **No argv flag authenticates anyone** — every script is invocable by any agent with the same argv
  surface the operator has. A flag can remove a *silent* path; it cannot grant authority.
- Fail closed. An unverifiable state blocks; it never passes.
- A repo-capability check degrades to a recorded `inert`, never to a block. Over-blocking is a new
  failure of the class the change exists to remove.

## Step 6 — Check every prompt against the failure modes

State the check explicitly in each prompt. These are the five ways this project has actually failed:

1. **Enumeration instead of structure.** Three rounds of deny-list patterns produced three
   bypasses. Is this proposal another round?
2. **A check that cannot detect the class of failure it exists for.** `--verify` checked paths, not
   liveness. A runner reported success over an empty set. Can this check see its own failure?
3. **Ceremony without mechanism.** The repo built acceptance criteria as a ritual and skipped the
   executable part for months. Does this ship a mechanism or a convention?
4. **Self-grading.** The planner writes the criteria; the reviewer declines to judge them. Who
   grades this, and are they independent of who produced it?
5. **A fix that reopens its own class.** Covered by §4 item 8.

**Anti-goal, absolute:** no proposal may add another LLM opinion layer. Multi-agent debate degrades
accuracy; LLM judges run 56.6–65.7% on hard pairs with a 61.3% flip rate under paraphrase. If a
prompt proposes a new reviewer or verifier agent, it carries the burden of explaining why that
evidence does not apply — and the default answer is that it does.

## Step 7 — Self-check before you finish

Do not report done until all of these hold:

- [ ] Every candidate in Step 2 is either written up or explicitly dropped with a `file:line` reason
- [ ] `docs/impl/00-INDEX.md` exists and its DAG is acyclic, with every out-of-rank position justified
- [ ] Every prompt has all twelve sections from Step 4
- [ ] Every acceptance criterion in every prompt is an executable command with an expected exit code
- [ ] Every prompt names a paired probe with both directions stated
- [ ] No prompt violates a Step 5 constraint
- [ ] No prompt adds an LLM opinion layer
- [ ] Every `file:line` you cite resolves in the current tree — spot-check them, do not assume
- [ ] The suite is still green (you should not have changed code, so this is a tripwire)

Report: the order you chose and why, anything you dropped and why, and any place where the code
disagreed with both ideation documents. That last category is the most valuable thing you can
find — say it plainly rather than reconciling it quietly.

---

## Worked shape — what one output should look like

Abbreviated. Yours are fuller; this fixes the register and the level of specificity.

> ### 01 — Close the Edit-path containment escape
>
> **What is broken.** The Edit-path scope check — plan-sha tamper guard, declared-`Files:`
> containment, fail-closed catch — is wrapped in `if (rel) {` at
> `skills/odyssey/hooks/pre-tool.mjs:817`. `classifyTarget`
> (`skills/odyssey/hooks/pre-tool.mjs:664-726`) returns `rel: ""` for any target outside both the
> run repo and `PROJECT_DIR`, so the check is skipped, the file-lock branch at `:894` is skipped
> too, and control reaches `exit(0)` at `:937`. Post-OKAY, `Write` to
> `skills/odyssey/hooks/pre-tool.mjs` and to `~/.zcode/cli/config.json` both return exit 0 against
> the deployed build. The Bash twin returns 2 for the same targets.
>
> **Fixed means.** A target that cannot be classified as inside the run repo or `PROJECT_DIR` is
> blocked on the Edit path, matching the Bash path. Declared in-scope targets are unaffected.
>
> **Files:** [`skills/odyssey/hooks/pre-tool.mjs`, `skills/odyssey/hooks/pre-tool.scope.test.mjs`]
>
> **Must NOT do:** widen the declared set; touch the Bash path's classifier; add a new pattern to
> `WRITE_PATTERNS`.
>
> **Acceptance criteria**
> - `node scripts/run-tests.mjs` exits 0
> - `node skills/odyssey/hooks/pre-tool.scope.test.mjs` exits 0
> - the new outside-`PROJECT_DIR` cases in that suite exit 2 where they previously exited 0
>
> **Paired probe.** `Edit` → an absolute path outside `PROJECT_DIR`, run against a worktree at the
> current HEAD and against the fix. Expected: **0 before, 2 after**. In-repo declared and undeclared
> controls must be unchanged (0 and 2 respectively) on both builds — a probe that changes those has
> over-blocked.
>
> **What it breaks.** Any run legitimately editing outside its repo. There should be none: the Bash
> twin already refuses, so this converges the two paths rather than adding a restriction.
>
> **Class closed.** "A guard added to one path and not its twin" — the shape v0.5.0 was written to
> hunt and left standing here. Reopening risk: a future guard added to the Bash classifier only.
> Prevented by asserting both paths in the same test for each target class.
>
> **Docs:** `CHANGELOG.md` (move this out of *Known, not fixed*), `README.md` comparison table,
> `DESIGN.md §6` scope-boundary row.
>
> **Size:** ~5 lines of hook change, ~40 lines of test. Patch release, shipped alone.
