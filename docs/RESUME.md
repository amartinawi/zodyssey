# ZOdyssey — Resume Here

> **Last updated:** 2026-08-02
> **Status:** the pipeline is measured, enforcement-bound (scope-isolation fail-closed on both
> axes), and the external consult gate is proven (2/2 runs audited, both caught real in-session
> misses) and now hardened (consult.mjs no longer DOSes itself on committed `node_modules`).
> Value proposition confirmed: **pipeline wins +0.25 on architecture tasks, ties on trivial.**

---

## Quick orientation (read this first)

ZOdyssey is a hybrid-enforced multi-agent orchestration conductor built inside ZCode. It routes
software tasks through 8 phases (prime → triage → consult → plan → review → execute → verify →
final-wave) with a cast of 8 sub-agents and whatever skills/MCPs you have installed. The
enforcement hooks hard-block the dangerous invariants; prompts guide the judgment parts.

**The single most important architectural constraint (verified by smoke-test 2026-08-02):**
ZCode sub-agents do NOT inherit the Skill tool or routed MCPs (codegraph, Context7) regardless of
frontmatter. The orchestrator must run Skill/MCP calls in the PARENT thread and pass results into
the sub-agent's dispatch prompt. Every `skill:`/MCP instruction in agent bodies is a recommendation
the ORCHESTRATOR executes, not the sub-agent.

---

## Where things are

### Enforcement layer (security) — 6 audit rounds, then paused at the safety rail
- **What holds** (zero regressions across 6 rounds): edit-gate covers Bash+NotebookEdit;
  self-authorizable-state hole closed; consult.mjs injection-free + fail-closed; parallel cap
  fires (hook-counted ledger); file-locks work (per-owner map); phase-transition DAG prevents the
  set-phase master-bypass; parse-plan strips comments + column-0 anchored.
- **NEW 2026-08-02 (this session) — scope-isolation boundary, fail-closed on both axes:** once
  `review.verdict == OKAY`, executors can ONLY edit files in the plan's declared `Files:` union
  (`hooks/pre-tool.mjs` isEdit branch). This was added because a real production run
  edited unrelated files outside scope. Two gaps found + fixed same session:
  (1) an empty `catch {}` swallowed ENOENT on an unreadable plan → edit fell through to `exit(0)`
  (now `block()`s); (2) an empty declared set short-circuited to "allow everything" (now fail-closed,
  and `parse-plan --lint` rejects empty `Files:` with exit 6 so the planner is told early). Verified
  live: a real out-of-scope Write from the parent session is blocked; an in-scope Write passes. See
  memory `zodyssey-scope-isolation` + `zodyssey-scope-failclosed-broken` (RESOLVED).
- **NEW 2026-08-02 — consult gate proven to catch in-session misses:** both measured ZOdyssey arms
  now audited via `/orchestrate-consult`. **arch-01-zodyssey** REJECTED round 1 (`test/cache.test.js`
  used Jest globals while the runner is `node --test` → `npm test` exited 1, but the in-session
  final-wave had marked it `pass`). **std-01-zodyssey** REJECTED round 1 (`src/server.js` used
  `res.writeHead` but the plan's acceptance stub only had `statusCode`+`end` → the acceptance
  command silently didn't validate the body). Both remediated under the re-armed scope hook
  (`phase: remediate`), both ACCEPTED round 2. The pattern: a separate auditor can't inherit the
  run's assumption that "the test passed." See memory `zodyssey-consult-catches-final-wave-miss`.
- **NEW 2026-08-02 — consult.mjs prompt-bloat fix (found auditing std-01):** the std-01 audit kept
  failing with `spawnSync claude EPIPE`. Root cause: consult.mjs injected the fixture's committed
  `node_modules/` (5,406 files) into BOTH the scoped-diff and out-of-scope sections → 13.8MB prompt
  (minified bundles, 257KB single lines) → `claude` choked. arch-01 was unaffected because its
  fixture had a `.gitignore`. Fix: `isGeneratedOrBookkeeping` filter (`node_modules/`, `vendor/`,
  build outputs, lockfiles) on both paths + per-line length cap. 13,824,892 → 7,454 bytes. See
  memory `zodyssey-consult-prompt-bloat-fix`.
- **What stalled** (rounds 4-7): the trusted-writer model (8 scripts, each a forgeable surface
  needing bespoke nonce binding). The loop hit diminishing returns — each fix relocated the hole.
  See `AUDIT-2026-08-01-ROUNDS.md` for the full trajectory + the 3 trust anchors that must be
  established before resuming. The single-gate-writer refactor (consolidate the 8 trusted scripts)
  is deferred per consult priority — only worth doing after more arch-task data confirms the
  current shape works.
- **Verdicts persisted:** `eval/audit-2026-08-01-v{2..6}-*` (5 rounds of security re-audits).

### Operational layer — the criticals are fixed; the eval loop produces data
- **Phases 5/6 bound to evidence:** `record-verify.mjs` + `record-final-wave.mjs` (F1 = machine-
  checked set-difference, F2/F4 = nonce-bound artifacts, F3 = checklist).
- **Acceptance-criteria lint:** `parse-plan --lint` gates record-review OKAY. Rejects "user
  manually verifies" slop + missing criteria.
- **Eval loop:** 18 seed tasks + 4 fixtures + harness.mjs + judge.mjs (independent external CLI)
  + auto-append on set-phase done. First measured results: trivial tie (0.83 vs 0.83),
  architecture win (+0.25: 0.87 vs 0.62).
- **Consult reports:** `OPERATIONAL-CONSULT-2026-08-01.md` (28 gaps) + `INTEGRATION-CONSULT-
  2026-08-01.md` (existing surface sufficient; 3 unrouted high-leverage MCPs/skills).

### What's deliberately deferred (per consult priority B→C→A)
- **A (playwright→F3 full wiring):** routed in capabilities.md but the plan-contract QA scenario
  doesn't yet auto-compile to a Playwright script. M-effort; wait until the +0.25 arch advantage
  is confirmed across more arch seeds.
- **C (single-gate-writer refactor):** consolidate the 8 trusted scripts into one writer with one
  nonce mechanism. Only after more arch-task data.
- **Dashboard renderer** (`dashboard.mjs`): data exists (results.jsonl + judged.jsonl); the
  renderer is unbuilt.
- **UserPromptSubmit hook** for the trivial-gate: currently prompt-guided, not hook-enforced.

---

## File map

### Live system (what runs)
```
~/.zcode/skills/odyssey/
├── SKILL.md                         # the conductor (8-phase state machine + dispatch rules)
├── references/
│   ├── capabilities.md              # capability routing table + MCP audit + trust-anchor note
│   └── auditor-prompt.md            # the prompt consult.mjs sends to the external auditor
├── hooks/
│   ├── pre-tool.mjs                 # edit-gate + Bash-gate + parallel-cap + file-lock + phase-gate + nonce-minting + capability-recording + scope-isolation (fail-closed)
│   ├── post-tool.mjs                # parallel-cap ledger decrement
│   └── stop.mjs                     # change-detected checkpoint + lock release
└── scripts/                         # 17 scripts — see SKILL.md "Scripts you call" for signatures
    ├── scaffold.mjs                 # plan + state + task-brief
    ├── parse-plan.mjs (+ .test.mjs) # todo parser + --lint mode + unit tests
    ├── set-phase.mjs                # phase-transition DAG + auto-append + memory-write
    ├── record-review.mjs            # OKAY gate (nonce + plan-sha + lint)
    ├── record-momus-artifact.mjs    # nonce-bound artifact writer
    ├── record-verify.mjs            # phase-5 per-criterion evidence
    ├── record-final-wave.mjs        # phase-6 F1-F4 (F1 = machine-checked set-difference)
    ├── record-todo.mjs              # todo status + lock attribution + release
    ├── record-capability.mjs        # self-declared capability use
    ├── run-report.mjs               # efficiency scorecard (success from final.verdict)
    ├── harness.mjs                  # eval runner (fresh-copy + scaffold + both arms)
    ├── judge.mjs                    # independent LLM-as-judge (--double for 2-pass)
    ├── consult.mjs                  # external audit gate (fail-closed, secret-redacting)
    ├── resolve-capabilities.mjs     # agent-grant reconciliation
    ├── recall-outcomes.mjs          # cross-run memory read-side
    └── status.mjs                   # quick run-inspection
```

### Design + audit docs
```
~/.zcode/orchestration/
├── DESIGN.md                        # the original spec (§12 manifest updated 2026-08-02)
├── MEASUREMENT.md                   # eval methodology (rubric, seed format, loop design)
├── ECOSYSTEM_GRAPH.md               # the layered map (snapshot from 2026-07-31 — needs refresh)
├── AUDIT-2026-08-01.md              # the original 10-gap audit
├── AUDIT-2026-08-01-ROUNDS.md       # the 6-round security trajectory + what held + what stalled
├── OPERATIONAL-CONSULT-2026-08-01.md # the 28-gap operational review
├── INTEGRATION-CONSULT-2026-08-01.md # the "existing surface sufficient" integration verdict
├── RESUME.md                        # THIS FILE
└── eval/
    ├── seed.jsonl                   # 18 seed tasks (8 std, 5 arch, 5 triv)
    ├── results.jsonl                # measured runs (auto-appended on set-phase done)
    ├── judged.jsonl                 # judged records (from judge.mjs)
    ├── fixtures/                    # 4 fixture repos (express-jest, arch-api, auth-mod, readme-typo)
    ├── runs/                        # isolated run repos created by harness.mjs
    └── audit-2026-08-01-v{2..6}-*   # 5 security re-audit bundles + verdicts
```

### Agents (modified — trust-anchor corrected)
```
~/.zcode/agents/
├── metis.md           # tools: Read, Glob, Grep, Bash (read-only consultant)
├── prometheus.md      # tools: + Write, Edit, WebSearch, WebFetch (planner)
├── sisyphus-junior.md # tools: + Write, Edit, WebSearch, WebFetch (executor)
├── momus.md           # tools: Read, Glob, Grep, Bash (reviewer)
├── explore.md         # read-only codebase search
├── librarian.md       # docs/OSS research (only agent with Context7 MCP grant that works)
├── oracle.md          # strategic advisor
└── multimodal-looker.md # media interpretation
```
**CRITICAL:** the `tools:` frontmatter is documentation, not enforcement. Sub-agents get a fixed
set regardless. See `~/.zcode/cli/memories/.../zcode-subagent-tools-resolved.md`.

---

## The first measured results (2026-08-02)

| task | intent | zodyssey | baseline | delta |
|---|---|---|---|---|
| std-01 (healthz) | trivial | 0.83 | 0.83 | +0.00 (tie) |
| arch-01 (caching layer) | architecture | 0.87 | 0.62 | **+0.25 (pipeline wins)** |

**The pipeline wins on architecture** — the baseline failed "design rationale documented" (single
agent just wrote code; pipeline's plan-first discipline produced docs naturally). scope_fidelity
flipped to zodyssey 1.0 after the .gitignore fix (no more .zcode artifact leak).

**Asterisk on arch-01 (added 2026-08-02):** the +0.25 win is real and the consult gate ultimately
ACCEPTED the run — but the external auditor caught a latent critical bug the in-session final-wave
had missed (`test/cache.test.js` used Jest globals under `node --test`, so `npm test` exited 1 — the
run's own acceptance criterion was failing). The judge scored arch-01 0.87 because it didn't
execute `npm test`; the bug was invisible until a fresh-context auditor actually ran it. The win
held after remediation. This is why the consult gate exists.

---

## How to resume

### To run another eval task
```bash
# list the 18 seeds
node ~/.zcode/skills/odyssey/scripts/harness.mjs --list

# scaffold a zodyssey-arm run for a specific task
node ~/.zcode/skills/odyssey/scripts/harness.mjs --task arch-02

# scaffold a baseline-arm run (single-agent comparator)
node ~/.zcode/skills/odyssey/scripts/harness.mjs --task arch-02 --arm baseline

# after the conductor drives the run to done, judge it
node ~/.zcode/skills/odyssey/scripts/judge.mjs <run-repo> <slug> <seed-id>
```

### To verify the system is healthy after any change
```bash
# agent grants consistent?
node ~/.zcode/skills/odyssey/scripts/resolve-capabilities.mjs --check

# parser still correct?
node ~/.zcode/skills/odyssey/scripts/parse-plan.test.mjs

# all scripts load?
for f in ~/.zcode/skills/odyssey/scripts/*.mjs ~/.zcode/skills/odyssey/hooks/*.mjs; do node --check "$f"; done
```

### To re-consult (the external audit gate)
The consult mechanism is fully functional. Build a bundle of the source you want audited +
`references/auditor-prompt.md` and pipe to `claude -p --output-format json --permission-mode plan
--allowedTools ""`. See any of the 8 prior consult rounds in `eval/` for the pattern.

---

## Memory entries (cross-session knowledge)

The following memory files persist in `~/.zcode/cli/memories/projects/default-*/memory/`:
- `zodyssey-first-measured-results.md` — the +0.25 architecture win
- `zcode-subagent-tools-resolved.md` — sub-agents don't inherit Skill/MCP (the trust anchor)
- `zodyssey-operational-remediation.md` — the 4 criticals + 4 majors + 2 integrations
- `zodyssey-operational-consult.md` — the 28-gap review
- `zodyssey-remediation-stalled.md` — the security-loop stall + the 3 trust anchors
- `zodyssey-payload-probe-results.md` — agent_id ABSENT (ground-truth hook payload data)
- + 6 earlier entries (audit, enforcement gaps, wave-1, wave-2-3, eval-unmeasured, improvement-roadmap)

Read `MEMORY.md` in that dir for the index.
