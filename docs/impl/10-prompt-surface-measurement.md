# 10 — Prompt-surface measurement: evidence statuses for the guidance text

Build order **10** · depends-on **09** ([`09-two-arm-eval-baseline`](09-two-arm-eval-baseline.md) —
the one hard blocking edge in the queue: `docs/implementation-prompt.md:83` says "The prompt-surface
item cannot start before the eval runs"; the precondition below is that edge made executable) ·
queue row: [`docs/impl/00-INDEX.md`](00-INDEX.md) `10 prompt-surface-measurement` ·
measurement-class · minor release.

> **PRECONDITION — do not start this change until it holds.** Blocked on 09 having produced its
> first paired data. Executable gate:
> `grep -c '"arm":"baseline"' ~/.zcode/orchestration/eval/judged.jsonl` must return **≥ 1**. As this
> prompt was written (2026-08-16, todo 15 of run `impl-prompts-v0-6`) it returns **0**: the arm
> field is hardcoded to `"zodyssey"` (`skills/odyssey/scripts/judge.mjs:176`), so no record can
> carry `arm:"baseline"` until 09's `--arm` instrument lands. Until then there is nothing to
> measure, and the script you build here must refuse (exit 3). That refusal is correct behaviour,
> not a bug — the failure mode it prevents is a measurement rendered over absent data.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
and counts below were re-derived on 2026-08-16 and this repo moves fast. Do exactly this one change.

## What is broken

**The prompt surface is large, load-bearing by assertion, and measured nowhere.** The guidance that
steers every orchestration run is, in full (census measured 2026-08-16, todo 15):

- `skills/odyssey/SKILL.md` — 394 lines, **17 `##` sections** (+2 `###` subsections): the state
  machine, capability routing, parallel-by-default, anti-duplication, checkpointing, the works.
- `agents/*.md` — **8 agent definitions, 1,071 lines** (`metis` 265, `momus` 195, `oracle` 159,
  `librarian` 142, `sisyphus-junior` 108, `explore` 86, `prometheus` 72, `multimodal-looker` 44;
  `agents/README.md` is the porting map, not a dispatched prompt, and is excluded).
- `skills/odyssey/references/capabilities.md` — 150 lines, **23 activity rows** in the quick matrix
  at `:30-53`, each prescribing a Primary/Reinforcing capability for an activity.

That is ~1,615 lines of guidance text. **Zero of it is measured**: `grep -r 'prompt-surface\|promptSurface'
skills/ scripts/` returns 0 hits — no script, no metric row in `docs/MEASUREMENT.md`, no doc anywhere
distinguishes which sections demonstrably change outcomes from which are dead weight. Guidance
accretes release over release with no pruning signal; every addition is permanent by default because
nothing can say "this row has never earned its keep".

**And it cannot be measured today, which is why this item is blocked on 09.** Correlating guidance
against outcomes needs outcome *variance* — a delta between a guided run and an unguided one on the
same task. Verified blocker chain (all re-derived 2026-08-16):

1. `skills/odyssey/scripts/judge.mjs:176` writes `arm: "zodyssey"` hardcoded — it is the only `arm`
   occurrence in the file; no flag is parsed, so even a baseline run judged today is recorded as arm
   `"zodyssey"`. The judged record shape (`seed_id`, `slug`, `arm`, `overall`, `dimensions`,
   `criterion_results` — `judge.mjs:171-182`) can hold the comparison, but the label is wrong.
2. `skills/odyssey/scripts/harness.mjs:19` — the usage line still reads
   `--arm zodyssey|baseline … baseline = single-agent, no pipeline — TODO`; the baseline branch at
   `:128-135` prints manual instructions instead of automating the arm.
3. The live ledger proves it: `~/.zcode/orchestration/eval/judged.jsonl` holds **5 records, every
   one `arm:"zodyssey"`** — including two whose *slugs* end `-baseline` (`std-01-baseline` 0.83,
   `arch-01-baseline` 0.62, measured 2026-08-16). The field cannot express the comparison;
   `skills/odyssey/scripts/dashboard.mjs:20` already concedes this ("the `arm` field on judged
   records is unreliable (all emit 'zodyssey')") and works around it with a slug-suffix heuristic
   (`lib/arm.mjs:14`) — display-only, and exactly the crutch a measurement must not lean on.

The witnessed-activity substrate the measurement joins against also exists but is not yet populated
in the eval runs: run state records hook-witnessed capability loads
(`skills/odyssey/hooks/post-tool.mjs:205` and `:251` push
`{at, phase, capability, observed: true}` into `state.capabilities`), and each arm's run repo keeps
its state at `runs/<slug>-live/.zcode/state/<slug>.json` under the eval dir (layout verified on
disk). The two zodyssey-arm states on disk today carry `capabilities: []` (measured 2026-08-16) —
runs predate the observation write. The join must degrade to `unmeasured` there, never guess.

The paired probe / current-build reading that proves the defect real *today*: run any prospective
measurement over the live eval dir and there is no pair to consume — zero records with
`arm:"baseline"` — so any tool that "succeeds" over that dir is reporting a result over an empty
set. That is this repo's own `--verify` failure shape, and the reason the precondition below fails
closed.

## What fixed means

Stated as observable behaviour, not as a diff. One new operator-run script,
`skills/odyssey/scripts/prompt-surface.mjs` (usage `prompt-surface.mjs [eval-dir] [repo-root]`,
defaults matching `dashboard.mjs:31-32`: eval-dir `~/.zcode/orchestration/eval`, repo-root `cwd`):

1. **It refuses to run without 09's data — fail closed.** It reads `judged.jsonl` from the eval dir
   and requires **≥ 1 paired seed**: a `seed_id` with at least one record whose **`arm` field** is
   `"baseline"` and at least one whose `arm` field is `"zodyssey"`. Field, not slug-suffix — only
   09's `judge.mjs --arm baseline` can write that field, so the precondition keys on the instrument,
   not on a naming heuristic. Without a pair it writes the refusal to **stderr** (stdout stays
   empty), names the blocker and the cure — the text must contain `two-arm` and
   `09-two-arm-eval-baseline` and the harness/judge commands that produce the data — and
   **exits 3**. This is a deliberate divergence from `dashboard.mjs:12`'s exit-0-on-empty
   convention, and it is right: the dashboard *displays* what exists; this script computes evidence
   statuses, and a wall of `unmeasured` rendered over no data would look exactly like a result.
2. **It enumerates the whole prompt surface mechanically, every run.** Split `SKILL.md` on `^## `
   headings (17 sections today), parse the `capabilities.md` quick-matrix rows (23 today), list the
   8 `agents/*.md` definitions (excluding `README.md` by rule). Every enumerated unit appears as a
   report row whatever its status — a section added next quarter shows up as `unmeasured` in the
   next report as a *visible row*, not a silent pass.
3. **It tags each unit with an evidence status computed from 09's deltas — mechanically, no model
   call anywhere.** Per paired seed: `delta = mean(zodyssey overalls) − mean(baseline overalls)`. A
   unit is *witnessed active* on a seed when the zodyssey-arm run's state
   (`runs/*/.zcode/state/<slug>.json` glob under the eval dir) records its capability in
   `capabilities[]` — matched by **exact normalized identity** (`Task: zodyssey:prometheus` →
   `agent:zodyssey:prometheus`; whitespace-stripped), never by last-segment tolerance. Then:
   - `measured-load-bearing` — witnessed on ≥ `MIN_N = 3` paired seeds AND mean delta over those
     seeds ≥ **+0.15**;
   - `contradicted` — same witness count AND mean delta ≤ **−0.15**;
   - `unmeasured` — everything else: below `MIN_N`, never witnessed, delta inside the noise band,
     or the state substrate absent/empty (today's `capabilities: []` case).
   The 0.15 threshold is not invented: it is `judge.mjs:166`'s own double-judge disagreement flag —
   a delta smaller than judge-to-judge noise cannot be called load-bearing. `MIN_N` and the
   threshold are named constants printed in the report header, not buried.
4. **The report prints one aggregate pipeline line plus the tagged table, to stdout only.**
   SKILL.md sections and agent blocks execute in every zodyssey-arm run by construction, so a
   two-arm design cannot attribute outcomes to them individually (that needs ablation) — they read
   `unmeasured` in this first pass, honestly, while the single `pipeline (aggregate)` line carries
   n-pairs, mean delta, and the same three-valued status for the guidance *as a whole*. The report
   ends with per-status counts and the unmeasured fraction — the headline number this item exists
   to make quotable.
5. **Nothing is mutated.** The script writes stdout and exits. It does not edit SKILL.md, the agent
   prompts, `capabilities.md`, `judged.jsonl`, or any state file; it annotates nothing into the
   .md files; it deletes nothing. Measurement, not mutation — pruning is a human decision in a
   separate change, argued from this table. Exit contract: **0** report rendered · **2** bad args ·
   **3** precondition failed. Not wired into any hook or phase transition; it is an operator
   command like the dashboard.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/scripts/prompt-surface.mjs` (new)
- `skills/odyssey/scripts/prompt-surface.test.mjs` (new)

The prompt surfaces are **read, not written**: `skills/odyssey/SKILL.md`, `agents/*.md`, and
`skills/odyssey/references/capabilities.md` are inputs the script parses, and appearing in `Files:`
would only create the temptation this change exists to refuse. The docs listed under "Docs to
update" belong to the release pass, not the gated run.

## Must NOT do

- **Do not rewrite, reflow, or prune `SKILL.md`, `agents/*.md`, or `capabilities.md` in this
  change** — not even the rows the first report tags `contradicted`. This change ships the
  measurement; acting on it is a separate human decision with its own change and its own review.
  Nothing is auto-deleted.
- **Do not add an LLM-judge-of-prompts layer.** No model call, no reviewer agent, no "have an LLM
  read the guidance and rate it". The analysis is mechanical over run data: parse surfaces, join
  witnessed activity, compare deltas. The only LLM in this pipeline is 09's judge, whose scores
  this script *consumes* — **no LLM opinion layer** is added on top.
- **Do not fall back to slug-suffix arm derivation** when the `arm` field is absent or uniformly
  `"zodyssey"`. `lib/arm.mjs:14`'s heuristic is display-only; keying measurement on it is
  measurement from a mislabeled comparison — the exact failure the precondition exists to refuse.
  Fail closed (exit 3) instead.
- **Do not match capabilities by last-segment tolerance** ("any `*:prometheus` matches the
  planning row"). The queue just fixed that tolerance as a credential vulnerability (build order
  03); do not reintroduce it as silent misattribution. Exact normalized identity only.
- Do not write anything outside stdout: no annotations into the guidance files, no backfill or
  "repair" of `judged.jsonl` or state files, no cache side-effects.
- Do not wire the script into hooks or phase transitions, and do not make its failure block
  anything — it is an operator report. A repo-capability gap (missing state file, empty
  `capabilities[]`) degrades to a recorded `unmeasured`, never to a block.
- Zero npm dependencies; Node 18+ built-ins only; synchronous, no daemon.

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

**This change's exposure: 28 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/SKILL.md` (24), `skills/odyssey/references/capabilities.md` (4).

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

1. `node --check skills/odyssey/scripts/prompt-surface.mjs && node --check
   skills/odyssey/scripts/prompt-surface.test.mjs` — expected exit **0**.
2. `node skills/odyssey/scripts/prompt-surface.test.mjs` — expected exit **0** (prints `N passed,
   0 failed`; must include the precondition block — hermetic fixture eval dir with no
   `arm:"baseline"` record → exit 3 with the message — and the tagged-report block — fixture with
   ≥1 paired seed, state files carrying capability observations, statuses computed, `MIN_N`
   gating asserted, stdout/stderr separation asserted).
3. `node --test skills/odyssey/scripts/prompt-surface.test.mjs` — expected exit **0**.
4. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16. The count may legitimately grow (this change adds a suite); the exit code must not
   change.
5. No-data refusal, hermetic and durable:
   `d=$(mktemp -d); err=$(node skills/odyssey/scripts/prompt-surface.mjs "$d" 2>&1 >/dev/null); ec=$?; rm -rf "$d"; test $ec -eq 3 && printf '%s' "$err" | grep -q 'two-arm' && printf '%s' "$err" | grep -q '09-two-arm-eval-baseline'`
   — expected exit **0**: empty eval dir → exit 3, refusal names the blocker and the producing
   prompt. (Against the live eval dir the same refusal fires until 09's first data lands — as this
   prompt was written that is the universal case; it belongs to the Paired probe, not here,
   because it expires the moment 09 produces a pair.)
6. Tagged report end-to-end, hermetic:
   `d=$(mktemp -d); mkdir -p "$d/runs/s1-zodyssey-live/.zcode/state" "$d/runs/s1-baseline-live/.zcode/state"; printf '%s\n' '{"seed_id":"s1","slug":"s1-zodyssey","arm":"zodyssey","overall":0.9}' '{"seed_id":"s1","slug":"s1-baseline","arm":"baseline","overall":0.4}' > "$d/judged.jsonl"; printf '%s\n' '{"slug":"s1-zodyssey","phase":"audited","capabilities":[{"at":"2026-08-16T00:00:00Z","phase":"6","capability":"agent:zodyssey:prometheus","observed":true}]}' > "$d/runs/s1-zodyssey-live/.zcode/state/s1-zodyssey.json"; out=$(node skills/odyssey/scripts/prompt-surface.mjs "$d" .); ec=$?; rm -rf "$d"; test $ec -eq 0 && printf '%s' "$out" | grep -q 'unmeasured' && printf '%s' "$out" | grep -q 'agents/prometheus.md'`
   — expected exit **0**: paired fixture → exit 0, the table renders, `agents/prometheus.md` is
   witnessed but n=1 < MIN_N so it must read `unmeasured` (proves the min-n gate, not just the
   happy path).
7. Read-only invariant — measurement, not mutation:
   `s1=$(cat skills/odyssey/SKILL.md skills/odyssey/references/capabilities.md agents/metis.md agents/momus.md agents/oracle.md agents/librarian.md agents/sisyphus-junior.md agents/explore.md agents/prometheus.md agents/multimodal-looker.md | sha256sum); node skills/odyssey/scripts/prompt-surface.mjs >/dev/null 2>&1; s2=$(cat skills/odyssey/SKILL.md skills/odyssey/references/capabilities.md agents/metis.md agents/momus.md agents/oracle.md agents/librarian.md agents/sisyphus-junior.md agents/explore.md agents/prometheus.md agents/multimodal-looker.md | sha256sum); test "$s1" = "$s2"`
   — expected exit **0**: the prompt surfaces are byte-identical after a report run against the
   live eval dir (whatever that run's own exit code was — the point is it never writes).
8. The TDD direction, re-provable on demand (demonstrate it BEFORE implementing — add the failing
   suite, watch it go red — and it stays provable after):
   `mv skills/odyssey/scripts/prompt-surface.mjs /tmp/ps.mjs.bak; node skills/odyssey/scripts/prompt-surface.test.mjs; ec=$?; mv /tmp/ps.mjs.bak skills/odyssey/scripts/prompt-surface.mjs; test $ec -eq 1`
   — expected exit **0** overall: with the implementation absent the suite exits 1, proving the
   new assertions actually execute rather than silently skipping.

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** The surface census is structural — headings, matrix rows,
   directory listing parsed from the files themselves each run — not a hand-maintained list. A new
   section or row cannot be forgotten into invisibility; it self-registers as an `unmeasured` row.
2. **A check that cannot detect the class of failure it exists for.** The class here is "a
   measurement that looks like a result over no data". The precondition refuses exactly that, and
   criterion 5 exercises it live; the report header prints pairs-consumed and thresholds so an
   all-`unmeasured` report is legible as substrate-poverty, not silently successful.
3. **Ceremony without mechanism.** Ships a script and a suite, not a doc promise. The unmeasured
   fraction becomes quotable because a command emits it, and the status computation is fixed
   constants, not reviewer judgment.
4. **Self-grading.** Statuses are computed from recorded deltas with named thresholds; every
   criterion is an exit code. No human grades prose, and no model grades anything.
5. **A fix that reopens its own class.** Covered in "The class it closes" — the enumeration test
   asserts a newly added section appears in the report, so the accretion-blindness cannot silently
   return.

## Paired probe

Both directions, stated. The "broken build" for a new script is its absence:

- **Probe A — the precondition refusal (the core invariant).** Run the script against an eval dir
  with no `arm:"baseline"` record. **Broken build: exit 1 (module not found). Fixed build:
  exit 3, stderr carries `two-arm` + `09-two-arm-eval-baseline`, stdout empty.** Against the *live*
  eval dir the refusal is today the universal case — 5 records, all `arm:"zodyssey"`
  (measured 2026-08-16; `judge.mjs:176` hardcodes the field) — so this probe doubles as the
  demonstration that the script refuses on real absent data, not only on synthetic emptiness.
- **Probe B — the tagged report over paired data.** Hermetic fixture (criterion 6's exact tree):
  one paired seed, one witnessed agent capability. **Broken build: exit 1. Fixed build: exit 0**,
  table renders `agents/prometheus.md | unmeasured | n=1` (min-n gate) and the
  `pipeline (aggregate)` line reports the pair. A second fixture variant inside the test suite uses
  3+ paired seeds with deltas beyond ±0.15 to drive all three statuses — `measured-load-bearing`,
  `contradicted`, `unmeasured` — so the thresholds are asserted, not illustrated.
- **Probe C — read-only.** sha256 of all ten guidance files before/after a live report run
  (criterion 7). **Broken build: vacuous (no script). Fixed build: identical digests**, on either
  side of whatever exit code the live dir produces.

Controls required on BOTH builds — a probe that moves any of them has overreached: `dashboard.mjs`
still exits 0 with "No eval data yet" on an empty dir (its convention is untouched);
`judge.mjs`/`harness.mjs` untouched; the full suite's exit code unchanged; `judged.jsonl` and every
state file byte-identical after any number of report runs.

## What it breaks

**Nothing runtime — the change is read-only analysis.** No hook, no phase transition, no script
that any run executes is modified; the blast radius is one new operator command and one new test
suite. Three honest frictions:

- Anyone expecting dashboard-style exit-0-on-empty gets exit 3 from this script. Deliberate
  (behaviour 1), divergent from `dashboard.mjs:12`, and documented where the grep lives
  (`references/scripts.md`) so it is a stated contract, not a surprise.
- The first reports will read mostly `unmeasured`: SKILL.md sections by construction (no ablation),
  and capabilities rows until runs record capability observations (the two live zodyssey-arm states
  carry `capabilities: []` today). That is the honest state of the evidence, and the report says so
  rather than dressing it up.
- The political risk is real but out of scope: a `contradicted` tag on guidance someone wrote reads
  like a verdict. It is a coarse correlation below three pairs' worth of nothing — the report
  informs pruning debates; humans decide, in a later change. That boundary is the point, and
  Must-NOT-do #1 enforces it.

## The class it closes

**Guidance accretion without a pruning signal** — the same class as *metrics that measure
nothing*, and this repo's own `--verify` precedent lives inside it: a runner that reported success
over an empty set because nothing in its output could express "I checked nothing". The prompt
surface has both failure shapes at once: (a) no measurement at all, so every addition is permanent
by default and every pruning argument is an intuition; (b) the temptation, once measurement is
attempted, to run it over data that cannot support it (slug-derived arms, zero pairs) and emit a
wall of `unmeasured` that looks like a result.

How this change could reintroduce the class: (1) new guidance lands untagged and the accretion
blindness returns — prevented because the census is re-derived from the files on every run and the
suite asserts a freshly-added section/row appears in the report as `unmeasured`, a visible row
rather than a silent pass; (2) someone "simplifies" the precondition to accept slug-suffix arms so
the report runs on pre-09 data — prevented by the precondition test asserting the arm-field rule
plus Must-NOT-do #3; the suite pins exit 3 on a mislabeled-arms fixture (baseline slug, `arm:
"zodyssey"` field) exactly to catch that regression.

## Docs to update

Every doc that states the claim this change alters, each checked against the 2026-08-16 tree:

- `docs/MEASUREMENT.md` — add the prompt-surface metric: the per-status counts, the unmeasured
  fraction as the headline, the canonical commands (`prompt-surface.mjs [eval-dir] [repo-root]`,
  exit contract), the thresholds (`MIN_N = 3`, delta ±0.15 anchored to `judge.mjs:166`'s judge-noise
  flag), and the precondition (requires `arm:"baseline"` records — i.e. 09 landed).
- `skills/odyssey/references/scripts.md` — new entry for `prompt-surface.mjs`: signature, exit
  contract **0/2/3**, and the explicit divergence from `dashboard.mjs`'s exit-0-on-empty convention
  with the reason.
- `CHANGELOG.md` — new version's **Added** entry, shape below, including the *Known, not fixed*
  residuals.
- `docs/DESIGN.md` §6 and `README.md` — checked: both state enforcement claims only; neither
  asserts anything about guidance measurement. **No edit required.** Recorded here so the next
  reader does not hunt.

## CHANGELOG entry shape

Minor release (a new measurement surface and script; no behaviour change anywhere else — ship it
without riders so the first quotable fraction is attributable to this change alone).

- **Added** — one entry: prompt-surface measurement. A report command tags every unit of the
  guidance surface (SKILL.md sections, capability-matrix rows, agent prompts) with an evidence
  status — `measured-load-bearing` / `unmeasured` / `contradicted` — computed mechanically from the
  two-arm deltas 09 produces, joined to hook-witnessed capability activity in run state. Names the
  precondition (refuses, exit 3, without a seed judged under both arms) and the headline it makes
  quotable (the unmeasured fraction). This repo cites its probes: refusal proven live against the
  pre-09 ledger; all three statuses threshold-proven in the suite.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - **Initial tagging is coarse.** Two arms measure the pipeline as a whole; per-section attribution
    for SKILL.md and per-agent attribution require ablation runs (a future change, not this one).
    Agent blocks inherit the aggregate delta's status; SKILL.md sections read `unmeasured` by
    construction.
  - The witnessed-activity substrate is empty for runs that predate the capability-observation
    write (`state.capabilities: []` in both live zodyssey-arm states) — early reports will
    legitimately read mostly `unmeasured`.
  - Guidance-version skew: eval runs are driven by the *cached* plugin's prompt surface; the report
    tags the tree it is pointed at (`repo-root` argv). Exact version pinning is follow-up work.
  - `MIN_N = 3` and the ±0.15 band are named conventions printed in the report header — conventions,
    not laws.
  - The report mutates nothing. Pruning, if any, is a human decision in a separate change.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the cache carries the script (the operator runs it from wherever;
  the cache copy is the one matching the runs' guidance — see the skew bullet above).

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is a pure code-logic change: one new script plus its suite, and the run's whole method is
red-green — write the failing precondition and status-computation cases first (criterion 8's
demonstration), then make them green. F5 cross-checks the declaration against hook-witnessed
loads, so a declaration without a real load fails the final wave — declare nothing speculative.
No `discovered:`/`generic:` (no find-skills call is planned) and no `mcp:` declarations (none will
be loaded — the analysis reads local files with `node:fs`). If a test fails in a way two fix
attempts do not diagnose, loading `systematic-debugging` is correct — declare it only if it is
actually loaded, after the fact, never in anticipation.

## Estimated size

~200 lines in `skills/odyssey/scripts/prompt-surface.mjs` (precondition, surface census, pairing,
witnessed-activity join, status computation, report), ~180 in
`skills/odyssey/scripts/prompt-surface.test.mjs` (fixture builders for eval dir + state files;
refusal, min-n, threshold, and enumeration-regression blocks), ~20 lines of docs. Minor release,
shipped alone behind 09's first data.

## Amendment — 2026-08-17, after the arm-derivation rider shipped

The ISNAD-adaptation work (queue row 19, build step A0) fixed the `arm` hardcode this brief's
preconditions describe: `judge.mjs` now stamps `arm: armFromSlug(slug)` via
`skills/odyssey/scripts/lib/arm.mjs`, so `arm:"baseline"` records ARE producible without item 09.
The residual blocker for this brief is narrower than its opening states: it is the explicit
`--arm` instrument channel plus baseline-arm automation (`harness.mjs:19`) — the exit-3
precondition should key on an explicitly-stamped `--arm` record, not on the absence of a
hardcode. Accordingly, the Must-NOT-do rule "do not fall back to slug-suffix arm derivation" is
restated for the post-fix world as: **require an explicitly-stamped `--arm` record, not an
inferred one** — the stamped field is now slug-derived (correct for labeling, per the
`docs/impl/09` amendment), so measurement must not treat record `arm` as independent of the
slug. Precondition text above is preserved as the record of what was true on 2026-08-16.
