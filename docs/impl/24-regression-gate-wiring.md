# Brief 24 — the regression gate gets its invoke: `done` runs `--check`

2026-08-21 · closes the README enforcement table's last half-wired row · release v0.6.17

## What is broken

`regression-gate.mjs --check` — the only code path that writes `regressed` or `toolchain-drift` —
has **zero code callers**. `--snapshot` runs from two sites (execute entry via
`set-phase.mjs`, plus `record-review.mjs`'s OKAY advance), and `set-phase … done` carries
refusal clauses for both values, but nothing ever runs the comparison, so both clauses guard a
field nothing sets. The pass-to-pass property (SWE-bench's PASS_TO_PASS, absent from every
checked OSS orchestrator) shipped as ceremony: a mechanism with no wiring. The README's
enforcement table carried this as its one ⚠️ row, honestly, since 2026-08-19 — item 02 wired
three sibling checks (check-imports, coverage-delta, resolve-capabilities) the two-sided way and
named this one as out of scope. Measured this session: a fixture run with a regressed suite
sails to `done` with `st.regression.status` still `baselined` — the silent pass (4/12 of the
wiring suite's assertions fail pre-fix, exactly the half-wiring shape).

## What fixed means

1. The `done` transition **invokes** `regression-gate.mjs <repo> <slug> --check` itself
   (`set-phase.mjs`, done-entry block): the comparison runs over the exact tree the final wave
   judged, the check writes the lane via its own state writer, and set-phase **re-reads the
   state** so the existing refusal clauses evaluate the FRESH lane — invoke, record, consume,
   all three sides on one transition.
2. The subprocess's exit code never gates the transition — the recorded status does (exit 8
   `regressed` / 6 `toolchain-drift` surface through the refusal messages, where a human reads
   them). A refused `done` that is retried re-runs the check, so fixing the regression produces
   a fresh verdict, not a stale refusal.
3. The outer spawn timeout rides `ZODYSSEY_REGRESSION_TIMEOUT_MS + 60s` margin; the gate's own
   suite timeout still governs. Gate-vs-inert is unchanged: no toolchain → `inert`, no baseline
   → `no-baseline`, baseline red → recorded never enforced — the gate still cannot wedge a run
   it cannot evaluate.
4. `regression-gate.mjs` itself is **untouched** — its exit-code contract is frozen; only the
   caller side was missing.

## Files

- `skills/odyssey/scripts/set-phase.mjs` — the done-entry invoke block (+ re-read) and the
  `REGWIRE_TIMEOUT_MS` const. Nothing else in the file changes behavior.
- `skills/odyssey/scripts/set-phase.regression-wiring.test.mjs` — NEW suite (the 54th): cases
  A (gate: green baseline + red suite → done refuses, lane `regressed`), B (pass-through:
  lane `ok`, done succeeds), C (no lane → `no-baseline`, never a block), D (source-shape: the
  invoke and the re-read are pinned against accidental removal).
- `skills/odyssey/scripts/set-phase.eval-lane.test.mjs` — case (f) re-planted honestly: the
  regressed lane is now derived from a real red toolchain suite instead of a hand-planted
  status, because the done entry re-derives it (the lane semantics under test — a refused done
  appends to neither eval lane — are unchanged).
- `README.md` — the ⚠️ row becomes the v0.6.17 guarantee row; the blockquote records both
  corrections (2026-08-19, 2026-08-21) and the lesson they encode.
- `scripts/check-anchors.mjs` — illustrative comment pair re-pointed (consult-r3 advisory).
- `docs/impl/00-INDEX.md` — queue row 24, line-count-neutral.
- `docs/impl/24-regression-gate-wiring.md` — this brief.
- `CHANGELOG.md` + the version trio — `[0.6.17]` entry and bumps.

## Must NOT do

Touch `regression-gate.mjs` (frozen exit contract); gate on the subprocess exit code instead of
the recorded lane; make `inert`/`no-baseline` block `done`; run the check on any transition
other than `done` (the suite cost belongs at the terminal decision, once); weaken
`set-phase.eval-lane.test.mjs` case (f)'s lane assertions to make it pass.

Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon · graceful no-op when optional tools are absent · every hook is a no-op unless a run is active · the trusted-script allowlist means any agent has the same argv surface the operator does, so no argv flag authenticates anyone.

Anti-goal: no more LLM opinion layers. Fail closed.

## Acceptance criteria

- `node --check skills/odyssey/scripts/set-phase.mjs` — exit 0.
- `node skills/odyssey/scripts/set-phase.regression-wiring.test.mjs` — exit 0, 12/12 (RED 4/12
  observed on the unmodified tree before the wiring; the paired direction is case D).
- `node skills/odyssey/scripts/set-phase.eval-lane.test.mjs` — exit 0, 19/19.
- `grep -c "regression-gate.mjs", import.meta.url).*--check" skills/odyssey/scripts/set-phase.mjs`
  ≥ 1 (the invoke exists at the done entry).
- `git diff skills/odyssey/scripts/regression-gate.mjs` — empty (the frozen contract).
- `node scripts/run-tests.mjs` — exit 0, **54/54**.
- `test "$(grep -c '^## ' docs/impl/24-regression-gate-wiring.md)" -eq 12` — exit 0.

## Paired probe

| Leg | Tree | `done` result | `st.regression.status` |
|---|---|---|---|
| RED (unmodified) | fixture: green baseline, red suite | **succeeds** — the silent pass | `baselined` (stale — nothing ran) |
| GREEN (wired) | same fixture | **refused**: "passed before this run and fails now" | `regressed` (fresh, with `after` recorded) |
| GREEN pass-through | green suite | succeeds | `ok` |
| GREEN no-lane | no regression record | succeeds | `no-baseline` |

Both legs hermetic (mkdtemp repos, sentinel toolchain suites), observed 2026-08-21; the RED leg
is case A of the committed suite, which fails 4/12 on the pre-wiring tree by construction.

## What it breaks

- `done` now costs one suite run (the gate's own timeout governs; for this repo ~100s once per
  run). Runs in repos with no toolchain stay instant (`inert`).
- Hand-planted `regressed`/`toolchain-drift` lanes no longer survive to the refusal — the done
  entry re-derives them from the real suite. Anything relying on a hand-planted lane (one test
  fixture did) must plant the underlying condition instead.
- A run whose suite was red mid-close but is green at `done` now passes — correct, and a
  behavior change from the never-checked status quo.

## The class it closes

"An invoke whose recorded state nothing consumes is the half-wiring the regression gate shipped
with" — the inverse also held: a consumer whose recorded state no invoke produces. Item 02
closed three checks of the first shape; this closes the last of the second. The class is
**mechanism-without-wiring** (failure mode 3, ceremony without mechanism): the table row
claimed enforcement while the enforcing value was unreachable. Not closed by this item: the
suite-level exit code remains the enforceable signal (per-test granularity is a named
concession — runner-specific parsing rots); `--resnapshot` remains operator-deliberate.

## Docs to update

`README.md` (the row + blockquote, done), `CHANGELOG.md` `[0.6.17]`, `docs/impl/00-INDEX.md`
row 24, this brief. DESIGN.md needs nothing — the DAG and refusal clauses are unchanged; only
the missing edge gained its edge.

## CHANGELOG entry shape

```
### Fixed — the regression gate is wired: `done` runs the comparison (item 24)

regression-gate.mjs --check shipped in v0.6.0's B8 wave with zero code callers — the snapshot
ran, the done refusals waited, and nothing ever compared. The done transition now invokes
--check over the exact tree the final wave judged, re-reads the recorded lane, and refuses on
what it says; the subprocess exit never gates, the recorded status does. Gate-vs-inert
unchanged: inert/no-baseline never block, an already-red baseline is recorded, not enforced.
The 54th suite pins invoke+record+consume together (12/12; 4/12 on the pre-wiring tree), and
the eval-lane suite's refused-done fixture now derives its regression from a real red suite.
README's enforcement table loses its last ⚠️ row — zero half-wirings remain.
```

## Capability routing

`routed: skill:test-driven-development` — the change is a red-first paired probe (RED 4/12 on
the unmodified tree captured before the wiring; GREEN 12/12 after), executed directly per the
house TDD discipline.

## Estimated size

S — one invoke block + one const in set-phase.mjs, one new suite, one fixture re-plant, README
row/quote, comment re-point, brief + INDEX row + release. Suite 53 → 54.
