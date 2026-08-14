---
description: Run an independent external audit of a completed ZOdyssey run. Hands the plan + full git diff to the external Claude Code CLI, which returns ACCEPT or REJECT+gaps. On REJECT, auto-remediates the gaps and re-audits, looping until ACCEPT. Use after /orchestrate finishes.
argument-hint: "<slug>"
skills: zodyssey:odyssey
---

Load the `zodyssey:odyssey` skill, then run the **external consult/audit gate** for the completed run `<slug>`:

```
$ARGUMENTS
```

Follow the **Consult workflow** section of the zodyssey:odyssey skill exactly. Summary of what you do:

## Setup
1. Confirm `<repo>/.zcode/state/<slug>.json` exists and `phase == "done"`. If not done, tell the user to finish the run first.
2. Note the repo root (current workspace project root).

## The audit loop (loop until ACCEPT)
1. Run ONE audit round: `skills/odyssey/scripts/consult.mjs <repo> <slug>` (inside the `zodyssey` plugin install). This spawns the external Claude Code CLI headlessly with the plan + this run's git diff + the audit prompt, parses the structured verdict, and writes it to `state.json`'s `consult` lane.
2. Read the verdict from the script's JSON output:
   - **ACCEPT** → the run is audited-accepted. Tell the user, summarize the auditor's notes, and STOP. Mark `phase: "audited"`.
   - **REJECT** → enter remediation (below).

## Remediation (on REJECT)
1. Read `consult.last_gaps` from state.json — each gap has `{category, severity, issue, fix}`.
2. Dispatch remediation work to `zodyssey:sisyphus-junior` — one dispatch per gap (parallel where independent), each carrying the gap's `issue` + `fix` as the task. Use the same dispatch discipline as phase 4 (parallel-by-default). In `done`/`audited` the enforcement hooks are **disarmed**, so the parallel cap does **not** apply during remediation — if you want it enforced during gap-fixes, first `set-phase <repo> <slug> remediate`, then restore `done`/`audited` after re-consult.
3. After all gap-fixes return, re-verify (run any affected acceptance commands), then re-run the audit (`consult.mjs` again).
4. Loop. There is **no hard cap** — you loop until ACCEPT.

## Safety rail (soft, not a hard stop)
Every **5 rounds** without convergence, pause and ask the user (via AskUserQuestion): "Consult round N, still REJECT. Continue the loop, or pause to inspect?" This prevents an unattended pathological disagreement from burning tokens forever, while honoring "no hard cap."

## What you must NOT do
- Do NOT run the audit if the run isn't `done` (no diff to audit).
- Do NOT edit the auditor's verdict or gaps — they are the independent truth. You remediate, you don't negotiate.
- Do NOT skip remediation steps. Each gap's `fix` must be actually addressed before re-auditing.
- Do NOT fabricate an ACCEPT. Only the external auditor's parsed verdict counts.

## Reporting
When ACCEPT (or user pauses), summarize: rounds run, gaps found and fixed per round, final advisories. The full history is in `state.json` → `consult.history`.
