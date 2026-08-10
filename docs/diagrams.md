# Diagrams

Visual reference for ZOdyssey's architecture. All diagrams are [Mermaid](https://mermaid.js.org/) — they render natively on GitHub and in any Markdown viewer that supports it. Edit them as text; no build step.

The headline visual (the enforcement-delta idea) lives at [`assets/hero.svg`](../assets/hero.svg) and is embedded in the [README](../README.md).

---

## 1. The pipeline (8 phases)

The conductor drives this state machine. Every transition writes a checkpoint to `<repo>/.zcode/state/<slug>.json` so a crashed run can resume.

```mermaid
flowchart TD
    P["−1 · PRIME<br/><i>prompt-master</i><br/>refine the raw task"] --> T{"0 · TRIAGE<br/>trivial / standard /<br/>architecture?"}
    T -- "trivial" --> SKIP["just answer normally<br/>(no orchestration)"]
    T -- "standard / architecture" --> C["1 · CONSULT<br/><b>metis</b><br/>intent + risks + directives"]
    C --> PL["2 · PLAN<br/><b>prometheus</b><br/>draft plan + state.json"]
    PL --> R{"3 · REVIEW<br/><b>momus</b> (the gate)<br/>OKAY or REJECT?"}
    R -- "REJECT (round < 3)" --> PL
    R -- "REJECT (round ≥ 3)" --> SURF["surface to user"]
    R -- "OKAY" --> E["4 · EXECUTE<br/><b>sisyphus-junior</b><br/>parallel waves, capped at 4"]
    E --> V["5 · VERIFY<br/>run each todo's<br/>acceptance commands"]
    V --> F{"6 · FINAL WAVE<br/>F1 plan-compliance<br/>F2 code-quality<br/>F3 manual QA<br/>F4 scope-fidelity"}
    F -- "all pass" --> DONE(("done"))
    F -- "any fail" --> E

    classDef gate fill:#ffebe9,stroke:#cf222e,stroke-width:2px,color:#1f2328;
    classDef good fill:#dafbe1,stroke:#2da44e,stroke-width:2px,color:#1f2328;
    classDef phase fill:#ddf4ff,stroke:#218bff,stroke-width:1px,color:#1f2328;
    class R gate;
    class DONE good;
    class C,PL,E,V,P phase;
```

**Key invariants enforced at the gate (phase 3):**
- The hook **blocks every product-code edit** until `state.review.verdict == OKAY`.
- The OKAY verdict is **non-forgeable** — bound to a nonce the hook minted when it witnessed the `Task(momus)` dispatch, plus the plan's sha256.
- A REJECT loop can run at most 3 rounds; the hook blocks further `momus` dispatches after that.

---

## 2. Agent topology

The conductor (main agent) drives; the cast of 8 sub-agents does the work. Read-only agents can run anytime; executors only in execute/verify/final.

```mermaid
flowchart LR
    COND["🧭 Conductor<br/>(main agent +<br/>odyssey skill)"]

    subgraph RO["read-only research lane (any phase)"]
        direction TB
        EXP["explore<br/><i>codebase search</i>"]
        LIB["librarian<br/><i>docs / OSS research</i>"]
        ORC["oracle<br/><i>strategic advisor</i>"]
        ML["multimodal-looker<br/><i>images / PDFs</i>"]
    end

    subgraph PLAN["planning lane (phases 1–3)"]
        direction TB
        MET["metis<br/><i>pre-planning consult</i>"]
        PRO["prometheus<br/><i>the planner</i>"]
        MOM["momus<br/><i>review gate</i>"]
    end

    subgraph EXEC["execution lane (phase 4+)"]
        direction TB
        SJ["sisyphus-junior<br/><i>task executor</i>"]
    end

    COND -- dispatches --> RO
    COND -- dispatches --> PLAN
    COND -- dispatches --> EXEC

    COND -- "owns: Skill tool,<br/>codegraph, MCPs" --> TOOLS["capabilities the<br/>sub-agents can't load"]

    classDef cond fill:#fff8c5,stroke:#d4a72c,stroke-width:2px;
    classDef ro fill:#ddf4ff,stroke:#218bff;
    classDef plan fill:#f6f8fa,stroke:#8250df,stroke-width:1.5px;
    classDef exec fill:#dafbe1,stroke:#2da44e,stroke-width:2px;
    classDef tool fill:#eaeef2,stroke:#6e7681,stroke-dasharray:3 3;
    class COND cond;
    class EXP,LIB,ORC,ML ro;
    class MET,PRO,MOM plan;
    class SJ exec;
    class TOOLS tool;
```

**Why the conductor owns the Skill tool and MCPs:** ZCode sub-agents receive a fixed tool set (Bash/Edit/Read/Write/WebSearch + a couple of always-on MCPs) — they do **not** get the Skill tool, codegraph, or routed MCPs regardless of the agent file's `tools:` frontmatter (verified by smoke-test, documented in each agent). So the conductor loads skills and runs codegraph in its own thread, then passes the results into the sub-agent's dispatch prompt. This is the "trust anchor" that makes the dispatch model work.

---

## 3. The enforcement gate (PreToolUse decision tree)

This is the reference implementation of the delta. Read top-to-bottom: first match wins, every other branch blocks.

```mermaid
flowchart TD
    START(["tool call:<br/>Edit / Write / Bash / Task"]) --> ACTIVE{"orchestration run<br/>active in this repo?"}
    ACTIVE -- "no" --> PASS1["✓ pass — normal editing,<br/>gate is a no-op"]
    ACTIVE -- "yes" --> KIND{"tool kind?"}

    KIND -- "Task / Agent" --> DISP["dispatch branch"]
    KIND -- "Bash" --> BASH{"write-capable?<br/>(sed -i, >, git apply, ...)"}
    KIND -- "Edit / Write / ..." --> EDIT["edit branch"]

    BASH -- "read-only" --> PASS2["✓ pass"]
    BASH -- "trusted recorder<br/>script invoke" --> PASS3["✓ pass"]
    BASH -- "write-capable" --> VERDICT1

    EDIT --> SCOPE{"target in plan's<br/>declared Files: ?"}
    SCOPE -- "no" --> BLOCK1["✗ BLOCK — scope violation"]
    SCOPE -- "bookkeeping<br/>(.zcode/plans/, notepads/)" --> PASS4["✓ pass"]
    SCOPE -- "yes, in scope" --> LOCK{"file-lock ledger:<br/>another agent holds it?"}
    LOCK -- "yes" --> BLOCK2["✗ BLOCK — collision"]
    LOCK -- "no" --> VERDICT1{"state.review.verdict<br/>== OKAY?"}

    VERDICT1 -- "no" --> BLOCK3["✗ BLOCK — review gate"]
    VERDICT1 -- "yes" --> TAMPER{"plan sha matches<br/>bound verdict?"}
    TAMPER -- "drift" --> BLOCK4["✗ BLOCK — plan tampered"]
    TAMPER -- "match" --> PASS5["✓ pass — edit proceeds"]

    DISP --> PCAP{"in-flight dispatches<br/>< parallel cap (4)?"}
    PCAP -- "no" --> BLOCK5["✗ BLOCK — parallel cap"]
    PCAP -- "yes" --> PASS6["✓ dispatch proceeds"]

    classDef pass fill:#dafbe1,stroke:#2da44e;
    classDef block fill:#ffebe9,stroke:#cf222e,stroke-width:1.5px;
    classDef decision fill:#fff8c5,stroke:#d4a72c;
    class PASS1,PASS2,PASS3,PASS4,PASS5,PASS6 pass;
    class BLOCK1,BLOCK2,BLOCK3,BLOCK4,BLOCK5 block;
    class ACTIVE,KIND,SCOPE,LOCK,VERDICT1,TAMPER,PCAP,BASH decision;
```

**The five load-bearing invariants**, each mapped to a branch above:

| Invariant | Branch | Failure mode if absent |
|---|---|---|
| No edits before review passes | `VERDICT1` | executor ships code nobody approved |
| Executor stays in declared scope | `SCOPE` | executor edits an unrelated file |
| No edit collisions between agents | `LOCK` | two agents clobber the same file |
| Parallel dispatch within bounds | `PCAP` | runaway fan-out, 50 subagents |
| Bash write-escape before review | `BASH` | shell bypass of the Edit gate (`sed -i`, `>`) |

---

## 4. The external consult gate (independence)

The strongest verification: after a run reaches `done`, an **external CLI** (separate process, fresh context, different model) audits the plan + full diff. The auditor cannot inherit the run's assumptions.

```mermaid
flowchart LR
    RUN["ZOdyssey run<br/>(in-session,<br/>connected model)"]
    DIFF["git diff<br/>run_start_sha..HEAD<br/>+ the plan"]
    AUD["🧪 external CLI<br/>(fresh context,<br/>independent model)"]
    V{"ACCEPT or<br/>REJECT?"}

    RUN -- "hands off" --> DIFF
    DIFF -- "spawn" --> AUD
    AUD --> V

    V -- "ACCEPT" --> OK(("phase: audited"))
    V -- "REJECT + gaps" --> REM["dispatch sisyphus-junior<br/>per gap (remediate)"]
    REM -- "re-verify" --> DIFF

    classDef ext fill:#f6f8fa,stroke:#8250df,stroke-width:2px;
    classDef good fill:#dafbe1,stroke:#2da44e,stroke-width:2px;
    classDef decision fill:#fff8c5,stroke:#d4a72c;
    class AUD ext;
    class OK good;
    class V decision;
```

**Why this is stronger than any in-session reviewer:** the auditor is a separate process — it has not seen the plan rationale, the consult debate, or the executor's self-justifications. It judges the diff against the plan cold. A sub-agent reviewer (even momus) shares the run's context; the external auditor does not.

**Honest limitation:** this fires only on `/orchestrate-consult` (opt-in) and only after the run reaches `done`. It needs a second provider's CLI installed (default `claude`; override with `CLAUDE_CLI`). The `--multi-auditor` mode runs two independent passes and flags disagreement.
