# 12 — User-confirmed acceptance criteria at PRIME

Build order **12** · depends-on **—** (nothing precedes or blocks it) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `12 prime-user-confirmed-acceptance` · not security-class · patch release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast. Do exactly this one change.

A note on what this change is: **a conductor-prompt contract plus a small recording mechanism.**
The deliverable is mostly `skills/odyssey/SKILL.md` text (the orchestrator's brain), with one
optional flag in the scaffold so the recorded state is a machine-readable artifact instead of
hopium. Read the Must-NOT list before designing anything — the anti-goal is absolute here.

## What is broken

**The acceptance criteria that gate every run are model-authored end-to-end; the user — the one
party independent of the model — never confirms them.** The chain, anchored:

- PRIME (phase −1) produces the primed brief carrying "· intent + success criteria"
  (`skills/odyssey/SKILL.md:72`) via `skill: prompt-master` (`skills/odyssey/SKILL.md:70`;
  described at `skills/odyssey/references/capabilities.md:59`). Those success criteria are
  model-derived. The user's only touchpoints in the whole pipeline are: the ambiguity ritual at
  PRIME ("· ambiguities → ask the user (max 3, then commit)" at `skills/odyssey/SKILL.md:74`;
  "ask the user FIRST and WAIT" at `:76-77`), metis's user-questions at consult
  (`skills/odyssey/SKILL.md:98`, `:356`), and the momus-loop safety rail (`:273`). **None of these
  confirms the criteria themselves** — ambiguities are about what was asked, not about what will
  count as done.
- The criteria that actually gate execution are authored later, by prometheus, into the plan the
  scaffold writes: `skills/odyssey/scripts/scaffold.mjs` writes the plan template verbatim
  (`writeFileSync(planPath, body)` at `:190`) whose Todos grammar makes "Acceptance criteria
  (executable commands)" a required nested field (`skills/odyssey/scripts/scaffold.mjs:160`);
  prometheus fills them in (`agents/prometheus.md:55`) under the zero-user-intervention rule
  (`agents/prometheus.md:61` — "Never 'user manually verifies' or 'user confirms'").
- Every downstream consumer of the criteria is then a model or a machine: `parse-plan --lint`
  checks runnability only (`skills/odyssey/scripts/parse-plan.mjs:20`; dispatched pre-momus at
  `skills/odyssey/hooks/pre-tool.mjs:1470`), `record-verify` executes them, momus reviews the
  verdict, oracle is an LLM. That is the self-grading failure mode in the project's own list
  (`docs/ideation-prompt.md:77` — "the planner writes the criteria; the reviewer declines to judge
  them"). A run today reaches `execute` with criteria no human ever saw.

Paired-probe result proving the absence on the current build (re-derive before building):
`grep -c "AskUserQuestion" skills/odyssey/SKILL.md` → **1** (the momus rail at `:273` only — no
criteria round anywhere), and `grep -rn "criteria-confirmation" skills/ scripts/ agents/ commands/`
→ **0 hits** (no confirmation state exists to record).

**The evidence for fixing this — and its caveats, carried verbatim, not re-fetched.** This is the
only strong-evidence accuracy item in the queue, and the strength is conditional, so the caveats
travel with the numbers as labels, permanently:

- `docs/OPPORTUNITY-MAP.md:267` (row #10): TiCoder "**+22.49 to +53.98 absolute pass@1** with 1–5
  user queries (arXiv 2208.05950). The mechanism is *interactive user queries*, not
  planner-authored criteria — so the evidence supports asking the user, not adding a reviewer."
  Cost column: "Low — PRIME already has the 'max 3 questions, then commit' ritual." Risk column:
  "Interactivity in headless runs."
- `docs/ideation-report.md:450` (verdict: CONFIRMED — fully traced, the strongest cluster in
  either pass): "+22.49–37.71 (MBPP) and +24.79–53.98 (HumanEval) absolute pass@1 … follow-up avg
  +45.97% with human study." **Caveats, verbatim:** "single corporate research group, simulated
  (oracle) user, MBPP/HumanEval only — generalization to orchestration acceptance criteria is an
  extrapolation."
- These are external numbers. This run did not re-fetch the sources (no external URLs, by rule)
  and **the fix run must not either** — the mechanism does not depend on the exact deltas, and an
  unfetched number must never masquerade as a re-verified one. If you need the caveat to become a
  number, that is the two-arm eval's job (queue items 09/10), not this change's.
- Distinguish this evidence from the LLM-judge evidence: the 56.57–65.71% hard-pair accuracies and
  the 61.3% paraphrase flip rate (`docs/ideation-report.md:448`) attach to **LLM verdicts** — they
  are the reason this change asks the *user* and not another model, and they do not apply to a
  human confirming their own intent. The TiCoder caveats above are the ones that DO apply, and
  they are carried, not softened.

## What fixed means

Stated as observable behaviour. The mechanism has four parts — trigger, round, recording,
transcription — and one absolute: **it never blocks.**

**1. Trigger — measurable criteria only.** When the PRIMED brief's success criteria are
**measurable** — phrasable as an executable check (a command plus its expected outcome), the same
standard the plan template itself enforces downstream (`skills/odyssey/scripts/scaffold.mjs:160`)
— PRIME appends **one** AskUserQuestion round to the existing ambiguity ritual. The round lives
INSIDE the standing budget, not beside it: max 3 questions at PRIME, then commit
(`skills/odyssey/SKILL.md:74`). The question presents the top proposed criteria (at most 3
criteria; at most 4 options total per the AskUserQuestion tool's contract, one of which is always
an explicit **skip**) for the user to **confirm / adjust / skip**. If the brief's criteria are
qualitative, vague, or absent → **no round** — the trigger fails and the flow is exactly today's.

**2. Recording — a stamped state, not a memory.** The conductor passes the round's outcome to the
scaffold when it creates the run: `scripts/scaffold.mjs <repo> <slug> <title> <intent> [task-brief]
--criteria-state confirmed|adjusted|skipped` (the invocation the conductor already makes, at
`skills/odyssey/SKILL.md:374`). Scaffold stamps `plans/<slug>.task.md` — the G5 file it already
writes for the primed brief (`skills/odyssey/scripts/scaffold.mjs:213`, `:217`) — with a first
line:

```
<!-- criteria-confirmation: <state>@<ISO-8601 timestamp> -->
```

The stamp is additive: the brief body after line 1 is byte-identical to what the conductor passed.
When the state is `adjusted`, the user's wording lives in the brief body under a
`## User-adjusted criteria` heading (the conductor authors the brief; the stamp names the state,
the body carries the text). **No flag → no stamp → the file is byte-identical to today's output**
— backward compatibility is an asserted behaviour, not an accident. Flag validation fails closed:
a value outside the three-state vocabulary exits **2** (bad args — the existing exit-code grammar
at `skills/odyssey/scripts/scaffold.mjs:36-37`), before any file is written.

**3. Transcription — downstream honors the adjustment.** The PLAN phase
(`skills/odyssey/SKILL.md:105-113`) gains one rule keyed to the stamp: `adjusted` → the user's
criteria are transcribed verbatim (as executable commands) into the todos' Acceptance criteria —
they are the source of truth, not the model's paraphrase of them; `confirmed` → the presented
criteria; `skipped` or no stamp → today's authorship, unchanged. The user's role stays
**upstream**: criteria inside the plan remain machine-executable, and the zero-user-intervention
rule (`agents/prometheus.md:61`) is untouched — this change never writes "user confirms X" INTO a
criterion; it lets the user shape WHICH criteria get written, before the plan exists.

**4. Degradation — the mechanism never blocks.** Skip, no answer, or AskUserQuestion unavailable
(headless / autonomous runs — the map row's own stated risk, `docs/OPPORTUNITY-MAP.md:267`) →
state `skipped` → the run proceeds exactly as today. There is no precondition, no refusal, no
gate, no state-lane keyed on the confirmation anywhere in the pipeline. A flag given with no brief
captured is the existing W5 warning path (`skills/odyssey/scripts/scaffold.mjs:219`) — warning,
exit 0, nothing stamped (there is nothing to stamp). Over-blocking here would be a new failure of
the class this change exists to close.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/SKILL.md` — **the actual deliverable**: the PRIME box (`:69-78`) gains the
  criteria-confirmation round with its trigger, bound, and skip path; the PLAN box (`:104-112`)
  gains the transcription rule; the scaffold invocation line (`:373`) gains the flag.
- `skills/odyssey/scripts/scaffold.mjs` — the optional `--criteria-state` flag, its fail-closed
  validation, and the first-line stamp. Nothing else in the file changes.
- `skills/odyssey/scripts/scaffold.criteria-confirm.test.mjs` — **new**. No scaffold-specific
  suite exists today (`ls skills/odyssey/scripts/ | grep scaffold` → `scaffold.mjs` only; the
  pipeline-integration suite covers other wiring). `scripts/run-tests.mjs` discovers every
  `*.test.mjs` recursively, so the suite count grows 33 → 34 with no runner change.

Nothing else. `agents/prometheus.md` stays untouched (the user's role is upstream by design —
see Must NOT do). `skills/odyssey/scripts/consult.mjs` is untouched: it reads `<slug>.task.md` as
THE ORIGINAL TASK (`consult.mjs:754`, `:765`) and the stamp is a first-line HTML comment in what is
otherwise prose context. Hooks are untouched — this is not a gate and must never become one.
`docs/` belongs to the release pass, not the gated run.

## Must NOT do

- **No new reviewer, verifier, judge, or interviewer agent — no LLM opinion layer, absolute.**
  The Step-6 anti-goal is at its sharpest here: the entire justification for this change is that
  the evidence supports asking the *user*, not adding a model (`docs/OPPORTUNITY-MAP.md:267`). If
  you find yourself designing an agent that asks, weighs, or grades anything, stop — you are
  building the thing this change exists to not need.
- **Never make the round blocking.** No precondition, refusal, retry loop, or state-lane keyed on
  the confirmation state. Skip, no-answer, and headless must be byte-equivalent to today's flow.
- **No blocking interview.** One round, inside the existing "max 3, then commit" budget
  (`skills/odyssey/SKILL.md:74`) — never beside it, never above it, never a second round because
  the answer was incomplete. Never exceed the AskUserQuestion option cap (≤4 options).
- **Do not make the flag load-bearing.** `--criteria-state` records a label; it authenticates
  nothing. Any agent can pass any value, and a forged `confirmed` stamp must remain inert — it can
  at most bias transcription prose; it grants no authority and gates nothing, and the design must
  not "harden" it into a credential.
- Do not modify the brief body — stamp only, first line, additive. Never rewrite, reorder, or
  "clean up" the user's adjusted wording in the brief.
- Do not move user confirmation into the plan's criteria list. "User confirms X" as an acceptance
  criterion violates `agents/prometheus.md:61` and reopens self-grading one level down.
- Do not re-fetch the external evidence URLs. The numbers carry their caveat labels from
  `docs/ideation-report.md:450`; an unfetched number stays labeled unfetched.
- Do not touch `skills/odyssey/hooks/*`, `agents/*`, or `consult.mjs`. No npm packages, no daemon,
  no async runners.
- Do not batch this into a release carrying queue items 01, 03, or 04 (one security change per
  release; this change is not security-class).

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent — load-bearing here: AskUserQuestion absent
  (headless) → state `skipped`, run proceeds; the missing tool is never an error
- Every hook is a no-op unless a run is active — no hooks are touched; nothing in this change
  should even be able to notice a run
- **No argv flag authenticates anyone** — every script is invocable by any agent with the same argv
  surface the operator has. A flag can remove a *silent* path; it cannot grant authority.
  (`--criteria-state` is exactly the allowed shape: it records a state and removes the silent
  unstamped-brief ambiguity; it grants nothing — see Must NOT do.)
- Fail closed. An unverifiable state blocks; it never passes. — **Scoped**: fail-closed applies to
  flag *validation* (bad value → exit 2 before writes). The confirmation *state itself* must fail
  open to `skipped` — an unanswered question is not an unverifiable security state, and blocking on
  it would be over-blocking, a new failure of the class this change exists to remove.
- A repo-capability check degrades to a recorded `inert`, never to a block. Over-blocking is a new
  failure of the class the change exists to remove.

### Anchor-drift reconciliation (amendment, 2026-08-16)

`scripts/check-anchors.test.mjs` landed after this prompt was written and runs inside
`node scripts/run-tests.mjs`. It content-pins every `file:line` citation in the repo's docs, so
**editing a cited file makes the suite go red until the citations are reconciled.** That is the
check working, not a defect in your change.

**This change's exposure: 46 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/SKILL.md` (24), `skills/odyssey/scripts/scaffold.mjs` (12), `scripts/run-tests.mjs` (6).

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

1. `node --check skills/odyssey/scripts/scaffold.mjs` — expected exit **0**.
2. `node skills/odyssey/scripts/scaffold.criteria-confirm.test.mjs` — expected exit **0**. The
   suite must contain and pass, at minimum (each against a scratch repo/slug):
   (a) brief + `--criteria-state confirmed` → exit 0; `plans/<slug>.task.md` exists; line 1
   matches `^<!-- criteria-confirmation: confirmed@`; the body after line 1 is byte-identical to
   the input brief (Buffer equality); (b) `--criteria-state adjusted` with the user's wording
   inside the brief body → stamp reads `adjusted@`, body intact; (c) `--criteria-state skipped` →
   stamp reads `skipped@`; (d) **no flag** + brief → exit 0 and the task file is byte-identical to
   the input brief — the legacy assertion, no first-line stamp (backward compatibility as an
   executable claim, the `(state.x || {})` discipline applied to files); (e)
   `--criteria-state banana` → exit **2**, and no plan, state, or task file was written for that
   slug (validation fails closed before any write); (f) `--criteria-state confirmed` with **no**
   brief → exit 0 plus the existing no-brief warning (`scaffold.mjs:219`) — never an error;
   (g) plan.md and state.json contents are unaffected by the flag in every passing case (the flag
   touches the task file only — diff the two invocations' outputs to prove it).
3. `node --test skills/odyssey/scripts/scaffold.criteria-confirm.test.mjs` — expected exit **0**.
4. Conductor-contract tripwires (the prose deliverable's interface strings — the SKILL.md edit is
   asserted by its load-bearing tokens, the version-consistency pattern):
   `test $(grep -c 'criteria-confirmation' skills/odyssey/SKILL.md) -ge 2` — expected exit **0**
   (the PRIME round and the PLAN transcription rule both name the stamp they produce/consume);
   `test $(grep -c 'AskUserQuestion' skills/odyssey/SKILL.md) -ge 2` — expected exit **0**
   (today it is 1, the momus rail at `:273`; the PRIME round adds the second — this is the
   paired-direction grep, probe-able on both builds); `test $(grep -c 'max 3, then commit' skills/odyssey/SKILL.md) -eq 1`
   — expected exit **0** (the budget clause survives the edit exactly once: the new round lives
   inside it, not beside it).
5. The paired direction — proof the stamp assertions actually run against today's unstamped code,
   re-provable on demand (in TDD order you demonstrate it BEFORE writing the flag):
   `git stash push -- skills/odyssey/scripts/scaffold.mjs && node skills/odyssey/scripts/scaffold.criteria-confirm.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only the scaffold change reverted, the flag is an unknown
   argument (today's scaffold ignores it — `rest` at `scaffold.mjs:196` only looks for `--task`),
   no stamp is ever written, cases (a)-(c) and (e) fail, and the suite exits 1.
6. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16; after this change it must read 33/33 (the new suite is discovered — a count that
   stays 32 means the file is misnamed or misplaced, and a runner that reports success over an
   empty set is this repo's documented false-green).

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** No deny-list or allow-list is added. One three-state
   vocabulary (`confirmed|adjusted|skipped`) with a no-flag default — a label enum for a stamp, not
   a pattern set that can drift out of sync with reality.
2. **A check that cannot detect the class of failure it exists for.** The honest residual, named:
   nothing executable can detect "the conductor never asked the user." What IS detectable: the
   recording (criterion 2, demonstrated failing on the unmodified build by criterion 5), the
   contract's presence (criterion 4), and the stamp's *absence* as a visible signal on every run
   (an unstamped brief is exactly as legible as the W5 no-brief warning at `scaffold.mjs:219`).
   The undeclarable part is carried as a Known-not-fixed, not hidden.
3. **Ceremony without mechanism.** The gravest risk for a prompt-contract change — a new ritual.
   The mechanism half is real: state → stamped artifact → transcription rule, with the stamp's
   existence and byte-additivity machine-asserted. The prose half is bounded by tripwires, and the
   round cannot fire without the trigger condition, which keeps it rare.
4. **Self-grading.** This is the change's subject. The one grader independent of the model by
   construction — the user — is inserted at the single point where the criteria do not exist yet.
   No model is added anywhere; the anti-goal is respected by construction, not by exception.
5. **A fix that reopens its own class.** Covered in "The class it closes" — the reopening shapes
   are blocking drift, mandatory drift, and post-plan drift; each has a named fence.

## Paired probe

**Probe A (the recording mechanism):** a scratch repo; invoke scaffold with a brief and
`--criteria-state confirmed`.

- **Before the fix (current HEAD): no stamp, silently.** The flag is an unknown argument today —
  `rest` is only scanned for `--task` (`skills/odyssey/scripts/scaffold.mjs:196-207`) — so the
  invocation exits 0 and writes `plans/<slug>.task.md` **verbatim, with no confirmation state
  anywhere**. The state the conductor tried to record is silently lost: exactly the class of
  silent drop W6-minor fixed for piped briefs (`scaffold.mjs:208-209`).
- **After the fix: stamped, additive.** The same invocation exits 0; line 1 is the
  `criteria-confirmation: confirmed@…` stamp; the body after line 1 is byte-identical (probe with
  `sha256sum` on body-only vs. the input brief).

**Probe B (the conductor contract):** `grep -c 'AskUserQuestion' skills/odyssey/SKILL.md` →
**1 before** (the momus rail at `:273` only) → **≥2 after** (the PRIME round), and
`grep -c 'criteria-confirmation' skills/odyssey/SKILL.md` → **0 before → ≥2 after**. Today the
PRIME box (`:69-78`) asks about ambiguities and never about criteria; after, the criteria round is
in the same box, inside the same max-3 budget.

Unchanged controls, required on BOTH builds — a probe that moves any of them has over-reached:

| Control | Before | After |
|---|---|---|
| Scaffold with brief, no flag | task file = brief, byte-identical | **byte-identical** (no stamp — legacy path untouched) |
| Scaffold with no brief | exit 0 + W5 warning (`scaffold.mjs:219`) | **exit 0 + same warning** (a flag cannot make no-brief an error) |
| plan.md / state.json contents, with vs. without the flag | identical | **identical** (the flag touches the task file only) |
| A run created before this change (unstamped brief) | loads, consults, transitions | **loads, consults, transitions** (no new required state; `skipped`-by-absence is the transcription rule's default arm) |
| Ambiguity ritual and metis user-question flows (`SKILL.md:74`, `:97`) | unchanged wording and budget | **unchanged wording and budget** (the round joins the budget; it does not expand it) |

## What it breaks

The intended break: for users whose tasks yield measurable criteria and who want a say, one more
interaction round appears at PRIME — before any agent is dispatched, when answering is cheapest.
The costs, stated exactly:

- **One extra question for zero-question users.** Bounded: a single round, inside the standing
  max-3 budget (`skills/odyssey/SKILL.md:74`), with an explicit skip option always present; a skip
  answer reproduces today's flow byte-for-byte (control row 1 of the paired probe). Users who
  answer nothing at all get the same degradation — silence is a skip, not a stall.
- **Latency for autonomous/headless runs: none, by contract.** AskUserQuestion unavailable →
  `skipped` (graceful no-op when an optional tool is absent — the Step-5 constraint, load-bearing
  here). This is the map row's stated risk ("Interactivity in headless runs",
  `docs/OPPORTUNITY-MAP.md:267`) converted into the degradation clause; state it in the SKILL.md
  text itself so the opt-out is documented where the conductor reads it.
- **Byte-exact consumers of `<slug>.task.md`.** `consult.mjs` reads the file as THE ORIGINAL TASK
  for scope-fidelity judgment (`consult.mjs:754`, `:765`); a first-line HTML comment is additive to
  what is otherwise prose context — but re-verify consult's tolerance at build time before
  landing, and if any consumer ever byte-compares the file, the stamp is the thing to reconcile,
  never the brief body.
- **Suite count moves 33 → 34.** Any live doc asserting the suite count updates in the same
  release; historical CHANGELOG rows stay historical.
- **The honest epistemic cost:** the round's value depends on the quality of the conductor's draft
  criteria — a bad draft can be confirmed as readily as a good one, and the TiCoder deltas were
  measured on MBPP/HumanEval with a simulated oracle user, not on orchestration runs
  (`docs/ideation-report.md:450`). This change ships the mechanism, not a ZOdyssey-native number;
  measuring whether the round helps here is the two-arm eval's job (queue 09/10). Named under
  *Known, not fixed* — do not let the CHANGELOG imply more than the caveats allow.

## The class it closes

**Self-grading** — failure mode 4 (`docs/ideation-prompt.md:77`): the model writes its own exam
(criteria), machine-checks its form (`parse-plan --lint`, `skills/odyssey/scripts/parse-plan.mjs:20`
— runnability, not correctness), and every downstream judge is itself a model (momus reviews
verdicts; oracle is an LLM). User confirmation at PRIME inserts the one grader who is independent
**by construction** — the user is the party whose intent the criteria claim to represent.

Why PRIME and not later: PRIME is the only phase where the user is present AND the criteria do not
yet exist. Confirmation added post-plan (review, verify, final wave) would ask the user to grade a
fait accompli — a plan already shaped by the model's criteria, past the gate that blessed them —
with strictly less context and strictly more sunk cost. The anchor is the mechanism.

How this change could reintroduce the class:

- **Blocking drift** — the round accretes retries, follow-ups, or a "must answer" gate until the
  pipeline stalls on a silent user. Prevented by: the never-blocks clause written into the PRIME
  text itself, the one-round/inside-max-3 bound tripwired by criterion 4's
  `max 3, then commit` count, and the skip/no-answer/headless controls asserted in the suite
  (criterion 2f) and the probe table.
- **Mandatory drift** — a future change "requires" `--criteria-state` (or the gate starts
  demanding a stamp), turning a recording aid into a precondition. Prevented by: criterion 2(d)
  asserts the no-flag path is byte-identical to today — the backward-compat fence is executable,
  not aspirational — and by the standing rule that new state must stay optional
  (`skills/odyssey/scripts/scaffold.mjs:298-302` for the state.json form of the same discipline).
- **Post-plan drift** — the confirmation migrates to PLAN/verify "where the criteria are written
  down", quietly re-creating self-grading with extra steps and less user context. Prevented by:
  the round is anchored in the PRIME box only; `agents/prometheus.md` is untouched by this change
  and its zero-user-intervention rule (`agents/prometheus.md:61`) keeps user confirmation out of
  the criteria list — the transcription rule consumes the stamp, it does not reopen authorship.

## Docs to update

Every doc that states the claim this change alters ("PRIME refines the prompt and surfaces
ambiguities; criteria are planner-authored"), each re-anchored at build time:

- `skills/odyssey/SKILL.md` — done in this change (it IS the deliverable): PRIME box `:69-78`
  (round + trigger + bound + skip), PLAN box `:104-112` (transcription rule), scaffold invocation
  `:373` (the flag).
- `skills/odyssey/references/capabilities.md:59` — the prompt-master entry's primed-brief
  description gains the criteria-confirmation round (trigger, one round, skip path).
- `skills/odyssey/references/scripts.md:7` — the scaffold signature documents the optional
  `--criteria-state confirmed|adjusted|skipped` argument, the first-line stamp format, and the
  fail-closed exit 2 on a bad value.
- `docs/DESIGN.md` — the phase −1 description and the G5/task-brief paragraph gain the
  criteria-confirmation stamp as a recorded, additive artifact (verify the exact section at build
  time; if §6's scope rows are unaffected, record that rather than hunting for an edit).
- `README.md` — the pipeline description of phase −1 (verify the exact section at build time).
- `CHANGELOG.md` — shape below. Any live claim of the suite count moves with it (33 → 34).

## CHANGELOG entry shape

Patch release (v0.6.x line): one conductor-contract paragraph plus one optional scaffold flag; no
interface, gate, or state change reaches any consumer that does not pass the flag. Not batched with
queue items 01/03/04 (one security change per release; this is not security-class).

- **Added — acceptance criteria can be user-confirmed at PRIME.** One entry stating: the trigger
  (primed brief yields measurable criteria), the bound (one AskUserQuestion round, inside the
  existing max-3-then-commit budget, ≤4 options incl. skip), the recording
  (`scaffold --criteria-state` → first-line `criteria-confirmation:` stamp on
  `plans/<slug>.task.md`, additive), the transcription rule (adjusted criteria are the source of
  truth at PLAN; confirmed/skipped/absent degrade to today's authorship), and — in its own
  sentence — that skip, no-answer, and headless runs are byte-equivalent to the prior flow: the
  mechanism never blocks. Cite the paired probe: today the flag is silently ignored and no
  confirmation state exists anywhere (grep counts 1 and 0 before; ≥2 and ≥2 after). Cite the
  evidence with its caveat labels intact — TiCoder +22.49–37.71 (MBPP) / +24.79–53.98 (HumanEval)
  absolute pass@1, follow-up avg +45.97% with human study; caveats: single corporate research
  group, simulated (oracle) user, MBPP/HumanEval only, generalization to orchestration acceptance
  criteria is an extrapolation (`docs/ideation-report.md:450`; not re-fetched).
- **Known, not fixed** — name them; the next audit should not have to find them:
  - The act of asking remains conductor prose. The mechanism guarantees that a confirmation, when
    obtained, is recorded and honored downstream; it cannot force the question to be asked. The
    tripwires (criterion 4) assert the contract's presence in SKILL.md, not the conductor's
    behavior — the ceremony-without-mechanism residual, bounded and named.
  - The external accuracy numbers are carried with their caveat labels and were not re-fetched;
    no ZOdyssey-native measurement exists that the round improves outcomes here. The two-arm eval
    (queue items 09/10) is the instrument that could produce one; until then this ships a
    mechanism, not a number.
  - A forged `--criteria-state confirmed` stamp is inert-but-possible: the flag records, it does
    not authenticate (Step 5). If that ever needs to be more than a label, it is a new change with
    its own audit, not a quiet hardening here.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the marketplace cache picks up the SKILL.md text — a conductor-prompt
  change that stays only in the repo fires in no run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

The scaffold half of this change is code logic and the run's method is red-green: write the
failing stamp assertions first (criterion 5's demonstration — the suite must go red against the
unmodified `scaffold.mjs`), then make them green; the SKILL.md prose rides along after the
mechanism exists. F5 cross-checks the declaration against hook-witnessed loads, so declare nothing
speculative: no `discovered:`/`generic:` (no find-skills call is planned) and no `mcp:`
declarations (none will be loaded — this change fetches nothing, by rule). If a test fails in a
way two fix attempts do not diagnose, loading `systematic-debugging` is correct — declare it only
if actually loaded, after the fact, never in anticipation.

## Estimated size

~10-15 lines in `skills/odyssey/SKILL.md` (PRIME round, PLAN transcription rule, flag on the
invocation line — box-drawing constraints make line counts approximate); ~20-30 lines in
`skills/odyssey/scripts/scaffold.mjs` (flag parse out of `rest`, three-state validation with
fail-closed exit 2, first-line stamp on the existing task-brief write); ~100-150 lines of new test
(`scaffold.criteria-confirm.test.mjs`): scratch-repo fixtures for the seven cases, byte-equality
assertions, and the bad-value/no-brief controls. Docs pass touches ~6 files. Patch release; it may
ride the v0.6 line with other non-security items but never shares a release with 01, 03, or 04.
