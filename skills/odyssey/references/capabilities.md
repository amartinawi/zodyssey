# ZOdyssey Capability Routing — best tool for each activity

> The orchestrator's promise: **always use the best available capability for the job.** This file is
> the routing table. Every agent (zodyssey:metis, zodyssey:prometheus, zodyssey:momus,
> zodyssey:sisyphus-junior, and the conductor itself) consults it before choosing how to work.
> When a capability here fits your current activity, USE IT — do not default to generic behavior.
> Skills are loaded via `skill(name="…")`; plugin agents via `Task(subagent_type="…")`;
> MCPs are called directly.

> Inventory snapshot: 8 plugins enabled · ~50 user skills · 8 user sub-agents · 20 MCPs · codegraph.
> Run `find ~/.zcode -name SKILL.md` to re-discover; this table names the load-bearing ones.

> **Trust anchor — RESOLVED 2026-08-02 (smoke-test):** ZCode sub-agents do NOT receive the Skill
> tool or routed MCPs (codegraph, Context7) regardless of `tools:` frontmatter. A dispatched
> sisyphus-junior got a fixed set (Bash/Edit/Read/WebFetch/WebSearch/Write + 2 always-on MCPs) —
> the frontmatter `tools:` field is documentation, not enforcement, and the README's "allowlist"
> claim is wrong. **Consequence:** the orchestrator CANNOT delegate "load skill: TDD" or "call
> codegraph" to a sub-agent. It must run Skill/codegraph/Context7 in the PARENT (main) thread,
> where those tools exist, and pass the results into the sub-agent's dispatch prompt. Treat every
> skill/MCP routing instruction below as something the ORCHESTRATOR executes before/at dispatch,
> not something the sub-agent does itself.

## Quick matrix — activity → best capability

| Activity | Primary capability | Reinforcing capability |
|---|---|---|
| **Prime / refine the user's prompt** | `skill: prompt-master` | `skill: brainstorming` (very fuzzy) |
| **Brainstorm / shape a feature** | `skill: brainstorming` | `skill: premortem` (risk), `feature-dev:code-architect` |
| **Hard multi-step reasoning** | `sequentialthinking` MCP | `Task: zodyssey:oracle` (ours) |
| **Plan the work** | `Task: zodyssey:prometheus` (ours) | `skill: writing-plans`, `skill: executing-plans` |
| **Research the codebase** | `codegraph_explore` MCP (if `.codegraph/`) | `Task: zodyssey:explore` (ours), `Task: zodyssey:librarian` (docs/OSS) |
| **Research libraries/docs** | `Context7` MCP + `Task: zodyssey:librarian` | `WebSearch` / `WebFetch` |
| **Design / architecture** | `Task: zodyssey:oracle` (ours) + `skill: brainstorming` | `feature-dev:code-architect`, `skill: premortem`, `sequentialthinking` MCP |
| **UI/UX design intelligence** | `skill: ui-ux-pro-max` | `Task: zodyssey:oracle` (design review), `playwright`/`chrome-devtools` MCPs (UI verify) |
| **Implement (TDD)** | `skill: test-driven-development` | `skill: subagent-driven-development`, `Task: zodyssey:sisyphus-junior` |
| **Implement (plan execution)** | `skill: executing-plans` | `skill: using-git-worktrees` (isolation) |
| **Debug (hard)** | `skill: systematic-debugging` + `sequentialthinking` MCP | `Task: zodyssey:oracle` (after 2 failed attempts) |
| **Security / vuln audit** | `claude-security` plugin (deep scan + verified patches) | `Task: code-reviewer`, `skill: source-command-audit-code` |
| **Audit code quality** | `Task: code-reviewer` (feature-dev) or `/code-review` | `skill: source-command-audit-code`, `skill: review-agent` |
| **Audit docs accuracy** | `skill: source-command-audit-docs` | `skill: source-command-audit-full` |
| **Audit end-to-end** | `skill: source-command-audit-test` | `skill: source-command-audit-full` |
| **Review a plan (gate)** | `Task: zodyssey:momus` (ours) | `Task: zodyssey:oracle` (independent, for architecture) |
| **Review code (pre-merge)** | `skill: requesting-code-review` | `skill: verification-before-completion`, `Task: code-reviewer` |
| **Verify before claiming done** | `skill: verification-before-completion` | run the todo's acceptance commands |
| **Remember across runs** | `memory` MCP (knowledge graph: entities/relations/observations) | notepad files (within a run) |
| **Merge / finish branch** | `skill: finishing-a-development-branch` | `skill: merge-ready` |
| **Media / image / PDF** | `Task: zodyssey:multimodal-looker` (ours) | — |
| **Parallel independent tasks** | `skill: dispatching-parallel-agents` | (the orchestrator does this natively in phase 4) |

## Detail — when to reach for each, by phase

### Phase -1 — Prime (before everything)
- **`skill: prompt-master`** — ALWAYS load this first. Feed it the raw user task; it returns a primed brief (intent, success criteria, surfaced constraints, ambiguities, rewritten prompt). The rewritten prompt REPLACES the original for all downstream phases. This is the single highest-leverage step in the pipeline: a sharp brief makes triage, Metis, and planning all more accurate for negligible cost.

### Phase 0 — Triage
- **`skill: brainstorming`** — if the PRIMED brief is still fuzzy/creative ("build me a way to…"), load brainstorming before triage decides. A fuzzy request shouldn't be deflected as "trivial"; it needs shaping.
- No other capability needed; triage is a judgment call on the primed brief.

### Phase 1 — Consult (`zodyssey:metis`)
- **`skill: premortem`** — for `architecture` and `mid-sized` intents, zodyssey:metis should run a premortem to surface failure modes, then fold them into her directives.
- **`codegraph_explore`** — if the repo is indexed, zodyssey:metis should probe it (one call) to ground her risk analysis in real structure, not assumptions. Fallback: `Task: zodyssey:explore`.
- **`skill: source-command-audit-*`** — if the intent is clearly an audit ("review this for issues", "is the codebase healthy?"), Metis should name the matching audit skill in her directives rather than letting it be rediscovered later.
- **`skill: ui-ux-pro-max`** — if the intent is UI/UX work (design, build, create, implement, review, improve a UI — landing page, dashboard, component, mobile app), Metis should name this skill in her directives so it's not rediscovered later. Identify the product type, style keywords, industry, and stack from the prompt — these feed the design-database search in phase 2.

### Phase 2 — Plan (`zodyssey:prometheus`)
- **`skill: writing-plans`** (superpowers) — zodyssey:prometheus MUST consult this alongside the odyssey scaffold; it's the battle-tested plan-writing method and complements our plan contract.
- **`Task: code-architect`** (feature-dev plugin) — for `architecture` intent, dispatch this to design the structure before writing the plan's Execution Strategy.
- **`Task: zodyssey:explore` / `Task: zodyssey:librarian` / `codegraph_explore`** — fan out for research BEFORE drafting (zodyssey:metis will have recommended which).
- **`skill: using-git-worktrees`** — if the work would touch a busy repo, the plan should propose a worktree for isolation.
- **`skill: ui-ux-pro-max`** (UI/UX tasks only) — the ORCHESTRATOR runs the design-database search (not zodyssey:prometheus — sub-agents can't load skills) BEFORE zodyssey:prometheus drafts, and passes the results into zodyssey:prometheus's dispatch prompt. Search order: product type → style → typography → color → landing (or chart for dashboards) → stack. The design context grounds the plan's visual decisions so zodyssey:prometheus doesn't invent a design system from scratch. Key search: `python3 ~/.zcode/skills/ui-ux-pro-max/scripts/search.py "<keyword>" --domain <domain> -n 3` for each relevant domain.

### Phase 3 — Review (`zodyssey:momus`, the gate)
- **`Task: zodyssey:momus`** (ours) — the primary gate; checks executability, references, QA.
- **`Task: zodyssey:oracle`** (ours) — for `architecture` intent, an INDEPENDENT second review (both must OKAY). zodyssey:oracle catches what zodyssey:momus (a blocker-finder) won't: design-level flaws.
- **`skill: premortem`** — on REJECT, before zodyssey:prometheus revises, a premortem on the rejected plan often surfaces why.

### Phase 4 — Execute (`zodyssey:sisyphus-junior`)
- **`skill: test-driven-development`** — for any todo that adds or changes logic, the executor MUST follow TDD (write failing test → implement → green). This is non-negotiable for code todos; note it in the plan's Acceptance criteria.
- **`skill: ui-ux-pro-max`** (UI/UX tasks only) — the ORCHESTRATOR loads this skill and runs the pre-delivery checklist (no emoji icons, proper contrast, no layout-shift hovers, responsive breakpoints, accessibility) BEFORE the executor's output is accepted. The skill's `references/pro-rules.md` is the binding standard for UI quality. Since the executor can't load skills (sub-agent limitation), the orchestrator passes the relevant design context + pro-rules into the dispatch prompt and validates the output against them.
- **`skill: subagent-driven-development`** — when a todo is large, the executor splits it into sub-tasks delegated to further `zodyssey:sisyphus-junior` instances (parallel where independent).
- **`skill: executing-plans`** — the canonical plan-execution loop; complements our state machine.
- **`skill: using-git-worktrees`** — if the plan called for isolation, create the worktree first.
- **`feature-dev:code-architect` / `code-explorer`** — dispatch for design-heavy or navigation-heavy todos.
- **`skill: systematic-debugging`** — the moment an executor hits a bug or failing test, switch to this skill; do not flail.

### Phase 5 — Verify
- Run each todo's acceptance commands (Metis mandated these be executable).
- **`scripts/record-verify.mjs`** — bind each criterion's command + exit code + output as evidence under `.zcode/verify/` (the phase-5 substrate; closes the "verify was unbound self-report" gap).
- **`skill: verification-before-completion`** — load this BEFORE each `record-verify.mjs` call. It is the judgment layer that decides whether a *passing* command actually proves the criterion (complements the script; does NOT replace it — the script provides the unforgeable artifact).
- On failure → `skill: systematic-debugging` + re-dispatch the todo with the error.

### Phase 6 — Final verification wave (F1–F4) — now evidence-bound
- **`scripts/record-final-wave.mjs`** — binds all four F-items to evidence (closes the "final wave was unbound self-report" gap, the operational-consult's central defect).
- **F1 Plan-compliance:** MACHINE-CHECKED inside record-final-wave.mjs as a set-difference (plan `Files:` vs `git diff --name-only`). No longer orchestrator self-review.
- **F2 Code-quality:** `Task: code-reviewer` (feature-dev) → produces an artifact under `.zcode/reviews/` with a hook-minted nonce; `skill: merge-ready` as the F2 wrapper (multi-axis subagent review with verified findings). record-final-wave verifies the nonce.
- **F3 Manual-QA:** for UI tasks, the **`skill: ui-ux-pro-max`** pre-delivery checklist (no emoji icons, contrast ≥4.5:1, no layout-shift hovers, responsive at 320/768/1024/1440px, accessibility: alt text + form labels + `prefers-reduced-motion`) serves as the F3 verification standard. Route the **`chrome-devtools` MCP** (drive the page + screenshot) and the **`zai-mcp-server` MCP** (`ui_diff_check` vs a design ref, or `diagnose_error_screenshot`) to produce the F3 verdict — **in the PARENT thread** (sub-agents don't get routed MCPs; see trust anchor above). That verdict is written to a checklist file consumed by `record-final-wave.mjs --f3-checklist <path>` (NOT a bare `--f3`). → see **`references/f3-ui-verify.md`** for the full wiring sequence (drive → screenshot → diff/diagnose → checklist → `--f3-checklist`). For non-UI tasks, an executable shell checklist remains (same `--f3-checklist` consumption).
- **F4 Scope-fidelity:** `Task: zodyssey:oracle` → artifact under `.zcode/reviews/` with a hook-minted nonce; record-final-wave verifies.

### Capability-grant reconciliation (run after any agent/frontmatter change)
- **`scripts/resolve-capabilities.mjs`** — reads each agent's `tools:` allowlist vs the capabilities its body references + the live inventory, emits `.zcode/capabilities.lock.json`, exits 6 on routed-but-not-granted violations (the silent-denial class). The precondition for trusting any skill-routing claim.

### Evaluation (the measurement loop)
- **`scripts/harness.mjs`** — runs a seed task (fresh fixture copy → scaffold → arm=zodyssey|baseline); prints the judge command.
- **`scripts/judge.mjs`** — INDEPENDENT LLM-as-judge on the external CLI (not zodyssey:oracle — zodyssey:oracle is a participant); scores the final diff against the seed's success_criteria on the MEASUREMENT.md rubric; appends to `eval/judged.jsonl`.
- **`scripts/run-report.mjs`** — auto-appended to `eval/results.jsonl` on every `set-phase done|audited` (no run completes unmeasured).

### Cross-cutting
- **`skill: dispatching-parallel-agents`** — the conductor follows this for phase-4 fan-out (it's the superpowers method; our parallel-by-default rule is its ZOdyssey expression).
- **`skill: using-superpowers`** — load at SessionStart to keep the capability-discovery habit active throughout.
- **AWS work:** the 13 `aws-*` skills are authoritative for anything on AWS — Metis/Prometheus MUST route AWS tasks to the matching one rather than improvising.
- **WordPress / Iqraa / SEO:** `iqraa-wordpress`, `wordpress-mcp`, and the `openseo-*` / SEO skills are domain-specific; route to them for those domains.

### The three newest capabilities (use these deliberately)

**`sequentialthinking` MCP — structured multi-step reasoning.**
Reach for it when a problem resists a single-pass answer: hard architecture decomposition, a bug with 2+ failed fix attempts, a refactor with non-obvious blast radius. It lets you sequence thoughts, branch alternatives, and revise earlier thoughts. Don't use it for simple lookups — that's wasted overhead. Oracle and Prometheus should invoke it before answering hard questions; Sisyphus-Junior should invoke it (via the orchestrator) when systematic-debugging alone isn't converging.

**`memory` MCP — a knowledge graph that survives across runs.**
Entities, relations, observations — persisted to `~/.zcode/orchestration/memory.json`. Use it for things worth remembering past the current task: architectural decisions and their rationale, proven "gotchas" about the codebase, which approaches failed and why, key file/symbol locations. The orchestrator should write a memory entry at the end of each run (decisions made, lessons learned) and read relevant memories at the start of Metis (consult). Within a single run, the notepad files are still the working memory; the graph is for cross-run learning. Don't dump trivia — each entry should be something that would save real time next run.

**`claude-security` plugin — deep vulnerability scanning with verified findings.**
The F2 (code-quality) and any security-audit work should route here, not to generic review. It scans at a chosen effort tier, challenges every finding before reporting (kills false positives), computes a verification tally in code, and turns surviving findings into targeted patches — each verified by a panel of agents — that you apply when you choose. Use the `scan-*` agents it ships (`scan-researcher`, `scan-verifier`, `scan-inventory`) plus its `/` commands. This is the capability that turns "F2 code-quality review" from a vibe-check into a real security pass.

## The rule, restated

**Before doing any activity the hard way, scan this table.** If a capability fits, load/dispatch it.
The point of an orchestrator is to be the thing that *knows* to reach for TDD, for codegraph, for a
premortem — instead of doing each task with generic prompting. That habit is what makes the difference
between "a pipeline" and "the ultimate most accurate value."

## MCP audit (T4-#10, 2026-08-02) — 22 configured; 5 routed; deliberate verdict on the rest

**Routed (5):** Context7, codegraph, memory, openseo, chrome-devtools (the F3 playwright/UI path).

**Should-route next (high-leverage, currently unrouted):**
- **`github`** — source F1/F2 diffs via the MCP instead of shelling `git diff`; gives the orchestrator PR/issue context when relevant.
- **`sequential-thinking`** — the documented tool for hard multi-step reasoning (architecture decomposition, 2+ failed-fix debug). Currently unrouted despite being in the original capability table.
- **`web-search-prime` / `web-reader`** — research fallback when Context7 + zodyssey:librarian don't cover a topic.

**Deliberately out-of-pipeline (12) — context cost accepted:**
- Domain-specific (route only for those domains): `aws-*` (4 — handled by the aws-* skills), `novamira-iqraa-tech`, `openseo` (SEO), `ruflo`, `syncthing-docs`.
- Specialized runtimes (route only when the task needs them): `node_repl` (browser-use), `computer-use`, `notebooklm-mcp`, `zread`, `mcp-server-git` (redundant with the github MCP + shelling), `zai-mcp-server` (image analysis — route via zodyssey:multimodal-looker).

**Discipline:** do NOT add more MCPs before routing the high-leverage unrouted ones above. Each MCP costs context on every turn whether used or not; an unrouted MCP is pure overhead.
