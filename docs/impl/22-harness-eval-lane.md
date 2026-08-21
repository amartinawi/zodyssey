# 22 — Harness eval lane: the two-arm harness declares its synthetic lane (candidate C4)

Build order **22** · depends-on **—** (the promotion of candidate C4, surfaced 2026-08-20 while
queueing item 12; reopens item 05's lane split) · queue row: [`docs/impl/00-INDEX.md`](00-INDEX.md)
`22 harness-eval-lane` · not security-class · patch release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-20 against the POST-FIX tree and this file moves fast. Do exactly
this one change.

---

## What is broken

**Scope deviation, resolved as a SUPERSET — flagged first.** The operator's enumerated fix for
candidate C4 was spawn-env inheritance: stamp `ZODYSSEY_EVAL_LANE: "synthetic"` into the env of
both harness spawns so everything they start inherits the declaration. The fix as implemented is a
superset of that, because the baseline arm ALSO self-appends its efficiency record DIRECTLY —
pre-fix `appendFileSync(RESULTS, JSON.stringify(record) + "\n")`, the operator-lane `RESULTS`
const at skills/odyssey/scripts/harness.mjs:43 — a write the harness process itself makes, which
no spawn env can ever tag: the child process is not involved in that write at all. The 2 observed
`arm:"baseline"` records that polluted the operator corpus (measured 2026-08-20, read-only: 418
operator-lane records, 2 with `arm:"baseline"`) went through exactly this direct path, so a
spawn-only fix would have been failure mode 2 (a check that cannot detect its own class) and
failure mode 5 (a fix that reopens its own class), in the operator's enumeration. The self-append
is therefore ALSO routed — to `results.synthetic.jsonl` via the harness's own unconditional
declared lane — and *What fixed means* states that superset precisely.

The defect itself: the two-arm evaluation harness (skills/odyssey/scripts/harness.mjs, the
"produce data" half the operational-consult CRIT-4b asked for) builds fake runs end to end —
fresh-copied fixture repos, a spawnable external CLI, self-appended measurement records — and
never declared itself synthetic anywhere: zero occurrences of `ZODYSSEY_EVAL_LANE` at the
scaffold spawn (now skills/odyssey/scripts/harness.mjs:230) or the baseline CLI spawn (now
skills/odyssey/scripts/harness.mjs:247), and the baseline self-append hardcoded to the
operator lane. The lane contract was never ambiguous: skills/odyssey/references/scripts.md:9 —
"Fixture harnesses MUST declare the lane at spawn" — with scripts/run-tests.mjs:81 as the
compliant precedent (`env: { ...process.env, ZODYSSEY_EVAL_LANE: "synthetic" }`). Consequence:
every harness-driven baseline record landed in `results.jsonl`, the operator's trend log — the
exact corpus-decontamination class item 05 closed for set-phase (the consumer at
skills/odyssey/scripts/set-phase.mjs:494-497), reopened by the harness that postdates it.
Candidate C4, docs/impl/00-INDEX.md:207-213. Proved before any edit: the hermetic RED probe of
2026-08-20 (under *Paired probe*) watched one `arm:"baseline"` record land in a temp HOME's
operator lane while the synthetic file was never created — and the probe's own success condition
encoded that broken routing, which is what "exit 0 with the defect present" means.

## What fixed means

The fix is producer-side and unconditional at every site that emits or derives telemetry — a
superset of the enumerated spawn-env inheritance, per the deviation flagged above:

- **The harness's own declared lane, as a constant.** `SYNTH` is hoisted into the constants
  block (skills/odyssey/scripts/harness.mjs:46-55, the const at :55) with the declaration
  rationale in the comment above it: the harness IS a synthetic generator, and a generator
  declares its lane at source instead of letting its telemetry land in the operator's corpus.
  The declaration is never operator-env-consulted — no `env.ZODYSSEY_EVAL_LANE ||` anywhere;
  the generator does not ask the operator's env which lane the generator itself is.
- **Scaffold spawn tagged** — skills/odyssey/scripts/harness.mjs:230:
  `env: { ...env, ZODYSSEY_EVAL_LANE: "synthetic" }` in the `execFileSync("node", …)` options
  (the run-tests.mjs:81 idiom), so the scaffolded run and anything it spawns inherit the lane.
- **Baseline CLI spawn tagged** — the same env option inside the `spawnSync(claudeBin, …)`
  options at skills/odyssey/scripts/harness.mjs:247.
- **The direct self-append routed** — `appendFileSync(SYNTH, JSON.stringify(record) + "\n")` at
  skills/odyssey/scripts/harness.mjs:349; the completion log at :350 prints the actual
  destination, and the `--dry-run` preview at :165 names `results.synthetic.jsonl` too, so the
  operator-auditable surface matches the executed surface. `RESULTS` (the operator lane) stays
  exactly where it was — the summary still reads BOTH lanes
  (skills/odyssey/scripts/harness.mjs:370-371), which is itself item 05's both-lanes rule.
- **A regression suite that cannot green vacuously** —
  skills/odyssey/scripts/harness.eval-lane.test.mjs (192 lines, 9 checks, four legs):
  (a) behavioral — one hermetic `--arm baseline` run puts exactly one parseable
  `arm:"baseline"` record into `results.synthetic.jsonl` and leaves the operator file absent or
  empty; (b) stub witness — the stub CLI tees its observed `$ZODYSSEY_EVAL_LANE` and it must
  read `synthetic`, proving the spawn env rather than just the append routing; (c) source
  shape — the colon-form declaration regex must match inside BOTH spawn option objects (an
  `env.ZODYSSEY_EVAL_LANE || "synthetic"` fallback has no colon and cannot match, so the shape
  pins the declaration as a literal) and the append's target variable must be declared against
  `results.synthetic.jsonl`; (d) inversion — the suite header documents that (a)/(b) fail with
  the fix reverted, and that RED was recorded on the unmodified tree before the fix existed.
  Every harness spawn first does `delete env.ZODYSSEY_EVAL_LANE` — run-tests.mjs:81 exports
  `synthetic` to every suite it runs, so an unscrubbed spawn would make leg (b) vacuously
  green; the scrub is delete-only, so the ONLY way the stub can observe `synthetic` is the
  harness declaring it.
- **The pre-existing harness suite repointed, not extended** — the `resultsPath` helper
  (skills/odyssey/scripts/two-arm-eval.test.mjs:295) and the dry-run-destination case at :484,
  plus the diagnostic strings at :508, :554 and :620, name the synthetic lane; the suite count
  stays 70, no cases added, none removed.

## Files

- `skills/odyssey/scripts/harness.mjs` — +16/−5 measured 2026-08-20 (`git diff --numstat`):
  the `SYNTH` const + declaration comment, two spawn env options, the routed append, the
  honest log/dry-run lines. Git plumbing untouched (all 8 `execFileSync("git"` sites verbatim).
- `skills/odyssey/scripts/harness.eval-lane.test.mjs` — NEW, 192 lines, 9 checks; suite count
  48 → 49.
- `skills/odyssey/scripts/two-arm-eval.test.mjs` — +8/−5, repoints only.
- `docs/impl/22-harness-eval-lane.md` — this brief.
- `docs/impl/00-INDEX.md` — queue row 22 + the C4 stamp, line-count-neutral (218 held).
- `CHANGELOG.md` + `package.json` + `.zcode-plugin/plugin.json` + `marketplace.json` — the
  `[0.6.15]` entry and the version trio bump.
- `scripts/anchors.lock.json` — ONE re-baseline per reconciliation round, after per-cite
  verification at source.

## Must NOT do

- **No git-plumbing changes.** The 8 `execFileSync("git"` call sites survive verbatim —
  init/config/add/commit (skills/odyssey/scripts/harness.mjs:203-207), rev-parse (:213),
  status --porcelain (:279), diff (:303). The count guard in the acceptance criteria enforces
  this mechanically.
- **No operator-env consultation for the harness's own lane.** No `env.ZODYSSEY_EVAL_LANE ||`
  anywhere in harness.mjs; the declaration is an unconditional constant. The harness is the
  synthetic generator — it declares, it does not ask.
- **No touching the real `~/.zcode/orchestration/eval/`.** Every probe and test is hermetic
  (mkdtemp HOME); the 2 polluted `arm:"baseline"` records REMAIN in the operator corpus —
  data remediation is an operator-side decision, documented here, never executed by this run.
- **No set-phase.mjs edits.** The lane consumer (skills/odyssey/scripts/set-phase.mjs:494-497)
  was already correct; this fix is producer-side only.
- **No `--update` before verify-at-source.** `--update` re-pins whatever is there; the fixed
  order is: change code → run the checker → verify or fix every citation at its source → then
  the single `--update`, once per reconciliation round.
- **No rewriting released CHANGELOG history.** The only CHANGELOG lines this run writes sit
  above the pre-change second version heading.
- **No extension of `two-arm-eval.test.mjs` with new cases** — its assertions get repointed to
  the new destination, nothing more.
- **No parked-item fixes.** C1, C3-provenance, C5, the cache-prune path edge, the stray-file
  prune candidate, the prune summary print order, compareSemver prerelease conservatism, the
  stale ×6 comment, item 14: noted, never actioned. No new script, flag, or argv surface; no
  new dependencies.

Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon · graceful no-op when optional tools are absent · every hook is a no-op unless a run is active · the trusted-script allowlist means any agent has the same argv surface the operator does, so no argv flag authenticates anyone.
Anti-goal: no more LLM opinion layers. Fail closed.

## Acceptance criteria

Every criterion is an exact command from the repo root plus its expected exit code; `record-verify`
executes them verbatim. The ladder is red at two intermediate points, each pinned here as an
expected state, not an accident. Commands 1-3 ran against the UNMODIFIED tree (RED, recorded
2026-08-20 before the fix was dispatched); commands 4-10 ran against the fixed tree; 11-14 are
the reconciliation and release gates of todos 6 and 7.

1. `node --check skills/odyssey/scripts/harness.eval-lane.test.mjs` — expected exit **0**.
2. RED, on the unmodified harness: `node skills/odyssey/scripts/harness.eval-lane.test.mjs` —
   expected exit **1** (captured 2026-08-20: 2/9 passed, the only greens the exit-0 harness run
   and the named-variable shape check; every red named the missing feature). A suite exiting 0
   here means a vacuous green — stop and fix the suite, not the tree.
3. `grep -c "delete env.ZODYSSEY_EVAL_LANE" skills/odyssey/scripts/harness.eval-lane.test.mjs` —
   expected exit **0**, output ≥ 1 (the scrub mandate; run-tests.mjs:81 exports `synthetic`
   suite-wide, and an unscrubbed spawn is a vacuous green).
4. `node --check skills/odyssey/scripts/harness.mjs && node --check skills/odyssey/scripts/two-arm-eval.test.mjs` —
   expected exit **0**.
5. GREEN: `node skills/odyssey/scripts/harness.eval-lane.test.mjs` — expected exit **0**
   (9/9 passed).
6. `node skills/odyssey/scripts/two-arm-eval.test.mjs` — expected exit **0** (`70 passed,
   0 failed` — repointed, not extended).
7. `node skills/odyssey/scripts/set-phase.eval-lane.test.mjs` — expected exit **0** (the
   pre-existing lane suite stays green untouched).
8. The GREEN probe (the mirrored `/tmp/zod-lane-green` command under *Paired probe*) — expected
   exit **0**, stdout including `1` (exactly one `arm:"baseline"` record in
   `results.synthetic.jsonl`; the operator-lane `results.jsonl` is never created).
9. `grep -c "ZODYSSEY_EVAL_LANE" skills/odyssey/scripts/harness.mjs` — expected exit **0**,
   output ≥ 3 (measured 4: both spawn declarations plus the declaration comment).
10. `test "$(grep -c 'execFileSync("git"' skills/odyssey/scripts/harness.mjs)" -eq 8` —
    expected exit **0** (the git-plumbing count guard).
11. After per-cite verification and the ONE `--update` of todo 6: `node scripts/check-anchors.mjs`
    — expected exit **0**; and `node scripts/run-tests.mjs` — expected exit **0**; and
    `node scripts/run-tests.mjs 2>&1 | grep -F "running 49 suite(s)"` — expected exit **0**
    (the new suite discovered; pipe exit is grep's).
12. `test "$(grep -c '^## ' docs/impl/22-harness-eval-lane.md)" -eq 12` — expected exit **0**
    (this brief survived reconciliation with its 12-section contract intact).
13. `grep -c "^## \[0.6.15\] — 2026-08-20" CHANGELOG.md` — expected exit **0**, output **1**;
    `grep -c '"version": "0.6.15"' package.json .zcode-plugin/plugin.json marketplace.json` —
    expected exit **0**, three lines each `:1`; `node scripts/version-consistency.test.mjs` —
    expected exit **0**.
14. Re-run after the round-2 re-pin of todo 7: `node scripts/check-anchors.mjs` and
    `node scripts/run-tests.mjs` — expected exit **0** both (transient red between the version
    bump and the re-pin is the checker working, not a regression).

## Paired probe

Both directions were demonstrated — RED on the unmodified tree first (2026-08-20), GREEN after
the fix (2026-08-20). Each probe is hermetic and self-contained: a committed fixture repo (so
`run_start_sha` resolves), a stub CLI that writes one non-`.zcode` work file and prints `{}`
(exactly enough to pass the empty-work guard), a temp HOME holding only `seed.jsonl`, and
`ZODYSSEY_EVAL_LANE` scrubbed from the environment — an inherited lane value would mislabel the
experiment and void the evidence. RED command, verbatim:

```sh
git --version >/dev/null && rm -rf /tmp/zod-lane-red && mkdir -p /tmp/zod-lane-red/fixture && git -C /tmp/zod-lane-red/fixture init -q && git -C /tmp/zod-lane-red/fixture config user.email t@t && git -C /tmp/zod-lane-red/fixture config user.name t && echo x > /tmp/zod-lane-red/fixture/f.txt && git -C /tmp/zod-lane-red/fixture add -A && git -C /tmp/zod-lane-red/fixture commit -qm base && printf '#!/bin/sh\necho work > work.txt\nprintf "{}"\n' > /tmp/zod-lane-red/cli && chmod +x /tmp/zod-lane-red/cli && mkdir -p /tmp/zod-lane-red/home/.zcode/orchestration/eval && printf '{"id":"p1","intent":"standard","repo":"/tmp/zod-lane-red/fixture","prompt":"do it","success_criteria":["c"]}\n' > /tmp/zod-lane-red/home/.zcode/orchestration/eval/seed.jsonl && env -u ZODYSSEY_EVAL_LANE HOME=/tmp/zod-lane-red/home CLAUDE_CLI=/tmp/zod-lane-red/cli node skills/odyssey/scripts/harness.mjs --task p1 --arm baseline >/dev/null 2>&1; grep -c '"arm":"baseline"' /tmp/zod-lane-red/home/.zcode/orchestration/eval/results.jsonl && test ! -e /tmp/zod-lane-red/home/.zcode/orchestration/eval/results.synthetic.jsonl
```

The GREEN probe is the mirrored form (`/tmp/zod-lane-red` → `/tmp/zod-lane-green`) with the
assertions inverted — the `grep -c` reads `results.synthetic.jsonl` and the `test ! -e` guards
`results.jsonl`. Observed, both dates 2026-08-20:

| probe leg | RED — unmodified harness | GREEN — after the fix |
|---|---|---|
| hermetic `--task p1 --arm baseline` run | **exit 0 with the defect present**; operator-lane `results.jsonl` holds exactly **1** `arm:"baseline"` record (`grep -c` printed `1`); `results.synthetic.jsonl` **absent** | **exit 0**; `results.synthetic.jsonl` holds exactly **1** `arm:"baseline"` record (`grep -c` printed `1`); operator-lane `results.jsonl` **absent** — never created |
| stub witness — the spawned CLI's observed `$ZODYSSEY_EVAL_LANE` | `""` — nothing declared at either spawn | `synthetic` |
| regression suite `harness.eval-lane.test.mjs` | **exit 1, 2/9 passed** (recorded before the fix was dispatched) | **exit 0, 9/9 passed** |
| scrub vacuity — `ZODYSSEY_EVAL_LANE=synthetic` exported to the SUITE process | identical exit 1, witness still `""` — the delete-only scrub holds; the suite cannot inherit its way to green | same discipline per spawn; the suite never sets the variable |

The landed RED record (verbatim, `generated_at` 2026-08-20T19:55:19.212Z) carried `slug
"p1-baseline"`, `arm "baseline"`, honest nulls for the pipeline-only fields — a well-formed
measurement record, in the wrong corpus. No probe ever touched the real
`~/.zcode/orchestration/eval/`; the temp dirs were removed after evidence capture, and both
commands are idempotent (each begins with `rm -rf` of its own temp path), so verification can
re-execute them byte-exact.

## What it breaks

- **The dashboard's default view loses the harness's baseline rows.** `dashboard.mjs` reads the
  operator lane — `RESULTS_PATH` resolves `results.jsonl` at skills/odyssey/scripts/
  dashboard.mjs:32, read at :71 — so harness-driven baseline records, now in the synthetic
  lane, no longer render there. This is documented, not code-changed: the dashboard is a
  renderer over the operator's REAL corpus, and synthetic data staying out of it is the entire
  point of the lane split. An operator who wants baseline rows in a dashboard can point its
  eval-dir argument at a corpus that merges the lanes.
- **Two harness-internal operator surfaces changed text, honestly** — the `--dry-run` preview
  and the completion log now name `results.synthetic.jsonl` (skills/odyssey/scripts/
  harness.mjs:165 and :350); anyone grepping old output for `results.jsonl` will notice.
- **The two-arm suite's assertions were repointed** — `resultsPath` (skills/odyssey/scripts/
  two-arm-eval.test.mjs:295) and case (f) (:484) plus diagnostics (:508, :554, :620) pin the
  synthetic destination; a future edit that reverts the routing reddens 5 existing assertions,
  by design.
- **The 2 polluted records stay.** They remain in the operator corpus pending an operator-side
  data decision (delete, quarantine, or annotate) — this run documents them, it does not
  remediate them.

## The class it closes

**Corpus decontamination — "a synthetic generator that never declares its lane."** Item 05
split the telemetry lanes so the operator's trend log holds real runs only, and taught the
consumer (set-phase, at skills/odyssey/scripts/set-phase.mjs:494-497) to honor a declaration.
Candidate C4 is the live instance of failure mode 5 — a fix that reopens its own class, in the
operator's enumeration: the harness was built AFTER item 05, in ignorance of the contract, and
became a second producer whose records no declaration ever labeled. Measured, 2 fake
`arm:"baseline"` rows sat among the operator's 418 real ones. The closure is producer-side and
total over what the harness emits: records spawned processes append (both spawns tagged — the
declaration travels in the env everything they start inherits) AND the record the harness
appends itself (the `SYNTH` constant) — which is why the fix had to be the superset the first
section flags: a spawn-only fix would have left the direct append polluting the corpus, the
class reopened by its own remediation.

Two residuals are explicitly NOT closed, stated honestly:

- **zodyssey-arm scorecards appended from the operator's interactive conductor sessions.** For
  that arm the harness only scaffolds the run; the operator's conductor — not the harness —
  drives it and fires set-phase inside the operator's own session env, and no harness spawn
  exists to tag. Routing those would require the lane persisted in run STATE (scaffold writes
  it, set-phase reads it back) — a lane-contract change, out of this item's scope. Until then,
  a harness-scaffolded zodyssey-arm run's scorecard is indistinguishable from a real
  operator-driven one in the trend log.
- **The 2 polluted baseline records remain** in the operator corpus, pending the operator-side
  data decision this brief documents and defers.

## Docs to update

- **`docs/impl/00-INDEX.md`** — queue row 22 lands line-count-neutral (218 held); candidate
  C4's paragraph (docs/impl/00-INDEX.md:207-213) takes its promotion stamp in-row, with the
  superset consequence stated (spawns tagged AND the self-append routed; 2 polluted records
  documented, not deleted).
- **`CHANGELOG.md`** — the `[0.6.15]` entry directly under the header, transcribing the shape
  below; plus the version trio (`package.json`, `.zcode-plugin/plugin.json`, `marketplace.json`).
- **Every harness.mjs-citing doc** — the +16/−5 shifts every pin below the constants block;
  expected drift set: `docs/impl/09-two-arm-eval-baseline.md`, `docs/impl/
  05-metrics-corpus-decontamination.md`, `docs/impl/10-prompt-surface-measurement.md`,
  `docs/impl/21-cite-completeness.md`, `docs/ROADMAP.md`, `docs/ideation-report.md`,
  `docs/OPPORTUNITY-MAP.md`, the rewritten INDEX lines, the CHANGELOG top-section window, and
  the NEW pins from this brief (they land `unlocked`). Number-only repoints at the citing
  source after per-cite verification; never reword a claim to fix a number; exactly ONE
  `--update` per round.

## CHANGELOG entry shape

Todo 7 inserts a new version heading — `## [0.6.15] — 2026-08-20`, directly under the CHANGELOG
header — and transcribes this block under it (the heading is named here mid-sentence only, so
this file's own twelve-section contract stays byte-exact):

```markdown
### Fixed — the eval harness declares its synthetic lane at every producer site (item 22)

The two-arm evaluation harness built synthetic runs end to end — fresh-copied fixtures, a
spawnable external CLI, self-appended measurement records — and never declared itself
synthetic anywhere: no `ZODYSSEY_EVAL_LANE` at the scaffold spawn or the baseline CLI spawn,
and the baseline arm's efficiency record self-appended straight to the operator-lane
`results.jsonl`. The lane contract (references/scripts.md) says fixture harnesses MUST declare
the lane at spawn; the harness postdated item 05's lane split and reopened exactly that class —
measured 2026-08-20, 2 fake `arm:"baseline"` records sat among the operator's 418 real ones.

The fix is producer-side and unconditional: both spawns stamp
`ZODYSSEY_EVAL_LANE: "synthetic"` (the run-tests declaration idiom) so everything they start
inherits the declaration, and the baseline self-append routes to `results.synthetic.jsonl` by
CONSTANT — the harness IS the synthetic generator, so it declares its lane at source rather
than asking the operator's env (`env.ZODYSSEY_EVAL_LANE ||` is forbidden in it). A spawn-only
fix could not have routed the direct append, and the 2 polluted records went through exactly
that path.

Paired probes, RED first: a hermetic baseline run (temp HOME, stub CLI, scrubbed env) landed
one `arm:"baseline"` record in the operator lane with the synthetic file absent — exit 0 with
the defect present; after the fix the mirrored probe holds exactly one record in
`results.synthetic.jsonl` with the operator file never created, and the spawned CLI witnesses
`ZODYSSEY_EVAL_LANE=synthetic`. The new suite `harness.eval-lane.test.mjs` was RED at 2/9 on
the unmodified harness and is 9/9 after; the suite count goes 48 → 49.

Known, not fixed: the dashboard's default view reads the operator lane, so harness baseline
rows now render only from the synthetic lane; zodyssey-arm scorecards from the operator's
interactive conductor sessions cannot be harness-tagged (no harness spawn to tag — routing
them would need lane persistence in run state); and the 2 polluted records are documented and
retained pending an operator-side data decision.
```

## Capability routing

```
routed: skill:test-driven-development
```

Non-negotiable for code in this repo (skills/odyssey/references/capabilities.md:84 routes
"Implement (TDD)"-class todos through the discipline; capabilities.md:41 is the routing row),
and this run literally used it: the hermetic RED probe observed the defect on the UNMODIFIED
tree before any edit (2026-08-20, exit 0 with the defect present, counts captured), the new
suite was authored and its RED recorded (exit 1, 2/9) before the fix was dispatched, and the
9/9 green exists only after the fix — the deliverable is the red-then-green sequence itself.
Load the skill in the parent thread — F5 cross-checks the declaration against hook-witnessed
loads, and a sub-agent cannot load a skill on the orchestrator's behalf.

## Estimated size

`harness.mjs` +16/−5 (measured 2026-08-20); one new 192-line suite (count 48 → 49);
`two-arm-eval.test.mjs` +8/−5 repoints only; this brief; the INDEX row at 218 held; the
`[0.6.15]` CHANGELOG entry + version trio; one anchors-lock re-baseline per reconciliation
round (todos 6 and 7). No new runtime surface beyond one env key on two spawns and a const, no
hook, no dependency, no argv change. **Patch release 0.6.15.**
