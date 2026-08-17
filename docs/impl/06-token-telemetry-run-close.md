# 06 — Token telemetry at run close: populated-or-stamped, attributed per run

Build order **06** · depends-on **05** (metrics-corpus-decontamination — telemetry numbers are
corpus metrics; the first honest fraction is drawn after the synthetic records stop flowing in) ·
queue row: [`docs/impl/00-INDEX.md`](00-INDEX.md) `06 token-telemetry-run-close` ·
telemetry/measurement-class · patch.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast. Do exactly this one change.

## What is broken

**The wiring already exists and, since one specific moment, works.** When a run reaches
`done|audited`, `skills/odyssey/scripts/set-phase.mjs:430-439` auto-appends a run-report record to
`~/.zcode/orchestration/eval/results.jsonl` by executing run-report from the **plugin cache**
(`skills/odyssey/scripts/set-phase.mjs:433-437` — `fileURLToPath(new URL("./run-report.mjs",
import.meta.url))`, with the in-code comment "so it is found from the plugin cache install").
`skills/odyssey/scripts/run-report.mjs:99` calls `collectRunTokens`, which reads ZCode's durable
telemetry — the SQLite DB at `~/.zcode/cli/db/db.sqlite` (`skills/odyssey/scripts/lib/tokens.mjs:35`,
table `model_usage` joined to `session` at `:83-92`). Token accounting shipped in 0.5.2
(`CHANGELOG.md:31` dated 2026-08-15, entry at `CHANGELOG.md:186`; commit `6b0b428`
"feat(telemetry): real per-run token accounting").

**The corpus says "2 of ~193 populated" — and that number decomposes into three eras, none of which
is "the mechanism is broken"** (measured during todo 11 of run `impl-prompts-v0-6`, 2026-08-16;
`results.jsonl` is live and drifted 184 → 185 → 190 → 191 → 193 across this task's own lifetime —
stamp your own count, never relay this one):

- **116 records have no `tokens` field at all** — written by the placeholder-era run-report before
  the telemetry landed (the old code carried `const tokensPerTodo = null; // populated when ZCode
  exposes per-run token counts`, per the history note at
  `skills/odyssey/scripts/lib/tokens.mjs:3-5`).
- **75 records carry an explicit `"tokens":null`** — every one a harness-fixture run
  (`"slug":"t…"`, `add-truncate`) that makes no model requests, so the window query matches zero
  rows and `skills/odyssey/scripts/lib/tokens.mjs:94` returns null. Correct degradation.
- **2 records are populated** — and they date the moment telemetry went live. The live 0.5.2 cache
  was refreshed 2026-08-15T18:39Z (mtime of the cached
  `…/0.5.2/skills/odyssey/scripts/run-report.mjs`); slug `truncate-roundto` closed 16:17:02Z with
  **no tokens field** (cache still pre-wiring) and its re-run closed 19:36:50Z with tokens
  **populated** — a same-slug natural experiment straddling the cache refresh. Since that refresh,
  every real run closing on this machine populated (2/2; Node v25.9.0).

So the INDEX row's "2/184" is real, and the INDEX already reads it correctly ("wiring already
exists … the defects are the null population … and attribution") — it was the two ideation
documents that missed the wiring (both passes proposed "wire at close" against a mechanism that
already exists). The residual defects are three, all verified:

1. **A null is reason-blind.** `collectRunTokens` returns null from at least five distinct
   conditions — missing args (`skills/odyssey/scripts/lib/tokens.mjs:67`), DB file absent (`:68`),
   the `node:sqlite` binding unavailable (`:71-72`), DB open/query failure incl. locked (`:75`,
   `:143-144`), and zero usage rows in the window (`:94`) — and
   `skills/odyssey/scripts/run-report.mjs:127` flattens all five into the single sentinel
   `"tokens":null`. A record cannot say whether null means "fixture run, correctly empty" or
   "telemetry silently dead". It took live DB forensics (this prompt's own re-derivation) to
   establish the mechanism works at all; the populated fraction is not measurable as a health
   signal. This is Step-6 failure mode 2 verbatim: a check that cannot detect the class of failure
   it exists for.
2. **The declared Node floor silently disables telemetry — a latent mismatch, NOT the cause of the
   observed 2/193** (this machine runs Node v25.9.0, where the path works). `package.json:9`
   declares `"engines": { "node": ">=18" }`, but `skills/odyssey/scripts/lib/tokens.mjs:163` reaches
   SQLite only via `process.getBuiltinModule("node:sqlite")` — `process.getBuiltinModule` was added
   in Node 22.3.0 (backported to 20.16.0; absent on 18) and `node:sqlite` itself arrived in 22.5.0.
   On the declared floor runtime every record is null with nothing recording that the platform,
   not the run, is the cause. The degradation is by design
   (`skills/odyssey/scripts/lib/tokens.mjs:150-151` — "an older runtime degrades to 'no telemetry'
   rather than crashing the caller") but it is silent, and the repo's own rule (Step 5) is that an
   absent optional capability degrades to a **recorded** `inert`, never to an unrecorded nothing.
3. **Attribution is a heuristic the file itself names as estimate-grade.** Runs are identified by
   (repo, time-window) — `skills/odyssey/scripts/lib/tokens.mjs:20-23` states "Two concurrent runs
   in one repo cannot be separated. Reported honestly as confidence:'estimate' — stamping the
   harness session id into state would make it exact, which is the follow-up";
   `:115`/`:121` carry the marks. The exact form is mechanizable today, verified against the live
   DB: the `session` table has a `parent_id` column and all 9 sub-agent sessions of the
   `ideation-v0-6` run link to its orchestrator session (`sess_2924301d…`), so
   `WHERE (s.id = :sid OR s.parent_id = :sid)` scopes a run exactly — the window then stops being
   the attribution key and becomes a sanity bound. The stamping channel also exists but is dead:
   hook payloads verifiably carry `session_id` (`skills/odyssey/hooks/pre-tool.mjs:566` lists it
   among known payload fields; `:575-577` records that the probe proved which identity fields the
   harness actually sends; `:875` consumes `payload.session_id` today), while
   `skills/odyssey/scripts/scaffold.mjs:288` initializes `active_executor_session: null` and
   **nothing in the tree ever writes it** — grep shows exactly two hits: that init and the read at
   `pre-tool.mjs:885`. A field scaffolded for exactly this purpose, never populated.

## What fixed means

Stated as observable behaviour, not as a diff:

1. **Every record appended at `done|audited` carries a `tokens` value that is populated or
   reason-stamped — never a bare, unexplained null.** When the source is absent, the value is an
   inert object of the shape `{ inert: true, reason: <one of: bad-args | db-missing |
   binding-unavailable | db-unreachable | no-usage-in-window>, node_version, at }`, and
   `binding-unavailable` names the floor in its reason text (node:sqlite requires Node >= 22.5;
   the engines floor is >= 18). `no-usage-in-window` is the fixture/null-era case made visible —
   after 05 lands it should be the only inert reason remaining for real runs.
2. **A run closing on a Node-18 machine still closes.** Telemetry absence never fails the phase
   transition, never fails run-report, never blocks anything — the graceful no-op rule. What
   changes is that the absence is *recorded*, so the populated fraction becomes a measurable
   health signal: after this change, three greps over `results.jsonl` partition every record into
   populated / inert-with-reason / historical (field-absent or null), and the historical bucket is
   frozen by construction (nothing writes that shape anymore).
3. **Attribution is exact when the session id was witnessed.** When run state carries the
   orchestrator's session id, token collection scopes by `(s.id = :sid OR s.parent_id = :sid)`,
   reports `attribution: "session"`, `confidence: "exact"`, and **excludes usage from concurrent
   sessions in the same repo and window that are not descended from the run's session** — while
   including every sub-agent child session (the `parent_id` linkage verified above). The `repo`,
   `repo_aliases`, and `window` echo fields stay: a figure quoted without its scoping keys is
   unfalsifiable (`skills/odyssey/scripts/lib/tokens.mjs:116-119`). When no session id was
   witnessed (headless run, payload without the field), behaviour falls back to today's
   (repo, window) heuristic with `confidence: "estimate"` — degrade, never block.
4. **The orchestrator's session id is stamped into run state once, from a hook payload.**
   `post-tool.mjs` already holds the sanctioned locked state-write pattern (the capability
   observation write at `skills/odyssey/hooks/post-tool.mjs:157-166`); the same channel stamps
   `state.session_id = payload.session_id` on first witness (only if absent), best-effort,
   exit-0-always. Hook-payload `session_id` is shared across parallel sub-agents
   (`skills/odyssey/hooks/pre-tool.mjs:880-885`), so any event during the run yields the
   orchestrator's id — first-witness is safe regardless of which thread fired.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/scripts/lib/tokens.mjs`
- `skills/odyssey/scripts/lib/tokens.test.mjs` (new)
- `skills/odyssey/scripts/run-report.mjs`
- `skills/odyssey/hooks/post-tool.mjs`
- `skills/odyssey/hooks/post-tool.session-stamp.test.mjs` (new)

Two deliberate omissions, both verified non-causal: `skills/odyssey/scripts/set-phase.mjs` (the
auto-append works — the 2/2 post-cache real runs prove it) and `package.json` (the engines line is
not the cause of the observed fraction on any machine that has closed a run since 0.5.2; the floor
mismatch is remedied by the stamped inert + docs, not by bumping engines — see Must NOT do). The
docs listed under "Docs to update" belong to the release pass, not the gated run.

## Must NOT do

- **Do not fake or synthesize token numbers.** When the source is absent the value is a stamped
  inert, never an estimate, a guess, or a zero dressed as a measurement. Tokens are the honest
  unit (`skills/odyssey/scripts/lib/tokens.mjs:25-28`); an inert is honest absence.
- **Do not hard-require `node:sqlite`** — no `"engines"` bump to >= 22.5, no install-time check
  that fails, no npm SQLite dependency. The no-optional-tool rule cuts both ways: the optional
  tool may be absent, and its absence degrades to a *recorded* inert. Over-blocking is a new
  failure of the class this change exists to remove.
- **Do not read tokens through a new daemon or async path.** Synchronous, no daemon — the
  report runs inline inside a phase transition.
- Do not touch `skills/odyssey/scripts/set-phase.mjs` (not in `Files:`) or
  `skills/odyssey/hooks/pre-tool.mjs`. The stamp rides `post-tool.mjs`'s existing locked-write
  pattern; pre-tool is the enforcement gate and is out of bounds for a telemetry change.
- Do not backfill, rewrite, or "repair" historical records in `results.jsonl` — the 116
  field-absent and old null records stay exactly as they are.
- Do not drop the `window`, `repo`, or `repo_aliases` echo fields, and do not remove the
  arithmetic rules (`skills/odyssey/scripts/lib/tokens.mjs:13-18`) or their comments — attribution
  upgrading to session-exact ADDS keys; it does not delete the keys that make the old figures
  reproducible.
- Do not make telemetry failure fail anything: run-report's exit contract
  (`skills/odyssey/scripts/run-report.mjs:13` — 0 ok, 2 bad args, 3 state missing) is unchanged,
  and the auto-append's best-effort guarantee (`set-phase.mjs:426`, verified untouched) stands.
- Do not add a reviewer, judge, or verifier agent. **No LLM opinion layer** — every verification
  in this change is an exit code or a grep.

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

**This change's exposure: 69 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/scripts/set-phase.mjs` (29), `skills/odyssey/hooks/post-tool.mjs` (14), `skills/odyssey/scripts/lib/tokens.mjs` (14).

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

1. `node --check skills/odyssey/scripts/lib/tokens.mjs && node --check
   skills/odyssey/scripts/run-report.mjs && node --check skills/odyssey/hooks/post-tool.mjs` —
   expected exit **0**.
2. `node skills/odyssey/scripts/lib/tokens.test.mjs` — expected exit **0** (prints `N passed,
   0 failed`; includes the seeded-DB attribution block and the inert-reason block).
3. `node --test skills/odyssey/scripts/lib/tokens.test.mjs` — expected exit **0**.
4. `node skills/odyssey/hooks/post-tool.session-stamp.test.mjs` — expected exit **0** (stamp
   fires once when the payload carries `session_id`; no stamp when absent; no active run → no-op;
   hook exits 0 in every case).
5. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16. The count may legitimately grow; the exit code must not change.
6. The paired direction — proof the new assertions actually run against the broken code. In TDD
   order you demonstrate this BEFORE writing the fix (add the failing cases, watch the suite go
   red), and it stays re-provable on demand:
   `git stash push -- skills/odyssey/scripts/lib/tokens.mjs && node skills/odyssey/scripts/lib/tokens.test.mjs; ec=$?; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only tokens.mjs reverted, the inert-shape assertions fail
   (old code returns null) and the suite exits 1.
7. Live degradation probe, source absent by construction:
   `node -e 'import("./skills/odyssey/scripts/lib/tokens.mjs").then(m=>{const r=m.collectRunTokens({repoRoot:process.cwd(),startMs:Date.now()-1000,endMs:Date.now(),dbPath:"/nonexistent/db.sqlite"});process.exit(r&&r.inert===true&&typeof r.reason==="string"&&r.reason.length>0?0:1)})'`
   — expected exit **0** after the fix; the identical one-liner against pre-fix HEAD prints/returns
   `null` and exits **1** (both directions of probe A, below).
8. Report-shape invariant, run against the fix-run's own live state (any non-`inflight` slug under
   `.zcode/state/` — the fix run's own qualifies):
   `node skills/odyssey/scripts/run-report.mjs . "$(ls .zcode/state/*.json | grep -v inflight | head -1 | xargs basename | sed 's/\.json$//')" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const t=r.tokens;if(t===null)process.exit(1);if(t.inert===true&&typeof t.reason!=="string")process.exit(1);if(!t.inert&&!(t.totals&&Number.isFinite(t.totals.total)))process.exit(1)})'`
   — expected exit **0**: the emitted `tokens` is populated, or inert with a reason — never bare
   null, never an inert without a reason, never a populated shape without totals.

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** No deny-list, no pattern round. The inert reasons are a
   closed set derived from the actual null sites in `collectRunTokens` (`:67`, `:68`, `:71-72`,
   `:75`/`:143`, `:94`), and attribution is a structural predicate (`id OR parent_id`), not a
   name-shape heuristic. If a sixth degenerate condition appears, the catch-all stamps
   `db-unreachable` rather than passing silently.
2. **A check that cannot detect the class of failure it exists for.** This is the defect being
   fixed, in the same shape `--verify` had: run-report recorded null and could not say why. After
   the change the failure is self-describing in the record (`reason`), and criterion 7 exercises
   the degraded path live rather than assuming it.
3. **Ceremony without mechanism.** Ships a code change (reason-stamped returns, session stamp,
   query predicate) plus two regression suites — the fraction becomes greppable because the record
   shape changed, not because a doc asks nicely.
4. **Self-grading.** Every criterion is machine-executed with a recorded exit code; probes A and B
   below run against both builds. Nobody grades prose.
5. **A fix that reopens its own class.** Covered in "The class it closes" — the invariant test
   asserts populated-or-stamped-inert, so a future silent-null return fails the build.

## Paired probe

Three probes, each with both directions stated:

- **Probe A — degradation observability (the core defect).** Call `collectRunTokens` with
  `dbPath` pointing at a nonexistent file (criterion 7's exact one-liner). **Before: returns
  `null`** — indistinguishable from every other null. **After: returns
  `{inert: true, reason: "db-missing", …}`**. The `binding-unavailable` arm of the same probe uses
  the injection seam the module already exposes — `globalThis.__zodysseySqlite`
  (`skills/odyssey/scripts/lib/tokens.mjs:152-155` reads the global first by design): set it to
  `{}` before calling and the `:72` site fires. Before: null. After: inert with
  `reason: "binding-unavailable"` naming the Node floor. This is how the Node-18 behaviour is
  tested on a Node-25 machine without owning a Node-18 install.
- **Probe B — attribution exactness.** Seed a temp DB (created with `node:sqlite` inside the test,
  deleted after) with three sessions sharing one `directory`: an orchestrator, a child with
  `parent_id` = orchestrator, and an interloper with no linkage — all with `model_usage` rows
  inside the same window. **Before (current HEAD): the window query counts all three** — the
  interloper's tokens pollute the run's totals, which is the estimate-grade contamination
  `tokens.mjs:21-22` concedes. **After, with the orchestrator id supplied: the interloper is
  excluded, the child is included, `attribution` is `"session"`, `confidence` is `"exact"`**.
  Control: with NO session id supplied, the result is byte-comparable to today's heuristic output
  (`confidence: "estimate"`) — the fallback must not change.
- **Probe C — end-to-end at close.** The fix-run's own `done`/`audited` transition auto-appends a
  record whose `tokens` is populated or inert-with-reason (criterion 8 asserts the shape on the
  live report). **Before: bare null whenever the source is absent; no reason anywhere.**
  **After: never bare null.** Cache lesson carried from the natural experiment: the auto-append
  executes the CACHED run-report (`set-phase.mjs:433-437`), so the end-to-end direction is only
  observable after the release is re-Got/Updated into the plugin cache — a fix that stays only in
  the dev tree populates nothing (that is precisely why 116 records have no field).

Controls required on BOTH builds — a probe that moves any of them has overreached: a real run with
the DB present still populates (the 2/2 evidence); run-report on a missing state file still exits
3; run-report with bad args still exits 2 (`skills/odyssey/scripts/run-report.mjs:13`); the
post-tool hook still exits 0 on malformed stdin and with no active run; historical records in
`results.jsonl` are byte-identical.

## What it breaks

Near nothing, and the honest reason is grep: **no code consumes the `tokens` field** — zero hits
for `tokens`/`tokens_per_todo` in `judge.mjs`, `harness.mjs`, and `scripts/*.mjs`; the field's
readers are humans and `docs/MEASUREMENT.md`. The blast radius is therefore:

- Anyone grepping the exact sentinel `"tokens":null` to mean "no telemetry" must now also match
  the inert shape — the fraction command in MEASUREMENT.md is updated in the same change (Docs to
  update) so the canonical form is written down where the grep lives.
- The run-state schema grows an optional `session_id` field and the record schema grows the inert
  shape — both additive; the backward-compat rule (`|| {}` discipline for every new state field)
  applies and old states must load unchanged (criterion 5's suite covers state round-trips).
- `post-tool.mjs` gains a best-effort state write. It already writes state under lock for
  capability observation (`:157-166`), so the new write rides an exercised path; the invariant
  that must not move is exit-0-always (criterion 4), because PostToolUse hooks must not block.

## The class it closes

**Telemetry that silently records null — a check that cannot see its own failure.** This is the
repo's own `--verify` precedent: a runner that reported success over an empty set because nothing
in its output could express "I checked nothing". Here the shape was sharper: the record carried a
`tokens` key whose null meant five different things, and the only way to learn the mechanism worked
was to forensically query the operator's DB — exactly what this prompt had to do to write it.

How this change could reintroduce the class: the next telemetry field (cost, per-dispatch spans —
queue item 14) gets added returning bare null "for now", and the reason-blind sentinel returns at a
new key. What prevents that: the new suite asserts the invariant **populated-or-stamped-inert,
never silent null** at the `collectRunTokens` boundary (probes A and B in the same test file), so
any future caller that flattens an inert back to null — or any new collector that returns null
without a reason — fails criterion 2/6's suite. The inert shape is also self-documenting in the
trend log: a future audit greps `"inert":true` and gets the reason counts for free, instead of
re-deriving this prompt's forensics.

## Docs to update

Every doc that states the claim this change alters, each checked against the 2026-08-16 tree:

- `docs/MEASUREMENT.md:24` (the `Tokens / todo completed` metric row) and `:31` (the
  tokens-per-successful-todo headline): add the platform floor (token telemetry requires
  Node >= 22.5 via `node:sqlite`; on the engines floor >= 18 it records a stamped inert) and the
  canonical fraction command partitioning records into populated / inert-with-reason /
  historical. The record-schema sketch at `docs/MEASUREMENT.md:125-130` gains the inert shape.
- `CHANGELOG.md` — new version's **Fixed** (shape below) plus the *Known, not fixed* residuals.
- `skills/odyssey/references/scripts.md:35` (the run-report entry): state the emitted `tokens`
  shapes (populated / inert-with-reason / historical null) and the two attribution modes
  (`session`+exact vs `time-window`+estimate, and what witnesses the id). The set-phase entry at
  `:9` needs no change — the auto-append contract is untouched.
- `docs/DESIGN.md` §6 — checked: the hook table states enforcement claims only; it makes no
  token-telemetry claim (`run-report`/`results.jsonl` do not appear in §6). **No edit
  required.** Recorded here so the next reader does not hunt.
- `README.md` — checked: its measurement mentions do not state a token-population claim. No edit
  required unless the release notes want the fraction; record the decision either way.

## CHANGELOG entry shape

Patch release (telemetry fix + additive fields; not security-class, so no own-release rule — but
ship it without unrelated riders so the cache-refresh effect is attributable).

- **Fixed** — one entry: run-close token records are now populated or reason-stamped, never a
  bare null. State the mechanism in one clause (the five null sites in `lib/tokens.mjs` now stamp
  `inert` with a reason; `run-report.mjs` passes it through) and name the probe evidence (probe A
  null → inert both directions; probe B interloper excluded / child included). This repo cites its
  probes, not just its diffs. Add one line for attribution: runs whose orchestrator session id was
  witnessed are attributed exactly (`session.parent_id` scope, `confidence: "exact"`); others fall
  back to the time-window heuristic, as before.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - The 116 field-absent records and pre-0.5.2 null records in `results.jsonl` **stay as they
    are** — historical nulls are not backfilled; the fraction command counts them as a frozen
    historical bucket.
  - The `engines` floor stays `>=18` (`package.json:9`); token telemetry requires Node >= 22.5 and
    degrades to a stamped `binding-unavailable` inert below it. The floor is documented, not
    raised — telemetry is optional.
  - Exact attribution depends on a hook payload carrying `session_id`; a run whose events never
    did (headless, exotic harness) keeps `confidence: "estimate"`.
  - Two concurrent runs in one repo remain inseparable in the fallback heuristic — unchanged
    except that the record now says which mode it used.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  **re-Get/Update the plugin so the marketplace cache picks up the scripts** — the auto-append
  runs the CACHED run-report (`set-phase.mjs:433-437`), and the `truncate-roundto` pair (null at
  16:17Z, populated at 19:36Z, cache refresh 18:39Z) is the standing proof that a fix which stays
  in the dev tree populates nothing.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is a pure code-logic change across two new test files and three source files; the run's whole
method is red-green: write the failing inert-shape and interloper-exclusion cases first
(criterion 6's demonstration), then make them green. F5 cross-checks the declaration against
hook-witnessed loads, so a declaration without a real load fails the final wave — declare nothing
speculative. No `discovered:`/`generic:` (no find-skills call is planned) and no `mcp:`
declarations (none will be loaded — the DB is read with `node:sqlite`, not an MCP). If a test
fails in a way two fix attempts do not diagnose, loading `systematic-debugging` is correct —
declare it only if it is actually loaded, after the fact, never in anticipation.

## Estimated size

~50 lines in `skills/odyssey/scripts/lib/tokens.mjs` (reason-stamped returns, the session
predicate, inert shape), ~10 in `skills/odyssey/scripts/run-report.mjs` (pass-through of the
inert shape and `state.session_id`), ~15 in `skills/odyssey/hooks/post-tool.mjs` (first-witness
stamp on the existing locked-write pattern), ~150 across the two new test files (seeded-DB
attribution block, inert-reason block, stamp block), ~15 of docs. Patch release.
