# ZOdyssey Ecosystem — The Map

> One-page reference for everything we built: the layers, the runtime flow, where enforcement
> bites, and how capabilities route. Read this to orient; read `DESIGN.md` for rationale,
> the conductor's operating instructions at
> `~/.zcode/cli/plugins/cache/local/zodyssey/<version>/skills/odyssey/SKILL.md`
> (dispatchable as `zodyssey:odyssey` since v0.3.0), and `references/capabilities.md` for the
> per-activity routing table.
>
> Snapshot (2026-08-02): **22 MCPs (5 routed, 3 should-route-next, 14 deliberately out-of-pipeline)
> · 9 plugins · 8 user sub-agents (sub-agents do NOT inherit Skill/MCP — verified) · 48 user skills
> · 3 enforcement hooks (PreToolUse + PostToolUse + Stop) · 1 slash command · 17 scripts · 4 eval
> fixtures · 18 seed tasks · first measured results (pipeline +0.25 on architecture vs baseline).**
>
> **For the full resume context, read `RESUME.md`.** This file is the map; RESUME.md is the state.

---

## 1. Layered architecture (what sits on top of what)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER                                             │
│         "/orchestrate <task>"  ·  normal chat (untouched)                │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
          ┌──────────────────────────▼──────────────────────────┐
          │  ENTRY + CONDUCTOR  (the brain of ZOdyssey)          │
          │                                                    │
          │   /orchestrate ──► odyssey skill (conductor)        │
          │   (commands/orchestrate.md under the plugin cache)  │
          │   (skills/odyssey/SKILL.md — dispatchable as        │
          │    zodyssey:odyssey)                                 │
          │   · 7-phase state machine                           │
          │   · capability routing (consults capabilities.md)   │
          │   · parallel-by-default dispatch                    │
          └───────────┬────────────────────────────┬───────────┘
                      │                            │
        ┌─────────────▼───────────┐   ┌────────────▼────────────┐
        │  THE CAST (8 agents)    │   │  ENFORCEMENT (hard)      │
        │  ~/.zcode/agents/       │   │  ~/.zcode/cli/config.json│
        │                         │   │                          │
        │  consult  : metis       │   │  PreToolUse hook ────────┼─► blocks:
        │  plan     : prometheus  │   │  (Write|Edit|Task|Agent) │   · edit before
        │  review   : momus       │   │                          │     plan-OKAY
        │  research : explore     │   │  Stop hook ──────────────┼─► checkpoint
        │            librarian    │   │                          │   for resume
        │  advice   : oracle      │   │  NO-OP unless a run is   │
        │  execute  : sisyphus-jr │   │  active (normal editing  │
        │  media    : multimodal- │   │  is never affected)      │
        │            looker       │   └──────────────────────────┘
        └─────────────┬───────────┘
                      │ dispatches via Task(subagent_type=…)
          ┌───────────▼───────────────────────────────────────────┐
          │  CAPABILITY SURFACE (what the cast reaches for)        │
          │                                                       │
          │  Skills (62 total):                                   │
          │   · ZOdyssey : odyssey (conductor)                    │
          │   · superpowers (14): TDD, systematic-debugging,      │
          │     writing/executing-plans, brainstorming, premortem,│
          │     verification-before-completion, dispatching-      │
          │     parallel-agents, using-git-worktrees, code-review │
          │   · audit (4): source-command-audit-{code,docs,test,  │
          │     full}, review-agent, merge-ready                  │
          │   · domain (44): aws-* (13), SEO/OpenSEO (8),         │
          │     higgsfield (5), impeccable, imagegen, …           │
          │                                                       │
          │  MCPs (22):                                           │
          │   · reasoning : sequential-thinking  ◄ NEW            │
          │   · memory    : memory (knowledge graph) ◄ NEW        │
          │   · codegraph : codegraph_explore (per-repo index)    │
          │   · docs      : Context7                              │
          │   · web       : web-search-prime, web-reader, zread   │
          │   · git/pr    : github, mcp-server-git                │
          │   · browser   : chrome-devtools, playwright           │
          │   · aws (5)   : aws-knowledge, -pricing, -cloudwatch, │
          │     aws-mcp, …                                        │
          │   · zai       : zai-mcp-server (vision)               │
          │   · misc      : notebooklm, openseo, ruflo, …         │
          │                                                       │
          │  Plugins (9):                                         │
          │   · claude-security ◄ NEW (7 scan agents + verified   │
          │     patches — the F2 security gate)                   │
          │   · feature-dev (code-architect/explorer/reviewer)    │
          │   · code-review, superpowers, context7, playwright,   │
          │     sourcegraph, skill-creator, pyright-lsp           │
          └───────────────────────────────────────────────────────┘
```

**Key invariant:** everything above the line is *opt-in*. Below `/orchestrate`, the cast + enforcement activate. Without it, ZCode is plain — the hooks are no-ops, no agent auto-runs.

---

## 2. The runtime flow (one orchestration run, end to end)

```
                        /orchestrate <task>
                               │
                               ▼
                   ┌────────────────────────┐
                   │ 0. TRIAGE (conductor)   │  trivial? ─► "just ask normally" + STOP
                   │    intent: trivial /    │  standard  ─► continue
                   │    standard /           │  architecture ─► continue (+ Oracle, v2 team)
                   │    architecture         │
                   └───────────┬─────────────┘
                               │
                   ┌───────────▼─────────────┐
                   │ 1. CONSULT  metis       │  ◄── reads memory MCP first (prior lessons)
                   │   + codegraph probe     │      runs premortem for arch/mid-sized
                   │   + premortem           │      surfaces user-questions ─► WAIT for user
                   └───────────┬─────────────┘
                               │  (directives for planner)
                   ┌───────────▼─────────────┐
                   │ 2. PLAN     prometheus  │  ◄── loads writing-plans skill
                   │   + code-architect      │      fans out explore/librarian/codegraph
                   │   + explore/librarian   │      writes  .zcode/plans/<slug>.md
                   │                         │            .zcode/state/<slug>.json
                   └───────────┬─────────────┘
                               │
                   ┌───────────▼─────────────┐
                   │ 3. REVIEW   momus  ◄──── │  GATE. [OKAY] | [REJECT ≤3 blockers]
                   │   (+ oracle, if arch)    │  REJECT ─► revise ─► re-review (≤3 rounds)
                   │                         │  writes verdict to state.json
                   └───────────┬─────────────┘
                               │ OKAY  ── hook now ALLOWS edits
                   ┌───────────▼─────────────┐
                   │ 4. EXECUTE  sisyphus-jr │  ◄── TDD skill (non-negotiable for code)
                   │   (parallel-by-default) │      systematic-debugging on any failure
                   │   wave dispatch ≤4      │      sequentialthinking on hard problems
                   │   ◄ HOOK: parallel cap  │      ticks  - [ ] → - [x]  per todo
                   │   ◄ HOOK: file locks    │      notepad per todo ─► inherited wisdom
                   └───────────┬─────────────┘
                               │
                   ┌───────────▼─────────────┐
                   │ 5. VERIFY   conductor   │  runs each todo's acceptance commands
                   │                         │  fail ─► re-dispatch todo + error
                   └───────────┬─────────────┘
                               │
                   ┌───────────▼─────────────┐
                   │ 6. FINAL WAVE  F1–F4    │  F1 plan-compliance (conductor)
                   │                         │  F2 code-quality ─► claude-security ◄ NEW
                   │                         │  F3 manual-QA checklist
                   │                         │  F4 scope-fidelity ─► oracle
                   └───────────┬─────────────┘
                               │
                               ▼
                          phase: done
                               │
                   ┌───────────▼─────────────┐
                   │  PERSIST LEARNINGS       │  ◄── writes memory MCP (decisions, gotchas)
                   │  (closes the loop)       │      next run's metis reads them back
                   └─────────────────────────┘
```

---

## 3. Where enforcement bites (hard) vs. guides (soft)

This is the design's core — and the part that distinguishes ZOdyssey from prompt-only orchestrators (like omo's unenforced review gate).

```
                          ENFORCEMENT MAP

   HARD (hook blocks)                     SOFT (prompt guides)
   ─────────────────                     ─────────────────────
   ┌─────────────────────────┐           ┌─────────────────────────┐
   │ ✋ edit before OKAY      │           │ which phase to run next │
   │ ✋ dispatch > 4 parallel │           │ parallel vs sequential  │
   │ ✋ Task in wrong phase   │           │ trivial vs standard     │
   │ ✓ checkpoint on Stop    │           │ which skill/MCP to use  │
   │                         │           │ when to consult Oracle  │
   │ ALWAYS NO-OP if no      │           │ what to write to memory │
   │ active run ──► normal   │           │ scope/Must-NOT-do       │
   │ editing never affected  │           │                         │
   └─────────────────────────┘           └─────────────────────────┘
        the model CANNOT                      the model MAY drift;
        bypass these                          gates catch the rest
```

The principle: **enforce invariants, guide choices.** If a rule is checkable deterministically (file exists, verdict==OKAY, count<N), it's a hook. If it needs judgment (is this "deep"?), it's a prompt.

---

## 4. Capability routing (the muscle on top of the pipeline)

The conductor + cast consult `references/capabilities.md` at every phase. Headline routes:

```
   ACTIVITY              ──►   BEST CAPABILITY
   ───────────                 ────────────────
   fuzzy feature shape  ──►   skill: brainstorming + premortem
   hard reasoning        ──►   MCP: sequential-thinking  ◄ NEW
   plan the work         ──►   Task: zodyssey:prometheus + skill: writing-plans
   research codebase     ──►   MCP: codegraph_explore (if .codegraph/) else Task: zodyssey:explore
   research libs/docs    ──►   MCP: Context7 + Task: zodyssey:librarian
   design/architecture   ──►   Task: zodyssey:oracle + feature-dev:code-architect
   implement (code)      ──►   skill: test-driven-development (non-negotiable) + zodyssey:sisyphus-junior
   implement (plan)      ──►   skill: executing-plans + using-git-worktrees
   debug (hard)          ──►   skill: systematic-debugging + sequential-thinking
   security/vuln audit   ──►   plugin: claude-security (verified patches) ◄ NEW
   audit code quality    ──►   Task: code-reviewer + skill: source-command-audit-code
   review plan (gate)    ──►   Task: zodyssey:momus (+ zodyssey:oracle independent)
   verify before "done"  ──►   skill: verification-before-completion
   remember across runs  ──►   MCP: memory (knowledge graph) ◄ NEW
   media / image / PDF   ──►   Task: zodyssey:multimodal-looker
   parallel independent  ──►   skill: dispatching-parallel-agents
```

---

## 5. State & artifacts (per repo)

```
   <repo>/
   └── .zcode/
       ├── plans/
       │   └── <slug>.md          ◄── the contract planner↔executor (sections fixed-order)
       ├── state/
       │   └── <slug>.json        ◄── phase, review.verdict, todos, file_locks,
       │                             in_flight_dispatches, checkpoints (resume)
       └── notepads/
           └── <slug>/
               ├── 1.md           ◄── per-todo findings ─► "inherited wisdom"
               └── 2.md                forwarded to later todos

   ~/.zcode/orchestration/
   ├── memory.json                ◄── MCP memory knowledge graph (cross-run)
   ├── DESIGN.md                  ◄── full design rationale + provenance
   └── ECOSYSTEM_GRAPH.md         ◄── this file
```

---

## 6. The numbers

| Layer | Count | Highlights |
|---|---|---|
| MCP servers | **22** | sequential-thinking, memory (NEW); codegraph, Context7, github, web-*, aws-*, zai |
| Plugins enabled | **9** | claude-security (NEW); feature-dev, code-review, superpowers, +5 |
| User sub-agents | **8** | metis, prometheus, momus, explore, librarian, oracle, sisyphus-junior, multimodal-looker |
| Plugin agents | **13** | feature-dev (3), code-review (1), claude-security (7) scan-researcher/verifier/inventory… |
| Skills | **62** | odyssey + 14 superpowers + 4 audit + 44 domain (aws, SEO, higgsfield…) |
| Enforcement hooks | **2** | PreToolUse (edit/dispatch gate), Stop (checkpoint) |
| Slash commands | **1** | `/orchestrate` (run · resume · status) |
| ZOdyssey scripts | **2** | scaffold.mjs (plan+state), parse-plan.mjs (todos) |
| Provenance | — | design grounded in 7 published sources + omo source-code deep-dive (DESIGN.md §0) |

---

## 7. The differentiator, in one line

> **A hybrid-enforced multi-agent orchestrator that always reaches for the best available
> capability at each phase — hard-gating the dangerous invariants (no edit before plan-OKAY,
> parallel overflow) that prompt-only systems (omo) leave to convention, while guiding the
> judgment parts via a capability routing table.**

The cast is the cast omo proved out. The enforcement is what LangGraph promises. The capability
routing is what makes every activity use the strongest installed tool instead of generic prompting.
Together: the ultimate most accurate value.
