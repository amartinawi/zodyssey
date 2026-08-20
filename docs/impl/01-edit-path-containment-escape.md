# 01 — Close the Edit-path containment escape

Build order **01** · depends-on **—** (nothing precedes or blocks it) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `01 edit-path-containment-escape` · security-class · patch · shipped alone.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast. Do exactly this one change.

## What is broken

The Edit-path scope boundary — plan-sha tamper guard, declared-`Files:` containment, and the
fail-closed catch for unreadable plans — is entirely wrapped in `if (rel) {` at
`skills/odyssey/hooks/pre-tool.mjs:817`, and the file-lock branch below it re-uses the same guard
at `skills/odyssey/hooks/pre-tool.mjs:904`. `classifyTarget`
(`skills/odyssey/hooks/pre-tool.mjs:664-726`) initializes `let rel = ""` at `:677` and assigns
`rel` only inside the run-repo branch (`:681-692`) or the `PROJECT_DIR` branch (`:694-717`). A
target that resolves outside **both** roots therefore returns `rel: ""`: the scope gate at `:817`
is skipped, the lock at `:904` is skipped, and control falls through to the allow at
`skills/odyssey/hooks/pre-tool.mjs:996`.

The escape is **post-OKAY only**. Pre-OKAY, outside targets are blocked by the unconditional
verdict gate at `skills/odyssey/hooks/pre-tool.mjs:798`; the comment at `:796` ("Outside
PROJECT_DIR entirely and not bookkeeping → treat as product code (gated)") is true only for that
window. Once `review.verdict == "OKAY"`, an executor may edit any absolute path outside the run
repo and `PROJECT_DIR` — `~/.zcode/cli/config.json`, `/etc/...`, a sibling project — with no scope
check, no plan-sha re-hash, and no file lock.

The Bash twin already fails closed for the same targets: `quickClassify`
(`skills/odyssey/hooks/pre-tool.mjs:290-300`) deliberately returns
`{ rel: abs, bookkeeping: false, isState: false }` for anything outside the run repo
(`:298-299`, comment: "outside the run repo entirely → treat as product code (will fail the
inScope check, blocking it)") — a non-empty `rel` precisely so the Bash path's containment bites.

**Demonstrated live, both directions (2026-08-16, active post-OKAY run `impl-prompts-v0-6` in this
repo, phase `execute`):**

- `Edit` targeting `/etc/zodyssey-escape-probe.txt` → hook exit **0** (allowed). That is the escape.
- Control, same run: `Edit` targeting the in-repo undeclared
  `/home/amar/Desktop/ZOdyssey/undeclared-control.txt` → exit **2**, `SCOPE VIOLATION:
  undeclared-control.txt is not in the plan's declared Files: scope` — proves the run was
  discovered and the in-repo gate armed, so the first result is the escape, not a no-op.
- Bash twin, same outside target: write-capable `echo x >> /etc/zodyssey-escape-probe.txt` →
  exit **2**, `SCOPE VIOLATION (Bash)`. (Pinned `ZODYSSEY_UNGATE_BASH=` empty — an ambient `=1`
  bypasses the entire Bash gate; that escape hatch is queue item 04's territory, not this
  change's.)

Already named in the ledger: `CHANGELOG.md:334` (v0.5.1, *Known, not fixed*) — "The Edit-path scope
gate is skipped for targets outside `PROJECT_DIR` (`if (rel)` with `rel` empty), while the Bash
twin fails closed."

## What fixed means

Stated as observable behaviour, not as a diff:

1. In an active run, any phase, with `review.verdict == "OKAY"`: an Edit-family event (tool list
   at `skills/odyssey/hooks/pre-tool.mjs:583` — `Write`, `Edit`, `ApplyPatch`, `MultiEdit`,
   `NotebookEdit`) whose target resolves outside both the run repo and `PROJECT_DIR` exits **2**
   with a `SCOPE VIOLATION` message naming the target — the same outcome the Bash twin produces
   today.
2. Everything else is unchanged, byte for byte: declared in-repo targets exit 0; undeclared
   in-repo targets exit 2 (`:850-858`); bookkeeping (`.zcode/plans/`, `.zcode/notepads/`,
   `.zcode/staging/`) exits 0 (`:758-772`); an existing notepad under `Write` still trips the
   append-only guard; `.zcode/state/` targets exit 2 (`:739`); pre-OKAY outside targets already
   exit 2 (`:798`); with no active run the hook is a no-op exit 0.
3. A plan that literally declares an outside absolute path in `Files:` keeps working: containment
   at `skills/odyssey/hooks/pre-tool.mjs:850-851` is an exact-or-prefix string match on `rel`, so
   once `rel` carries the absolute path, a declared exact match passes. The fix blocks only
   UNdeclared outside targets.

**Preferred implementation (~5 lines):** converge `classifyTarget` with `quickClassify` — for a
target outside both roots, return `rel: <absolute path>` with `bookkeeping: false, isState: false`,
mirroring the fall-through at `:298-299`. The existing `if (rel)` boundary, tamper guard,
containment, fail-closed catch, and lock branch then apply verbatim, and the two twins' classifiers
become shape-identical. (The INDEX outcome line phrases the result as "the `if (rel)` branch is
gone"; deleting the conditional instead is equally valid provided the criteria below hold — the
criteria are the contract, not the mechanism.)

Two edges to handle knowingly, not accidentally:

- **No-target events.** `if (!p)` at `skills/odyssey/hooks/pre-tool.mjs:665` returns `rel: ""` for
  an Edit payload with no resolvable path, which still falls to the allow at `:996`. The standing
  rule says an unverifiable target should Fail closed — but widening this change past the
  demonstrated class is out of scope. If you leave it, name it in *Known, not fixed*.
- **Root equality.** A target exactly equal to the run repo or `PROJECT_DIR` yields `rel: ""` on
  BOTH paths today (`quickClassify`'s early return behaves identically), and the tools themselves
  reject directory targets. Identical edge on both twins means convergence is preserved — leave it
  and name it.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/hooks/pre-tool.mjs`
- `skills/odyssey/hooks/pre-tool.scope.test.mjs`

Nothing else. The docs listed under "Docs to update" belong to the release pass, not the gated
run: a post-OKAY executor cannot edit files outside this declared set (the scope gate enforces
exactly that), so the doc edits either ride the release commit outside the run, or the plan is
deliberately widened to list each doc literally. Do not widen it by default.

## Must NOT do

- Do not touch the Bash path — `quickClassify` at `skills/odyssey/hooks/pre-tool.mjs:290-300` or
  the Bash branch from `:1158` on. The twin is already correct; converging means changing the
  EDIT classifier, not both.
- Do not add or edit any `WRITE_PATTERNS` entry, and do not introduce a new deny-list or
  allow-list pattern anywhere. The fix is structural classification, not enumeration — see
  failure-mode check 1 below.
- Do not change pre-OKAY behaviour. `:798` already blocks outside targets; touching it is
  regression risk with no defect to fix.
- Do not modify any existing `SEC-*` member — security checks in this file are append-only; new
  checks are additive siblings.
- Do not fix the adjacent named residuals (new-file lexical-resolution symlink redirect,
  `CHANGELOG.md:335`; the unlocked state writes) — separate releases.
- Do not add a reviewer, judge, or verifier agent. **No LLM opinion layer** — every verification
  in this change is an exit code.

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

**This change's exposure: 52 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/hooks/pre-tool.mjs` (51), `skills/odyssey/hooks/pre-tool.scope.test.mjs` (1).

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
2. `node skills/odyssey/hooks/pre-tool.scope.test.mjs` — expected exit **0** (the suite prints
   `N passed, 0 failed`; the new block from this change is included in N).
3. `node --test skills/odyssey/hooks/pre-tool.scope.test.mjs` — expected exit **0**.
4. `node skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` — expected exit **0**. Mandatory after
   ANY `pre-tool.mjs` edit: this is the suite that exists to catch a third silent deletion of the
   Bash gate.
5. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16. The count may legitimately grow; the exit code must not change.
6. The paired direction — proof the new assertions actually run against the broken code. In TDD
   order you demonstrate this BEFORE writing the fix (add the failing cases, watch the suite go
   red), and it stays re-provable on demand:
   `git stash push -- skills/odyssey/hooks/pre-tool.mjs && node skills/odyssey/hooks/pre-tool.scope.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only the hook reverted, the new outside-target cases fail
   (old hook allows, exit 0, assertion ✗) and the suite exits 1.
7. Live probe, same form as today's demonstration:
   `printf '%s' '{"tool_name":"Edit","tool_input":{"file_path":"/etc/zodyssey-escape-probe.txt"}}' | node skills/odyssey/hooks/pre-tool.mjs`
   — expected exit **2** when invoked with an active post-OKAY run in scope (the fix-run's own run
   qualifies; the plan declares nothing under `/etc/`). The no-run control — invoked from a
   directory with no active run — exits **0** (hooks are no-ops then; that is a control, not a
   failure). For the Bash-twin variant, pin `ZODYSSEY_UNGATE_BASH=` empty as the existing suite
   already does at `skills/odyssey/hooks/pre-tool.scope.test.mjs:60`.

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** Not another deny-list round: this fix adds no pattern and
   no list. It converges classification so the UNCLASSIFIABLE class itself fails closed (outside
   both roots → not in declared scope → block). There is nothing to enumerate, and no novel target
   shape can slip past by being unlisted.
2. **A check that cannot detect the class of failure it exists for.** Criterion 6 is the tripwire:
   the new assertions are demonstrated failing against the broken code, so a silently-skipped or
   never-run assertion cannot pass unnoticed.
3. **Ceremony without mechanism.** This ships a hook code change plus a regression-suite
   extension — a mechanism, not a convention.
4. **Self-grading.** Every criterion is machine-executed with a recorded exit code; the paired
   probe runs against both builds. Nobody grades prose.
5. **A fix that reopens its own class.** Covered in "The class it closes" — twin parity is
   asserted in the same test, per target class.

## Paired probe

**Probe:** an Edit-family event targeting an absolute path outside `PROJECT_DIR` and outside the
run repo (canonical form: `/etc/zodyssey-escape-probe.txt`), against an active post-OKAY run.

- **Before the fix (current HEAD): exit 0** — allowed. Demonstrated live on 2026-08-16 (recorded
  above); reproducible via criterion 7's command, or by the new suite cases under the `git stash`
  reversion in criterion 6.
- **After the fix: exit 2** — `SCOPE VIOLATION` naming the target, convergent with the Bash twin's
  live exit 2 on the same target.

Unchanged controls, required on BOTH builds — a probe that moves any of them has over-blocked:

| Control | Before | After |
|---|---|---|
| Edit, in-repo path declared in `Files:` | 0 | 0 |
| Edit, in-repo path NOT declared | 2 | 2 |
| Edit, outside target, verdict ≠ OKAY (pre-OKAY) | 2 (`:798`) | 2 |
| Write/Edit, `.zcode/plans/` · `.zcode/notepads/` · `.zcode/staging/` | 0 | 0 |
| Write, an existing notepad (append-only guard) | 2 | 2 |
| Edit, `.zcode/state/` target (`isState` guard) | 2 | 2 |
| Bash twin, write-capable, same outside target (UNGATE empty) | 2 | 2 |

## What it breaks

Legitimate workflows that start failing: post-OKAY Edit-family writes to absolute paths outside
the run repo and `PROJECT_DIR` that are NOT declared in the plan's `Files:`. The honest blast
radius is near zero, because the Bash twin already refuses the identical targets (demonstrated
above): any workflow that "needed" this path was already broken for every write-capable Bash
command — this converges the two tools rather than adding a restriction. A plan that deliberately
declares an outside absolute path keeps working (exact-match semantics at
`skills/odyssey/hooks/pre-tool.mjs:850-851`). Nested-repo runs are unaffected — their targets
classify through the run-repo branch (`:681-692`). No existing Edit-path assertion flips: the
scope suite builds all 18 of its target paths inside the run repo (`join(repo, …)` throughout
`skills/odyssey/hooks/pre-tool.scope.test.mjs`), and the `/tmp` mentions in the other `pre-tool`
suites are Bash-path commands, not Edit targets.

## The class it closes

**A guard added to one path and not its twin.** In this repo's own words:
`skills/odyssey/hooks/pre-tool.mjs:287-289` — the v0.5.0 fix for T1-5 "armed `isState` on the Edit
path only, which is the very Class A shape this release exists to close — a guard added to one
path and not its Bash twin" (full account at `CHANGELOG.md:378`, including that the suite did
NOT catch it — a re-verification against 0.4.1 did); and v0.5.1 shipped the same shape again in the
nonce lane — exact-match guard on one site, segment-tolerant matching on its twin
(`CHANGELOG.md:312`). This instance is the shape inverted in origin but identical in effect: the
Bash path's classifier never returns an empty `rel` for a real target (`:298-299`), while the Edit
path's does (`:677` init, assignment only inside guarded branches) — so every guard hanging off
`if (rel)` exists on one path and not the other.

How this change could reintroduce the class: any future edit to ONE classifier (hardening
`quickClassify`'s fall-through without touching `classifyTarget`, or vice versa), or a new tool
name added to the list at `:583` without twin coverage. What prevents it: (a) the new test block
asserts BOTH paths against the SAME outside target in the same suite, so twin divergence fails the
build; (b) the preferred implementation makes the two classifiers shape-identical, removing the
structural difference the class feeds on; (c) the fix adds no pattern that can drift out of sync —
there is no list to keep in sync.

## Docs to update

Every doc that states the claim this change alters ("an executor may only edit declared files" /
"fails closed"), each checked against the 2026-08-16 tree:

- `CHANGELOG.md:334` — move the v0.5.1 *Known, not fixed* bullet into the new version's **Fixed**
  (shape below).
- `README.md:121` — comparison-table row "Executor stays in declared scope … blocks edits outside
  it. **Fails closed** on unreadable/empty plan": extend to state that containment covers targets
  outside the repo entirely, converged with the Bash write-gate. The mermaid at `README.md:94-95`
  already implies it — verify, don't rewrite.
- `docs/DESIGN.md:259` (§6 hook table, scope-boundary row): same extension — "outside it"
  includes outside-`PROJECT_DIR`/run-repo targets. Adjacent drift in the SAME row: it still reads
  "Runs in all phases except `final`", stale since SEC-5 removed the carve-out (in-code history at
  `skills/odyssey/hooks/pre-tool.mjs:810-813`) — correct it only if `DESIGN.md` is in the release's
  editable set; otherwise record the drift, do not silently widen scope.
- `skills/odyssey/references/scripts.md` — checked: it states nothing about Edit-path containment
  (its scope mentions are `parse-plan --files` and F1). **No edit required.** Recorded here so the
  next reader does not hunt.
- `skills/odyssey/SKILL.md` — checked: `:8` lists hook invariants without restating containment,
  and `:379` mentions only the `phase=final` scope gate. No statement of the altered claim, so
  **no edit required** (optionally add scope containment to the `:8` invariant list — a wording
  addition, not a correction).

## CHANGELOG entry shape

New version `0.5.3` (patch). **One security change per release, shipped alone** — the repo rule,
with its own precedent at `CHANGELOG.md:273` (a structural gate change "wants its own release and
its own paired run"). Do NOT batch queue items 03 or 04 into this release even though they touch
the same file.

- **Fixed** — one entry: the Edit-path scope gate now fails closed for targets outside
  `PROJECT_DIR` and the run repo, matching the Bash write-gate. State the mechanism in one clause
  (classification convergence — `if (rel)` is no longer skippable for real targets) and name the
  paired-probe evidence (exit 0 → 2, both directions, controls unchanged). This repo cites its
  probes, not just its diffs.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - Edit events with no resolvable target path still pass (`if (!p)` at
    `skills/odyssey/hooks/pre-tool.mjs:665`) — left open if the minimal fix leaves it.
  - Root-equality edge: a target exactly equal to the run repo or `PROJECT_DIR` returns `rel: ""`
    on both twins; the tools reject directory targets themselves.
   - Pre-existing residuals this change does not touch: the new-file lexical fallback / symlink
     redirect (`CHANGELOG.md:335`), the unlocked state writes.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the marketplace cache picks up the hook — a fix that stays only in
  the repo protects no run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is a pure code-logic change and the run's whole method is red-green: load the TDD skill via
the Skill tool in the executor thread, write the failing outside-target cases first (criterion 6's
demonstration), then make them green. F5 cross-checks the declaration against hook-witnessed loads
(`skills/odyssey/references/scripts.md:22`), so a declaration without a real load fails the final
wave — declare nothing speculative. No `discovered:`/`generic:` (no find-skills call is planned)
and no `mcp:` declarations (none will be loaded). If a test fails in a way two fix attempts do not
diagnose, loading `systematic-debugging` is correct — declare it only if it is actually loaded,
after the fact, never in anticipation.

## Estimated size

~5 lines in `skills/odyssey/hooks/pre-tool.mjs` — the `classifyTarget` fall-through return plus a
comment mirroring `:298-299` — and ~40 lines in `skills/odyssey/hooks/pre-tool.scope.test.mjs`:
one new block reusing the existing `repoWithScope`/`hook` harness (`:40-61`), containing the
outside-target Edit case, the Bash-twin parity case, and the pre-OKAY and declared/undeclared
controls. Patch release, security-class, shipped alone, with its own paired run.
