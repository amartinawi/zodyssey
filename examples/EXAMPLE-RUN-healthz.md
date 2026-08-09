# Example run: add a /healthz endpoint

This is an anonymized, lightly edited transcript of a real ZOdyssey run on the `std-01` eval seed (a deliberately small "standard" task: add a health endpoint + test to an Express server). It shows what each phase produces so you can see the pipeline end-to-end. Phases that are pure orchestration (triage, dispatch bookkeeping) are elided.

## Task

> Add a `/healthz` endpoint to the Express server + a jest test.

Repo: a 6-file Express + Jest fixture (the kind you might scaffold for a smoke test).

---

## Phase 1 — Consult (`metis`)

`metis` classifies the task and surfaces directives for the planner:

> **Intent:** standard (bounded, clear deliverable, single system).
> **Success criteria:** `GET /healthz` returns `200 {ok:true}`; a jest test exists and passes; no other endpoints change.
> **Directives for prometheus:**
> - Route file goes under `src/routes/` (matches existing convention).
> - Acceptance criteria MUST be agent-executable (`npm test`, a curl, …) — no "looks good" criteria.
> - The test file and the route file are the only 2 files in scope.

## Phase 2 — Plan (`prometheus`)

The planner writes `<repo>/.zcode/plans/add-healthz-endpoint.md`:

```markdown
---
slug: add-healthz-endpoint
title: Add a /healthz endpoint to the Express server
status: drafting
intent: standard
created_at: 2026-08-09T10:00:00Z
plan_sha256: <bound-after-first-review>
review: { round: 0, verdict: null, momus_session: null, blockers: [] }
approval_gate: open
---

# add-healthz-endpoint — Work Plan

## TL;DR
Add a `GET /healthz` route returning `200 {ok:true}` and a jest test covering it.

## Scope
### Must have
- A route handler at `GET /healthz` → `200 { ok: true }`.
- A jest test that asserts the response.
### Must NOT have
- No changes to existing routes, middleware, or the app entrypoint.
- No new dependencies.

## Verification strategy
- `npm test` exits 0 (the new test + all existing tests).
- `curl localhost:3000/healthz` returns `200 {"ok":true}` (manual or scripted).

## Todos
- [ ] 1. Add the healthz route
  - What to do: Create `src/routes/healthz.js` exporting an Express router with a `GET /` handler returning `200 { ok: true }`. Mount it in the app at `/healthz`.
  - Must NOT do: Do not modify any other route or the app entrypoint beyond the one mount line.
  - Files: [src/routes/healthz.js, src/app.js]
  - Wave: 1
  - Acceptance criteria:
    - `node -e "require('./src/routes/healthz.js')"` does not throw
    - `curl -sf localhost:3000/healthz` is not reachable yet (route mounted only after app starts)
  - QA scenarios:
    - Happy: GET /healthz → 200 {ok:true}
    - Failure: GET /healthx → 404

- [ ] 2. Add the jest test
  - What to do: Create `test/healthz.test.js` that imports the route, fires a request (supertest is already a devDep), and asserts `200 { ok: true }`.
  - Must NOT do: Do not touch existing tests.
  - Files: [test/healthz.test.js]
  - Wave: 1
  - Acceptance criteria:
    - `npm test -- healthz` exits 0
  - QA scenarios:
    - Happy: test passes

## Final verification wave
- [ ] F1. Plan-compliance: every todo's Files: was edited, nothing else.
- [ ] F2. Code-quality review.
- [ ] F3. Manual-QA: start the app, curl /healthz, confirm 200.
- [ ] F4. Scope-fidelity: no file outside the 3 declared was touched.

## Success criteria
- `npm test` exits 0.
- `git diff --stat` shows exactly 3 files changed (2 created, 1 mounted).
- `curl localhost:3000/healthz` → `200 {"ok":true}`.
```

## Phase 3 — Review gate (`momus`)

`momus` reads the plan and returns:

> **Verdict: OKAY**
> - Acceptance criteria are all agent-executable.
> - Files: scope matches the deliverable.
> - No ambiguity, no missing section.

`record-review.mjs` binds the plan-sha to the verdict and writes it to `state.json`. Now — and only now — can an executor edit product code.

## Phase 4 — Execute (`sisyphus-junior`, wave 1)

Both todos are in Wave 1 (independent), so the orchestrator dispatches them in parallel. The hook's scope boundary verifies each Edit lands inside the declared `Files:`:

- Todo 1 edits `src/routes/healthz.js` (create) + `src/app.js` (mount line). Both in declared scope → pass.
- Todo 2 edits `test/healthz.test.js` (create). In scope → pass.

If either had tried to edit, say, `package.json` (not declared), the hook would block with:
```
ZODYSSEY_BLOCK gate: SCOPE VIOLATION: package.json is not in the plan's declared Files: scope.
```

## Phase 5 — Verify

The orchestrator runs each todo's acceptance criteria:
- `npm test -- healthz` → exits 0. ✔
- `node -e "require('./src/routes/healthz.js')"` → no throw. ✔

## Phase 6 — Final wave

- **F1** (plan-compliance): `git diff --name-only` = `[src/routes/healthz.js, src/app.js, test/healthz.test.js]`. All in declared scope. ✔
- **F2** (code-quality): clean — no issues.
- **F3** (manual-QA): start app, `curl localhost:3000/healthz` → `200 {"ok":true}`. ✔
- **F4** (scope-fidelity): no out-of-scope file touched. ✔

## Terminal state

`state.json` at the end:

```json
{
  "slug": "add-healthz-endpoint",
  "phase": "done",
  "started_at": "2026-08-09T10:00:00Z",
  "updated_at": "2026-08-09T10:14:00Z",
  "review": { "round": 1, "verdict": "OKAY", "plan_sha256": "a1b2c3…", "momus_session": "agent_…" },
  "todos": {
    "1": { "status": "done", "attempts": 1 },
    "2": { "status": "done", "attempts": 1 }
  },
  "final": { "F1": "pass", "F2": "pass", "F3": "pass", "F4": "pass", "verdict": "pass" }
}
```

## What this run demonstrates

- **The enforced gate worked.** No code was written before `review.verdict == OKAY`. With a prompt-convention orchestrator, an impatient model can skip that; here it cannot.
- **The scope boundary worked.** The executor stayed inside the 3 declared files. If it had wandered (the real-world failure this prevents), the hook would have blocked it.
- **Acceptance criteria were executable.** Every todo's "done" was decided by a command exit code, not a vibe.
- **The whole run took ~14 minutes** for a 3-file change. For a trivial task this is overhead (triage would normally deflect a one-liner); for a standard task touching shared code, the gate + scope isolation is cheap insurance.
