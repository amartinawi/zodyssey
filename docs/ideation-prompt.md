# ZOdyssey ideation prompt — discovery for v0.6+

Paste the block below into a fresh session with this repo as cwd. It is written to be
**self-grounding**: it tells the session what already exists so it cannot waste a round
proposing shipped work, and it encodes the failure modes this project has actually hit so it
cannot cheerfully repeat them.

Companion to `deep-audit-prompt.md` (which finds what is *broken*). This one asks what is
*missing*.

---

## The prompt

> You are doing open-ended discovery on ZOdyssey, a multi-agent orchestration plugin for the
> ZCode harness. Goal: make it the most powerful, accurate, and hard-to-get-wrong tool in the
> AI/LLM-assisted coding space. Treat this as ideation, not implementation — I want a ranked
> opportunity map, not code.
>
> **Before proposing anything, establish ground truth yourself.** Do not trust this brief.
> Read `docs/ROADMAP.md`, `docs/DESIGN.md`, `CHANGELOG.md`, and `skills/odyssey/SKILL.md`, then
> verify against the code. The roadmap is dated 2026-08-11 and four releases have shipped since;
> parts of it are stale in both directions. Where this brief and the code disagree, the code wins,
> and tell me where I was wrong.
>
> ### What is already built (verify, then do not re-propose)
>
> A phase DAG (Prime→Triage→Consult→Plan→Review→Execute→Verify→Final→Done) with hook-enforced
> gates. Non-forgeable review verdicts via hook-minted nonces bound to artifact + plan-sha.
> Authenticated run discovery (HMAC marker over run identity). A Bash/Edit write gate with
> declared-file scope checks. Append-only evidence notepads. A test-integrity guard (deleted /
> weakened / skip-markered tests). A pass-to-pass regression gate. F1–F5 final wave, including a
> behavioural capability-routing cross-check. Segment-tolerant capability matching. Real token
> accounting from the session DB. 32 test suites, ~98 gate-surface cases, paired old/new probes.
>
> ### Validated gaps in the existing roadmap (confirmed against code, 2026-08-15)
>
> - **A4 — the doc-code invariant registry was never built.** The roadmap calls this "the missing
>   organ": the thing that notices when a safeguard silently stops working. Its absence is the
>   root cause of the repo's worst incident (the Bash write-gate was deleted twice; three external
>   audits missed it).
> - **B9 — package-existence checking:** absent. 19.7% hallucination rate across 576k samples.
> - **B10 — pre-edit lint baseline:** absent, so pre-existing lint noise is attributed to the edit.
> - **Phase C is still blocked:** `judge.mjs:311` hardcodes `arm: "zodyssey"` on every record and
>   never reads `--arm`, so the baseline arm cannot be measured. The eval has never produced a
>   number. (The `REPLACE_WITH` seed bug it also cites *has* been fixed.)
>
> ### Known-unfixed residuals (in CHANGELOG; do not rediscover, do build on)
>
> Shell-escaping splits command tokens past the regex gate; the interpreter deny-list is unbounded
> by construction; the named terminus is **head-allowlist inversion** (classify by command head
> against known-safe heads) and it is unshipped. Consumable nonces live in agent-readable state, so
> they prove a reviewer was *dispatched*, not what it *said* — the proposed fix is binding
> artifacts to reviewer transcript hashes, which needs harness support. Five stale plugin versions
> accumulate in the cache with no pruning.
>
> ### What the outside world says (use as a lens, verify before relying on it)
>
> 2026 consensus is that **the harness, not the model, is the lever**: swapping harnesses moves
> SWE-bench Pro pass@1 more than most model upgrades (23%→52% on one model). Production harnesses
> are described as five layers — tool orchestration, verification loops, context/memory,
> guardrails, observability. ZOdyssey is strong on guardrails and verification, thin on
> context/memory and observability. Least-privilege enforcement correlates with a 17% vs 76%
> incident rate. Capability *minimization at the runtime* is the defense that works, because it
> does not depend on the model complying.
>
> ### The failure modes this project actually has — check every proposal against them
>
> 1. **Enumeration instead of structure.** Three rounds of adding patterns to a deny-list produced
>    three bypasses. The fourth round found none only because the questions were exhausted.
> 2. **A check that cannot detect the class of failure it exists for.** `--verify` checked paths,
>    not liveness. Audits checked diffs, not standing invariants. A runner reported success over an
>    empty set.
> 3. **Ceremony without mechanism.** Acceptance criteria are the highest-evidence intervention
>    (TiCoder: +22–54 absolute pass@1) — the project built the ritual and, for a long time, skipped
>    the executable part.
> 4. **Self-grading.** The planner writes the criteria; the reviewer declines to judge them.
> 5. **Fixes that reopen their own class.** One release shipped a hole and its fix in the same regex.
>
> ### Explicit anti-goals
>
> More LLM opinion layers. Multi-agent debate degraded accuracy in 5 of 6 measured configurations;
> LLM-judge accuracy on hard cases is 60–67% with prompt framing swinging verdicts ±60pp. If you
> propose another reviewer agent, carry the burden of explaining why the evidence does not apply.
>
> ### Hard constraints
>
> Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon · graceful no-op when
> optional tools are absent · every hook is a no-op unless a run is active · the trusted-script
> allowlist means any agent has the same argv surface the operator does, so no argv flag
> authenticates anyone.
>
> ### What I want back
>
> 1. **An opportunity map, ranked by (evidence strength × leverage) ÷ cost.** For each: the claim,
>    the evidence with a source, what it would take, and what it would break. Say plainly when
>    evidence is absent — "no published outcome evidence" is a valid and useful entry.
> 2. **Which of the five harness layers ZOdyssey is weakest in, argued from the code.** My guess is
>    context/memory and observability; disconfirm me if the code says otherwise.
> 3. **The three structural changes** that would each eliminate a whole class of defect rather than
>    an instance. Head-allowlist inversion is one candidate — find the others.
> 4. **What "swiss army knife for AI/LLM and coding" should mean here**, concretely. Is breadth
>    (more capabilities, more MCPs, more languages) actually the goal, or is the differentiator
>    that this is the only orchestrator whose guarantees are *code-enforced rather than
>    prompt-convention*? Argue a position; do not hedge.
> 5. **The strongest argument against this project's core bet** — that code-enforced gates beat
>    prompt convention — and what evidence would settle it.
>
> Search the web for current work; cite what you use. Prefer primary sources and say when something
> is vendor-funded or unreplicated. Where you are uncertain, say so — a confident wrong ranking is
> worse than an honest gap.

---

## Why the prompt is shaped this way

**It front-loads ground truth** because the expensive failure in ideation is a session spending its
best thinking re-deriving what exists. Four releases of drift means the roadmap alone would mislead.

**It names the failure modes** because they are non-obvious and recurring. A session that does not
know "enumeration instead of structure" has bitten three times will propose a fourth pattern list.

**It states anti-goals with evidence.** "Add more reviewer agents" is the single most likely
suggestion and the evidence is against it. Making that burden explicit up front is cheaper than
arguing it down later.

**It asks for disconfirmation twice** (§2 and §5). Every prior round of value on this project came
from someone attacking a claim rather than extending it.
