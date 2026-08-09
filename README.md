# ZOdyssey

> A hybrid-enforced multi-agent orchestration pipeline. The pattern is portable; the reference implementation targets [ZCode](https://z.ai).

**What if the "review the plan before executing" step in your agent pipeline was a hard gate, not a suggestion?**

That is the core idea. Most multi-agent orchestrators (including the excellent [**omo**](https://github.com/code-yeongyu/oh-my-openagent), which this project learned from) implement the review/approval gate as a prompt convention — the model is *told* not to edit before review passes, but nothing actually stops it. ZOdyssey code-enforces that gate with a hook, and adds a scope-isolation boundary so an executor can only touch files the plan declared. The full pipeline (prime → triage → consult → plan → review → execute → verify → final-wave) is the same shape omo and others use; the enforcement layer is the delta.

---

## Two ways to use this repo

### 1. You just want the ideas (any harness)

Read [`docs/DESIGN.md`](docs/DESIGN.md) — it explains the hybrid-enforcement principle, the plan-file contract, the state/resume model, and every load-bearing decision with the research it is grounded in. Then read [`docs/ADAPT.md`](docs/ADAPT.md) for a concrete guide to porting the enforcement delta onto omo or any orchestrator that supports hooks (Claude Code, ZCode, Cursor, etc.). The source of the gate itself ([`skills/odyssey/hooks/pre-tool.mjs`](skills/odyssey/hooks/pre-tool.mjs)) is the reference implementation to crib from.

**If you are already an omo user, start there** — omo gives you the full pipeline, the agent cast, and the ergonomics. Then layer on the 4 enforcement hooks from [`docs/ADAPT.md`](docs/ADAPT.md). That is the highest-leverage path for most people.

### 2. You are on ZCode and want it ready-to-run

Install the reference implementation:

```bash
git clone https://github.com/amartinawi/zodyssey.git
cd zodyssey
node scripts/install.mjs            # copies into ~/.zcode/, registers hooks
```

Then start a new ZCode session and run, in any repo:

```
/orchestrate <your task>
```

Full install/troubleshooting/config in [`docs/INSTALL.md`](docs/INSTALL.md).

---

## The pipeline

```
  -1  PRIME        prompt-master refines the raw task into a sharp brief
   0  TRIAGE       trivial → just answer; standard → single-track; architecture → full pipeline
   1  CONSULT      metis classifies intent, surfaces questions/risks
   2  PLAN         prometheus writes <repo>/.zcode/plans/<slug>.md  (cannot edit product code)
   3  REVIEW       momus returns OKAY | REJECT + blockers   ←  THE ENFORCED GATE
   4  EXECUTE      sisyphus-junior per todo, parallel-by-default, scope-locked to the plan's Files:
   5  VERIFY       run each todo's executable acceptance criteria
   6  FINAL WAVE   F1 plan-compliance · F2 code-quality · F3 manual-QA · F4 scope-fidelity
```

The orchestrator (main agent) drives this; the cast of sub-agents (`metis`, `prometheus`, `momus`, `sisyphus-junior`, plus read-only `explore`/`librarian`/`oracle`) does the work. The enforcement hooks in `~/.zcode/cli/config.json` hard-block the invariants.

## What the hooks enforce (the delta)

| Invariant | How omo does it | How ZOdyssey does it |
|---|---|---|
| **No edits before plan passes review** | prompt convention | hook reads `state.json`; blocks the Edit |
| **Executor stays in declared scope** | not enforced | hook parses the plan's `Files:` union; blocks edits outside it. **Fails closed** on unreadable/empty plan |
| **No edit collisions between agents** | not enforced | hook checks a file-lock ledger |
| **Parallel dispatch within bounds** | not enforced | hook counts in-flight Tasks; blocks beyond cap (default 4) |
| **Bash write-escape before review** | n/a | hook gates write-capable Bash (`sed -i`, `>`, `git apply`, …) the same as Edit. Secure by default; `ZODYSSEY_UNGATE_BASH=1` disables |

All hooks are **NO-OP unless an orchestration run is active**. Normal ZCode editing is never affected. A run is "active" only between `/orchestrate` and reaching a terminal phase (`done`/`audited`/`abandoned`), and only inside the repo where you invoked it.

## The external consult gate (the strongest check)

After a run reaches `done`, `/orchestrate-consult <slug>` hands the plan + the full git diff to a **separate Claude CLI process** (fresh context, independent model) for an ACCEPT/REJECT audit. It cannot inherit the run's assumptions, so it catches things in-session reviewers miss. On REJECT, ZOdyssey sets `phase: remediate` (re-arming the gates) and loops until ACCEPT. See [`docs/DESIGN.md` §6.1](docs/DESIGN.md).

## Requirements

- **[ZCode](https://z.ai)** (for the ready-to-run reference implementation) — the hooks, commands, and sub-agents are ZCode primitives.
- **Node 18+** (for the hooks + scripts, all ESM `.mjs`).
- **A coding model that follows multi-step instructions** — developed against GLM-5.2 via the Z.ai coding plan. Claude / GPT / Gemini class models work too if your harness can dispatch them as sub-agents.
- **Optional:** [`superpowers`](https://github.com/obra/superpowers) for the brainstorming/TDD/debugging skills the conductor reaches for, and [codegraph](https://github.com/colbymchenry/codegraph) for the explore step.

## What it is NOT

- **Not a replacement for normal agent operation.** It is an opt-in mode entered via `/orchestrate`. Everything else is handled directly.
- **Not multi-model in v1.** The `category` routing field is designed in (see [DESIGN.md §8](docs/DESIGN.md)) but routing reduces to effort/variant selection within one connected model until you wire a second provider.
- **Not harness-agnostic in v1.** The reference implementation targets ZCode. The *pattern* is portable — see [`docs/ADAPT.md`](docs/ADAPT.md).
- **Not a team-mode orchestrator yet.** Parallel multi-executor (mailbox + worktrees) is designed but deferred to v2. v1 is single-executor-per-todo, dispatched in parallel waves.

## Project layout

```
zodyssey/
├── skills/odyssey/          # the conductor: SKILL.md + hooks/ + scripts/ + references/
│   ├── hooks/pre-tool.mjs   #  THE enforcement gate (the delta)
│   └── scripts/             # scaffold, parse-plan, set-phase, consult, record-*, harness, judge…
├── agents/                  # metis, prometheus, momus, sisyphus-junior, explore, librarian, oracle, multimodal-looker
├── commands/                # /orchestrate, /orchestrate-consult
├── docs/
│   ├── DESIGN.md            # the full design doc — read this first
│   ├── ADAPT.md             # porting the enforcement delta onto omo / any harness
│   ├── INSTALL.md           # detailed install + config + troubleshooting
│   └── ECOSYSTEM_GRAPH.md, MEASUREMENT.md, RESUME.md, deep-audit-prompt.md
├── examples/                # one anonymized example run
└── scripts/install.mjs      # the installer
```

## Provenance

ZOdyssey is a synthesis of published multi-agent systems research, not an invention. Every load-bearing decision maps to a finding from production systems — the [Anthropic multi-agent research post](https://www.anthropic.com/engineering/multi-agent-research-system), the [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) essay, [LangChain's multi-agent architecture analysis](https://www.langchain.com/blog/choosing-the-right-multi-agent-architecture), the [arXiv context-engineering paper](https://arxiv.org/html/2508.08322v1), and the [omo](https://github.com/code-yeongyu/oh-my-openagent) source (the pipeline shape and the agent cast are modeled on omo; the enforcement layer is the differentiator). Full citations in [DESIGN.md §0 + §15](docs/DESIGN.md).

## License

[MIT](LICENSE) — take it, adapt it, use it. If the enforcement-gate pattern makes your orchestrator more reliable, that is the whole point.
