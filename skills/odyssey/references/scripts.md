# Scripts you call — full signatures (load on demand)

Load this reference when you are about to invoke a trusted-writer script. The inline
SKILL.md keeps only one-line reminders; the full signatures, flags, and exit codes live here.

## Planning + transitions
- `scripts/scaffold.mjs <repo-root> <slug> <title> <intent> [task-brief]` — creates plan + state.json + plans/<slug>.task.md (the last carries the phase-−1 primed brief, read by consult.mjs as THE ORIGINAL TASK).
- `scripts/parse-plan.mjs <plan.md> [--files|--waves|--todo N|--lint]` — reads todos for dispatch and verification. `--lint` mode checks acceptance criteria are executable (gates record-review OKAY).
- `scripts/set-phase.mjs <repo> <slug> <phase> [--note <text>]` — **the only sanctioned way to transition phases**. Enforces the transition DAG (plan→review→execute→verify→final→done) + preconditions (done requires OKAY + final pass). Escape hatches: blocked/abandoned always allowed. On done|audited, auto-appends run-report to results.jsonl + writes a memory outcome.

## Review gate (phase 3)
- `scripts/record-momus-artifact.mjs <repo> <slug> <round> --nonce <nonce> [--from <file>]` — **the only sanctioned way to record momus's verdict artifact**. Requires `--nonce` (issued by the hook when it observed the `Task(momus)` dispatch). Writes under `.zcode/reviews/`. NOTE: prefer `--from <bookkeeping-file>` over stdin piping — the metachar denylist blocks the `<<EOF |` form pre-verdict.
- `scripts/record-review.mjs <repo> <slug> <OKAY|REJECT> --momus-artifact <path> --plan-sha <sha> [--blockers <file>]` — **the only sanctioned way to set the review verdict**. Runs `parse-plan --lint` on OKAY (refuses if acceptance criteria aren't executable). BOTH `--momus-artifact` and `--plan-sha` are MANDATORY. Pass the FULL 64-char plan-sha (a truncated prefix passes the error message but fails the equality check).

## Verify + final wave (phases 5-6)
- `scripts/record-verify.mjs <repo> <slug> <todo-id> --criterion <cmd> --exit-code <N> [--output <file>] [--n <idx>]` — records per-criterion evidence under `.zcode/verify/`. Exit 6 on failure (exit-code != 0). Also populates `state.acceptance[todoId] = {pass, at, evidence}` (gated on `todos[todoId].status==='done'` AND every recorded criterion passing — closes the mid-verify race) and `state.notepad_pointers[todoId]` when `.zcode/notepads/<slug>/<id>.md` exists. Both fields optional (older state loads fine). NOTE (security): the exit-code is a caller-supplied argv, not executed — see external-audit finding; the orchestrator must run the criterion itself and pass the real exit code.
- `scripts/compact.mjs <repo> <slug>` — OPTIONAL pre-final-wave notepad compactor. Concatenates each notepad in `.zcode/notepads/<slug>/*.md` (truncated to ~40 lines, `## <name>` headers) into a single `_compact-brief.md` the final-wave sub-agents consume instead of the full doc set. Deterministic ($0, no LLM), additive (NEVER modifies source notepads), idempotent. Borrows prime-agent primitive #8.
- `scripts/record-final-wave.mjs <repo> <slug> [--f2-artifact P --f2-nonce N] [--f3-checklist P] [--f4-artifact P --f4-nonce N] [--skip F2,F4]` — binds all four F-items to evidence. F1 = machine-checked set-difference (plan Files vs git diff). F2/F4 = nonce-bound artifacts. F3 = checklist file. NOTE: F1 throws+silently-passes in a non-git repo; `--skip F2,F4` is the only working F4 path today (wrong-var bug at :36).

## Tracking
- `scripts/record-todo.mjs <repo> <slug> <id> <status> [--session S]` — records todo status + maintains `state.active_todos[owner]` for file-lock attribution. On done/failed, releases locks.
- `scripts/record-capability.mjs <repo> <slug> <phase> <capability> [--activity A]` — self-declared capability use (the hook ALSO records observed Skill/MCP calls with `observed:true`).
- `scripts/status.mjs <repo> <slug> [--json]` — quick "where is this run?" (phase, verdict, todo counts). `--json` also emits `acceptance`, `notepad_pointers`, `verified_count`; human mode adds a gated `verified: N passed · M notepad(s) linked` line (only when the fields have content — byte-identical backward compat for pre-acceptance runs).

## Eval + consult
- `scripts/run-report.mjs <repo-root> <slug> [--json] [--log <path>]` — one-run efficiency scorecard. `success` derived from `state.final.verdict`.
- `scripts/harness.mjs [--task <id>] [--arm zoedyssey|baseline] [--list]` — eval runner: fresh-copy → scaffold → (conductor drives) → auto-append. Prints the judge command.
- `scripts/judge.mjs <run-repo> <slug> <seed-id> [--double]` — INDEPENDENT LLM-as-judge on the external CLI (not oracle). Scores against the seed's success_criteria. `--double` = two passes + >0.15 disagreement flag.
- `scripts/consult.mjs <repo-root> <slug> [--task <file>]` — run ONE external audit round (the `/orchestrate-consult` gate). Fail-closed verdict, secret redaction, read-only auditor.

## Diagnostics + cross-run learning
- `scripts/resolve-capabilities.mjs [--check] [--agent <name>]` — reconciles agent `tools:` grants vs body references vs live inventory. Exits 6 on routed-but-not-granted violations.
- `scripts/recall-outcomes.mjs <repo> [--failed]` — reads prior blocked/failed outcomes from `.zcode/memory/outcomes.jsonl` for phase-1 premortem grounding.
- `scripts/parse-plan.test.mjs` — unit tests for the parser (10 cases; run after any parse-plan change).

## Phase 3 (REVIEW) — exact order to record a verdict

1. Dispatch momus via `Task(subagent_type="momus")`. The enforcement hook observes this and mints a one-time **nonce** into `state.review.pending_nonce` (read it from there, or from the hook's stderr line). NOTE: SKILL.md older prose said `pending_momus` — that field does not exist; the real field is `pending_nonce`.
2. momus returns her verdict JSON. Write it to a bookkeeping file (`.zcode/plans/` or `.zcode/notepads/`), then `record-momus-artifact.mjs <repo> <slug> <round> --nonce <nonce> --from <that file>` → prints the artifact path under `.zcode/reviews/`. (Stdin piping via `<<EOF |` is blocked by the metachar denylist pre-verdict.)
3. `record-review.mjs <repo> <slug> <OKAY|REJECT> --momus-artifact <that path> --plan-sha $(sha256sum <plan> | cut -d' ' -f1) [--blockers <file>]`.

The chain (dispatch → nonce → artifact → verdict) is what makes the OKAY non-forgeable: an agent can't fabricate the artifact because the nonce only exists after a real `Task(momus)` call the hook witnessed. (CAVEAT — see external-audit finding: as of 2026-08-04 the review-lane non-forgeability has a confirmed hole; the nonce-binding fix is in the security wave.)
