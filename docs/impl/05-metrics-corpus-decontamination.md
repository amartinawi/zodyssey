# 05 — Decontaminate the metrics corpus

Build order **05** · depends-on **—** (nothing precedes or blocks it) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `05 metrics-corpus-decontamination` · not security-class ·
minor release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast; in particular queue item **02 lands
ahead of this one and adds ~70-90 lines to `set-phase.mjs`**, so every `set-phase.mjs:NNN` below
must be re-derived (the block shapes and quoted lines are stable; the numbers are not). Do exactly
this one change.

## What is broken

**The mechanism.** When any orchestration run reaches a terminal phase, `set-phase.mjs`
unconditionally appends its scorecard to the operator's live trend log:
`skills/odyssey/scripts/set-phase.mjs:430` — `if (phase === "done" || phase === "audited") {`;
`:447` — `const resultsPath = join(env.HOME || "", ".zcode", "orchestration", "eval",
"results.jsonl");`; `:450` — `appendFileSync(resultsPath, report.trim() + "\n");`; `:452` —
`capJsonl(resultsPath, 1000)`. There is no guard of any kind in the block: no fixture check, no
env opt-out, no slug filter (grep `fixture|skip|eval` across `set-phase.mjs` hits only the
final-wave `--skip`/`--force` semantics, unrelated). The block's own header (`:426-429`, tagged
CRIT-4a) explains why: the auto-append was built so that "NO run can complete unmeasured" — which
is precisely what makes a fixture run indistinguishable from a real one at this write site.

**The contamination, anchored.** The repo's own integration fixture drives a full synthetic run
to a successful `done`: `skills/odyssey/scripts/pipeline-integration.test.mjs:61` —
`const SLUG = "add-truncate";` — and `:267` invokes the real `set-phase.mjs <fixture-repo>
add-truncate done`, which hits `:450` and appends a fixture scorecard to the **live operator
log** (the run's `run()` helper at `:33` inherits `process.env`; nothing reroutes `HOME`).
Sixteen further records carry `"slug":"t"` — the fixture slug used across the hook/script suites
(`skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:173,185`; `skills/odyssey/hooks/pre-tool.gate-surface.test.mjs:236`;
`skills/odyssey/scripts/regression-gate.test.mjs:122` crafts `.zcode/state/t.json`). No test in
today's tree successfully drives `t` → done (regression-gate's done at
`skills/odyssey/scripts/regression-gate.test.mjs:124` is asserted BLOCKED, exit ≠ 0, and the
precondition at `skills/odyssey/scripts/set-phase.mjs:131` fires before the append), so those 16
are historical fixture writes — generated in four bursts on 2026-08-15T17:06-17:07Z, fixture-
shaped (`todos_total: 0`) — produced by the same unconditional mechanism, which is unchanged.

**The measured state — this prompt's own tally, stamped, never an ideation-doc number.**
Measured 2026-08-16 during this queue's authoring (todo 10 of run impl-prompts-v0-6;
`date -u` at measurement: 2026-08-15T23:50:07Z):

- `wc -l ~/.zcode/orchestration/eval/results.jsonl` → **190** records.
- `grep -c 'add-truncate' …` → **143**; `grep -c '"slug":"t"' …` → **16**; synthetic = 16 + 143 =
  **159/190 = 83.7%**.
- `wc -l ~/.zcode/orchestration/eval/judged.jsonl` → 5.
- The file is **live and drifted throughout this queue's own authoring**: 172 (map, 08-15) → 177
  (report, 08-15) → 181 (metis consult, 08-16) → 184 (notepad 2, 08-16) → 185 (todo 3) → **190
  (this todo)**. The `add-truncate` count alone grew 137 → 138 → 143 across those checkpoints —
  every increment is a `node scripts/run-tests.mjs` execution appending a fixture record to the
  operator's trend log. That growth is the paired probe's broken direction, already witnessed
  five times before anyone built anything.

**Why this gates the queue.** `dashboard.mjs` reads exactly this file
(`skills/odyssey/scripts/dashboard.mjs:31-34`; its arm logic at `skills/odyssey/scripts/lib/arm.mjs:14-17` counts every
fixture record as arm "zodyssey"), so the win-rate it renders is 83.7% fixture noise — vacuous.
Every measurement item behind this one draws its first number from the same file: **06**
(token telemetry — populated-fraction denominators), **09** (two-arm eval — arm comparisons),
**10** (prompt-surface — blocked on 09). The queue's own sequencing rule is explicit:
`docs/implementation-prompt.md:84-85` — "No measurement item should land before the corpus is
decontaminated, or its first number is drawn from a poisoned set." The INDEX DAG encodes it:
06 depends-on 05, 09 depends-on 05, 10 depends-on 09.

## What fixed means

Stated as observable behaviour, not as a diff.

**1. Synthetic runs write to a separate lane file.** A run that declares itself synthetic at
source — via the environment variable `ZODYSSEY_EVAL_LANE=synthetic`, set by the fixture/harness
process that spawns `set-phase.mjs` — appends its done/audited scorecard to
`~/.zcode/orchestration/eval/results.synthetic.jsonl` instead of `results.jsonl`. Same directory,
same record format (the untouched `run-report.mjs --json` line), same rolling cap, same stderr
notice (`set-phase.mjs:453` already prints the destination path — it now names the lane file,
free observability).

**2. Real runs are bit-for-bit unchanged.** With the variable unset — the state of every real
orchestration run — the append lands in `results.jsonl` exactly as today. CRIT-4a's contract
("no run completes unmeasured") is preserved for the operator lane; only the *destination* of
declared-synthetic writes changes.

**3. The repo's own suite stops contaminating.** One full `node scripts/run-tests.mjs` execution
leaves the operator's `results.jsonl` byte-identical (asserted on the `add-truncate` marker, see
criteria), while `results.synthetic.jsonl` grows by the fixture records.

**4. Migration stance — retention, not quarantine, argued explicitly.** The ~159 historical
synthetic records already in `results.jsonl` **stay there**. They are flagged, not deleted:
`docs/MEASUREMENT.md` records the cutover date and the stamped pre-cutover contamination
(159/190 = 83.7%, 2026-08-16), and `capJsonl(resultsPath, 1000)` at `:452` ages the contaminated
tail out naturally. Quarantine — a one-time migration moving fixture-slug records out of the
live file — is rejected for three reasons: (a) product code rewriting the operator's telemetry
history is silent-history-editing, the exact class this repo's append-only ledger conventions
exist to prevent (`set-phase.mjs` writes state; it must never edit history); (b) a migration
needs a fixture classifier (slug ∈ {"t", "add-truncate"}) — an enumeration of fixture slugs that
the next fixture name silently bypasses, the Step-6 failure mode #1 shape, and one that can eat
a real run whose slug collides; (c) the cap already provides the aging mechanism without a
rewrite. Retention costs one documented caveat and zero code.

**5. Why a separate file, not a provenance stamp in one file.** A `"synthetic": true` stamp
pushes the filtering duty onto every consumer — `dashboard.mjs`, the `harness.mjs` count, and
the 06/09/10 fix-runs — and one forgetful consumer re-poisons its own number. A separate file
makes the *default* read clean with zero consumer changes: everything that reads
`results.jsonl` today keeps working and gets real runs only; anything that wants both lanes
reads both files. Structure over enumeration.

**6. The env var grants no authority — stated against the Step-5 constraint.**
`ZODYSSEY_EVAL_LANE` removes a *noisy* path (fixture telemetry arriving in the operator's trend
log); it does not authenticate anyone and grants no privilege: `set-phase.mjs` remains invocable
by every agent with the same argv/env surface the operator has, and the lane value never gates,
blocks, or unlocks a transition (telemetry is best-effort by the block's own contract,
`:426-429`). Contrast `ZODYSSEY_UNGATE_BASH`, which removes a *gate* — this removes a write
destination, and only for runs that declare themselves synthetic. A real run that sets it merely
opts its own telemetry out of the trend log — an operator-visible data-loss tradeoff, not a
security boundary. Lane resolution is exact-match: the only recognized synthetic marker is the
literal value `synthetic`; unset or any other value means operator lane (best-effort telemetry
semantics — a typo'd lane must not fail a phase transition; the guard criterion is the
tripwire, not the router).

Mechanism notes, secondary to the behaviour: resolve the lane where `resultsPath` is built
(`:447`); add `mkdirSync(dirname(resultsPath), { recursive: true })` before the append (today
the eval dir exists only because `scripts/install.mjs:925` created it — a hermetic test or a
fresh machine degrades to the catch-and-warn at `:455`, which would silently mask the very
behaviour under test); `capJsonl` applies to whichever lane file was written (`:452`'s twin).
`judged.jsonl` is deliberately NOT split: it has zero fixture writes today (5 records, stable;
`skills/odyssey/scripts/judge.mjs:13`) — extending the lane to it is queue item 09's call, named
under *Known, not fixed*.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/scripts/set-phase.mjs` — the append site (`:430-457`): lane resolution, mkdir,
  cap twin.
- `skills/odyssey/scripts/harness.mjs` — the sweep summary at `:149` prints the record count of
  `results.jsonl` only; post-split it must report both lanes (operator + synthetic) or it
  silently under-reports — a miniature of the vacuous-dashboard problem this change exists to
  close. Harness also grows the lane declaration surface for 09 (its runs are real and stay
  operator-lane by default).
- `skills/odyssey/scripts/pipeline-integration.test.mjs` — the fixture writer: declare the lane
  for the fixture's child processes. The `run()` helper at `:33-38` and the `dispatch()` helper at
  `:68-72` already sculpt child env (`ZODYSSEY_UNGATE_BASH: ""` at `:71` is the in-file
  precedent) — add `ZODYSSEY_EVAL_LANE: "synthetic"` there, so the whole fixture run is
  synthetic at source, including any future `done`/`audited` invocation added to this test.
- `skills/odyssey/scripts/set-phase.eval-lane.test.mjs` (new — no such suite exists today;
  naming follows `set-phase.check-wiring.test.mjs` from queue item 02, which will already exist
  when this lands — keep the names distinct).

Nothing else. `dashboard.mjs` is deliberately absent: it needs **zero changes** — it reads
`results.jsonl` and starts receiving real runs only, which is the point (see "What it breaks").
`run-report.mjs` is untouched (its JSON line is lane-agnostic). `judge.mjs` is untouched (no
fixture writes today). The docs listed under "Docs to update" belong to the release pass, not
the gated run — do not widen the set to include them by default.

## Must NOT do

- **Do not rewrite history in the live file.** No one-time migration, no quarantine move, no
  deletion or reordering of existing `results.jsonl` records, no script that "cleans" fixture
  slugs. Retention is the decided stance (argued above); the file is the operator's data.
- **Do not break the readers.** `run-report.mjs`'s output schema is untouched;
  `dashboard.mjs`, `harness.mjs`, and `dashboard.test.mjs` (which already writes an isolated
  fixture `results.jsonl` in a `mkdtemp` dir at `skills/odyssey/scripts/dashboard.test.mjs:65`)
  must keep working unmodified except the harness summary line. Both lane files carry the
  identical record format.
- **Do not make the lane a gate.** An unset, misspelled, or unrecognized lane value never
  blocks or fails a transition — telemetry stays best-effort (`:426-429`, `:455`'s catch). Fail
  closed applies to enforcement state, not to where a scorecard lands.
- **No argv flag for lane selection.** Env-only, and no argv-surface change to `set-phase.mjs`
  at all — **No argv flag authenticates anyone**; the lane declares provenance, it does not
  confer authority.
- Do not touch `judged.jsonl` routing (queue item 09 extends the lane there when arms exist).
- Do not add a slug classifier, name sniffer, or any heuristic that *guesses* whether a run is
  synthetic — provenance is declared at source or it is not known. A guessed lane is
  enumeration wearing a mechanism's clothes.
- Do not daemonize, background, or add async runners; **Zero npm dependencies** — Node 18+
  built-ins only, synchronous.
- Do not batch this into a release carrying queue items 01, 03, or 04 (one security change per
  release; this change is not security-class).
- **No LLM opinion layer** — the lane is an env byte and a path join. No judge, classifier, or
  reviewer decides anything in this change.

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

**This change's exposure: 38 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/scripts/set-phase.mjs` (29), `skills/odyssey/scripts/harness.mjs` (7), `skills/odyssey/scripts/pipeline-integration.test.mjs` (2).

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

Every criterion is an exact command from the repo root plus its expected exit code; criteria 1-8
describe the **fixed** tree (the red-direction demonstration is criterion 4, run in TDD order
before the implementation lands). `record-verify` executes them and records the codes.

1. `node --check skills/odyssey/scripts/set-phase.mjs && node --check skills/odyssey/scripts/harness.mjs && node --check skills/odyssey/scripts/pipeline-integration.test.mjs`
   — expected exit **0**.
2. `node skills/odyssey/scripts/set-phase.eval-lane.test.mjs` — expected exit **0**. The suite
   must contain and pass, at minimum, all under a hermetic `HOME` (each case builds a fixture
   repo + crafted done-bound state — `review.verdict: "OKAY"`, `final.verdict: "pass"`, no
   regressed regression; the crafting pattern is
   `skills/odyssey/scripts/regression-gate.test.mjs:118-126`): (a) **default lane** — `done`
   with no lane var appends exactly one parseable record to
   `$TMP/.zcode/orchestration/eval/results.jsonl` (CRIT-4a preserved); (b) **synthetic lane** —
   `done` with `ZODYSSEY_EVAL_LANE=synthetic` appends to
   `$TMP/.zcode/orchestration/eval/results.synthetic.jsonl` and `$TMP`'s `results.jsonl` is
   absent or empty; (c) **lane value strictness** — `ZODYSSEY_EVAL_LANE=Synthetic` (wrong case)
   behaves as operator lane, transition exits 0; (d) **cap twin** — the source routes
   `capJsonl` at the lane file (asserted via criterion 8's tripwire plus a small-N cap
   exercise, or by asserting the synthetic path is the capped one in source order).
3. `node --test skills/odyssey/scripts/set-phase.eval-lane.test.mjs` — expected exit **0**.
4. The paired direction — proof the new assertions run against the unwired code, demonstrated
   BEFORE the implementation lands (TDD order):
   `git stash push -- skills/odyssey/scripts/set-phase.mjs && node skills/odyssey/scripts/set-phase.eval-lane.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only the lane routing reverted, case (b) fails (the
   record lands in the operator file) and the suite exits 1. (The fixture-declaration edit in
   `pipeline-integration.test.mjs` stays applied during this demonstration — it is inert until
   `set-phase.mjs` reads the variable.)
5. **The suite-level guard — the operator log invariant, on the real HOME:**
   `b=$(grep -c add-truncate ~/.zcode/orchestration/eval/results.jsonl); node scripts/run-tests.mjs >/dev/null 2>&1; a=$(grep -c add-truncate ~/.zcode/orchestration/eval/results.jsonl); test "$b" -eq "$a"`
   — expected exit **0**: one full suite execution adds zero `add-truncate` records to the
   operator log. The marker count (not `wc -l`) is deliberate: a concurrent *real* orchestration
   run reaching `done` during the window appends a record whose slug is not `add-truncate`, so
   the criterion cannot flake on live traffic — a criterion a concurrent real run can break is
   not a criterion.
6. The synthetic lane receives the fixture record:
   `test $(grep -c add-truncate ~/.zcode/orchestration/eval/results.synthetic.jsonl 2>/dev/null || echo 0) -ge 1`
   — expected exit **0** after the suite run in criterion 5.
7. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16 (this queue's own arrival measurement; item 02's landing may grow the count — the
   exit code is the contract, not the count).
8. Source tripwire against silent unhooking, in the spirit of
   `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs`:
   `test $(grep -c 'results.synthetic.jsonl' skills/odyssey/scripts/set-phase.mjs) -ge 1 && test $(grep -c 'ZODYSSEY_EVAL_LANE' skills/odyssey/scripts/pipeline-integration.test.mjs) -ge 1`
   — expected exit **0** (the lane named at its routing site and declared at the fixture's
   source).

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** No slug lists, no fixture-name classifiers, no
   per-consumer filter conventions. Provenance is declared once at source and the sink routes
   on it — the structure is the separate file. The rejected quarantine migration is named above
   precisely because it would have been another enumeration round.
2. **A check that cannot detect the class of failure it exists for.** Criterion 5 detects
   contamination end-to-end on the real file, through the real suite, using a marker immune to
   live traffic; criterion 4 proves the assertions can go red. A silently-skipped lane test
   cannot pass criterion 5's invariant.
3. **Ceremony without mechanism.** The alternative design — a docs rule telling fixture authors
   to point HOME elsewhere — is exactly the conductor-addressed imperative this repo replaces.
   This ships a mechanism: an env byte read at the write site.
4. **Self-grading.** Every criterion is machine-executed with a recorded exit code; the paired
   probe runs against both builds with byte-level file evidence. Nobody grades prose.
5. **A fix that reopens its own class.** Covered in "The class it closes" — the guard is the
   suite-level marker invariant, which catches a *future* undeclared fixture writer, not just
   today's.

## Paired probe

**Probe:** one execution of the repo's test suite, measuring the `add-truncate` marker count in
the operator's live `~/.zcode/orchestration/eval/results.jsonl`.

- **Before the fix (current HEAD): the operator log grows.**
  `b=$(grep -c add-truncate ~/.zcode/orchestration/eval/results.jsonl); node scripts/run-tests.mjs >/dev/null 2>&1; a=$(grep -c add-truncate ~/.zcode/orchestration/eval/results.jsonl); echo "$b -> $a"`
  → `a > b` — today's behaviour, already witnessed live five times during this queue's own
  authoring (137 → 138 → 143 across checkpoints; the file's total drifted 172 → 190). Every
  suite run pollutes the operator's trend log with one fixture record.
- **After the fix: the operator log is byte-identical, the synthetic lane grows.** Same commands
  → `a == b`, AND `grep -c add-truncate ~/.zcode/orchestration/eval/results.synthetic.jsonl`
  has increased by ≥ 1 (criterion 6).

Unchanged controls, required on BOTH builds — a probe that moves any of them has over-blocked:

| Control | Before | After |
|---|---|---|
| A real (unlaned) run reaching `done`/`audited` | appends to `results.jsonl` | appends to `results.jsonl` — CRIT-4a bit-for-bit |
| `done` blocked by a recorded regression (`set-phase.mjs:131`) | no append, exit ≠ 0 | no append, exit ≠ 0 — the lane never gates |
| `audited` transition | appends to `results.jsonl` | routes by the same lane rule as `done` |
| `run-report.mjs --json` output format | lane-agnostic | lane-agnostic — untouched |
| `dashboard.mjs` on the existing historical file | renders (vacuously) | renders identically — zero code change |

## What it breaks

The intended break: fixture records stop arriving in the operator's trend log. Honest blast
radius beyond that:

- **Anything assuming one corpus file.** The exact readers, checked against the 2026-08-16 tree:
  `skills/odyssey/scripts/dashboard.mjs:31-34` (reads `results.jsonl` + `judged.jsonl` from the
  eval dir) — post-split its win-rate covers real runs only and its numbers **shift**; that is
  the purpose, but the historical tail remains mixed until `capJsonl` ages it out, so the
  pre-cutover window must be documented in `docs/MEASUREMENT.md` or the next reader attributes
  the shift to a code change. `skills/odyssey/scripts/harness.mjs:34,145` — updated in this
  change to report both lanes. `skills/odyssey/scripts/run-report.mjs:183` — the manual-append
  footer still names `results.jsonl`; a human hand-appending a synthetic run's report would land
  it in the operator log — a one-clause docs caveat, no code change (named under *Known, not
  fixed*). `skills/odyssey/scripts/recall-corrections.mjs:32` — aspirational comment only.
  `skills/odyssey/scripts/dashboard.test.mjs:65` — already isolated in a temp dir; unaffected,
  and it is the generalization pattern this change follows.
- **The stderr notice changes text for synthetic runs** (`:453` now prints the synthetic path) —
  nothing in the repo greps that message (grep: no consumers), humans only.
- **Downstream queue items 06, 09, 10** — gated on this by design (INDEX DAG); each reads the
  operator lane and needs no retrofit. 09 additionally inherits the lane mechanism for
  `judged.jsonl` when arms land.
- **Anyone who was (incorrectly) using the fixture records as signal** — e.g. a trend chart that
  appeared "active" because suite runs kept appending. That activity was the defect.

## The class it closes

**Shared mutable state between test fixtures and production telemetry** — the test suite writes
to the operator's real data sink because the sink has no notion of provenance. The 143
`add-truncate` records are this class accumulated in production: five of them arrived while this
very prompt was being written. The dashboard's vacuous win-rate
(`skills/odyssey/scripts/dashboard.mjs:31-34` counting fixture records as arm "zodyssey" via
`skills/odyssey/scripts/lib/arm.mjs:14-17`) is the class's observable damage, and the queue's whole measurement block (06, 09, 10)
is its blast radius-to-be.

How this change could reintroduce the class: a **future** test or harness invoking
`set-phase … done` (or any new terminal-phase writer) without declaring the lane — the record
lands in the operator log again, silently, exactly the way the `add-truncate` count crept
137 → 143. What prevents it: (a) criterion 5's marker invariant is re-runnable at any time and
is immune to concurrent real runs — a new undeclared fixture writer moves the `add-truncate`
count only if it reuses that slug, so the invariant's general form is "operator-log line count
unchanged across a suite run when no real run completes", with the marker form as the
traffic-proof executable; (b) the lane test asserts the partition hermetically, so the routing
itself cannot rot silently (criterion 4 keeps the assertions red-capable); (c) the source
tripwire (criterion 8) fails if the routing or the fixture declaration is deleted; (d)
`references/scripts.md`'s set-phase entry documents the lane contract — a new fixture author
meets it in the docs that already tell them how to invoke the script. The residual, named
honestly: the guard proves the *suite* clean, not the ecosystem — a script run by hand outside
the suite with no lane still writes to the operator log, which is correct behaviour for a real
run and undecidable for a synthetic one (provenance cannot be guessed — see Must NOT do).

## Docs to update

Every doc that states the claim this change alters ("every completed run's scorecard lands in
`results.jsonl`"), each checked against the 2026-08-16 tree:

- `docs/MEASUREMENT.md:148` — the pipeline diagram's `APPEND to eval/results.jsonl ◄── the trend
  line` box gains the two-lane fact; `:196` — build-order item 4 ("`eval/results.jsonl` +
  `dashboard.mjs` — append-only trend log") likewise. Add a **corpus-hygiene block**: the
  cutover date, the stamped pre-cutover contamination (159/190 = 83.7% synthetic, measured
  2026-08-16, run impl-prompts-v0-6 todo 10), the retention stance, and the cap-aging note —
  without it, the dashboard's post-cutover shift is unattributable.
- `skills/odyssey/references/scripts.md:9` — the set-phase row's "On done\|audited, auto-appends
  run-report to results.jsonl" gains: the `ZODYSSEY_EVAL_LANE=synthetic` routing to
  `results.synthetic.jsonl`, and the rule that fixture harnesses declare the lane at spawn.
- `docs/DESIGN.md` — the queue's docs pointer named "§6", but §6 is the hooks table
  (`docs/DESIGN.md:245`) and states nothing about the corpus; the sections that carry the claim
  are **§11 Observability & evaluation** (`:384`) and **§12's component row 12** (`:416`,
  "results.jsonl + judged.jsonl"). Update those two; record the pointer correction in the
  change's notes rather than silently editing §6 (a doc edit in the wrong section is the next
  doc-code drift).
- `CHANGELOG.md` — shape below.
- `README.md` — check the comparison table at release time for any "every run is measured"
  phrasing; if a row implies one file, add the lane clause there (verify at build time — do not
  edit on spec).

## CHANGELOG entry shape

Version **0.6.x minor** — a new telemetry artifact and a consumer-visible routing contract is
behaviour, not a defect patch. It may ride the v0.6 minor with queue item 06 (its dependent) and
other non-security items; it never shares a release with 01, 03, or 04 (one security change per
release; this is not security-class).

- **Changed — the metrics corpus is decontaminated.** One entry stating: fixture/synthetic runs
  append to `~/.zcode/orchestration/eval/results.synthetic.jsonl`; `results.jsonl` holds real
  runs only; provenance is declared at source via `ZODYSSEY_EVAL_LANE=synthetic`; the rolling
  cap applies to both lanes; `dashboard.mjs` needed zero changes (the design's point). Cite the
  paired probe, as this repo does: suite run before → operator log +1 `add-truncate` record
  (observed live 137 → 143 during the v0.6 planning run); after → byte-identical operator log,
  synthetic lane +1. Stamp the corpus numbers with their measurement date — the file is live
  and this repo has three separate stale counts of it in its own ideation docs.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - The ~159 historical synthetic records (16 `"slug":"t"` + 143 `add-truncate` at measurement)
    remain in `results.jsonl` — retained, not quarantined; flagged in `MEASUREMENT.md` with the
    cutover date; aged out by the 1000-record cap. Deleting or moving them was rejected as
    history-rewriting by product code with an enumeration-shaped classifier.
  - `judged.jsonl` has no lane split — zero fixture writes today (5 records, stable); queue
    item 09 must extend the lane mechanism when the baseline arm lands.
  - No permanent sentinel re-runs the whole suite against the live operator file on every
    commit; the guard is the lane test plus criterion 5's re-runnable invariant.
  - `run-report.mjs:183`'s manual-append footer names `results.jsonl` only — a human
    hand-appending a synthetic report lands it in the operator log (docs caveat, no code
    change).
  - The 16 `"slug":"t"` records' exact writer predates the current tree (2026-08-15 bursts; no
    current test successfully drives `t` → done) — left as unattributed archaeology, harmless
    under retention.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  re-Get/Update the plugin so the marketplace cache picks up the routing — a fix that stays
  only in the repo contaminates from the stale cache's `set-phase.mjs` on the very next suite
  run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is a pure code-logic change (a routing byte, a test fixture declaration, a summary line)
and the run's whole method is red-green: write `set-phase.eval-lane.test.mjs` first, demonstrate
it red against the unwired `set-phase.mjs` (criterion 4 — the suite must fail with the record
landing in the operator file), then route the lane and go green, then run the suite-level guard.
F5 cross-checks the declaration against hook-witnessed loads, so a declaration without a real
load fails the final wave — declare nothing speculative. No `discovered:`/`generic:` (no
find-skills call is planned) and no `mcp:` declarations (none will be loaded). If a test fails
in a way two fix attempts do not diagnose, loading `systematic-debugging` is correct — declare
it only if it is actually loaded, after the fact, never in anticipation.

## Estimated size

~10-15 lines in `skills/odyssey/scripts/set-phase.mjs` (lane resolution at the `:447` site, the
mkdir guard, the cap twin); ~3 lines in `skills/odyssey/scripts/pipeline-integration.test.mjs`
(one env key in each child-spawn helper); ~5 lines in `skills/odyssey/scripts/harness.mjs`
(both-lane summary); ~110-140 lines of new test (`set-phase.eval-lane.test.mjs`: four hermetic
cases plus controls); ~25 lines of docs. **Minor release** — rides the v0.6 minor with
non-security items, never with 01/03/04. Gates queue items 06 and 09 the moment it lands: the
first honest corpus number is the one drawn after this change ships.

## Amendment — 2026-08-17, item shipped (v0.6.1)

Shipped on `feat/eval-lane-decontamination`. Deviations from the brief as written, both forced
by the tree having moved since 2026-08-16 (the brief's own header instruction: verify every
anchor against the standing tree):

1. **The fixture declaration outgrew `pipeline-integration.test.mjs`.** Item 02's landing gave
   `set-phase.check-wiring.test.mjs` four successful `done` transitions (slug `t`) with no lane
   declaration — a polluter the brief could not name because it predates item 02's suite
   (the brief's own finding: "no test in today's tree successfully drives `t` → done"). Per-helper
   edits would be enumeration — the exact reintroduction class the brief warns against — so the
   declaration lives at the ONE spawner every suite shares: `run-tests.mjs` exports
   `ZODYSSEY_EVAL_LANE=synthetic` for the whole suite run. The lane suite deletes/sets the var
   explicitly per case, so an inherited lane can never contaminate its operator-lane assertions.
   Net effect: criterion 5's invariant holds on BOTH markers — `add-truncate` (pipeline) and `t`
   (check-wiring) — not just the brief's marker.
2. **The mkdir guard is inside the lane change** (the brief's mechanism note), which also fixes
   the hermetic-HOME ENOENT the red-direction run exposed: pre-fix, a fresh HOME degraded to
   the catch-and-warn, silently producing zero records anywhere.

Citations above were re-anchored to the current tree on shipment (the bare-continuation dialect
this file's "What is broken" used heavily is checker-invisible — see `docs/impl/15`'s 2026-08-17
note); quoted code lines in "What is broken" describe the pre-lane tree and are preserved as the
historical record. Stamped at cutover: 387 records / 91.2% synthetic (211 `add-truncate` +
142 `t`); suite-run guard after the fix: operator log byte-identical (387 → 387), synthetic lane
+4 fixture records on the first post-fix run.

## Amendment — 2026-08-18, fix-run residuals (impl-05-corpus-decontamination)

Deltas recorded by the post-ship verification run:

1. **Check-wiring's source lane completed** (the census amendment): `set-phase.check-wiring.test.mjs`
   now declares the lane in its own `phase()` helper, so direct dev-loop runs of the suite (which
   bypass `run-tests.mjs`'s whole-run blanket) route synthetic too — the one residual polluter the
   shipped fix left open.
2. **The v0.6.1 CHANGELOG-shift reconciliation was verify-adopted from `2550e67`, not redone**: the
   re-anchored citations were sample-re-verified by claim content. The insert was +13 lines; the
   blanket +33 applied to the "coherent remainder" overshot by 20, so those sites were re-fixed at
   source in this run (the hand-fixed cluster — the cadence line, the gate-surface line, the v0.5.1
   Edit-path bullet, secure-by-default — verified correct as re-anchored).
3. **The 09-12 sweep stands superseded** per `f0c723b`'s committed decision: briefs 09-12 re-derive
   their citations against the standing tree at their own build time (two same-day
   inferred-referent double-shifts motivated the decline — re-editing reconciled citations is how
   double-shifts happen).
