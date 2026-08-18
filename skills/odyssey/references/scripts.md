# Scripts you call — full signatures (load on demand)

Load this reference when you are about to invoke a trusted-writer script. The inline
SKILL.md keeps only one-line reminders; the full signatures, flags, and exit codes live here.

## Planning + transitions
- `scripts/scaffold.mjs <repo-root> <slug> <title> <intent> [task-brief] [--reset]` — creates plan + state.json + plans/<slug>.task.md (the last carries the phase-−1 primed brief, read by consult.mjs as THE ORIGINAL TASK). `--reset` recovers a terminal/abandoned run (refuses on an active run).
- `scripts/parse-plan.mjs <plan.md> [--files|--waves|--todo N|--lint]` — reads todos for dispatch and verification. `--lint` mode checks acceptance criteria are executable (gates record-review OKAY).
- `scripts/set-phase.mjs <repo> <slug> <phase> [--note <text>]` — **the only sanctioned way to transition phases**. Enforces the transition DAG (plan→review→execute→verify→final→done) + preconditions (done requires OKAY + final pass). Escape hatches: blocked/abandoned always allowed. On done|audited, auto-appends run-report to results.jsonl + writes a memory outcome. **Two-lane telemetry:** a run declaring itself synthetic at source — `ZODYSSEY_EVAL_LANE=synthetic` (exact match; unset/misspelled = operator lane; never a gate) in the env of the process spawning set-phase — appends to `results.synthetic.jsonl` instead, so the operator's trend log holds real runs only. Fixture harnesses MUST declare the lane at spawn (`run-tests.mjs` exports it for the whole suite run; `pipeline-integration.test.mjs` declares it per helper).

## Review gate (phase 3)
- `scripts/record-momus-artifact.mjs <repo> <slug> <round> --nonce <nonce> [--from <file>]` — **the only sanctioned way to record zodyssey:momus's verdict artifact**. Requires `--nonce` (issued by the hook when it observed the `Task(zodyssey:momus)` dispatch). Writes under `.zcode/reviews/`. NOTE: prefer `--from <file>` over stdin piping — the metachar denylist blocks the `<<EOF |` form pre-verdict. **Stage that file in `.zcode/staging/`** — SEC-6 refuses `--from` under `.zcode/plans/` or `.zcode/notepads/` (the dirs the planner writes, and so the cheapest place to pre-stage a forged verdict). `.zcode/staging/` is writable pre-OKAY and exists for exactly this.
- `scripts/record-review.mjs <repo> <slug> <OKAY|REJECT> --momus-artifact <path> --plan-sha <sha> [--blockers <file>]` — **the only sanctioned way to set the review verdict**. Runs `parse-plan --lint` on OKAY (refuses if acceptance criteria aren't executable). BOTH `--momus-artifact` and `--plan-sha` are MANDATORY. Pass the FULL 64-char plan-sha (a truncated prefix passes the error message but fails the equality check).

## Verify + final wave (phases 5-6)
- `scripts/record-verify.mjs <repo> <slug> <todo-id> --criterion <cmd> [--exit-code <N> [--exit-code-2 <N>]] [--output <file>] [--n <idx>] [--trust-argv] [--flake-check]` — records per-criterion evidence under `.zcode/verify/`. Exit 6 on failure (exit-code != 0). Flags: `--criterion` is required (the shell command). `--exit-code <N>` is the exit code of the criterion; WITHOUT `--trust-argv` the script EXECUTES the criterion itself (SEC-H2) and refuses `--exit-code` (exit 2) — pass `--trust-argv` only if you ran the criterion yourself and are passing its real exit code. `--exit-code-2 <N>` + `--flake-check` runs a second pass and marks disagreements as `flaky` (distinct from `failed`). `--output <file>` attaches evidence; `--n <idx>` is the criterion index. Also populates `state.acceptance[todoId] = {pass, at, evidence}` (gated on `todos[todoId].status==='done'` AND every recorded criterion passing — closes the mid-verify race) and `state.notepad_pointers[todoId]` when `.zcode/notepads/<slug>/<id>.md` exists. Both fields optional (older state loads fine).
- `scripts/compact.mjs <repo> <slug>` — OPTIONAL pre-final-wave notepad compactor. Concatenates each notepad in `.zcode/notepads/<slug>/*.md` (truncated to ~40 lines, `## <name>` headers) into a single `_compact-brief.md` the final-wave sub-agents consume instead of the full doc set. Deterministic ($0, no LLM), additive (NEVER modifies source notepads), idempotent. Borrows prime-agent primitive #8.
- `scripts/record-final-wave.mjs <repo> <slug> [--f2-artifact P --f2-nonce N] [--f3-checklist P] [--f4-artifact P --f4-nonce N] [--skip F2,F4,F5] [--allow-untouched]` — binds all five F-items to evidence.
  - **F1** — machine-checked, three ways: (a) `actual ⊆ declared` (no out-of-scope files); (b) the converse — a plan that declares files against an EMPTY diff fails, because nothing was done; (c) **test integrity** — a deleted test file, a net-negative test-file line count, or a newly added `skip`/`only`/`xfail` marker fails F1. Fails closed in a non-git repo. `--allow-untouched` waives declared-but-untouched files in F1 (for plans that legitimately leave a declared file unmodified).
  - **F2 / F4** — nonce-bound artifacts whose **verdict is parsed**. The artifact must be JSON with a `verdict` field, or contain a line `VERDICT: APPROVE` / `VERDICT: REJECT`. Anything ambiguous (both, neither, or an unrecognized value) resolves to `missing` and FAILS — an unknown verdict never closes a gate. Prose merely mentioning the words is not a verdict.
  - **F3** — checklist file must exist and be non-empty. This remains a presence check, not a content check.
  - **F5** — routing-default gate: cross-checks the plan's `## Capability routing` token against `state.capabilities[]` (hook-witnessed Skill/mcp__* calls). `routed: skill:X` needs an observed `skill:X`; `routed: mcp:S` needs `mcp__S…`; `routed: agent:X` needs an observed `agent:X` dispatch; `discovered`/`generic` need an observed `skill:find-skills`. `--skip F5` is the escape hatch.
  - `--skip` records the item as `passed: true`. It is an escape hatch for items that genuinely do not apply, **not** a way to reach `done`. Skipping F2/F4 discards the only code-quality and scope-fidelity signals the pipeline has.
  - *(Corrected 2026-08-11: this entry previously told the conductor that `--skip F2,F4` was "the only working F4 path today (wrong-var bug at :36)". That bug was fixed long before, so the note was instructing conductors to skip a working gate. It also claimed F1 "throws+silently-passes in a non-git repo"; F1 has failed closed since SEC-H1.)*

## Tracking
- `scripts/record-todo.mjs <repo> <slug> <id> <status> [--attempts N] [--session S] [--force-done]` — records todo status + maintains `state.active_todos[owner]` for file-lock attribution. On done/failed, releases locks.
  - **`done` requires verify evidence** (exit `7` if absent). The guard reads `state.verify.history` for that todo id — real exit codes from real spawns, written by `record-verify.mjs` — and refuses if there are no records, if any criterion failed, or if any is flaky. It reads `verify.history` rather than `acceptance[]` deliberately: `record-verify` only sets `acceptance[id].pass` once the todo is already `done`, so gating on that would deadlock instead of breaking the circularity.
  - `--force-done` is for a todo with genuinely no executable criteria. It is not silent: the record carries `forced: true`, `verified: false`, and `forced_reason`, so a forced completion stays distinguishable from a verified one.
  - *(Added 2026-08-11. `record-verify.mjs:9-10` had claimed this guard existed since it was written; it did not.)*
- `scripts/record-capability.mjs <repo> <slug> <phase> <capability> [--activity A]` — self-declared capability use (the hook ALSO records observed Skill/MCP calls with `observed:true`).
- `scripts/status.mjs <repo> <slug> [--json]` — quick "where is this run?" (phase, verdict, todo counts). `--json` also emits `acceptance`, `notepad_pointers`, `verified_count`; human mode adds a gated `verified: N passed · M notepad(s) linked` line (only when the fields have content — byte-identical backward compat for pre-acceptance runs).

## Eval + consult
- `scripts/run-report.mjs <repo-root> <slug> [--json] [--log <path>]` — one-run efficiency scorecard. `success` derived from `state.final.verdict`; `ungated_bash_calls` counts the per-run ledger of calls that walked through the `ZODYSSEY_UNGATE_BASH=1` hatch (0 with no ledger). The emitted `tokens` (since 0.6.3) is populated, inert-with-reason (`{inert:true, reason, node_version, at}`; closed reason set `bad-args | db-missing | binding-unavailable | db-unreachable | no-usage-in-window` — `binding-unavailable` names the node:sqlite Node >= 22.5 floor vs the engines floor >= 18, and the emitted reason string carries that floor sentence after the token — "binding-unavailable: node:sqlite requires Node >= 22.5; the engines floor is >= 18" — so consumers match by prefix, not exact equality on the bare token), or historical (pre-0.5.2 field-absent/null, frozen) — never a bare unexplained null. Attribution: `session` + `confidence:"exact"` when the orchestrator's session id was witnessed (post-tool.mjs's first-witness stamp into `state.session_id`; usage scoped by `s.id = sid OR s.parent_id = sid`) vs the `time-window` + `confidence:"estimate"` heuristic fallback.
- `scripts/harness.mjs [--task <id>] [--arm zodyssey|baseline] [--list]` — eval runner: fresh-copy → scaffold → (conductor drives) → auto-append. Prints the judge command.
- `scripts/judge.mjs <run-repo> <slug> <seed-id> [--double]` — INDEPENDENT LLM-as-judge on the external CLI (not oracle). Scores against the seed's success_criteria. `--double` = two passes + >0.15 disagreement flag.
- `scripts/consult.mjs <repo-root> <slug> [--task <file>] [--plan-audit] [--multi-auditor]` — run ONE external audit round (the `/orchestrate-consult` gate). `--plan-audit` is a pre-execute plan-audit mode; `--multi-auditor` runs a two-pass double audit (second CLI from `CLAUDE_CLI_2`). Fail-closed verdict, secret redaction, read-only auditor. **Freezes the audit tip** (race fix): captures `HEAD` as `audit_head` once at gather time, injects an `AUDIT RANGE` section into the prompt naming the exact frozen range `run_start_sha..audit_head` so the auditor reasons about THAT range (not live HEAD, which may advance past the run's work during the multi-minute external call), records `run_start_sha` + `audit_head` on each `consult.history` entry, and warns if HEAD moved during the round.

## Correctness gates (added 2026-08-11)
- `scripts/probe-toolchain.mjs <repo>` — writes the target repo's `.zcode/toolchain.json` (`test_cmd`, `lint_cmd`, coverage fields) derived from its `package.json` scripts ONLY; `lint_cmd` comes from `scripts.lint` and is never invented or installed (absent → `null`, and every lint consumer records `inert`). Invoked by `scaffold.mjs` at run creation. Consumers: the post-edit lint arm — both sides since v0.6.4 (`pre-tool.mjs`'s first-touch baseline capture and `post-tool.mjs`'s attributed comparison, sharing `hooks/lib/lint-invocation.mjs`) — `parse-plan`'s toolchain-aware criterion lint, `coverage-delta`, and `regression-gate` (`test_cmd`). 27-case suite: `probe-toolchain.test.mjs`.

- `scripts/record-verify.mjs … [--no-stall-check]` — exits **10** ("NOT RERUN") if the criterion previously failed and the worktree is byte-identical to that failure. The attempt is still counted so the cap converges. When you see exit 10, the fix is to *change something* or re-plan — never to retry. Inert in non-git repos; `--no-stall-check` disables.

- `scripts/regression-gate.mjs <repo> <slug> --snapshot|--check` — the pass-to-pass property. `--snapshot` runs `toolchain.test_cmd` and records the baseline; it is invoked automatically by `set-phase.mjs` on entering `execute`, so you normally never call it by hand. `--check` re-runs and exits **8** if a suite that was green has gone red; `set-phase … done` refuses while `state.regression.status === "regressed"`. A baseline that was already red is recorded and never enforced (inherited breakage is not this run's fault), and a repo with no `test_cmd` records `inert`. Suite-level exit code is the signal — test-name parsing is best-effort and used only for the message. **⚠️ YOU MUST RUN `--check` YOURSELF — nothing invokes it (verified 2026-08-16).** `--snapshot` is automatic; `--check` has **zero code callers** and is the only writer of `state.regression.status`, so `set-phase … done` refuses on a field that is never populated unless you run this — the gate reads as enforcement and is inert. **Run `regression-gate.mjs <repo> <slug> --check` during `verify`, before requesting `done`.** Item 02 of the v0.6 queue shipped in v0.6.0 and wired `check-imports`, `coverage-delta` and `resolve-capabilities` — but **not** this one, which was outside its scope; `--check` still has zero code callers, so this sentence remains the enforcement.
- `scripts/check-imports.mjs <repo> [--since <sha>] [--files a,b,c]` — exits **9** on an import that resolves against neither the declared dependencies nor `node_modules` (JS/TS) or `requirements`/`pyproject` (Python). Offline; relative paths, builtins, and local modules are ignored. Run it during verify on the run's changed files.

## Diagnostics + cross-run learning
- `scripts/resolve-capabilities.mjs [--check] [--agent <name>]` — reconciles agent `tools:` grants vs body references vs live inventory. Exits 6 on routed-but-not-granted violations. Test-only env overrides: `ZCAP_HOME` / `ZCAP_CAPS_MD` / `ZCAP_LOCK_PATH` / `ZCAP_CFG_PATH` / `ZCAP_NO_CODEGRAPH` (relocate fixtures / force codegraph off).
- `scripts/recall-outcomes.mjs <repo> [--failed]` — reads prior blocked/failed outcomes from `.zcode/memory/outcomes.jsonl` for phase-1 premortem grounding.
- `scripts/recall-corrections.mjs <repo>` — mines correction signals (verify-fail re-dispatches, Momus REJECT + blockers) from `.zcode/state/*.json` (NOT `outcomes.jsonl`) for phase-1 Metis grounding; top-K bounded (default 5) for context economy. Exit 0 success · 2 bad args · 3 no state yet.
- `scripts/registry-report.mjs <repo> [--json] [--min-n <k>] [--store <dir>]` — the narrator trust registry (ISNAD R2): cross-run agent-config reliability keyed on `sha256(agents/<name>.md)` — a prompt edit starts a new key at the cold-start prior (structural decay: trust attaches to the configuration, never the model name). Evidence: consult ACCEPT/REJECT gaps from `.zcode/state/*.json` (compliance gap → momus miss; bug/quality/security gap → executor miss) plus judged criterion results (zodyssey-arm only, via `lib/arm.mjs`) from `~/.zcode/orchestration/eval/judged.jsonl`; idempotent stable evidence ids, ledger at `~/.zcode/orchestration/registry/narrators.jsonl` (rolling 1000 cap). Trust = `(s+1)/(s+m+2)`, n ALWAYS printed beside it. **Advisory only** — consumed by metis at consult, never a gate. Test overrides: `ZODYSSEY_REGISTRY_DIR` / `ZODYSSEY_EVAL_DIR` / `--store`. Exit 0 success · 2 bad args · 3 no state dir.
- `scripts/parse-plan.test.mjs` — unit tests for the parser (30 cases; run after any parse-plan change).

## Phase 3 (REVIEW) — exact order to record a verdict

1. Dispatch zodyssey:momus via `Task(subagent_type="zodyssey:momus")`. The enforcement hook observes this and mints a one-time **nonce** into `state.review.pending_nonce` (read it from there, or from the hook's stderr line). Only the exact `subagent_type` mints — a lookalike namespace (`*:momus`) dispatches but mints nothing and warns on stderr. NOTE: SKILL.md older prose said `pending_momus` — that field does not exist; the real field is `pending_nonce`.
> **The hook lints the plan BEFORE it will dispatch momus.** If `parse-plan --lint` fails, the
> `Task(zodyssey:momus)` dispatch is blocked with the specific problems listed. Fix the plan, then
> dispatch. This exists because the lint used to run at the *end* of the review: momus would
> approve, `record-review` would reject on a criterion the parser could have flagged first, and
> fixing it changed the plan-sha — which invalidated the review and cost another momus round.

2. zodyssey:momus returns her verdict (JSON with a `verdict` field, or a `VERDICT: OKAY|REJECT` line per references/momus-prompt.md). Write it to **`.zcode/staging/`** (NOT `.zcode/plans/` or `.zcode/notepads/` — SEC-6 refuses those as `--from` sources, because they are agent-writable and are where a forged verdict would most cheaply be planted), then `record-momus-artifact.mjs <repo> <slug> <round> --nonce <nonce> --from <that file>` → prints the artifact path under `.zcode/reviews/`. (Stdin piping via `<<EOF |` is blocked by the Bash gate's metachar denylist pre-verdict — the gate was restored 2026-08-11 after having been deleted in v0.2.0, so this constraint is live again.)
   Note: notepads are **append-only**. `Write` over an existing notepad is blocked; use `Edit`, or write a new file. Notepads are what F1–F4 read, so replacing one wholesale destroys the evidence behind the verdict.
3. `record-review.mjs <repo> <slug> <OKAY|REJECT> --momus-artifact <that path> --plan-sha $(sha256sum <plan> | cut -d' ' -f1) [--blockers <file>]`.

The chain (dispatch → nonce → artifact → verdict) is what makes the OKAY non-forgeable: an agent can't fabricate the artifact because the nonce only exists after a real `Task(zodyssey:momus)` call the hook witnessed. *(The 2026-08-04 review-lane hole referenced here was closed by `record-review.mjs`'s nonce binding; the caveat is removed as obsolete.)*

**What the chain does and does not prove.** It proves a reviewer was **dispatched** and that the artifact bytes are the ones the nonce was bound to. Until 2026-08-11 that was the entire final-wave check — F2/F4 never opened the artifact, so one reading `{"verdict":"REJECT"}` passed both. The verdict is now parsed (see `record-final-wave.mjs` above), which closes the gap between "a review happened" and "the review approved". Phase 3's `record-review.mjs` already compared the artifact's verdict against argv; the final wave now matches that standard.

## Final-wave artifacts (added 2026-08-12)

- `scripts/record-final-artifact.mjs <repo> <slug> <F2|F4> [--nonce N] [--from <file>]` — the trusted writer for F2/F4 artifacts, mirroring `record-momus-artifact.mjs` for the review lane. `.zcode/reviews/` is not bookkeeping, so this is the only sanctioned way to put an artifact there. Verdict comes from `--from` (not under `plans/`/`notepads/` — use `.zcode/staging/`) or stdin. Prints the artifact path.
  - It does **not** consume the nonce: `record-final-wave.mjs` does that, binding it to the artifact's bytes. Passing `--nonce` here just checks it against `state.final_f2|final_f4.pending_nonce` so a mismatch surfaces immediately instead of at the gate.
  - An unrecognized `verdict` value is refused at write time. The gate would resolve it to `missing` and fail closed anyway, but by then the one-time nonce is spent.
- **A failed F1 no longer consumes the F2/F4 nonces.** They are recorded as `not_evaluated` and left intact, so fixing an F1 problem and re-running does not require re-dispatching both reviewers.


## Recovering from a failed final wave

F1 can fail on something you can still fix — most often test-integrity, when a test file ended the
run net-negative. The recovery is legal but not obvious, because test files are read-only in
`verify` and `final` (B5), and the DAG has no `final → execute` edge:

```
final → verify → execute     # both transitions are DAG-legal
```

In `execute`, test edits are permitted again (that phase is where writing tests is the job). Restore
the assertions, then `execute → verify → final` and re-run `record-final-wave.mjs` **with the same
F2/F4 nonces** — a failed F1 leaves them unconsumed, so no reviewer needs re-dispatching.

If the F2/F4 artifacts need updating too (say F4 rejected over the very thing you just fixed),
re-place them with `record-final-artifact.mjs` before the retry; the pending nonce is still valid.

## Round numbers

`record-momus-artifact.mjs`'s `<round>` argument is **optional**. It is 1-indexed, while
`state.review.round` counts *completed* rounds and starts at 0 — an off-by-one that cost two
shakedown runs a re-dispatch each. Omit it and the correct round is computed; pass it and a
mismatch names both numbers.
