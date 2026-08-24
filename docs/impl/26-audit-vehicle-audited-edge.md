# Brief 26 — the retroactive-audit vehicle can reach `audited` (candidate C1, commissioning)

2026-08-22 · QUEUED — the build brief for the next `/orchestrate` run · target release decided by that run

Promotes candidate **C1** (`docs/impl/00-INDEX.md`, "Three defects found at run-close"). C1 was
recorded but never briefed, because the INDEX contract is one row = one `docs/impl/NN-<slug>.md`
and no prompt existed. This is that prompt.

## What is broken

The `audited` phase is unreachable for exactly the runs that earn it. The phase DAG
(`skills/odyssey/scripts/set-phase.mjs:87-97`) gives `audited` two predecessors only: `done`
(`:94`) and `remediate` (`:93`). A run opened purely to carry an external audit of work that
already shipped — a *retroactive-audit vehicle* — executes nothing: it never records a
`review.verdict === OKAY`, never runs the final wave, so it cannot satisfy the `done` precondition
(`set-phase.mjs:106-108`) and can never enter `done` or `remediate`. It terminates at `abandoned`,
whose edges are `plan`, `review`, `execute`, `blocked` (`:97`) — `audited` is not among them.

The consequence is not cosmetic. The terminal trend-log auto-append fires on `done` and `audited`
**only** (`set-phase.mjs:478`), so a run that ends at `abandoned` contributes **zero** records to
`~/.zcode/orchestration/eval/results.jsonl`. The one run class whose whole purpose is an external
audit therefore never lands in the corpus — and row 18's `verify_origin: external-audit` label
(the field that distinguishes audited work from self-graded work) is never contributed by the runs
that most deserve it.

Measured, live, on this repo's own state (2026-08-22):

- `impl-04-audit` — the run that carried item 04 to an external-audit **ACCEPT with zero gaps** —
  sits at `phase: abandoned` with `consult.verdict: "ACCEPT"`, `consult.history: [1:ACCEPT]`,
  `review.verdict: null`, no `final`. It contributes no trend record. It is the C1 victim.
- By contrast, every one of the 16 runs currently at `phase: audited` carries
  `consult.verdict === "ACCEPT"` (all 16 checked) — so an ACCEPT is what actually precedes `audited`
  in every sanctioned path, and a run holding an ACCEPT but stuck at `abandoned` is the exact,
  and only, shape the fix must admit.

## What fixed means

A retroactive-audit vehicle that earned an external-audit ACCEPT can be moved to `audited`, so its
record joins the corpus with the correct origin — **without** widening the master-bypass surface
that scoping `--force` exists to close.

1. **Add the edge.** `abandoned`'s transition list (`set-phase.mjs:97`) gains `"audited"`.
2. **Gate the destination on a real ACCEPT.** `checkPrecondition` (`set-phase.mjs:100`) gains a
   clause: `target === "audited"` requires `st.consult?.verdict === "ACCEPT"` — else it returns a
   precondition failure. This is a **destination** precondition, not an edge-specific one: it
   applies to `done → audited` and `remediate → audited` as well, and is provably compatible with
   the live tree (all 16 existing `audited` runs satisfy it). It is what makes the new edge
   non-forgeable, and it simultaneously closes the latent gap that `done → audited` never required
   an audit at all (a `done` run that was never consulted could take the `audited` label; after
   this it cannot). That tightening is intended, not incidental.
3. **`audited` stays out of `FORCEABLE`.** `FORCEABLE` remains `{blocked, abandoned}`
   (`set-phase.mjs:319`); the `forcing && !FORCEABLE.has(phase)` refusal (`:326-329`) already
   rejects `--force audited`. Combined with (2), the two-command master-bypass the INDEX warns of
   — `set-phase abandoned --force` then `set-phase audited` — is blocked: the second step is not a
   force target, and its precondition demands a `consult.verdict === "ACCEPT"` that only the
   trusted `consult.mjs` writer can mint (`consult.mjs:1234`, and the multi-auditor lane at `:750`,
   both under the state lock). Forging it needs the same trusted-writer access every other verdict
   needs; the argv surface grants nothing.

No new gate is loosened; one destination is made reachable and simultaneously better-guarded.

## Files

- `skills/odyssey/scripts/set-phase.mjs` — the one edge (`:97`) + the one precondition clause
  (in `checkPrecondition`, `:100`). No other logic changes.
- `skills/odyssey/scripts/set-phase.audit-vehicle.test.mjs` — NEW suite, driven the way the sibling
  suites drive set-phase (`spawnSync` against a `mkdtemp` git repo — mirror
  `set-phase.check-wiring.test.mjs:33-50`). Cases, RED-first on the unmodified DAG:
  (a) `abandoned → audited` with `consult.verdict === "ACCEPT"` **succeeds** and the run's
  trend-record auto-append fires (the corpus gains the row it was denied);
  (b) `abandoned → audited` with `consult.verdict !== "ACCEPT"` (null / "REJECT") is **refused**
  (exit 6, precondition message);
  (c) `set-phase abandoned --force` then `set-phase audited` — the master-bypass two-step — is
  **refused** at the second step;
  (d) `--force audited` directly is **refused** (`FORCEABLE` unchanged);
  (e) the existing `done → audited` and `remediate → audited` paths with an ACCEPT still succeed
  (no regression), and `done → audited` **without** an ACCEPT is now refused (the intended
  tightening, asserted in both directions).
- `docs/impl/00-INDEX.md` — promote C1: add row 26 to the DAG table, mark it SHIPPED with the
  release + outcome at close, and update the C1 candidate note to point at this brief.
- `skills/odyssey/SKILL.md` and `docs/DESIGN.md` — if either states the phase graph or the
  audited-entry rule, add the `abandoned → audited` edge and the consult-ACCEPT destination gate
  (one line each; verify against the code before editing — do not add prose the DAG already carries).

## Must NOT do

Make `audited` a `--force` target (it must stay out of `FORCEABLE`); gate the edge on anything an
agent can write directly (the argv surface authenticates no one — the gate is `state.consult.verdict`,
minted only by the trusted `consult.mjs` under the lock); add an `abandoned → done` edge (that would
skip review+final; only `audited` is being admitted, and only behind an ACCEPT); retroactively mutate
any existing state file from the miner or the hook (moving `impl-04-audit` forward is a separate,
deliberate operator action — see Acceptance); weaken the `done` precondition (`review OKAY` + `final
pass` + regression/imports clauses stay exactly as they are — this brief only ADDS the audited
destination gate).

Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon · every transition stays
lock-guarded (`set-phase.mjs:334`) · the trusted-script allowlist means any agent has the same argv
surface the operator does, so no flag authenticates anyone · fail closed.

Anti-goal: no second way to reach `audited` that a self-graded run could take. One destination gate,
one edge, both provably ACCEPT-bound.

## Acceptance criteria

(To be finalized by the run's plan; shape:) `node --check skills/odyssey/scripts/set-phase.mjs` and
the new suite; RED first on the unmodified DAG (the `abandoned → audited` transition is illegal, so
cases a/c/e-tightening fail before the change); GREEN after with zero test edits; suite count
**55 → 56**; all five cases above; `node scripts/run-tests.mjs` green; `node scripts/check-anchors.mjs`
clean after reconciliation. **Demonstration on the real victim (operator step, not a code change,
proves the fix end-to-end):** `node skills/odyssey/scripts/set-phase.mjs <repo> impl-04-audit audited`
now succeeds (it holds `consult.verdict: "ACCEPT"`), and one `results.jsonl` record with
`verify_origin: external-audit` appears for it where there were none — recorded read-only in the
run's close-out, not committed.

## Paired probe

RED: on the unmodified `set-phase.mjs`, `abandoned → audited` exits 6 "illegal transition" (the edge
does not exist), so a run that earned an ACCEPT can never be measured — the DAG's own gap IS the red.
GREEN: with the edge + destination gate, an abandoned run holding `consult.verdict === "ACCEPT"`
transitions to `audited` and its trend record auto-appends; the same transition with no ACCEPT, and
the `--force` two-step, both still refuse.

## What it breaks

Nothing that was reachable before — `audited` gains one predecessor and one precondition, and every
existing `audited` run already satisfies that precondition (16/16 measured). The only newly-refused
transition is `done → audited` (or `remediate → audited`) for a run that never obtained a consult
ACCEPT — which was the latent hole, not a supported flow. Operators who move a stuck audit vehicle
forward gain a trend record where they had silence.

## The class it closes

Failure mode 1's shape (a label whose meaning the machine cannot confer on the cases that earn it)
crossed with the measurement gap the whole eval loop exists to close: the runs most worth measuring —
externally audited ones — were the runs the state machine could not record. Closed at the DAG layer,
behind the same ACCEPT every audited run already carries, with `--force` still unable to reach the
label. NOT closed here: signal-3 capture (out of scope, item 25's residual); any change to what
`verify_origin` is set from (row 18 owns that; this brief only makes the transition that carries it
reachable).

## Docs to update

`docs/impl/00-INDEX.md` (row 26 + C1 candidate note), `skills/odyssey/SKILL.md` / `docs/DESIGN.md`
(phase-graph statement, only if present and only against verified lines), CHANGELOG entry by the
implementing run, this brief stays the commissioning record.

## CHANGELOG entry shape

```
### Fixed — the retroactive-audit vehicle can reach `audited` (candidate C1)

A run opened only to carry an external audit of already-shipped work executes nothing, so it could
never reach `done` and therefore never `audited` — it ended at `abandoned` and contributed ZERO
records to the trend log (the auto-append fires on done|audited only, set-phase.mjs:478), the one
run class whose external-audit origin most deserves recording. set-phase.mjs gains an
`abandoned → audited` edge gated on a real external-audit ACCEPT (state.consult.verdict === ACCEPT,
minted only by trusted consult.mjs) — audited stays out of the --force set, so the abandoned-force
two-step cannot mint the label. The destination gate also closes the latent hole that done → audited
never required an audit. All 16 existing audited runs satisfy the new precondition. Suite 55 → 56.
```

## Anchor-drift reconciliation

`set-phase.mjs` carries **42 pinned citations** (measured 2026-08-22 against `scripts/anchors.lock.json`).
Any line insertion will drift them. The fixed order is mandatory: change code →
`node scripts/check-anchors.mjs` (read the drift) → repoint each affected citation **at its source
document** → *only then* `node scripts/check-anchors.mjs --update`. Running `--update` first re-pins
whatever is there, including already-wrong citations — the exact way item 15's own lock was seeded
over a stale anchor. Keep the edit minimal (one edge string + one precondition clause) precisely to
hold the citation drift near zero.

## Capability routing

`routed: skill:test-driven-development` (a DAG-and-precondition change: red-first against the
unmodified transition map) + `routed: agent:zodyssey:oracle` at plan review (the change touches the
state-machine's bypass surface — the security-adjacent lane).

## Estimated size

S — two edits to one file (one array element, one precondition clause) + one suite + doc touches.
The risk is not size but the bypass surface: the destination gate and the `FORCEABLE` exclusion must
be reasoned together (case c and d exist for exactly that), and the reasoning is done above and
measured (16/16 audited runs ACCEPT-bound; the sole victim is impl-04-audit).
