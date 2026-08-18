# ZCode Orchestration System — Design Document

> **Codename:** ZOdyssey (Z-orchestration odyssey)
> **Status:** Design (v1.0) — pending build approval
> **Scope:** Hybrid-enforced, maximal — pipeline + team mode + memory + model routing
> **Authors:** designed 2026-07-31 from a synthesis of published best practices (see §0)

---

## 0. Provenance — what this design is grounded in

This is not invented from scratch. Every load-bearing decision maps to a finding from
production multi-agent systems research:

| Finding | Source | How it shapes this design |
|---|---|---|
| Orchestrator-worker beats single agent by **+90%** on research evals; needs effort-scaling to avoid "50 subagents for a simple query" | [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | Drives §3 (pipeline) + §7 (effort guardrail hook) |
| **"Find the simplest solution; only add complexity when needed."** Workflow (deterministic) vs Agent (LLM-directed) | [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) | Drives §2 (hybrid: hard gates for the deterministic parts, prompts for the LLM-judgment parts) |
| Four patterns: subagents, skills, handoffs, routers. **Subagents process 67% fewer tokens than skills** via context isolation | [LangChain — Choosing the Right Multi-Agent Architecture](https://www.langchain.com/blog/choosing-the-right-multi-agent-architecture) | Validates our worker-subagent port; drives §3 topology |
| Multi-agent needs **durable execution + resume from checkpoint**, not restart-on-failure | [LangChain — How and When to Build Multi-Agent Systems](https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems) | Drives §5 (checkpoint/resume via `state.json`) |
| Coding agents fail from **edit collisions + skipped distant edits + API hallucination**; hub-and-spoke + locks fix it | [arXiv — Context Engineering for Multi-Agent LLM Code Assistants](https://arxiv.org/html/2508.08322v1) | Drives §6 (file locks) + §3 (plan-driven completeness) |
| omo's Momus verdict is **prompt-only, not enforced**; `start-work` never checks it | omo source (this session's research) | **Our differentiator** — §4 code-enforces what omo leaves to convention |
| omo `task(category=)` is **model routing, not agent routing** (always Sisyphus-Junior) | omo `category-resolver.ts` | Drives §8 (model routing design — we keep it honest) |
| Filesystem handoffs beat in-memory "telephone" for large artifacts | Anthropic multi-agent post | Drives §5 (plans + notepads on disk, not in-context) |

---

## 1. Goals & non-goals

### Goals
1. **State-of-the-art reliability** — code-enforced gates where determinism matters; prompt guidance where LLM judgment is needed.
2. **Full benefit of the ported workers** (explore, librarian, oracle, metis, momus, multimodal-looker) — they become a real cast, not isolated sub-agents.
3. **Maximal scope in v1** — pipeline, team mode, memory, model routing — but staged so each layer is independently useful.
4. **Native ZCode** — built from ZCode primitives (hooks, commands, agents, `Task`/`SendMessage`, plan files). No external runtime, no daemon.
5. **Observable & evaluable** — every run produces artifacts you can inspect and score.

### Non-goals (explicitly)
- **Not** a replacement for the main ZCode agent's normal operation. The orchestrator is an *opt-in* mode entered via `/orchestrate`.
- **Not** multi-model in v1's first cut. Model routing is *designed in* (§8); routing reduces to "which variant/effort" within a single connected model until other providers are wired. The design leaves the door open — when a second provider is connected, the same `category` lookup table extends to pick a provider+model. No rewrite needed.
- **Not** harness-agnostic in v1. The reference implementation targets ZCode (hooks, commands, sub-agents). The *pattern* is portable; see `docs/ADAPT.md` for porting the enforcement delta onto omo or any orchestrator.

---

## 2. The core architectural decision — hybrid enforcement

Research shows enforcement is the axis that separates production systems:
- **LangGraph** = code-enforced graph (deterministic, durable) — most reliable, most rigid.
- **Anthropic's own orchestrator-worker** = pure prompt-convention — simplest, most flexible, occasionally skips steps.
- **omo** = mostly prompt-convention (the reviewer gate is *not* enforced — the key finding above).

**Our choice: hybrid, biased toward enforcement.** We use ZCode hooks to hard-enforce the deterministic invariants, and prompts to guide the LLM-judgment parts. Concretely:

| Layer | Mechanism | Why |
|---|---|---|
| **Plan exists before execution** | `PreToolUse` hook on `Write`/`Edit` — blocks edits unless an approved plan is registered | Prevents the #1 failure: skipped planning |
| **Plan passed review** | hook reads `state.json`; blocks edits if `review.verdict != OKAY` | **Code-enforces omo's unenforced gate** |
| **No two agents edit the same file** | hook checks a file-lock ledger; second `Edit` to a locked path is blocked | Fixes the documented coding-agent failure mode |
| **Parallelism within bounds** | hook counts in-flight `Task` dispatches; blocks beyond cap | The Anthropic "don't spawn 50 agents" guardrail, enforced |
| **Planner can't edit product code** | `prometheus` is a sub-agent whose `tools:` omits Write/Edit (already how ZCode sub-agents work) | Mirrors omo's `prometheus-md-only` hook, for free |
| **Which agent runs when** | prompt + plan-file contract (the orchestrator reads the plan and dispatches) | This *is* LLM judgment — enforcing it would be brittle |

The principle: **enforce invariants, guide choices.** If a rule can be checked deterministically (a file exists, a verdict equals OKAY, a count is under N), enforce it with a hook. If it requires judgment (is this task "deep" or "quick"? is the plan good?), put it in a prompt and accept occasional drift.

---

## 3. Architecture — the pipeline

```
                    ┌─────────────────────────────────────────────┐
                    │              USER                            │
                    │  /orchestrate <task>   or   /orchestrate     │
                    │                          resume <plan-slug>  │
                    └──────────────────────┬──────────────────────┘
                                           │
                          ┌────────────────▼────────────────┐
                          │   /orchestrate slash command     │  ◄── entry point
                          │   (writes nothing; loads skill)  │      (~/.zcode/commands/)
                          └────────────────┬─────────────────┘
                                           │ loads
                          ┌────────────────▼────────────────┐
                          │   odyssey skill (the conductor   │  ◄── AGENTS.md rules +
                          │   prompt + state machine)        │      plan-file contract
                          └────────────────┬─────────────────┘
                                           │
        ┌──────────────────────────────────┼───────────────────────────────────┐
        │             PHASE 0 — TRIAGE (effort scaling)                          │
        │   Is this trivial? → just do it (no plan).                             │
        │   Standard?       → single-track plan.                                │
        │   Architecture?   → full pipeline.                                    │
        └──────────────────────────────────┬───────────────────────────────────┘
                                           │ (if non-trivial)
        ┌──────────────────────────────────▼───────────────────────────────────┐
        │  PHASE 1 — CONSULT                  [metis sub-agent]                  │
        │  Classify intent, surface questions/risks, emit directives.            │
        │  May RECOMMEND dispatching explore/librarian/oracle (orchestrator      │
        │  executes those — metis itself can't spawn agents).                    │
        └──────────────────────────────────┬───────────────────────────────────┘
                                           │
        ┌──────────────────────────────────▼───────────────────────────────────┐
        │  PHASE 2 — PLAN                     [planner sub-agent: prometheus]    │
        │  Writes  <repo>/.zcode/plans/<slug>.md  (the contract, §4)             │
        │  +        <repo>/.zcode/state/<slug>.json (resume state)               │
        │  CANNOT edit product code (tools: omit Write/Edit).                    │
        └──────────────────────────────────┬───────────────────────────────────┘
                                           │
        ┌──────────────────────────────────▼───────────────────────────────────┐
        │  PHASE 3 — REVIEW (gate)            [momus sub-agent, + oracle opt.]   │
        │  Reads the plan file. Emits [OKAY] | [REJECT] + ≤3 blockers.           │
        │  Loop: REJECT → planner revises → review again. Max 3 rounds (ours,    │
        │  unlike omo's unbounded loop). Verdict written to state.json.          │
        └──────────────────────────────────┬───────────────────────────────────┘
                                           │  OKAY
        ┌──────────────────────────────────▼───────────────────────────────────┐
        │  PHASE 4 — EXECUTE                  [orchestrator = main agent, OR     │
        │                                            team mode for parallel]    │
        │  Reads plan, dispatches work via Task(subagent_type=…):                │
        │    • research: explore / librarian (parallel)                          │
        │    • advice on hard steps: oracle                                      │
        │    • implementation: executor (sisyphus-jr equivalent) / team members  │
        │  Each task's completion is recorded via record-todo/record-verify.     │
        │  Per-task notes saved to <repo>/.zcode/notepads/<slug>/*.md.           │
        │  ◄── HOOK ENFORCES: no Edit before plan-OKAY; file locks; parallel cap │
        └──────────────────────────────────┬───────────────────────────────────┘
                                           │
        ┌──────────────────────────────────▼───────────────────────────────────┐
        │  PHASE 5 — VERIFY                   [executor runs each task's QA]     │
        │  Every task's acceptance criteria are executable commands (Metis       │
        │  mandates this). Run them. Collect evidence (exit codes, output).      │
        │  Failing QA routes the error back to the responsible executor.         │
        └──────────────────────────────────┬───────────────────────────────────┘
                                           │
        ┌──────────────────────────────────▼───────────────────────────────────┐
        │  PHASE 6 — FINAL VERIFICATION WAVE (fixed, like omo's F1–F4)           │
        │  F1 Plan-compliance audit   F2 Code-quality review                     │
        │  F3 Manual-QA checklist     F4 Scope-fidelity check                    │
        │  Dispatched as sub-agents (oracle/code-review) against the full diff.  │
        └──────────────────────────────────┬───────────────────────────────────┘
                                           │
                                   ┌────────▼────────┐
                                   │     DONE        │  plan marked complete in state.json
                                   └─────────────────┘
```

**Topology:** hub-and-spoke (supervisor). The orchestrator is the hub; workers are stateless spokes.
Rationale: the coding-agents paper found hub-and-spoke with a central lock prevents the edit-collision
failure mode, and LangChain's data shows subagents (hub-and-spoke) save 67% tokens vs. skills.

---

## 4. The plan-file contract — `<repo>/.zcode/plans/<slug>.md`

The plan file is the **entire interface** between planner and executor (same contract omo proved out:
planner and executor never share a session; the markdown IS the handoff). Section order is fixed
(so Momus and the executor can parse it):

```markdown
---
slug: <kebab-case-slug>
title: <human title>
status: drafting | awaiting-review | approved | executing | completed | rejected
intent: trivial | standard | architecture     # from Phase 0
created_at: <iso>
plan_sha256: <sha of the body below, for review binding>
review:
  round: 0
  verdict: null | OKAY | REJECT
  momus_session: <agent-id>
  blockers: []           # [{issue, fix}, …] when REJECT
approval_gate: open | passed
---

# <slug> — Work Plan

## TL;DR (for humans)            ← written LAST; plain English, no paths/numbers
## Scope
### Must have
### Must NOT have
## Verification strategy
## Execution strategy
### Parallel execution waves      ← which todos run together (independent)
### Dependency matrix             ← which todos block which
## Todos                          ← the executable grammar (below)
## Final verification wave        ← F1–F4, fixed
## Commit strategy
## Success criteria
```

### Task grammar (code-parsed)
The executor and the parallelism hook parse `## Todos` rows. A todo MUST match:

```
- [ ] N. <title>
  - What to do: ...
  - Must NOT do: ...
  - Files: [path/a.ts, path/b.ts]          ← consumed by the file-lock hook
  - Wave: 1                                  ← consumed by the parallelism hook
  - Blocked by: []                           ← dependency ids
  - References: src/auth.ts:42, docs/x.md
  - Acceptance criteria:                     ← ALL agent-executable (Metis mandate)
    - `npm test auth` exits 0
    - `curl localhost:3000/healthz` returns 200
  - QA scenarios:
    - Happy: ...  Failure: ...
```

`- [ ] N.` (decimal id) and `- [ ] F<n>.` (final-verifier) rows are the only rows counted as work.
Prose bullets don't count — same rule omo's `plan-checklist.ts` uses, because a looser grammar
makes the executor hallucinate or skip tasks.

---

## 5. State, checkpoints, resume — `<repo>/.zcode/state/<slug>.json`

Durable execution (the LangChain production requirement). Everything needed to resume lives on disk:

```jsonc
{
  "slug": "...",
  "plan_path": ".zcode/plans/<slug>.md",
  "plan_sha256": "...",
  "phase": "consult|plan|review|execute|verify|final|remediate|done|audited|abandoned",
  "started_at": "...",
  "updated_at": "...",
  "active_executor_session": null,
  "todos": {
    "1": {"status": "pending|in_flight|done|failed", "started_at": null, "completed_at": null, "attempts": 0, "executor_session": null},
    ...
  },
  "file_locks": { "src/auth.ts": {"todo": 1, "session": "...", "acquired_at": "..."} },
  "in_flight_dispatches": 0,
  "inherited_wisdom": [".zcode/notepads/<slug>/1.md", "..."],   // passed forward
  "review": {"round": 0, "verdict": null, "history": []},
  "checkpoints": [
    {"at": "...", "phase": "execute", "completed_todo": 2, "note": "..."}
  ]
}
```

**Resume contract:** on crash or `/orchestrate resume <slug>`, the orchestrator reads
`state.json`, finds the last checkpoint, and resumes from there — not from scratch.
Checkpoints are written after each todo completes and after each phase transition.

---

## 6. Hooks — the enforcement layer

All in `~/.zcode/cli/config.json` → `hooks.events.*` with `hooks.enabled: true`.
Each hook is a small script that reads `state.json` + the tool-call payload and returns
exit `0` (pass) or `2` (hard block) with a JSON reason. Hooks are **NO-OP unless an orchestration
run is active** (`<cwd>/.zcode/state/*.json` with a non-terminal phase, not stale per
`ZODYSSEY_STALE_HOURS`); normal ZCode editing is completely unaffected otherwise.

Terminal phases (`done`, `audited`, `abandoned`) **disarm** the hooks — see §6.1 below for why
`remediate` exists as a re-arming escape hatch for the post-`done` consult gate.

| Hook event | Matcher | What it enforces |
|---|---|---|
| `PreToolUse` | `Write\|Edit\|ApplyPatch\|MultiEdit\|NotebookEdit` | **Review gate:** edits to product code require `review.verdict == OKAY`. Writes to `.zcode/plans/` and `.zcode/notepads/` are always allowed (bookkeeping); `.zcode/state/` is NOT bookkeeping and goes through the gate (so an agent can't self-authorize a verdict). |
| `PreToolUse` | `Write\|Edit\|…` | **Scope boundary (2026-08-02):** once OKAY, an executor may ONLY edit files in the plan's declared `Files:` union. The hook reads the plan at edit time, extracts the declared set, and BLOCKS anything outside it + bookkeeping. Fails CLOSED: if the plan is unreadable OR the declared set is empty, every product-code edit is blocked (no plan = no edits). Runs in all phases except `final`. |
| `PreToolUse` | `Write\|Edit\|…` | **File lock:** the target path must not be locked by another in-flight todo (per-owner map keyed by `agent_id \|\| session_id`). On success the edit acquires/refreshes the lock. |
| `PreToolUse` | `Bash` | **Bash write-gate:** write-capable commands (redirection, `sed -i`, `git apply/restore/commit`, interpreter `-e`/`--eval`, script indirection, etc.) require `review.verdict == OKAY`. Read-only Bash is always allowed. An exact-argv trusted-script allowlist lets the recorder scripts (`record-review.mjs`, `set-phase.mjs`, …) run pre-OKAY without a shell-metachar escape hatch. The documented escape hatch `ZODYSSEY_UNGATE_BASH=1` opens this gate entirely — recorded per-call into `.zcode/state/<slug>.ungated.jsonl` and surfaced as `ungated_bash_calls` (a witness beside the exit, never a second opinion in front of it). |
| `PreToolUse` | `Task\|Agent` | **Phase gate:** executors (`sisyphus-junior`) dispatch only in `execute`/`verify`/`final`/`remediate`; planners (`prometheus`) in `plan`/`review`/`consult`; read-only research agents (`explore`/`librarian`/`oracle`/`metis`/`momus`) anywhere. |
| `PreToolUse` | `Task\|Agent` | **Parallel cap:** in-flight dispatches `< cap` (default 4, `ZODYSSEY_PARALLEL_CAP`), else block. The hook maintains the count in a ledger file (`.zcode/state/<slug>.inflight.json`) because the model can't bump state between tool calls in one turn. |
| `PreToolUse` | `Task\|Agent` | **Nonce minting:** when it observes a review-bearing dispatch (`momus`→review, `code-reviewer`→F2, `oracle`→F4), the hook mints a one-time nonce into the matching state lane — only for the exact declared minter type per lane (`momus`/`zodyssey:momus`; `code-reviewer`/`feature-dev:code-reviewer`; `oracle`/`zodyssey:oracle`); a lookalike namespace (`evil:momus`, `someplugin:oracle`) still dispatches but mints nothing and warns on stderr. The recorder script must present it to place a valid artifact — this is what makes the OKAY/F2/F4 evidence non-forgeable. |
| `PreToolUse` | `Skill` / `mcp__*` | **Capability recording (observed):** best-effort appends real Skill/MCP calls to `state.capabilities` with `observed:true`, converting "TDD was used" from a self-claim into an observation. |
| `Stop` | (all) | **Checkpoint + lock release:** capture phase + progress; reap orphaned locks. |

**Key safety properties:** (a) hooks are *opt-in* — they only act when a run is active, so normal
host editing is never affected; (b) the review gate + scope boundary together implement the
scope-isolation fix — the gate says "the plan is good enough to execute," the scope
boundary says "execution stays inside the plan's declared files" (both are needed; neither alone
is sufficient); (c) the scope boundary fails closed — an unreadable or empty plan refuses all
product-code edits rather than allowing everything.

### 6.1 The post-`done` consult gate and the `remediate` phase

After a run reaches `done`, the user may invoke `/orchestrate-consult <slug>` for an **independent
external audit**: a *separate* Claude Code process (fresh context, different model) reviews the
plan + full git diff and returns ACCEPT or REJECT+gaps. This is stronger than any in-session
reviewer because the auditor cannot inherit the run's assumptions (empirically: on the arch-01 run
it caught a Jest-vs-`node --test` mismatch that broke the run's own `npm test` acceptance criterion
but that the in-session final-wave had marked `pass`). Implementation: `scripts/consult.mjs`
(§12 item 14) + `references/auditor-prompt.md`; the full remediation loop is documented in the
odyssey skill's "External consult/audit gate" section.

**The audit tip is frozen to a concrete SHA.** `consult.mjs` captures `HEAD` as `audit_head` once
at gather time, gathers the diff against the frozen `run_start_sha..audit_head` range, and injects
an `AUDIT RANGE` section into the prompt instructing the auditor to reason about that range — not
live HEAD, which may advance past the run's work during the multi-minute external call (a merge or
branch switch mid-audit is what made round 3 of `correction-signal-capture` see a "stale" diff).
Each `consult.history` entry records both SHAs for traceability, and a warning is emitted if HEAD
moved during the round (the verdict still covers the frozen range; the warning tells a human to
re-run after the repo settles). The auditor itself is spawned read-only (`--permission-mode plan`,
empty `--allowedTools`), so its verdict rests on the supplied diff + plan, not on live filesystem
mutation.

**The honest limitation that creates `remediate`:** because `done`/`audited` are terminal phases,
the enforcement hooks (review gate, scope boundary, parallel cap, phase gate) are **disarmed**
during consult-driven remediation. To keep the scope boundary governing gap-fix edits, the
conductor sets `phase: "remediate"` (a member of `EXEC_PHASES`) before dispatching fixes — this
re-arms the review gate + scope boundary + parallel cap — and restores `done` before re-auditing.
`remediate` is not a pipeline phase in the §3 state machine; it is an enforcement-arming escape
hatch that exists specifically so post-`done` edits don't escape the isolation layer that
motivated §6 in the first place.

---

## 7. Effort scaling — the anti-over-engineering guardrail (enforced)

This is the Anthropic lesson made concrete. A `UserPromptSubmit` hook (or the skill's first step)
classifies the request and **refuses to enter the full pipeline for trivial work**:

| Class | Signal | Pipeline | Hook action |
|---|---|---|---|
| **Trivial** | single-file, <20 line change, obvious fix | none — just do it | blocks `/orchestrate`, tells user to ask normally |
| **Standard** | bounded, clear deliverable | consult → plan → review → execute → verify (single executor) | allows |
| **Architecture** | multi-system, ambiguous, cross-cutting | full pipeline + team mode + oracle | allows |

The trivial gate is the single most important reliability guard: it prevents the documented
failure of "spawn 50 subagents for a one-line fix." omo leaves this to the user. **As of v0.1.1
this is code-enforced** by a `UserPromptSubmit` hook (`hooks/user-prompt-submit.mjs`) that flags
trivial-shaped prompts (typo / rename / spelling keywords, short length, no file list) and warns
that orchestration is overkill. The hook is warning-only (exit 0 always); override with the
phrase "force orchestrate" in the prompt.

---

## 8. Model routing — honest design

omo's `task(category=)` is a subtle thing: **it routes models, not agents** — category always
dispatches Sisyphus-Junior; only the model + a prompt-append differ. We replicate this honestly:

- v1 has **one connected model** (GLM-5.2 via Z.ai coding plan). So "routing" is really
  **effort/variant selection** within that model (reasoning on/off, effort level).
- The `category` field on a todo (`quick` | `deep` | `visual-engineering`) maps to a
  `reasoning` + `effort` setting on the dispatch, recorded in `state.json`.
- **The design leaves the door open** for multi-provider routing: when a second provider is wired
  (Claude/OpenAI/Gemini are configured in the host's other tools), the same `category` lookup
  table extends to pick a provider+model, omo-style. No rewrite needed — just populate the table.

This avoids over-claiming. We don't pretend to route across models we don't have; we structure
the code so that day is a config change, not an architecture change.

---

## 9. Team mode — parallel multi-executor

Opt-in via `intent: architecture` or an explicit flag. Mirrors omo's `team-core` mechanics,
adapted to ZCode primitives:

- **Members** = executor sub-agents (a `sisyphus-junior`-equivalent we'll port), each in its own
  `Task` dispatch with an isolated context.
- **Mailbox** = `<repo>/.zcode/teams/<runId>/inboxes/<member>/<uuid>.json`, atomic writes,
  `.delivering-<uuid>.json` reservation, `processed/` on success. Fire-and-forget (no sync reply wait).
- **Tasklist** = `<repo>/.zcode/teams/<runId>/tasks/<id>.json` with `claimTask` under a per-task
  file lock, `canClaim` dependency check, 5-min stale-lock reaping.
- **Worktrees** = optional; `git worktree add --detach` per member so parallel edits don't collide
  even at the VCS level. (Doubles as the file-lock backstop.)
- **Bounds (config, enforced):** ≤8 members, ≤4 in flight, 32KB/msg, 10K msgs/run, 120 min wall clock.
- **Eligibility (enforced):** read-only agents (oracle, librarian, explore, metis, momus,
  multimodal-looker) **cannot be members** — they can't write mailbox state. Only executors can.

Team mode is the highest-risk v1 component (concurrency is hard). It's behind a flag and the
single-executor path remains the default.

---

## 10. Memory

Three tiers, scoped to the orchestration run (not global — avoids the "memory problems, not
communication problems" failure MongoDB's team warns about):

1. **Plan file** — long-term, the contract. Survives the run; version-controllable.
2. **Notepads** (`<repo>/.zcode/notepads/<slug>/<todo>.md`) — per-task findings + "inherited wisdom"
   forwarded to subsequent todos. The Anthropic "compress completed phases into memory" pattern.
3. **Checkpoint state** (`state.json`) — resume + lock/phase bookkeeping. Ephemeral structure,
   durable content.

Cross-run memory (lessons that survive a single task) is **deferred** — it's the natural
extension once we have an eval harness telling us which lessons are worth keeping.

---

## 11. Observability & evaluation

- **Every run produces:** the plan file, state.json, per-todo notepads, a run log.
- **Telemetry is two-lane:** terminal-phase scorecards append to `eval/results.jsonl` (real
  runs) or `eval/results.synthetic.jsonl` (runs that declared `ZODYSSEY_EVAL_LANE=synthetic` at
  source — the fixture/harness's declaration, never guessed from slugs). Same format, same
  rolling cap; consumers of the operator lane get real runs only with zero filter conventions.
- **End-state evaluation** (Anthropic's method): because paths are non-deterministic, we judge
  whether the *final state* satisfies the success criteria — not the sequence of steps.
- **LLM-as-judge stub:** a `momus`-style review of the completed work against `Success criteria`,
  scored 0.0–1.0 on factual accuracy / scope fidelity / verification rigor. Start with ~20-query
  eval set (Anthropic's "small samples are enough").
- **Tracing:** the run log records every dispatch, hook decision, lock acquire/release, and
  checkpoint — enough to diagnose whether a failure was a bad plan, a bad dispatch, or a tool failure.

---

## 12. What we build — component manifest (updated 2026-08-02)

| # | Component | Location | Status |
|---|---|---|---|
| 1 | `/orchestrate` slash command | `~/.zcode/commands/orchestrate.md` | done |
| 2 | `odyssey` skill (conductor prompt + state machine) | plugin cache: `~/.zcode/cli/plugins/cache/<marketplace>/zodyssey/<version>/skills/odyssey/SKILL.md` (dispatchable as `zodyssey:odyssey` since v0.3.0) | done |
| 3 | `prometheus` planner sub-agent | `~/.zcode/agents/prometheus.md` | done |
| 4 | Plan scaffold + task-brief writer | `scripts/scaffold.mjs` | done |
| 5 | Plan parser + acceptance-criteria lint | `scripts/parse-plan.mjs` (+ `parse-plan.test.mjs`) | done |
| 6 | Enforcement hooks (PreToolUse + PostToolUse + Stop + UserPromptSubmit) | `hooks/{pre-tool,post-tool,stop,user-prompt-submit}.mjs` + `config.json` | done |
| 7 | Effort-scaling classifier (trivial/standard/arch) | `hooks/user-prompt-submit.mjs` (trivial-shape detection, warning-only) + conductor prompt | done |
| 8 | Executor sub-agent (sisyphus-jr port) | `~/.zcode/agents/sisyphus-junior.md` | done |
| 9 | Verify + Final-wave evidence scripts | `scripts/{record-verify,record-final-wave}.mjs` | done |
| 10 | Team mode (mailbox + tasklist + worktree) | `scripts/team/*.mjs` | deferred (v2) |
| 11 | Model-routing config table | `scripts/models.json` | deferred (v2) |
| 12 | **Eval harness** (run-report + record-todo + record-capability + **harness + judge + resolve-capabilities + recall-outcomes** + 18 seed tasks + 4 fixtures + results.jsonl + results.synthetic.jsonl lane + judged.jsonl) | `scripts/{run-report,record-todo,record-capability,harness,judge,resolve-capabilities,recall-outcomes,status}.mjs` + `eval/` | **done** |
| 13 | AGENTS.md rules | `~/.zcode/AGENTS.md` | done |
| 14 | **External consult/audit gate** (fail-closed, secret-redacting, scope-aware, generated-path-filtered) | `scripts/consult.mjs` + `references/auditor-prompt.md` | done |
| 15 | Env overrides (`ZODYSSEY_PARALLEL_CAP`, `ZODYSSEY_STALE_HOURS`, `CLAUDE_CLI`) | documented in SKILL.md; consumed by hooks + consult | done |
| 16 | **Review-gate evidence chain** (nonce → momus-artifact → plan-sha → lint → verdict) | `scripts/{record-momus-artifact,record-review}.mjs` + hook nonce-minting | done |
| 17 | **Phase-transition DAG** (prevents the set-phase master-bypass) | `scripts/set-phase.mjs` | done |
| 18 | **Capability reconciliation** (detects agent-body-vs-grant mismatches) | `scripts/resolve-capabilities.mjs` → `.zcode/capabilities.lock.json` | done |
| 19 | **Cross-run memory** (write on terminal transition + recall at consult) | `set-phase.mjs` (write) + `scripts/recall-outcomes.mjs` (read) | done |
| 20 | **Scope-isolation boundary** (post-OKAY executors edit only declared `Files:`; fail-closed on unreadable/empty plan) | `hooks/pre-tool.mjs` isEdit branch + `scripts/parse-plan.mjs --lint` (rejects empty Files:) | done (2026-08-02) |
| 21 | Dashboard renderer | `scripts/dashboard.mjs` | TODO (data exists; renderer unbuilt) |

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Hooks break normal editing | Hooks are no-ops unless an active `state.json` exists; tested first with a dry-run flag |
| Effort-scaling wrong → over-engineering simple tasks | Trivial-gate hook; default to "not orchestrate" |
| Team-mode concurrency bugs | Phase-2, flag-gated, single-executor stays default; worktrees as backstop |
| GLM-5.2 follows the plan contract imperfectly | Hard gates catch the big violations (no plan, no OKAY, file collision); Metis + Momus prompts catch the rest |
| Review loop never terminates | Max 3 rounds (bounded by convention: the conductor increments `state.review.round` and surfaces to the user at ≥3). **v1: prompt-enforced, not hook-enforced** — the hook checks `review.verdict` but does not yet read `review.round`; a future hook can make the cap hard. omo's *unbounded* loop is the footgun we avoid either way. |
| Plan format drifts | The parser + Momus both assert section order; scaffold writes the canonical template |

---

## 14. Open questions for build kickoff

1. **Executor model effort** — default `sisyphus-junior` dispatches to reasoning-on/medium-effort GLM-5.2?
   Or reasoning-off for speed on `quick` tasks?
2. **Hook implementation language** — `bash` (portable, no deps) vs `node` (richer JSON handling)?
   Leaning bash for the trivial-pass/trivial-block hooks, node for the lock/parallel counters.
3. **Team-mode in v1 or v2?** The design stages it in v2, but if you want it sooner we can pull it
   forward — at the cost of more concurrency-risk in the first cut.
4. **Eval set** — do you have ~5–10 real tasks to seed the eval harness, or should we synthesize them?

---

## 15. Sources

- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
- [LangChain — Choosing the Right Multi-Agent Architecture](https://www.langchain.com/blog/choosing-the-right-multi-agent-architecture)
- [LangChain — How and When to Build Multi-Agent Systems](https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems)
- [arXiv — Context Engineering for Multi-Agent LLM Code Assistants](https://arxiv.org/html/2508.08322v1)
- [TrueFoundry — Best Multi-agent Orchestration Frameworks in 2026](https://www.truefoundry.com/blog/multi-agent-orchestration-frameworks)
- [Galileo — AutoGen vs CrewAI vs LangGraph vs OpenAI Agents](https://galileo.ai/blog/autogen-vs-crewai-vs-langgraph-vs-openai-agents-framework)
- omo source analysis (this session) — `code-yeongyu/oh-my-openagent` `dev` branch
