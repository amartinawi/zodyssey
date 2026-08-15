# ZCode Sub-Agents (ported from oh-my-openagent)

User-scope sub-agents in `~/.zcode/agents/`. Auto-discovered by ZCode in every
workspace. The main ZCode agent invokes them via the built-in `Task` tool
(`subagent_type: "zodyssey:<name>"` — these agents ship under the `zodyssey:`
plugin namespace, so the dispatch identifier carries the `zodyssey:` prefix even
though each agent's own `name:` frontmatter stays bare; the namespace is added
by the plugin loader, not the file).

## Agents

| Agent | Role | Tools (ZCode) | omo source |
|---|---|---|---|
| `zodyssey:explore` | Read-only codebase search ("where is X?") | Read, Glob, Grep, Bash | `agents/explore.ts` |
| `zodyssey:librarian` | Docs / OSS research with citations + permalinks | Read, Glob, Grep, Bash, WebSearch, WebFetch, Context7 | `agents/librarian.ts` |
| `zodyssey:oracle` | Strategic technical advisor (architecture, hard debug) | Read, Glob, Grep, Bash, WebSearch, WebFetch | `agents/oracle.ts` (default/non-GPT variant) |
| `zodyssey:metis` | Pre-planning consultant (intent, ambiguity, slop-traps) | Read, Glob, Grep, Bash | `agents/metis.ts` (non-Kimi variant) |
| `zodyssey:momus` | Plan reviewer (executable? references valid? QA present?) | Read, Glob, Grep, Bash | `agents/momus.ts` (default/non-GPT variant) |
| `zodyssey:multimodal-looker` | Media/file interpretation (PDFs, images, diagrams) | Read | `agents/multimodal-looker.ts` |

All use `model: inherit` — they run on whatever model the orchestrator is using
(currently the Z.ai coding plan, GLM-5.2).

## How they were ported

Each `.md` is a faithful port of the corresponding oh-my-openagent agent. The
mapping from omo's runtime to ZCode:

| omo concept | ZCode equivalent |
|---|---|
| `AgentConfig.prompt` (code string) | Markdown body after frontmatter |
| `description` / `temperature` | frontmatter `description` (temp left to default — ZCode frontmatter has no temp field) |
| `createAgentToolRestrictions([deny...])` | frontmatter `tools:` allowlist (ZCode `tools:` is an allowlist, so we list the equivalent ZCode tools the agent MAY use) |
| `createAgentToolAllowlist([allow...])` | frontmatter `tools:` with just those tools |
| `call_omo_agent(subagent_type=...)` / `task(...)` | the agent **cannot** spawn sub-agents in ZCode, so `zodyssey:metis` instead *recommends* dispatch in its output ("ORCHESTRATOR: dispatch `zodyssey:explore`..."); the orchestrator executes it |
| `.omo/plans/*.md` (omo plan convention) | generalized to "the plan path the orchestrator passes" (default `.zcode/plans/*.md`) |
| model fallback chains (per-agent) | NOT ported — single `inherit` model |

## What did NOT port (the orchestration gap)

These omo features have no ZCode equivalent and are intentionally absent:

- **`task()` / `call_omo_agent()` tools** — omo's delegation primitives with
  category→model routing. In ZCode the main agent decides dispatch via `Task`.
- **Plan-file handoff** (`@plan` → `/start-work`) — no shared plan contract yet.
- **Reviewer gating** (Momus/Oracle returning OKAY/REJECT that blocks Atlas) —
  advisory only in ZCode; nothing forces the orchestrator to obey.
- **Per-agent model fallback chains** — each agent runs on the inherited model.
- **Team mode** (tmux lead+members, mailbox, shared tasklist).

**The orchestration layer is what we will build next**, natively in ZCode, on
top of these worker agents. See the "Next step" section below.

## Quick test

After writing these, restart ZCode (or open a new session) and check
**Settings → Subagents** — all eight should appear. Then try a one-liner in any
workspace, e.g.:

> Use the `zodyssey:explore` sub-agent to find where MCP servers are configured in this
> codebase.

The main agent should dispatch `zodyssey:explore` via `Task` and return its structured
`<results>` block.

## Provenance

Source: https://github.com/code-yeongyu/oh-my-openagent (`dev` branch)
Files: `packages/omo-opencode/src/agents/*.ts`, `packages/omo-opencode/src/shared/permission-compat.ts`
License: see omo repo (`LICENSE.md`).
Ported: 2026-07-31. Prompts transcribed faithfully; only omo-runtime-specific
references were adapted (noted per-file).

---

## Next step: a native ZCode orchestration system

The workers above are the cast. The missing piece is the **conductor + pipeline**
omo provides. A ZCode-native design (to be built):

```
User request
   │
   ▼
[Metis]  ── classify intent, surface questions/risks/directives
   │       (recommends dispatch of zodyssey:explore / zodyssey:librarian / zodyssey:oracle as needed)
   ▼
[Planner] ── produce  .zcode/plans/<slug>.md   (Must/Must-Not-Have, tasks, QA)
   │
   ▼
[Momus]   ── review plan  →  OKAY | REJECT (≤3 blockers)  →  loop back if REJECT
   │
   ▼
[Orchestrator = main ZCode agent] ── read plan, dispatch workers in parallel:
   │                                   • zodyssey:explore / zodyssey:librarian (research)
   │                                   • zodyssey:oracle (advice on hard steps)
   │                                   • executor sub-agents (implementation)
   ▼
[Verification] ── run each task's executable QA (commands, assertions, evidence)
   │
   ▼
Done
```

Implementation options to decide before building:
1. **Enforcement mechanism** — ZCode has no `task()` tool, so gating must be
   *convention-based* (a slash command + AGENTS.md rules the main agent follows)
   or *file-based* (plan files + a hook that blocks execution on REJECT).
2. **Where the conductor lives** — the main ZCode agent itself (simplest, no
   new infra) vs. a dedicated "atlas" sub-agent that the main agent delegates to.
3. **Plan file format** — markdown schema for `.zcode/plans/*.md` that Momus
   validates and the orchestrator executes.

These are open design questions — to be settled when we build the system.
