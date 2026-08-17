# 19 — Narrator trust registry (ISNAD R2)

Build order **19** · depends-on **—** (A0 rider included; arm lib consumed, none of rows 01-18
block it) · queue row: [`docs/impl/00-INDEX.md`](00-INDEX.md) `19 narrator-trust-registry` · not
security-class · minor release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were derived on 2026-08-17 after the change landed; this brief is the record of what shipped
and the contract it must keep satisfying. Do exactly this one change.

## What is broken

The eval loop measures and improves nothing. `judge.mjs`/`run-report.mjs` score every run;
`recall-outcomes.mjs`/`recall-corrections.mjs` feed metis at consult — but **no mechanism tracks
whether a given agent configuration's verdicts held up under independent scrutiny** and feeds that
back into the next run's risk assessment. A momus config that approves plans the external auditor
later REJECTs on compliance grounds, and an executor config whose output keeps failing judge
criteria, are both invisible to phase 1. The ISNAD-engine study (2026-08-17) supplied the missing
design (rule R2, jarḥ/taʿdīl): a **source registry** whose entries are keyed on the CONFIGURATION
(the deployed `agents/<name>.md` bytes — no agent file carries a version field, so the content hash
is the only sound identity), updated only by deterministic arithmetic over already-recorded
outcomes (never a new LLM opinion — ROADMAP §3 non-goal), and always displayed with the sample
count n behind every score.

**Paired-probe result (live, real data, 2026-08-17):** `registry-report.mjs` on THIS repo scanned
13 state files + the real `judged.jsonl` and produced `momus@bc5147160f46 trust 0.67 n=4 (s=3
m=1)` and `sisyphus-junior@90a67c2a625a trust 0.73 n=9` — evidence that existed on disk the whole
time, invisible until this change.

## What fixed means

Stated as observable behaviour:

1. `skills/odyssey/scripts/registry-report.mjs <repo> [--json] [--min-n <k>] [--store <dir>]`
   (exit 0 · 2 bad args · 3 no state dir) scans-and-recomputes — **never append-accrete**; no
   `consult.mjs` change, no new habit:
   - Consult lane: every `<repo>/.zcode/state/*.json` with `review.verdict === "OKAY"` and a
     `consult.history[]` round contributes — ACCEPT → momus success; REJECT gaps:
     `compliance` → momus miss (momus OKAY'd a plan that failed external compliance);
     `bug|quality|security` → executor miss (config-level attribution). Unknown gap categories are
     skipped with a stderr warning. Malformed state files: skipped loudly, never crash.
   - Judge lane: `~/.zcode/orchestration/eval/judged.jsonl` records whose arm derives `zodyssey`
     (`lib/arm.mjs` — the A0 rider); each `criterion_results[].met` → executor success/miss.
     Judge-era records predate agent hashing → they attribute to the CURRENT config key and carry
     `assumed_current_config: true`.
   - Identity: keys are `<agent>@<sha256(agents/<name>.md).slice(0,12)>`, resolved self-relative
     (`../../../agents/` — the `pre-tool.mjs:1570` install-root pattern). **A prompt edit starts a
     new key at the cold-start prior — structural decay; trust attaches to the configuration,
     never the model name.**
   - Ledger: `~/.zcode/orchestration/registry/narrators.jsonl` (env `ZODYSSEY_REGISTRY_DIR`,
     `--store`; judge input via `ZODYSSEY_EVAL_DIR`), one evidence row per line with stable ids
     (`<repoBase>:<slug>:consult:<round>[:g<i>]`, `judge:<slug>:<seed_id>:<at>:c<i>`) — re-scans
     append nothing; rolling 1000-row cap (`capJsonl` twin).
   - Trust: `(s+1)/(s+m+2)` (Laplace; cold start 0.50). **n is ALWAYS printed beside trust.**
2. Consumption is **advisory only**: `agents/metis.md` instructs running it at consult alongside
   the recall twins, folding low-trust/high-n narrators into Identified Risks (oracle co-review
   recommendation, stricter QA directives, finer todo granularity), with an explicit small-n rule
   (n < 3 is cold-start noise — note it, don't act on it). `skills/odyssey/SKILL.md`'s CONSULT box
   names the third script. **No gate, no precondition, no hook consumes a trust score.**
3. `scripts/install.mjs` gains step 7 REGISTRY — `initRegistryDir()` mirrors `initEvalDir()`
   (mkdir `~/.zcode/orchestration/registry/` + `.gitkeep`; the script also creates it on demand).

## Files

The declared editable set: `skills/odyssey/scripts/registry-report.mjs` (new) ·
`skills/odyssey/scripts/registry-report.test.mjs` (new) · `skills/odyssey/scripts/lib/arm.mjs`
(new, A0) · `skills/odyssey/scripts/arm.test.mjs` (new, A0) · `skills/odyssey/scripts/judge.mjs`
(A0 only: import + `arm: armFromSlug(slug)`) · `skills/odyssey/scripts/dashboard.mjs` (A0 only:
consume lib, drop private copy) · `agents/metis.md` · `skills/odyssey/SKILL.md` ·
`skills/odyssey/references/scripts.md` · `scripts/install.mjs` · `docs/INSTALL.md`.

## Must NOT do

- **No LLM opinion layer** — every update is arithmetic over consult verdicts and judge criterion
  results already on disk. A registry that spawns a model to "assess" narrators violates the
  ROADMAP §3 non-goal this design exists to honor.
- **No gate on trust** — never a precondition, hook, or refusal. The split is the repo's own:
  enforce invariants with code, guide choices with prompts.
- Do not ingest `outcomes.jsonl` — it is an unauthenticated plain append (`set-phase.mjs:448-469`
  writes it with no marker). The consult lane is written by trusted `consult.mjs` under its
  O_EXCL lock; that is the integrity boundary we accept, and it is stated in the script header.
- Do not modify `consult.mjs`, any hook, or `state.json` shape.
- Do not blacklist narrators or floor/ceiling trust by policy — Laplace smoothing with n shown is
  the whole arithmetic; "volume never launders bad origins" is already enforced elsewhere
  (record-todo blocks on any failed verify record), not the registry's job.
- No npm dependencies; no daemon; no new env vars beyond the two documented test overrides.

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

This change edits heavily-cited prompt surfaces (`SKILL.md`, `metis.md`, `scripts.md`,
`install.mjs`). Reconciliation performed 2026-08-17: ~35 citations shifted at source; five
contentless re-anchors; `judge.mjs:171` family (16 citations) repointed at the derivation line with
dated amendments appended to `docs/impl/09`, `docs/ideation-report.md`, and `docs/OPPORTUNITY-MAP.md`
(their hardcode claims were true as written — the defect is now fixed). Procedure:
[`docs/impl/02-wire-zero-caller-checks.md`](02-wire-zero-caller-checks.md) §Anchor-drift
reconciliation. **Note the trap this change hit: contentless citations surface as `[contentless]`,
not `[drift]`, and are invisible to a drift-only reconciliation pass — grep for both.**

## Acceptance criteria

1. `node --check` every touched/new `.mjs` — exit **0**.
2. `node skills/odyssey/scripts/registry-report.test.mjs` — exit **0** (28/28: argv exits, both
   attribution rules, Laplace values, idempotence, `--store`, `--json` + `--min-n`, judge-lane
   arm filtering, malformed-state tolerance, no-crash).
3. `node skills/odyssey/scripts/arm.test.mjs` — exit **0** (11/11 incl. consumer-wiring
   assertions: no private `armFromSlug` copies remain).
4. `node scripts/install.mjs --dry-run` — exit **0**, prints `init registry dir:`.
5. `node scripts/run-tests.mjs` — exit **0**, suite count 37 → **39** (registry + arm suites).
6. Real-data smoke: `node skills/odyssey/scripts/registry-report.mjs <any repo with consult
   history>` exits **0** and prints at least one narrator row with a nonzero n.

### Failure-mode check (Step 6)

1. **Enumeration instead of structure.** Attribution keys off the auditor's own gap categories
   (a closed contract), not a hand-list of gap texts.
2. **A check that cannot detect its class.** The suite pins exact trust arithmetic (0.67/0.33/0.5)
   and idempotence — a silently double-counting or misattributing registry fails loudly. The
   hermetic suite pins `ZODYSSEY_EVAL_DIR` at an empty dir precisely because the judge lane is
   global (found the honest way: the first run ingested s=7 m=3 of real data into a "hermetic"
   fixture).
3. **Ceremony without mechanism.** The registry is wired into metis's consult instructions and
   SKILL.md's consult box — the same wiring surface the recall twins use, not a doc-only mention.
4. **Self-grading.** Trust derives from the EXTERNAL auditor's verdicts and the independent judge's
   criterion results — never from any agent grading itself.
5. **A fix that reopens its own class.** The registry cannot become a new gate (Must NOT do), and
   config-hash keying means editing an agent prompt to "reset" a bad score only moves the problem
   to a cold-start key whose n=0 is displayed as what it is.

## Paired probe

**Probe:** a run whose momus OKAY was followed by an external REJECT with a compliance gap.

- **Before: invisible.** The consult lane records it; nothing aggregates it; phase 1 of the next
  run never hears that this momus config missed.
- **After: counted and surfaced.** The scan records a momus miss; metis receives
  `momus@… trust 0.33 n=1` and folds it into Identified Risks (small-n noted, not acted on).

Controls: repos without consult history → empty report, cold-start legend, exit 0; baseline-arm
judged records → ignored; re-scan → zero new rows.

## What it breaks

Nothing gates. The ledger is a new global file under the operator's `~/.zcode/orchestration/`
(existing convention); `metis.md`/`SKILL.md` gained one consult-time instruction each. Honest
costs: (a) the judge lane's current-config assumption mis-attributes pre-hash evidence by
construction — marked `assumed_current_config`, stated in the header; (b) consult is opt-in, so
the registry starts sparse — n-always-displayed is the mitigation, not a promise; (c) editing an
agent prompt resets its trust identity — deliberate (stochastic-narrator rule), and old rows remain
in the ledger as history under the old key.

## The class it closes

**Measured outcomes that feed nothing back** — the adaptation gap this repo's own notes named the
biggest. Closes it as a cross-run meta-layer over existing signals, per the ISNAD R2 design.
Adjacent, deliberately NOT duplicated: `recall-corrections.mjs`'s FUTURE WORK (a) loop (mining
recurring failure patterns for staged prompt edits) should READ this registry as its numeric
substrate rather than build a parallel store.

## Docs to update

Done in this change: `agents/metis.md` (narrator-reliability bullet) · `skills/odyssey/SKILL.md`
(CONSULT box line) · `skills/odyssey/references/scripts.md` (Diagnostics bullet) ·
`scripts/install.mjs` + `docs/INSTALL.md` (step 7 REGISTRY) · this queue row. At release:
CHANGELOG per below.

## CHANGELOG entry shape

- **Added — narrator trust registry (ISNAD R2).** `registry-report.mjs` + `lib/arm.mjs`: cross-run
  agent-config reliability from external-audit verdicts and judge criterion results, keyed on
  agent-file content hashes (prompt edit = new identity = cold start), Laplace trust with n always
  shown, global ledger under `~/.zcode/orchestration/registry/`, advisory-only consumption by
  metis at consult. Real-data smoke on landing: momus 0.67 (n=4), executor 0.73 (n=9).
- **Fixed — judged records no longer hardcode `arm: "zodyssey"`** (A0 rider): derived from the slug
  suffix via the shared lib; dashboard's private copy deduped. Item 09's residual scope (explicit
  `--arm` instrument channel + baseline-arm automation) unchanged.
- **Known, not fixed** — judge-lane evidence assumes the current agent config for pre-hash records
  (`assumed_current_config`); the registry is consult-fed and starts sparse by design; nothing
  renders trust in `dashboard.mjs` yet.

## Capability routing

`routed: skill:test-driven-development` — the hermetic suite was written against the script's
contract and demonstrated failing before the isolation fix (real-corpus leak).

## Estimated size

~230 lines `registry-report.mjs` · ~15 `lib/arm.mjs` · ~150 + ~110 test lines · ~30 lines of
prompt/wiring/doc edits. Landed as four commits on `feat/isnad-adaptation` (A0 `940fd84`, A1+A2
`add5d3c`, A3 + briefs).
