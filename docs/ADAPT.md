# Adapting ZOdyssey to other harnesses (omo, Claude Code, Cursor, …)

> If you already use [**omo**](https://github.com/code-yeongyu/oh-my-openagent), start there. omo gives you the full pipeline, the agent cast, and the ergonomics. **This doc is about layering the ZOdyssey enforcement delta onto omo (or any orchestrator with a hook system).**

## The one idea that matters

omo and ZOdyssey share the same pipeline shape (prime → consult → plan → review → execute → verify → final-wave). The difference is one architectural decision, stated in [DESIGN.md §2](DESIGN.md):

> **Enforce invariants with code; guide choices with prompts.**

omo's review gate is a prompt — the model is told to wait for `OKAY` before editing, but `start-work` never checks it. ZOdyssey's review gate is a `PreToolUse` hook that reads `state.json` and blocks the Edit if `review.verdict != OKAY`. Everything else — the plan-file contract, the cast of agents, the notepad memory pattern — is portable as-is.

So adapting ZOdyssey is **not** a port. It is: take the orchestrator you already have, and bolt on 4 hooks. Below is exactly how.

## The 4 hooks (the entire delta)

Each is a script your harness runs before a tool call. It reads the run state + the tool payload, returns `pass` or `block`.

### Hook 1 — Review gate (the big one)

**When:** `PreToolUse` on the edit tools (`Write`, `Edit`, `ApplyPatch`, …).
**Logic:**
1. Is an orchestration run active? (A non-terminal state file exists under `<cwd>/.zcode/state/`, not stale.) If no → pass (normal editing).
2. Is the target a bookkeeping path (`.zcode/plans/`, `.zcode/notepads/`)? → pass (planner scratchpad is always writable).
3. Is `state.review.verdict == "OKAY"`? If not → **block**: "edits blocked until plan passes review."
4. (Hooks 2 + 3 below run on the same path if verdict is OKAY.)

Reference: [`skills/odyssey/hooks/pre-tool.mjs`](../skills/odyssey/hooks/pre-tool.mjs), the `isEdit` branch.

### Hook 2 — Scope-isolation boundary

**When:** same `PreToolUse` path, after Hook 1 passes.
**Logic:** the target file must be in the plan's declared `Files:` union (the hook parses every `Files: [a, b, c]` in the plan). **Fail closed**: if the plan is unreadable OR declares zero editable files, block every product-code edit. (This is the fix for the real-world failure where an executor on a content-roundup run edited a completely unrelated file.)
**Bonus:** re-hash the plan against the sha bound to the OKAY verdict, so an executor can't widen its own scope by editing the plan post-review.

### Hook 3 — File-lock ledger

**When:** same `PreToolUse` path, after Hook 2 passes.
**Logic:** check a per-file lock map. If another in-flight todo holds the lock for this path, block (collision). Otherwise acquire/refresh the lock. Release when the todo is marked done (or reap by TTL).

### Hook 4 — Parallel cap

**When:** `PreToolUse` on the dispatch tool (`Task` / `Agent`).
**Logic:** count in-flight dispatches in a ledger file (`.zcode/state/<slug>.inflight.json`). Block if count >= cap (default 4). The model can't bump state between tool calls in one turn, so the hook owns this counter.

### (Optional) Hook 5 — Bash write-gate

If your harness exposes Bash as a tool and you want the same isolation on shell escapes (`sed -i`, `>`, `git apply`), gate write-capable Bash the same way as Hook 1+2. See the `isBash` branch + `bashWriteTargets` + `quickClassify` helpers in `pre-tool.mjs`. ZOdyssey ships this **on by default**; set `ZODYSSEY_UNGATE_BASH=1` if you want the lower-friction ungated behavior.

## Porting to omo specifically

omo is a TypeScript project. omo already has the `prometheus-md-only` hook (the planner can't write product code) and the pipeline. To add the ZOdyssey delta:

1. **State file.** omo tracks plan state. Make sure the verdict is written somewhere the hook can read (omo already has a `review.verdict` concept — surface it to disk if it isn't already).
2. **The hook.** Add a `PreToolUse` hook to omo's hook layer that does Hook 1 + 2 above. The logic is ~60 lines of TS; crib directly from [`pre-tool.mjs`](../skills/odyssey/hooks/pre-tool.mjs) `isEdit` branch (lines ~544-625 in the reference).
3. **The scope parser.** Reuse omo's existing `plan-checklist.ts` file-set extraction (it already parses `Files:`). Feed its output to the scope check.
4. **The parallel cap.** omo dispatches via its own mechanism — add the in-flight counter to whatever omo's dispatch path is.

The omo hooks live where omo expects them; the logic is portable verbatim. The result: omo's ergonomics + omo's agent cast + the ZOdyssey enforcement layer. Best of both.

## Porting to Claude Code

Claude Code has the same hook system (`PreToolUse`, `PostToolUse`, `Stop` in `~/.claude/settings.json`). The hook scripts can be reused **as-is** (they are ESM `.mjs` reading stdin JSON, which is the Claude Code hook contract). The only adaptations:

- Change `~/.zcode/` paths to `~/.claude/` (or make them configurable via env).
- The edit-tool names match (`Write`, `Edit`, `MultiEdit`).
- The dispatch tool is `Task` (same name).
- The conductor is a Claude Code skill instead of a ZCode skill (SKILL.md format is compatible).

## Porting to Cursor / other harnesses

The pattern needs exactly one primitive: **a script that runs before a tool call, can read the tool payload + a state file, and can return allow/deny.** Any harness with a pre-tool hook system can run these. Map the harness's tool names to the ZOdyssey gate's names (`Write`/`Edit` → edit gate, `Task`/`Agent` → dispatch gate, `Bash` → bash gate) and the rest is identical.

## What you do NOT need to port

- **The pipeline.** Your orchestrator already has one. Keep it.
- **The agents.** Your orchestrator's agent cast is fine. (ZOdyssey's `metis`/`prometheus`/`momus`/`sisyphus-junior` are adapted from omo's; omo's originals are equally good.)
- **The plan-file format.** omo's works. ZOdyssey's works. The contract is "planner writes it, executor reads it, hook parses `Files:` from it" — any structured markdown fits.
- **The model-routing design.** omo's `task(category=)` already does this. ZOdyssey deliberately does *not* reimplement it.

## What you SHOULD port (the high-leverage subset)

If you only do one thing: **Hook 1 (the review gate).** It is the single highest-reliability improvement. Just that hook closes the gap between "the model was told to wait" and "the model cannot proceed." The other hooks are valuable but Hook 1 is the difference.

If you do two things: **Hook 1 + Hook 2 (scope boundary).** Together they implement the isolation property — the plan is good enough to execute (Hook 1) AND execution stays inside the declared scope (Hook 2). Both are needed; neither alone is sufficient. This is the real-world scope-isolation failure made impossible.

## Reference implementation map

| Concept | File in this repo |
|---|---|
| The gate (all 5 hooks) | [`skills/odyssey/hooks/pre-tool.mjs`](../skills/odyssey/hooks/pre-tool.mjs) |
| Write-capable-Bash classifier | `WRITE_PATTERNS` + `looksReadOnly()` + `bashWriteTargets()` in the same file |
| Plan `Files:` parser (shared by gate + lint) | [`skills/odyssey/scripts/parse-plan.mjs`](../skills/odyssey/scripts/parse-plan.mjs) |
| State file shape + transitions | [`docs/DESIGN.md` §4-5](DESIGN.md) |
| The nonce → artifact → sha evidence chain | [`skills/odyssey/scripts/record-review.mjs`](../skills/odyssey/scripts/record-review.mjs) + [`record-momus-artifact.mjs`](../skills/odyssey/scripts/record-momus-artifact.mjs) |
| The external consult gate | [`skills/odyssey/scripts/consult.mjs`](../skills/odyssey/scripts/consult.mjs) + [`references/auditor-prompt.md`](../skills/odyssey/references/auditor-prompt.md) |

## Why bother?

Because the research is consistent: coding agents fail from (a) skipped planning, (b) edit collisions, (c) edits to files outside the intended scope, and (d) the "50 subagents for a one-line fix" over-engineering failure. All four are deterministic invariants — they can be checked with code. Prompt conventions catch them *most of the time*. Hooks catch them *every time*. That is the whole thesis of ZOdyssey, and it is portable to whatever you are already running.
