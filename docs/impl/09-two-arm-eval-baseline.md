# 09 — Two-arm eval: `judge.mjs --arm` + an automated baseline arm

Build order **09** · depends-on **05** (`metrics-corpus-decontamination` — must have LANDED before this
runs; verify `results.synthetic.jsonl` routing exists in `set-phase.mjs` at run start) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `09 two-arm-eval-baseline` · not security-class · minor
release · unblocks queue item **10** (`prompt-surface-measurement`) the moment it lands.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast; in particular queue item **05 adds
~5 lines to `harness.mjs`** (both-lane summary near today's `:145`), so every `harness.mjs:NNN`
below must be re-derived (the block shapes and quoted lines are stable; the numbers are not).
Do exactly this one change.

## What is broken

**The judge cannot label arms.** `skills/odyssey/scripts/judge.mjs:171` constructs every record
with the literal `arm: "zodyssey"`. The argv surface knows no arm flag at all —
`skills/odyssey/scripts/judge.mjs:40-45` destructures `<run-repo> <slug> <seed-id>` plus
`jrest.includes("--double")`, and the usage line at `:42` documents only `[--double]`. So even a
run that was in fact a baseline run is recorded as arm `"zodyssey"`. This is not hypothetical: the
live corpus (~/.zcode/orchestration/eval/judged.jsonl, **5 records**, counted 2026-08-16) contains
two records with slug `std-01-baseline` (at 2026-08-01T20:47:01Z) and `arch-01-baseline`
(2026-08-01T21:01:51Z) — baseline runs that actually happened — both stamped `arm: "zodyssey"`.
The repo's own consumer has given up on the field: `skills/odyssey/scripts/dashboard.mjs:20` —
"Arm derivation: the `arm` field on judged records is unreliable (all emit 'zodyssey')" — and
works around it with a slug-suffix heuristic at `:48-52` whose fallback silently buckets everything
non-`-baseline` into the zodyssey arm.

**The harness cannot run the control arm.** `skills/odyssey/scripts/harness.mjs:19` documents
`--arm` as "baseline = single-agent, no pipeline — TODO"; `:41-42` parses the flag; but the
baseline branch at `:128-132` only PRINTS instructions ("BASELINE ARM: execute this task as a
SINGLE agent with NO pipeline…") instead of executing anything, and `:137` prints the post-run
judge command with NO arm argument. The zodyssey arm is likewise scaffold-and-instruct (by design —
`:11-14`: the interactive conductor drives it; that boundary stays). Net: no arm has ever been both
run and labeled by machinery; the eval can produce one-arm numbers only.

**Why it matters.** The project's core bet — that code-enforced orchestration beats a single
capable agent on the same task — is currently unfalsifiable (`docs/ideation-report.md:119-123`,
§5 "the settling experiment"; `:274-277`, S3 "make the core bet falsifiable"; what would change
the position is named at `:325-327`: "this repo's own two-arm eval"). An experiment whose control
arm is a printed paragraph and whose records all wear the same label cannot return a negative
result; it can only confirm. Queue items 10+ inherit that blindness.

## What fixed means

Stated as observable behaviour, not as a diff.

**1. `judge.mjs` stamps the arm it was invoked under.**
`node skills/odyssey/scripts/judge.mjs <run-repo> <slug> <seed-id> [--arm zodyssey|baseline] [--double]`
appends a record whose `arm` equals the `--arm` value; with no `--arm`, the record says
`arm: "zodyssey"` — every existing invocation is bit-for-bit unchanged. `--arm` is a validated
enum: any other value exits **2** (the script's existing "bad args" contract, `judge.mjs:15`).
The arm NEVER enters the judged prompt: the scoring prompt built at `judge.mjs:101-135` contains
the criteria, the task prompt, and the diff — no arm — and must stay that way, so judging remains
blind to which arm produced the work. The stamp is record bookkeeping only.

**2. `harness.mjs --arm baseline` runs the seed end-to-end without orchestration.** The shared
prefix — fresh fixture copy (`:95-97`), the SEC-M12 git baseline (`:103-113`), the scaffold
(`:117-124`, which records `run_start_sha` at `skills/odyssey/scripts/scaffold.mjs:226,284` —
this is what makes the run judgeable, `judge.mjs:61-64`) — is UNCHANGED and runs for BOTH arms.
Then, instead of printing instructions, the harness spawns **one** external CLI agent (the same
binary `judge.mjs:141` already resolves: `env.CLAUDE_CLI || "claude"`), with cwd = the fresh copy,
input = the seed's `prompt` field verbatim (nothing else — the pipeline arm does not see the
success_criteria either; `harness.mjs:120` scaffolds from `seed.prompt` only), a bounded timeout
(one named constant; 60 minutes is a sound default — the corpus's longest real run measured 61.6
`wall_clock_min`), and waits synchronously. On completion the harness itself appends an efficiency
record to `~/.zcode/orchestration/eval/results.jsonl` (operator lane — a baseline run IS a real
eval run, and no `set-phase` transition ever fires for it, so the CRIT-4a appender cannot; the
harness is the appender of last resort) in the existing run-report schema with pipeline-only
fields (`review_rounds`, `todos_*`, …) set to null or honest zeros — never fabricated — plus
`arm: "baseline"` and measured `wall_clock_min`/tokens (null when the CLI reports no usage;
do not invent numbers). It then prints the judge command WITH `--arm baseline`.

**3. Baseline failures are loud.** External CLI absent, non-zero exit, or timeout → that seed's
result is `status: "failed"`, no vacuous success append, and a batch in which every seed failed
exits **4** — the same nothing-measured rule the harness already enforces for skipped seeds
(`:147-156`: "a green that represents no work done is worse than a red").

**4. A safe mode proves both arms selectable without spending anything.**
`node skills/odyssey/scripts/harness.mjs --dry-run [--arm zodyssey|baseline]` prints exactly what
that arm would do for each runnable seed (the spawn command, cwd, append destination, judge
command) and exits 0 having written nothing and spawned nothing — byte-identical filesystem,
asserted in the test. `--list` keeps its current behaviour (readiness only) and its summary gains
one line naming both arms. `--arm` outside the enum exits **2** (today unknown flags are silently
ignored — `:37-42` uses `indexOf`/`includes` with no validation — and that laxity is what would
make a pre-fix `--dry-run` dangerous; strict arm validation is part of this change).

**5. A comparison command reports per-seed two-arm deltas.**
`node skills/odyssey/scripts/judge.mjs --compare` (read-only; it never appends) reads
`judged.jsonl`, groups by the STAMPED `arm` field — no slug sniffing, and no
everything-else→zodyssey default (`dashboard.mjs:49`'s fallback is the silent-bucket shape this
instrument must not replicate; an unknown arm value prints as its own group with a warning) — and
prints, per seed, `{zodyssey, baseline, delta}` of the judge `overall`, plus per-arm means and n.
A seed missing an arm is printed as such (that is data, not an error). Records whose slug suffix
disagrees with their stamped arm get a mismatch warning line — which is exactly what surfaces the
two historical mislabeled records. Exit **0** when a report was produced; **3** when
`judged.jsonl` is missing or empty (nothing to compare — fail loudly, don't render a vacuous
table). Per-arm efficiency remains readable from `results.jsonl` slugs and the existing dashboard;
`--compare` does not duplicate it.

**6. The instrument boundary — stated, not implied.** `judge.mjs` is an eval instrument, never a
gate: nothing in this change invokes it from a hook or phase transition, it mints no nonce, and no
verdict it emits blocks or unlocks anything. The baseline arm is a control group, not a new
authority. The two arms compare under the ONE existing judge.

**7. Judge noise is bounded by design, and the caveat is carried honestly.** The spec's evidence
(`docs/implementation-prompt.md:166-167`): LLM judges run 56.6–65.7% on hard pairs with a 61.3%
flip rate under paraphrase. Neither arm's absolute score is meaningful at this corpus size; what
the two-arm design buys is that the SAME judge, rubric (`judge.mjs:105-112`), criteria, and seeds
score BOTH arms, so systematic judge error is shared and largely cancels in the DELTA.
Per-record variance stays visible through the existing `--double` (`judge.mjs:45,160-168`;
`docs/MEASUREMENT.md` §6.1: judge twice, flag disagreements > 0.15) — the settling run should use
it. Per `docs/MEASUREMENT.md` §6.2 the result is directional, not statistically tight.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/scripts/judge.mjs` — arm flag parse + enum validation, the stamp at the record
  constructor (today `:170-178`), usage/exit-contract header (`:10-15,42`), and the `--compare`
  mode.
- `skills/odyssey/scripts/harness.mjs` — the baseline branch (today `:128-137`) becomes
  execution; the self-append (+ `mkdirSync` guard on the eval dir, hermetic-test friendly); the
  `--dry-run` safe mode; strict `--arm` validation; the arm line in `--list`; the usage header
  (`:16-22`, TODO line at `:19` goes).
- `skills/odyssey/scripts/two-arm-eval.test.mjs` (new — no such suite exists today; naming follows
  the queue's `<topic>.<scope>.test.mjs` convention, e.g. 05's `set-phase.eval-lane.test.mjs`).

Nothing else. `dashboard.mjs` is deliberately absent — its slug-suffix arm derivation
(`:48-52`) keeps working unchanged because arm-bearing slugs are unchanged, which is the point.
`seed.jsonl` is untouchable (see Must NOT do). `set-phase.mjs`, `scaffold.mjs`, `consult.mjs`:
untouched. The docs listed under "Docs to update" belong to the release pass, not the gated run —
do not widen the set to include them by default.

## Must NOT do

- **No LLM opinion layer.** Do not add a second judge, scorer, reviewer, verifier, or classifier
  of any kind. The one external judge (`judge.mjs`) is reused for both arms — that is the whole
  design: the arms differ in the orchestrator, nothing else. A new scoring path would carry the
  burden of explaining why the 56.6–65.7%/61.3% evidence does not apply, and it does.
- **Do not promote the judge into the pipeline.** It is an eval instrument: no hook, phase
  transition, nonce, or verdict consumption may invoke or depend on it. This change adds labeling
  and reporting, never authority.
- **Do not touch the seeds' `success_criteria`** — not `seed.jsonl`, not any fixture task text,
  not the judge rubric weights. The criteria are the shared, arm-blind end-state; editing them
  mid-experiment moves the goalposts under both arms and voids comparability with the 5 existing
  judged records.
- **Do not confound the arms.** They may differ ONLY in the orchestrator: same fixture source,
  same fresh-copy + git-baseline + scaffold prefix, same external CLI binary, same seed prompt
  text, same judge, same rubric, same criteria. In particular do not "help" the baseline with
  orchestration artifacts (no plan, no criteria in its prompt, no sub-agents) and do not alter the
  zodyssey arm's conductor-driven flow — the interactive-conductor boundary at
  `harness.mjs:11-14` stands; headless full-pipeline automation is a separate follow-up.
- **Do not run the settling eval as part of this change.** Every acceptance criterion below is
  hermetic (temp `HOME`, stubbed CLI) or dry; populating the corpus is the operator's explicit
  later act. The fix-run spends zero external-CLI budget.
- **`--arm` authenticates nothing.** It declares provenance; any agent can mislabel a record with
  the same argv the operator has — **No argv flag authenticates anyone**. The label's trust comes
  from the harness constructing the run, and `--compare`'s mismatch warnings, not from the flag.
- **No slug-suffix arm derivation anywhere new.** The stamped field is the truth.
  `--compare` must not default unknown arms to zodyssey.
- **Zero npm dependencies** — Node 18+ built-ins only, synchronous, no daemon, no background
  runners. Absent optional tool (the external CLI) → loud per-seed failure and exit 4, never a
  vacuous success — **Fail closed**. Every hook stays a no-op unless a run is active (no hooks are
  touched).
- Do not batch this into a release carrying queue items 01, 03, or 04 (one security change per
  release; this change is not security-class).

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

`scripts/check-anchors.test.mjs` landed after this prompt was written and runs inside
`node scripts/run-tests.mjs`. It content-pins every `file:line` citation in the repo's docs, so
**editing a cited file makes the suite go red until the citations are reconciled.** That is the
check working, not a defect in your change.

**This change's exposure: 20 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/scripts/judge.mjs` (13), `skills/odyssey/scripts/harness.mjs` (7).

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

Every criterion is an exact command from the repo root plus its expected exit code; criterion 4 is
the red-direction demonstration, run in TDD order BEFORE the implementation lands. All
judge/harness invocations in the test run under a hermetic `HOME` (temp dir holding its own
`eval/seed.jsonl`, `eval/judged.jsonl`, fixture repo with `.zcode/state/<slug>.json` carrying a
valid `run_start_sha`, and a `CLAUDE_CLI` stub script that echoes one fixed verdict JSON and tees
its stdin to a file — `judge.mjs` resolves everything from `env.HOME`/`env.CLAUDE_CLI`, so no
product change is needed for hermeticity; `dashboard.test.mjs:64`'s mkdtemp isolation is the
in-repo precedent). The real operator corpus is never written by any criterion.

1. `node --check skills/odyssey/scripts/judge.mjs && node --check skills/odyssey/scripts/harness.mjs`
   — expected exit **0**.
2. `node skills/odyssey/scripts/two-arm-eval.test.mjs` — expected exit **0**. The suite must
   contain and pass, at minimum: (a) **stamp = argv** — judge under the stub with
   `--arm baseline` appends a record with `arm === "baseline"` to the hermetic `judged.jsonl`;
   (b) **default back-compat** — no `--arm` and `--arm zodyssey` both stamp `"zodyssey"`;
   (c) **enum strictness** — `--arm bogus` exits 2 (judge) and `--arm bogus` exits 2 (harness);
   (d) **blind judging** — the stub-captured judge prompt for a `--arm baseline` run contains no
   arm token (fixture and seed crafted to contain none); (e) **compare** — on a crafted corpus
   with both arms across two seeds plus one single-arm seed plus one unknown-arm record:
   per-seed deltas correct, the missing arm printed as missing, the unknown arm its own warned
   group, the slug/stamp mismatch warning fires on a crafted mislabeled record, exit 0; on an
   empty `judged.jsonl`: exit 3; (f) **dry-run safety** — `harness --dry-run --arm baseline`
   exits 0, prints the plan (spawn, cwd, append destination, judge command with `--arm baseline`),
   and the hermetic `HOME` tree is byte-identical before/after (no `runs/` dir, no appends);
   (g) **nothing-measured** — a baseline batch whose CLI stub fails every seed produces zero
   success appends and the harness exits 4.
3. `node --test skills/odyssey/scripts/two-arm-eval.test.mjs` — expected exit **0**.
4. The paired direction — proof the new assertions run against the unwired code:
   `git stash push -- skills/odyssey/scripts/judge.mjs && node skills/odyssey/scripts/two-arm-eval.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only the arm stamping reverted, cases (a)/(b) fail (every
   record wears `"zodyssey"`) and the suite exits 1.
5. Safe modes on the real tree (read-only): `node skills/odyssey/scripts/harness.mjs --list | grep -qi baseline`
   — expected exit **0** (the arm surface is visible in list mode); `node skills/odyssey/scripts/harness.mjs --dry-run --arm baseline | grep -q 'arm=baseline'`
   — expected exit **0** (baseline selectable, plan printed, nothing executed — 18/18 seeds
   runnable at authoring, 2026-08-16).
6. Usage contract unchanged where it must be: `node skills/odyssey/scripts/judge.mjs >/dev/null 2>&1; test $? -eq 2`
   — expected exit **0** (no-args still bad-args); `node skills/odyssey/scripts/judge.mjs --compare >/dev/null 2>&1; test $? -eq 0`
   — expected exit **0** (compare renders a report on today's real 5-record corpus — single-arm
   seeds printed as missing the baseline arm, the two 2026-08-01 mislabeled records warned — and
   writes nothing).
7. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16 (this change's own suite is discovered by the runner; the exit code is the
   contract, not the count).
8. Source tripwires against silent re-hardcoding:
   `! grep -q 'arm: "zodyssey"' skills/odyssey/scripts/judge.mjs && ! grep -q 'TODO' skills/odyssey/scripts/harness.mjs && test $(grep -c -- '--arm' skills/odyssey/scripts/judge.mjs) -ge 2 && test $(grep -c -- '--arm' skills/odyssey/scripts/harness.mjs) -ge 2`
   — expected exit **0**: the record-constructor literal is gone (defaulting via
   `|| "zodyssey"` is fine; the object-literal hardcode is not), the usage TODO is gone, and both
   files plumb the flag.

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** The arm is a plumbed enum — argv → slug → stamped record —
   not a per-callsite label list; `--compare` groups by the stamped field with no catch-all
   default, so an unknown value surfaces instead of silently joining the treatment arm. The
   rejected alternative (deriving arm from slug suffixes, as `dashboard.mjs:48-52` does) is
   sentinel matching — the exact shape `harness.mjs:53-55`'s own comment condemns.
2. **A check that cannot detect the class of failure it exists for.** Criterion 4 proves the stamp
   assertions go red; case (f) proves a "dry-run" that writes anything fails; case (g) plus
   criterion 3's exit-4 rule keep the harness's vacuous-green rule honest for the new arm.
3. **Ceremony without mechanism.** Today's baseline arm IS the ceremony failure — a printed
   instruction standing in for a control group. This ships the mechanism: a spawn, an append, a
   comparison command.
4. **Self-grading.** The judge is an external process that never saw the run's plan or reasoning
   (`judge.mjs:17-18`), is blind to the arm by case (d), and scores both sides; the delta is
   machine-computed from stamped records. The settling conclusion is drawn by the operator from
   `--compare` output, not authored by the system under test.
5. **A fix that reopens its own class.** Covered in "The class it closes" — the reopening shape is
   a future hardcoded label, prevented by stamp-equals-argv tests over the whole enum and by
   no-default grouping.

## Paired probe

Two probes, one per defect surface, both directions stated.

**Probe A — the arm stamp (judge).**
- **Before the fix (current HEAD):** the falsified direction is already in the live corpus —
  `judged.jsonl` records with slug `std-01-baseline` / `arch-01-baseline` stamped
  `arm: "zodyssey"` (2026-08-01). The executable before-direction is criterion 4: the new test's
  case (a) run against unmodified `judge.mjs` FAILS — every record it appends wears
  `"zodyssey"` regardless of argv (`:171`).
- **After the fix:** the same stubbed invocation with `--arm baseline` appends
  `arm: "baseline"`; case (a) green; and `--compare` on the real corpus warns on exactly the two
  historical mislabels.

**Probe B — arm selectability (harness, safe mode).**
- **Before the fix:** `node skills/odyssey/scripts/harness.mjs --list` (verified 2026-08-16:
  18/18 runnable, exit 0) prints no arm surface at all — no mode shows the baseline arm as
  runnable; the only baseline mentions in the harness are the usage TODO (`:19`) and the
  instruction-printer (`:128-132`); selecting `--arm baseline` executes zero task work. Do NOT
   run `--dry-run` against the unfixed harness to "see" this — unknown flags are silently
  ignored today (`:37-42`), so it would fall through into the real scaffold flow; the
  before-direction is the `--list` output plus code reading.
- **After the fix:** `--dry-run --arm baseline` exits 0 printing the exact automation plan with a
  byte-identical filesystem (case f), and `--list` names both arms (criterion 5).

Unchanged controls, required on BOTH builds — a probe that moves any of them has over-blocked:

| Control | Before | After |
|---|---|---|
| judge with no `--arm` | stamps `"zodyssey"` (`:171`) | stamps `"zodyssey"` — default, bit-for-bit |
| `judge … --double` | two passes, >0.15 disagreement flag (`:160-168`) | identical — untouched |
| judge no-args / bad-path exits | 2 / 3 / 4 per `:15` | same contract; 2 additionally for `--arm` outside the enum |
| zodyssey-arm harness flow | scaffold + conductor instructions, CRIT-4a appends on done | scaffold + conductor instructions — unchanged |
| judged prompt content | criteria + task + diff, arm-blind (`:101-135`) | identical — the arm never enters it |
| `dashboard.mjs` on the existing corpus | slug-suffix arm derivation renders | renders identically — zero code change |

## What it breaks

The intended break: the baseline arm stops being a paragraph and starts costing money.

- **External-CLI spend (the honest new budget).** Each baseline seed is one full single-agent
  coding run on the expensive model — 18 seeds exist today (`seed.jsonl`, counted 2026-08-16;
  MEASUREMENT.md targets ~20). Budget stance: nothing is spent unless the operator explicitly
  invokes `--arm baseline`; the default invocation and the zodyssey arm are bit-for-bit unchanged;
  no run-both-arms convenience is added; the first settling run should use `--task` on a subset;
  and the fix-run itself spends zero (all criteria hermetic or dry).
- **Corpus readers see a new `arm` value.** `dashboard.mjs` verified safe — it derives arm from
  the slug suffix (`:48-52`) and baseline records carry `-baseline` slugs exactly as the two
  historical ones do, so its per-arm table keeps rendering with zero changes. Its header comment
  at `:20` ("the `arm` field … is unreliable") becomes stale the moment the stamp lands — true
  drift, but the file is outside this change's set; named under *Known, not fixed*. Any operator
  script keying on `arm === "zodyssey"` sees `"baseline"` appear — that is the point; `--compare`
  is the sanctioned reader.
- **`results.jsonl` gains a record family with `success: null`.** The dashboard's win-rate row
  counts these as runs without wins until judged records pair up (its quality signal for judged
  runs comes from `judged.jsonl`, `overall ≥ 0.7`, `:103-107`). Accepted and documented: the
  settling number comes from `--compare`, not the dashboard; fabricating a `success` boolean the
  harness cannot know would be worse.
- **Harness exit semantics tighten.** An all-failed baseline batch exits 4 where the
  instruction-printer flow exited 0 having done nothing — the vacuous-green rule (`:147-156`)
  extended to the new arm; anything scripting around exit 0 now gets the honest failure.
- **The printed post-run instructions change text** (they carry `--arm`). Humans only — nothing in
  the repo parses that output (grep: no consumers).

## The class it closes

**A measurement that cannot see its control — an experiment with no baseline can only confirm.**
The repo's core bet (enforced orchestration over a single capable agent,
`docs/ideation-report.md:296`, falsifiable only by "this repo's own two-arm eval", `:325-327`)
was structurally untestable: every judged record wore one label (`judge.mjs:171`) and the control
arm was documentation (`harness.mjs:19,128-132`). The class's observable damage: five judged
records, zero comparisons possible, and a consumer reduced to slug sniffing (`dashboard.mjs:20`).

How this change could reintroduce the class: a **future arm — a third treatment, a renamed arm,
any new label — added as another hardcoded literal**, which is precisely how `"zodyssey"` got
baked in; or a comparison that silently buckets unknown labels into the treatment arm. What
prevents it: (a) the arm is argv-plumbed end-to-end (argv → slug → stamped record) and the test
asserts stamp == argv for EVERY declared enum value — extending the enum without plumbing fails
the iteration; (b) `--compare` has no everything-else→zodyssey default (the shape
`dashboard.mjs:49` got away with because it is a renderer, not the instrument) — an unknown arm
surfaces as its own warned group; (c) the mismatch warning cross-checks stamp against slug
suffix, so a future hardcode appears as corpus warnings on the next compare; (d) criterion 8's
tripwire fails the build if the `arm: "zodyssey"` object literal returns. Residual, named
honestly: `--arm` declares provenance and cannot verify it (Step 5) — a hand-run mislabel is
possible and is only visible, not preventable; the harness-constructed runs are the trustworthy
path.

## Docs to update

Every doc that states the claim this change alters ("the eval has one arm; the judge labels every
record zodyssey; the baseline is manual"), each checked against the 2026-08-16 tree:

- `docs/MEASUREMENT.md` — §2 (judge row/method) gains the two-arm fact; §6.1 (judge variance)
  gains the bounding argument — same judge/rubric/criteria/seeds across arms, so systematic judge
  error cancels in the delta; `--double` recommended for the settling run; restate the raw
  numbers (56.6–65.7% on hard pairs, 61.3% flip under paraphrase) so the caveat travels with the
  claim; §7 items 3 and 5 (the judge's new signature; the internal baseline arm distinguished
  from the optional external omo cross-eval). Compose with 05's corpus-hygiene block — 05 lands
  first; do not clobber it.
- `skills/odyssey/references/scripts.md:36-37` — the eval section: harness usage gains `--dry-run`
  and loses "TODO"; judge usage gains `[--arm zodyssey|baseline]` and `--compare`, with the
  extended exit codes.
- `docs/DESIGN.md` — pointer correction first: the queue brief said "§6", but §6 is the hooks
  table (`docs/DESIGN.md:245`) and states nothing about the eval; the claims live in **§11
  Observability & evaluation** (`:384`, the LLM-as-judge bullet) and **§12 row 12** (`:397`,
  "harness + judge … done"). Update §11 (two-arm method, automated baseline) and row 12; record
  the pointer correction in the change's notes rather than silently editing §6.
- `CHANGELOG.md` — shape below.
- `README.md` — check the comparison table at release time for eval phrasing; verify at build
  time, do not edit on spec.

## CHANGELOG entry shape

Version **0.6.x minor** — a new argv surface, a new corpus record family, and a new comparison
command are behaviour, not a defect patch. It may ride the v0.6 minor with non-security items; it
never shares a release with 01, 03, or 04 (one security change per release; this is not
security-class).

- **Added — the two-arm eval instrument.** One entry stating: `judge.mjs --arm
  zodyssey|baseline` stamps the arm it was invoked under (validated enum, default `zodyssey`
  bit-for-bit, arm never enters the judged prompt); `harness.mjs --arm baseline` runs the control
  arm end-to-end (shared fresh-copy/git/scaffold prefix, one external-CLI agent on the seed
  prompt, self-appended efficiency record, judge command with the arm, loud failure + exit 4);
  `harness.mjs --dry-run` selects arms safely; `judge.mjs --compare` reports per-seed two-arm
  deltas grouped by the stamped arm, with mismatch warnings. Cite the paired probes, as this repo
  does: pre-fix corpus records `std-01-baseline`/`arch-01-baseline` stamped `arm: "zodyssey"`
  (2026-08-01) — the falsified direction, already witnessed — and the post-fix stamp==argv test.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - **No baseline data exists yet.** The instrument ships; the corpus populates on the first
    explicit operator run (`--arm baseline`, `--double` recommended, `--task` subsets first).
    Landing this change without running the eval is correct.
  - The two historical mislabeled judged records (2026-08-01) remain — retention stance per queue
    item 05; `--compare` flags them on every run rather than rewriting history.
  - The zodyssey arm stays conductor-driven and interactive (`harness.mjs:11-14`); headless
    full-pipeline automation is a separate follow-up requiring a headless `/orchestrate`.
  - `dashboard.mjs` still derives arm from slug suffixes and its `:20` "arm field is unreliable"
    comment is now stale — correct behaviour, stale prose; switching it to the stamped field is a
    follow-up outside this change's file set.
  - The settling number will be directional (MEASUREMENT.md §6.2 — small seed set), and judge
    absolute scores stay untrustworthy (56.6–65.7% hard pairs, 61.3% flip under paraphrase); only
    the same-judge delta is the claim.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the marketplace cache picks up the new argv surface — a judge left
  in the stale cache keeps hardcoding `"zodyssey"` into records on the very next scoring run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is a pure code-logic change (two scripts, one new suite) and the run's whole method is
red-green: write `two-arm-eval.test.mjs` first, demonstrate it red against the unmodified
`judge.mjs` (criterion 4 — every record stamped `"zodyssey"`), then plumb the arm and go green,
then the dry-run and compare cases, then the full suite. F5 cross-checks the declaration against
hook-witnessed loads, so a declaration without a real load fails the final wave — declare nothing
speculative. No `discovered:`/`generic:` (no find-skills call is planned) and no `mcp:`
declarations (none will be loaded). If a test fails in a way two fix attempts do not diagnose,
loading `systematic-debugging` is correct — declare it only if it is actually loaded, after the
fact, never in anticipation.

## Estimated size

~55-75 lines in `skills/odyssey/scripts/judge.mjs` (flag parse + enum validation ~10, the stamp
~2, usage header, `--compare` with warnings ~40-55); ~70-90 lines in
`skills/odyssey/scripts/harness.mjs` (baseline execution + self-append + mkdir guard + fail-loud
+ `--dry-run` + strict `--arm` + the `--list` arm line, minus the instruction-printer); ~170-200
lines of new test (`two-arm-eval.test.mjs`: hermetic `HOME` + `CLAUDE_CLI` stub, cases a-g plus
controls); ~30 lines of docs. **Minor release** — rides the v0.6 minor with non-security queue
items, never with 01/03/04. Gates queue item 10 (prompt-surface measurement) the moment it lands:
that item's first number becomes drawable once both arms are runnable and labeled.
