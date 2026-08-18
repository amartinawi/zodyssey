# 04 — Record every ungated Bash call (`ZODYSSEY_UNGATE_BASH`)

Build order **04** · depends-on **—** (no build edge; sequenced after 01's and 03's releases only by
the one-security-change-per-release cadence, `CHANGELOG.md:121` — grouped adjacently with 01/03
because all three touch `skills/odyssey/hooks/pre-tool.mjs`, explicitly NOT merged with either) ·
queue row: [`docs/impl/00-INDEX.md`](00-INDEX.md) `04 ungate-bash-record-or-retire` ·
security-class · patch · shipped alone.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast. Do exactly this one change.

## What is broken

One environment variable disables the entire Bash write-gate with no audit trail. At
`skills/odyssey/hooks/pre-tool.mjs:1007` the check

`if (isBash && process.env.ZODYSSEY_UNGATE_BASH === "1") exit(0);`

is the first executable statement of the Bash branch (the decision-tree comment above it spans
`:940-977`), so with the variable set, **every** Bash call — read-only or write-capable, pre- or
post-review, in-scope or not — exits 0 past the verdict gate, the SEC-4 plan-sha tamper guard, and
the per-target scope check, and nothing anywhere records that it happened. The affordance is
deliberate and documented: the hook's own comment (`skills/odyssey/hooks/pre-tool.mjs:984-987`,
"POWER-USER ESCAPE HATCH"), the installer's AGENTS.md template written into every user's repo at
`scripts/install.mjs:883` ("set \`ZODYSSEY_UNGATE_BASH=1\` to disable if you trust your agents"),
the env table at `docs/INSTALL.md:152`, and the README comparison row at `README.md:121`. It
originated as the author's personal low-friction setup (`CHANGELOG.md:708`).

The defect is not that the hatch exists — it is that the hatch is **silent and ambient-leakable**.
Two pieces of in-repo history prove the silence is the dangerous part, not the openness:

- The Bash gate has been deleted **twice** — v0.1.1 (5c99927) and v0.2.0 (e57b01b) — and both
  deletions trace to exactly this variable's silent ambient presence in a private copy being
  mirrored into a public release. The regression suite's header records it:
  `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:3-11` ("the Bash gate has been silently deleted
  TWICE … v0.1.1 shipped it deleted — the author's local ZODYSSEY_UNGATE_BASH=1 copy was mirrored
  to the public repo verbatim"). During the ungated v0.2.0 window, "`ZODYSSEY_UNGATE_BASH` survived
  in four documentation locations and **zero lines of executable code**" (`CHANGELOG.md:483`), and
  the v0.1.2 restore entry (`CHANGELOG.md:648`) carries the post-mortem note that the first fix
  "did not hold".
- Observed live during this queue's own probing (2026-08-16, prompt 01's Bash-twin probe, recorded
  in run `impl-prompts-v0-6`): an executor shell whose ambient environment carried
  `ZODYSSEY_UNGATE_BASH=1` silently re-opened the Bash gate mid-probe — the first unpinned probe
  exited 0 with no visible cause, and only pinning the variable empty
  (`ZODYSSEY_UNGATE_BASH=`, as five test files already do, e.g.
  `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:84`) restored the block. Today such ambient
  leakage is invisible; the operator has no way to know the gate is standing open.

The one assertion that covers the hatch today confirms only that it opens:
`skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:157-158` — "ZODYSSEY_UNGATE_BASH=1 opens the gate
(documented hatch is real)". Nothing asserts anyone can see afterwards that it opened.

### The decision, argued both ways

Two options were on the table for this queue row: **retire the variable** or **record every
ungated call**.

- *For retiring:* one env var erasing the entire Bash gate is a standing single-point bypass of
  every enforcement this project exists to provide — the v0.1.1 incident
  (`skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:5-6`) is literally the variable's silent
  ambient presence shipping as a deleted gate. An operator who never sets it gains nothing from
  its existence; an operator who sets it accidentally loses everything.
- *For recording (and against retiring):* retirement breaks a legitimate, documented, four-anchor
  affordance (`scripts/install.mjs:883`, `docs/INSTALL.md:152`, `README.md:121`,
  `skills/odyssey/hooks/pre-tool.mjs:984-987`) whose explicit contract is low-friction operation
  for operators who "trust your agents" — a real use case this repo's own author is. And the
  deletion history is causal evidence **against** removal, not for it: the gate was deleted twice
  while the escape hatch existed, and each time the cause was the hatch's *silence*, never its
  existence. Removing the affordance does not remove the failure mode — an operator who wants
  friction-free Bash will find the next silent lever (uninstalling the hook, `--skip`, deleting
  the suite). Making every bypass a visible row removes the actual cause.

**Committed decision: RECORD, do not retire.** The gate still opens when the operator sets the
variable; from that moment on, every call that walks through the open gate leaves a row in the
run's state, and the run report says how many did. Recording, not refusing.

## What fixed means

Stated as observable behaviour, not as a diff:

1. With an active run in scope (any phase), `ZODYSSEY_UNGATE_BASH=1`, and a Bash tool call: the
   hook still exits **0** — the hatch opens exactly as documented — and, immediately before that
   exit, appends one JSON line to the per-run ledger
   `.zcode/state/<slug>.ungated.jsonl` carrying at least `{ "at": <ISO-8601 timestamp>,
   "command": <the full command string> }`. Every call that takes the `:978` exit is recorded —
   read-only commands included — because the check is the first executable statement of the Bash
   branch, and filtering "what to record" by write-capability would re-run the very analysis the
   hatch exists to skip and would couple the ledger to gate internals. This is a decision, not an
   accident: under the hatch, the hook's job is to witness, not to judge.
2. With the variable unset or empty, nothing changes anywhere: write-capable undeclared Bash still
   exits 2 with the same messages, read-only still exits 0, and **no ledger file is created** — the
   ledger records bypasses, not ordinary traffic. A blocked call writes no record (it never took
   the hatch exit).
3. The run report surfaces the count. `skills/odyssey/scripts/run-report.mjs` reads the ledger if
   present and emits an integer field `ungated_bash_calls` in its `--json` object (0 when the file
   is absent) plus one scorecard line, following the exact precedent of `hook_blocks`
   (`skills/odyssey/scripts/run-report.mjs:72-79`, report field at `:124`). Because
   `skills/odyssey/scripts/set-phase.mjs:430-450` already pipes `run-report --json` into the trend
   log at `done`/`audited`, the count lands in `results.jsonl` with no `set-phase.mjs` change.
4. Recording is never itself gated: no second environment variable, flag, or phase condition may
   enable, disable, or filter the ledger write. If the variable is set and a run is active, the
   record happens.
5. A failed ledger write degrades to a **recorded no-op**, never a run failure: the append is
   wrapped best-effort (same posture as the payload probe at
   `skills/odyssey/hooks/pre-tool.mjs:562-571` and every other hook-side state write); on failure
   the hook emits one stderr line naming the ledger path and the failure and still exits 0. The
   hatch is the operator's explicit choice — a write error must not silently revoke it, and stderr
   is the only channel a PreToolUse hook has that reaches the transcript.
6. With no active run, behaviour is unchanged: the no-run exit at
   `skills/odyssey/hooks/pre-tool.mjs:548` fires long before `:978`, so there is no slug, no
   ledger, and the hook stays a no-op exit 0 (Step-5 constraint: every hook is a no-op unless a
   run is active).
7. A shared test asserts the class, not just this instance: the regression suite scans the hook's
   own source and asserts that **every** `process.env.ZODYSSEY_*` read whose branch guards an
   early `exit(0)` (the bypass shape) routes through the recorder between the env read and the
   exit. Exactly one such site exists today (`:978`); a future bypass variable added without a
   recording path fails the suite (see "The class it closes").

**Preferred implementation (~12 lines in the hook):** a `recordUngatedBash(cmd)` helper —
`appendFileSync(join(RUN_STATE_DIR, `${state.slug}.ungated.jsonl`), JSON.stringify({ at: new
Date().toISOString(), command: cmd }) + "\n")` inside try/catch with the stderr fallback — called
immediately before the `exit(0)` at `:978`. Both `RUN_STATE_DIR` and `state.slug` are already in
scope there (`:553`, `:548`), and per-run sidecar files in `.zcode/state/` have two in-file
precedents (the parallel-cap ledger at `:343-346`, the payload probe at `:562-571`). The `.jsonl`
suffix cannot be mistaken for a state file by run discovery (which matches `*.json`). The criteria
below are the contract, not the mechanism.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/hooks/pre-tool.mjs`
- `skills/odyssey/scripts/run-report.mjs`
- `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs`

Nothing else. `set-phase.mjs` is deliberately absent: the trend-log surface comes free through the
existing `run-report --json` pipe (`skills/odyssey/scripts/set-phase.mjs:430-450`). The docs listed
under "Docs to update" belong to the release pass, not the gated run: a post-OKAY executor cannot
edit files outside this declared set, so the doc edits either ride the release commit outside the
run, or the plan is deliberately widened to list each doc literally. Do not widen it by default.

## Must NOT do

- Do **not** remove, disable, or conditionalize the affordance. The `:978` check still exits 0 for
  every Bash call when the variable is set; this change adds a witness beside the exit, never a
  second opinion in front of it. Retirement was considered and rejected (see the decision above);
  do not re-litigate it in code.
- Do **not** weaken the gate further: no new bypass, no loosened `WRITE_PATTERNS`, no extra
  trusted-invokable path, no read of the hatch earlier in the flow than `:978`.
- Do **not** gate the recording itself behind another environment variable, flag, argv option, or
  phase check. If the hatch fired and a run is active, the ledger write is attempted —
  unconditionally.
- Do **not** make a failed ledger write block the call or fail the run. The degradation path is
  one stderr line and exit 0 (a recorded no-op) — a recording tool that is absent or a state dir
  that is unwritable must not turn the operator's chosen hatch into a surprise re-gate.
- Do not filter what gets recorded through `looksReadOnly`, `bashWriteTargets`, or any gate
  classifier — recording is unconditional at the hatch exit (see fixed-means item 1).
- Do not modify any existing `SEC-*` member — security checks in this file are append-only; the
  recorder is an additive sibling at the hatch site, not an edit inside a `SEC-x` block.
- Do not batch this into 01's or 03's release in the CHANGELOG — one security change per release
  (`CHANGELOG.md:121`: a structural gate change "wants its own release and its own paired run").
- Do not add a reviewer, judge, or verifier agent. **No LLM opinion layer** — the ledger is
  `appendFileSync`, the count is `wc -l`, and every verification in this change is an exit code.

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

**This change's exposure: 97 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/hooks/pre-tool.mjs` (51), `skills/odyssey/scripts/set-phase.mjs` (29), `skills/odyssey/scripts/run-report.mjs` (9).

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
2. `node --check skills/odyssey/scripts/run-report.mjs` — expected exit **0**.
3. `node skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` — expected exit **0** (the suite prints
   `N passed, 0 failed`; the new ledger, report-count, and structural-bypass assertions are
   included in N).
4. `node --test skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` — expected exit **0**. Mandatory
   after ANY `pre-tool.mjs` edit: this is the suite that exists to catch a third silent deletion of
   the Bash gate.
5. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16. The count may legitimately grow; the exit code must not change.
6. The paired direction — proof the new assertions actually run against the broken code. In TDD
   order you demonstrate this BEFORE writing the fix (add the ledger assertions, watch the suite
   go red against current HEAD), and it stays re-provable on demand:
   `git stash push -- skills/odyssey/hooks/pre-tool.mjs && node skills/odyssey/hooks/pre-tool.bash-gate.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only the hook reverted, an ungated fixture call exits 0 but
   writes no ledger line, the new ledger assertion fails, and the suite exits 1.
7. Live probe, ungated direction — run inside the fix-run's own repo (its active run provides the
   slug; the probe command itself is harmless and, by design, becomes the first row of the fix-run's
   own ledger — the mechanism demonstrating itself):
   `printf '%s' '{"tool_name":"Bash","tool_input":{"command":"echo ungate-ledger-probe"}}' | ZODYSSEY_UNGATE_BASH=1 node skills/odyssey/hooks/pre-tool.mjs`
   — expected exit **0** (the hatch still opens), followed by
   `grep -q 'echo ungate-ledger-probe' .zcode/state/*.ungated.jsonl`
   — expected exit **0** (the call that walked through the hatch left a record). Run this pair
   BEFORE criterion 8 so the glob has a file to match.
8. Live probe, gated direction — the control that proves the ledger is a bypass-witness, not
   blanket surveillance:
   `printf '%s' '{"tool_name":"Bash","tool_input":{"command":"echo x >> ungated-ledger-control.txt"}}' | ZODYSSEY_UNGATE_BASH= node skills/odyssey/hooks/pre-tool.mjs`
   — expected exit **2** (write-capable, undeclared target: blocked by the scope gate post-OKAY or
   the review gate pre-OKAY — either way 2, today and after), followed by
   `grep -q 'ungated-ledger-control' .zcode/state/*.ungated.jsonl`
   — expected exit **1** (no record: the call was blocked, it never took the hatch exit).
9. The report surface, on the fix-run's own state (non-zero because criterion 7 wrote at least one
   row into it):
   `test "$(node skills/odyssey/scripts/run-report.mjs . "$(ls .zcode/state/*.ungated.jsonl | head -1 | xargs basename | sed 's/\.ungated\.jsonl$//')" --json | grep -o '"ungated_bash_calls":[0-9]*' | grep -o '[0-9]*$')" -ge 1`
   — expected exit **0**. (The suite's fixture-based assertion covers the zero case: a run with no
   ledger file reports `"ungated_bash_calls":0`, never errors.)

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** No deny-list, no pattern round: the recorder is an
   unconditional append at the single point where authority is bypassed. The structural
   source-scan assertion is itself structural, not enumerative — it names no variable; it says
   "every env-read-that-early-exits must pass the recorder".
2. **A check that cannot detect the class of failure it exists for.** Criterion 6 is the tripwire:
   the ledger assertions are demonstrated failing against the broken code. The source-scan
   assertion is self-detecting in a second way — if the recorder helper were renamed or moved, the
   scan itself fails (it looks for the routing token), so the guard cannot silently rot into a
   tautology.
3. **Ceremony without mechanism.** This ships a jsonl ledger, a report field, and suite assertions
   — all machine-checked. The convention "please be careful with UNGATE" already existed; the
   witness did not.
4. **Self-grading.** Every criterion is an exit code recorded by `record-verify`; the count in the
   trend log is computed from the artifact by `run-report.mjs`, not attested by any agent.
5. **A fix that reopens its own class.** Covered in "The class it closes" — the shared
   every-bypass-site-has-a-recording-path assertion.

Anti-goal, absolute: no **LLM opinion layer**. This change adds no reviewer, judge, or verifier
agent; its outputs are file lines, an integer, and exit codes.

## Paired probe

**Probe:** a Bash tool call in an active run, both directions of the hatch, plus the controls that
prove nothing else moved. Fixture forms live in the suite; the live forms are criteria 7-8.

| Call | Before (current HEAD) | After |
|---|---|---|
| `echo ungate-ledger-probe` with `ZODYSSEY_UNGATE_BASH=1` | exit **0**, no record anywhere — **the silence** | exit **0**, one ledger line in `.zcode/state/<slug>.ungated.jsonl`, report count +1 |
| `echo x >> undeclared.txt` with the variable unset/empty | exit **2** (scope/review gate), no record | exit **2**, no record — unchanged |
| `ls` (read-only) with the variable unset | exit **0**, no record | exit **0**, no record — read-only passthrough is not a bypass |
| `node …/skills/odyssey/scripts/set-phase.mjs …` (trusted invoke), variable unset | exit **0**, no record | exit **0**, no record — branch 2, not the hatch |
| Any Bash call with the variable set, **no active run** | exit **0** (`:548`), no ledger | exit **0**, no ledger — a no-op hook audits nothing |
| `run-report.mjs <repo> <slug> --json` | no `ungated_bash_calls` field | `"ungated_bash_calls": N` (0 with no ledger) |

A probe that changes any exit code in the "After" column has over-reached (the hatch must still
open, the gate must still block); a probe whose "After" column lacks the ledger row has shipped
nothing. The "before" column for row 1 was corroborated live on 2026-08-16 in both forms: the
suite's existing hatch assertion (`skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:157-158`) and
the ambient-leakage incident recorded in "What is broken".

## What it breaks

Operators who relied on **totally silent** ungating — the documented personal low-friction setup
(`docs/INSTALL.md:152`, `CHANGELOG.md:708`). After this change, every ungated run leaves: a ledger
file under `.zcode/state/` (one JSON line per Bash call — bounded by the run's Bash call count,
gitignored with all of `.zcode/`, and small next to the transcript itself), an
`ungated_bash_calls` integer on every scorecard, and that same integer in every trend-log record
via the existing auto-append (`skills/odyssey/scripts/set-phase.mjs:430-450`). No exit code changes
for anyone — not the operator with the variable set (still 0), not anyone without it (gates
unchanged), and the existing hatch assertion at `:157-158` still passes untouched.

Visible-by-default beats silent here for a reason this repo has paid for twice: the gate's two
deletions (`skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:3-11`, `CHANGELOG.md:483`) were both
silent ambient leakage of exactly this variable becoming shipped code, and neither was noticed
until after release — three external audits missed the second one. The 2026-08-16 ambient-leak
incident is the same shape at miniature scale: a probe quietly passed and nothing on the operator's
side said why. An operator whose gate is standing open for any reason — their own choice or an
inherited environment — now reads it off the scorecard instead of discovering it in a post-mortem.
The cost of that visibility is one line of JSON per shell call; the cost of the alternative is
quoted in the regression suite's header.

## The class it closes

**A silent authority-bypass affordance** — an opt-out that removes enforcement without leaving a
witness. This is the affordance-class sibling of the divergence family 01 and 03 close (enforcement
present in one build and absent in another): v0.1.1's public/private divergence
(`CHANGELOG.md:648`) was not a logic bug at all — it was this variable's silent ambient presence in
a private copy being mirrored verbatim. The silence, not the openness, was the failure mode both
times, which is also why the committed decision records rather than retires.

How this change could reintroduce the class: the hatch pattern is one copy-pasteable line. A future
contributor adding availability or debugging affordances ("`ZODYSSEY_SKIP_SCOPE=1`",
"`ZODYSSEY_DEBUG_BYPASS=1`", or the UNGATE check moved during a refactor so the recorder no longer
sits between the env read and the exit) recreates a silent bypass with zero ill intent — the exact
path by which the second deletion shipped unnoticed (`CHANGELOG.md:488`: audits review the diff in
front of them). What prevents it: (a) the **shared structural assertion** in the regression suite —
it scans the hook source for every `process.env.ZODYSSEY_*` read whose branch guards an early
`exit(0)` and requires the recorder to be routed between read and exit, so a second bypass variable
added without recording fails criterion 3 the day it lands, not two releases later; (b) the
existing twice-deleted header and assertions in `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs`
keep catching outright deletion; (c) the count surfacing in the trend log means a standing-open
gate shows up in the operator's own metrics corpus, not only in an audit.

## Docs to update

Every doc that states the claim this change alters ("the hatch disables the gate" — none of them
say "silently", which was exactly the problem), each checked against the 2026-08-16 tree:

- `CHANGELOG.md` — new version entry (shape below).
- `docs/INSTALL.md:152` — env-table row: extend the tradeoff sentence to state that every ungated
  call is recorded in `.zcode/state/<slug>.ungated.jsonl` and surfaced as `ungated_bash_calls` on
  the run report. This is the table an operator reads before setting the variable.
- `skills/odyssey/SKILL.md:384-391` — the "Environment overrides (documented)" list omits
  `ZODYSSEY_UNGATE_BASH` entirely today; add the row with the recording semantics so the conductor
  prompt matches the installer's AGENTS.md template (`scripts/install.mjs:883`).
- `docs/DESIGN.md:261` — §6 hook table, Bash write-gate row: the row currently does not mention the
  hatch at all; add that the documented escape hatch exists and is recorded per-call.
- `README.md:121` — comparison-table row: "…Secure by default; `ZODYSSEY_UNGATE_BASH=1` disables"
  gains "(every ungated call is recorded in run state)".
- `skills/odyssey/references/scripts.md:35` — `run-report.mjs` entry: name the
  `ungated_bash_calls` field alongside `success`.
- `scripts/install.mjs:883` — the AGENTS.md template string still advertises the var without the
  recording fact. **Outside this change's declared `Files:`** — the fix-run cannot edit it under
  the scope gate. Correct it in the release pass (and re-run the installer so the user-scope
  AGENTS.md copies refresh), or name it in *Known, not fixed*.

A fix that leaves any of these asserting the old behaviour has created the next doc-code drift.

## CHANGELOG entry shape

New patch version — the next free patch at ship time (`0.5.3` if nothing has shipped since
`0.5.2`; 01, 02 and 03 each claim their own release ahead of this one in build order). **One
security change per release, shipped alone** — the repo rule, with its precedent at
`CHANGELOG.md:121`. Do NOT batch queue items 01 or 03 into this release even though all three touch
`skills/odyssey/hooks/pre-tool.mjs`.

- **Fixed** — one entry: every `ZODYSSEY_UNGATE_BASH=1` Bash call is now recorded — one JSON line
  (command + timestamp) in `.zcode/state/<slug>.ungated.jsonl`, counted as `ungated_bash_calls` on
  the run report and trend log. State the mechanism in one clause (witness at the hatch exit; the
  gate still opens — recording, not refusing), state the history honestly (the gate was deleted
  twice by silent ambient presence of this variable — cite
  `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:3-11`), and cite the paired-probe evidence
  (ungated call: exit 0 with no record before, exit 0 with a record after; gated call: exit 2, no
  record, both builds). This repo cites its probes, not just its diffs.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - Recording is **append-only audit, not prevention**: the ungated call still executes before any
    row exists. A hostile actor who controls the environment runs AND is recorded; the ledger is
    evidence, not a barrier. The barrier is leaving the variable unset.
  - The ledger write is best-effort: a failed append degrades to a stderr no-op and never blocks
    the call (deliberate — the hatch is the operator's explicit choice, and a recording failure
    must not silently revoke a documented affordance).
  - The variable still bypasses the **whole** gate — verdict, tamper guard, and scope together,
    with no per-check granularity. Deliberate: granularity would re-run gate analysis inside the
    hatch.
  - Bash calls with the variable set but **no active run** remain unrecorded (the hook is a no-op
    without a run; there is no run state to audit into).
  - `scripts/install.mjs:883`'s AGENTS.md template text mentions the hatch without the recording
    fact — release-pass edit; user-scope copies refresh on installer re-run.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the marketplace cache picks up the hook — a fix that stays only in
  the repo records no run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is a pure code-logic change and the run's whole method is red-green: load the TDD skill via
the Skill tool in the executor thread, write the failing ledger/report/structural assertions first
(criterion 6's demonstration), watch the suite go red, then make them green. F5 cross-checks the
declaration against hook-witnessed loads (`skills/odyssey/references/scripts.md:22`), so a
declaration without a real load fails the final wave — declare nothing speculative. No
`discovered:`/`generic:` (no find-skills call is planned) and no `mcp:` declarations (none will be
loaded). If a test fails in a way two fix attempts do not diagnose, loading
`systematic-debugging` is correct — declare it only if it is actually loaded, after the fact, never
in anticipation.

## Estimated size

~12 lines in `skills/odyssey/hooks/pre-tool.mjs` (the `recordUngatedBash` helper — append,
try/catch, stderr fallback — plus its call immediately before the `:978` exit and a comment
mirroring the escape-hatch contract), ~8 lines in `skills/odyssey/scripts/run-report.mjs` (read +
count the ledger, the `ungated_bash_calls` field, one scorecard line), and ~40-50 lines in
`skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` (the ledger both-direction cases reusing the
existing `makeRepo`/`runHook` harness at `:41-84`, the run-report count assertion on a fixture,
the read-only/trusted/no-run controls, and the structural every-bypass-site-has-a-recording-path
source scan). Patch release, security-class, shipped alone, with its own paired run.
