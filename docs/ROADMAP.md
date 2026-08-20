# ZOdyssey accuracy roadmap

**Date:** 2026-08-11
**Status:** ⚠️ **STALE IN BOTH DIRECTIONS — read the Status addendum at the END of this file first.**
Verbatim 2026-08-11 text: *roadmap — direction agreed, not scheduled. Phase 0 has landed (uncommitted); Phases A–C are planned but not started.*
**Scope:** make ZOdyssey produce more accurate output, ranked by evidence

**How to use this document.** Phase A is specified in enough detail to turn into an
implementation plan directly. Phases B and C are ranked and costed but deliberately not
specified further — B's exact contents are defined by which Phase A assertions come back red,
and C is a decision point rather than a commitment (§8). Revisit the ordering if the evidence
base moves; every claim carries its source so it can be rechecked rather than inherited.

---

## 1. Problem

ZOdyssey's stated purpose is code-enforcing the invariants that other orchestrators leave as
prompt convention. Investigation on 2026-08-11 found the enforcement layer had regressed without
detection, and that the verification layer largely checks *provenance* rather than *correctness*.

**The Bash write-gate was deleted twice.** `5c99927` (v0.1.1) shipped it deleted by mirroring the
author's local ungated copy. `433c037` (v0.1.2) restored it and published a post-mortem.
`e57b01b` (PR #1, the v0.2.0 cycle) deleted it again — 170 lines replaced with
`if (isBash) exit(0);`. Three independent external audits ran on v0.2.0 and none noticed.

The lesson generalizes beyond one file: **audits verify that code matches its documentation in
the diff under review. None re-checks an invariant established two releases earlier.** ZOdyssey
had no mechanism that notices when a safeguard stops working.

The same absence shows up everywhere it was looked for:

- `harness.mjs:98-99` gate on `seed.repo.includes("REPLACE_WITH")`; the seeds say
  `/path/to/throwaway/repo`. The string never matches, so `--list` prints ✓ for all 5 seeds and
  every run then dies on `cpSync` ENOENT. **The eval has never produced a number.**
- `record-final-wave.mjs` F2/F4 never open the review artifact. They check path-under-`reviews/`,
  existence, and nonce consumption, then set `passed: true`. An artifact reading
  `{"verdict":"REJECT"}` passes both. F3 is `content.trim().length > 0`. All three accept `--skip`,
  recorded as `passed: true`.
- F1 computes `outOfScope = [...actual].filter(p => !declared.has(p))` and passes on empty. The
  converse (`declared \ actual` — a declared todo silently skipped) is never computed. The file's
  own comment concedes F1 "PASSED VACUOUSLY" on an empty diff.
- `pre-tool.mjs:553` — `if (bookkeeping) exit(0); // plan/notepad writes always fine`. Notepads
  are the evidence F1–F4 consume, and any agent may rewrite them in any phase. Verdicts are
  nonce-bound and sha-anchored; **their inputs are not.**
- `record-verify.mjs:9-10` documents a transition guard "enforced by record-todo.mjs". No such
  guard exists in `record-todo.mjs`.
- `probe-toolchain.mjs` has zero callers, so the `toolchain.json` that `post-tool.mjs` and
  `parse-plan.mjs` both depend on is never created. The post-edit lint arm is dead by default.

**The self-grading loop.** Acceptance criteria are authored by `prometheus`, the same agent that
writes the plan. `momus` explicitly declines to judge criteria quality and defaults to APPROVE.
`parse-plan --lint`'s "is this executable" test passes any string containing a `.` or `/`. Absent
the opt-in post-`done` `/orchestrate-consult`, the pipeline writes its own exam, grades it, and
passes itself.

## 2. What the external evidence says

Research summary with sources in Appendix A. The parts that bear on design decisions:

**Disconfirming ZOdyssey's existing bets.** Multi-agent debate degraded accuracy in 5 of 6
measured configurations (sycophancy: the correct agent abandons its answer under peer pressure).
LLM-as-judge accuracy on *hard* cases runs 60–67%, with one small judge at 50.36% test-retest;
prompt framing swings verdicts by up to ±60pp. Spec-document tooling has no published outcome
evidence. LLM-generated `AGENTS.md`-style context files measured −0.5% to −2% resolution at +20%
cost.

**Supporting what ZOdyssey lacks.** Making test files read-only is the single best-evidenced
intervention found: ImpossibleBench measures test-rewriting at 76% (GPT-5) and 46% (Claude Opus
4.1); restricting access drops it to near zero while prompting does not work, and **stronger
models cheat more**. Package-existence checking addresses a 19.7% hallucination rate across
576,000 samples. Execution feedback capped at 2 rounds captures 76–95% of achievable gain.
Coverage-minimized existing regression tests as the feedback signal gave +8.0% to +12.9% relative
across three different agent systems on a fixed harness.

**The mechanism that survives from spec-driven development** is pinning intent into *executable
assertions* before generation (TiCoder: +22 to +54 absolute pass@1). That is what acceptance
criteria are supposed to be. ZOdyssey built the ceremony and skipped the mechanism.

**Ecosystem null result.** A scan of omo, prime-agent, spec-kit, superpowers, OpenSpec, Kiro,
Cline/Roo, SWE-agent and claude-flow found **no orchestrator implementing a pass-to-pass
regression gate or a test-deletion detector.** spec-kit's scripts do file-existence checks only.
Those two items are net-new, not ports.

## 3. Goals and non-goals

**Goals**

1. Something notices when a safeguard breaks. This is the missing organ.
2. Close the self-grading loop: verdicts and criteria bind to executed reality.
3. Rank every change by evidence, and say plainly when evidence is absent.

**Non-goals**

- Adding another LLM opinion layer. The evidence is against it, and ZOdyssey has enough.
- Harness portability work, team mode, model routing.
- Proving ZOdyssey beats a single agent. That is Phase C, deliberately deferred (§8).

**Constraints (unchanged)**

Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon · graceful no-op when
optional tools are absent · every hook stays a no-op unless a run is active.

## 4. Core design decision: documentation is the spec

Every failure above is one shape — a documented claim the code stopped satisfying, with nothing
in between. So Phase A does not invent policy. It converts claims the repo **already makes** into
executable assertions.

`skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` (Phase 0, landed) is the template: its header
cites the README line each assertion defends.

**Consequence, and the reason this ordering works:** assertions written against *current*
documented claims will fail on arrival where the code is broken. Those failures are not defects
in the suite — they are the broken promises, made visible. **Phase B is therefore defined as
"make Phase A green."** The failing list is the backlog, ordered by how load-bearing the claim
is. No separate prioritization exercise, and each phase gets an honest exit condition.

## 5. Phase 0 — landed 2026-08-11

Completed before this spec was written, because the repo was shipping the regression.

- **Restored the Bash write-gate** in `pre-tool.mjs` from `433c037`: read-only passthrough,
  trusted-script allowlist, OKAY-verdict requirement, SEC-4 plan-tamper guard, SEC-H5 per-target
  scope check. Uncommitted v0.3.0 namespacing work and the SEC-1s guard preserved.
- **Fixed a v0.3.0 interaction that would have deadlocked every run.** The v0.1.2 code resolved
  `SCRIPTS_DIR` from `<PROJECT_DIR>/skills/...` or `~/.zcode/skills/...`. v0.3.0 relocates to
  `~/.zcode/cli/plugins/cache/local/zodyssey/<version>/`, where neither resolves in a user repo →
  allowlist fails closed → every `record-review.mjs` invocation blocked pre-OKAY → no verdict can
  ever be recorded. Now resolved self-relative from the hook's own location, correct in every
  layout.
- **Closed a hostile-repo trust hole present even in the "good" v0.1.2 code.** The
  `<PROJECT_DIR>/skills/odyssey/scripts` fallback trusted a path inside the repo *being audited*;
  a hostile repo shipping that directory got its scripts allowlisted past the gate. Both path
  guesses removed — unreachable once self-relative resolution works.
- **Added `pre-tool.bash-gate.test.mjs`** — 22 assertions. Validated in both directions: 11 fail
  against the broken v0.2.0 hook, 0 against the fixed one. All 11 repo suites green.

Not committed: the working tree carries 28 files of in-progress v0.3.0.

## 6. Phase A — the invariant suite

### A1 · `package.json`
The repo has none, so `npm test` does not exist. Zero dependencies, `engines: {"node": ">=18"}`,
one `test` script.

### A2 · `scripts/run-tests.mjs`
Discovers `**/*.test.mjs`, runs each as a subprocess, aggregates exit codes. Zero deps.

**Zero tests discovered is a failure, not a pass.** This is not pedantry: it is precisely the
`harness.mjs` bug, where a placeholder mismatch made all 5 seeds skip while `--list` printed ✓ for
each. A runner that reports success on an empty set reproduces the failure it exists to catch.

### A3 · `.github/workflows/ci.yml`
`npm test` on push and PR. Without it Phase A is files nobody runs — today's situation with 11
test files and no runner.

### A4 · `invariants.test.mjs` — the doc-code registry
Each entry: the claim, where it is documented, and the executable assertion. Deliberately small —
8–12 load-bearing claims. An exhaustive registry rots; a short one about things that actually
broke stays honest.

Catches *absence*, not *wrongness*. It would have caught the deleted gate; it would not catch a
gate that exists but is subtly wrong. A smoke alarm, not a fire inspection — worth building
because every fire found so far was smoke-alarm-detectable. **Landed 2026-08-19:** the registry exists — `scripts/claims-ledger.mjs` (the rows) + `scripts/check-claims.mjs` (the checker) + `scripts/check-claims.test.mjs` (the pin that keeps the registry itself from silently dying), nine seed rows: BASH-GATE-REGRESSION, GATE-SURFACE-INVARIANTS, VERSION-CONSISTENCY, SMOKE-GATE-LIVE, DEPLOY-SURFACE-COVERAGE, EDIT-PATH-CONTAINMENT, CHECKS-WIRED-AT-TRANSITIONS, NONCE-MINTER-EXACT, UNGATED-CALLS-RECORDED. The command that answers "which documented guarantee has no test?" is `node scripts/check-claims.mjs` (exit 0 = every row resolves).

### A5 · The red set
Assertions for claims the code currently violates. These fail on arrival and constitute Phase B.

| Claim | Documented at | On arrival |
|---|---|---|
| F2 checks code quality; F4 checks scope fidelity | `DESIGN.md`, `MEASUREMENT.md` | RED — neither opens the artifact |
| Eval seeds are runnable | `MEASUREMENT.md`, `harness.mjs --list` | RED — placeholder mismatch |
| A todo cannot reach done without verify evidence | `record-verify.mjs:9-10` | RED — guard never written |
| `toolchain.json` powers the post-edit lint arm | `post-tool.mjs`, `parse-plan.mjs` | RED — `probe-toolchain.mjs` has no callers |
| No regressions introduced | `DESIGN.md:44` | RED — nothing runs the existing suite |

### A6 · Doc-truth pass (dangerous first)
Under "documentation is the spec," a wrong doc becomes a wrong test. Ordered by harm:

1. **`references/scripts.md`** — instructs the conductor to `--skip F4` based on a bug since
   fixed. Actively causes a gate to be skipped.
2. **`CHANGELOG.md` v0.1.2** — describes a Bash-gate restoration that was subsequently
   re-deleted. Record the v0.2.0 regression and the Phase 0 fix.
3. **Stale counts and claims** in `DESIGN.md`, `ECOSYSTEM_GRAPH.md`, `SKILL.md` (hook and script
   counts, `dashboard.mjs` marked TODO though built, scope-boundary phase carve-out, review-round
   cap now hook-enforced).
4. **`install.mjs:530`** — writes a `ZODYSSEY_UNGATE_BASH` claim into every user's `AGENTS.md`.
   Now true again after Phase 0; keep the registry assertion so it cannot silently become false.

Deferred to Phase C: `RESUME.md`'s "pipeline wins +0.25 on architecture tasks." It is n=1 per arm
with a hand-produced baseline, and should not be a stated value proposition — but correcting it
belongs with the measurement work that would replace it.

### Data flow
CI → `npm test` → `run-tests.mjs` → each test spawns the real hook or script as a subprocess
against a hermetic temp fixture → exit codes aggregate → non-zero fails the build. The thing under
test is never mocked.

### Error handling
Hermetic temp dirs with cleanup · no network · no real LLM CLI spawned (`consult.test.mjs`
already establishes the stub-`spawn` pattern) · no wall-clock dependence in assertions.

### The prove-it-fails rule
**A new invariant test must be demonstrated failing against the broken code before it counts.**
Phase 0 ran its suite against the v0.2.0 hook and got 11 failures; without that step, a test
asserting `exit === 2` that silently never runs is indistinguishable from a passing one. This is
the same discipline as the security-research finding where ten reviewer agents unanimously
endorsed a non-existent OpenSSL vulnerability and only an executed test killed it.

## 7. Phase B — close the self-grading loop

Ordered by accuracy gained per line written. Sizes are estimates from the competitive scan and the
gap audit.

| # | Fix | ~Lines | Rationale |
|---|---|---|---|
| B1 | Verdict ambiguity → `missing`, never approval | 20 | Fixes F2/F4 accepting a REJECT artifact. Port omo's `classifyFinalWaveVerdict`; both-or-neither match must never resolve to approval |
| B2 | Append-only notepads (block `Write`, allow `Edit`) | 10 | Closes the evidence-integrity hole: verdicts are nonce-bound, their inputs are not |
| B3 | Test-integrity guard | 30 | Deleted test files, net-negative test-file line count, added skip/xfail/`.only`. **No orchestrator has this.** F1 already shells `git diff`; add `--numstat` + test pathspec |
| B4 | F1 converse: declared-but-untouched | 15 | Detects a silently skipped todo. Both sets already in scope at that line |
| B5 | Test files read-only at the hook layer | 10 | Highest-evidence intervention in the research; the hook already blocks by path |
| B6 | Criteria must invoke `toolchain.test_cmd` | 40 | Breaks the self-grading loop — criteria stop being agent-invented. Requires wiring `probe-toolchain.mjs` (B7) |
| B7 | Call `probe-toolchain.mjs` in the pipeline | 5 | Revives the post-edit lint arm and the toolchain-aware criterion lint, both dead by default |
| B8 | Pass-to-pass regression gate | 120 | Snapshot passing tests at `phase→execute`, re-run at verify, any pass→fail is a hard failure. **Net-new in the ecosystem** |
| B9 | Package-existence check | 20 | 19.7% hallucination rate across 576k samples; closes the slopsquatting class |
| B10 | Pre-edit lint baseline | ~210 + suite | **Shipped v0.6.4.** First-touch pre-edit baseline (frozen per target per run) + attributed comparison: blocks only diagnostics NEW to the edit; pre-existing noise and capability failures record `inert` |

B1–B4 total ~75 lines and each closes a confirmed hole.

**Explicitly not doing:** additional adversarial panels or reviewer agents. The evidence is
against them, and MAST's finding is that these are orchestration-design failures rather than
model-capability failures — more agents add cost and new failure modes.

## 8. Phase C — efficacy measurement (decision point, not a commitment)

Phase C asks the existential question: does the pipeline beat a single agent? Making it real
requires fixing the `REPLACE_WITH` mismatch, building actual fixtures, and implementing the
baseline arm — which today prints instructions to a human and is marked TODO, while `judge.mjs`
hardcodes `arm: "zodyssey"` on every record regardless of `--arm`.

**Honest risk assessment.** Each datapoint is a full multi-agent run: expensive, slow, stochastic.
Temperature 0 is not deterministic for agentic tasks, and the reliability metric is `pass^k`
(succeeds on all k attempts), not `pass@k`, which punishes within-task variance multiplicatively.
Five seeds cannot distinguish a real 10% gain from noise, and `MEASUREMENT.md` already concedes
that 20 tasks carries high variance.

There is a real chance a statistically credible efficacy eval costs more than it is worth at this
project's scale. That possibility should be evaluated after Phases A and B, with the invariant
suite in place, rather than committed to now.

**Accepted consequence of ordering B before C:** accuracy fixes ship justified by external
evidence, without local proof they helped ZOdyssey specifically. This is a deliberate trade — the
alternative blocks every improvement behind an eval that may never reach adequate power.

## 9. Open questions

1. Whether B8 (pass-to-pass regression gate) should hard-fail or record evidence in v1. It is the
   most expensive item and the most likely to produce false failures on flaky suites;
   `record-verify.mjs --flake-check` already exists and may need to gate it.
2. Whether the doc-code registry should be generated from a machine-readable claims file rather
   than hand-maintained. Hand-maintained is proposed for v1 on the grounds that a short honest
   list beats a long rotting one, but this inverts if the registry grows past ~15 entries.
3. Commit and branch strategy, given 28 files of in-flight v0.3.0 in the working tree.

## Appendix A — evidence

Benchmark integrity: OpenAI's SWE-bench Verified retirement (59.4% of audited failures had
material test/description defects) · eight agent benchmarks scored ~100% by pure exploitation ·
`pass^k` vs `pass@k` · repeated-run non-determinism at temperature 0.

Interventions: ImpossibleBench (arXiv 2510.20270) · TestPrune (2510.18270) · SWT-Bench
(2406.12952) · TiCoder (2208.05950) · package hallucination (USENIX ;login:) · MARIN API
hallucination · iterative self-repair (2604.10508) · AOrchestra context curation (2602.03786).

Disconfirming: multi-agent debate failure modes (2509.05396) · MAST (2503.13657) · LLM-judge bias
(2604.16790) · AI code review → code change rates (2508.18771) · AGENTS.md evaluation (2602.11988)
· Instructions-as-Code (2606.13449) · Böckeler on SDD tooling (martinfowler.com).

Vibe-coding defects: 302,579 AI-attributed commits, >15% introducing ≥1 issue, 22.7% surviving to
latest version (2603.28592) · Endor Labs FuncPass/SecPass divergence (84.4% functional vs 7.8%
security) · GitClear duplication trends (correlational, vendor).

Vendor-funded or unreplicated claims are marked as such in the research record and were not used
to justify any item above on their own.

## Appendix B — verification status

Every ZOdyssey-specific claim in §1 was verified by reading the source directly, not accepted from
a subagent report. Claims about third-party projects (the ecosystem null result, claude-flow's
ADR-093 and its fail-open witness chain) are relayed from the competitive scan and are **not**
independently verified.

---

## Status addendum — 2026-08-16

**Appended, not inserted.** The body above is kept byte-for-byte as the record of what was believed
on 2026-08-11, and this block lives at the end so that every `file:line` citation into this document
stays valid. Fourteen citations across `docs/ideation-report.md`, `docs/impl/07`, `docs/impl/08` and
`docs/impl/00-INDEX.md` point into the sections above; an insertion at the top would have silently
broken all of them. (That is not hypothetical — it was done, measured, and reverted to produce this
form. The check that would have caught it is queued as `docs/impl/15-anchor-drift-check.md`.)

**All of Phase B shipped** across v0.3.2–v0.6.4. B1–B7 and B9 landed by v0.5.2; B10 (the pre-edit lint baseline) landed in v0.6.4. §7 is therefore
a *proposal table*, not a status table — do not read a row in it as a claim that the item is
unbuilt, and do not read it as a claim that a shipped item works.

**B8 is half-shipped, and this document's framing hid it.** The §7 row reads "Snapshot passing tests
at `phase→execute`, re-run at verify, any pass→fail is a hard failure." The snapshot half is wired
(`set-phase.mjs:339`, `record-review.mjs:295`, both `--snapshot`). The re-run half is not:
`regression-gate.mjs --check` has **zero code callers**, and `--check` is the only writer of
`status: "regressed"` (`regression-gate.mjs:181`) — the exact field `set-phase.mjs:131` refuses
`done` on. The baseline is taken automatically, the comparison never runs, and the refusal reads a
field nothing populates. **The gate has never fired.**

This bears on §2's ecosystem null result. "No orchestrator implements a pass-to-pass regression
gate" remains true of the surveyed field — and is now also true of ZOdyssey, which ships one that
never runs. Do not use it as a differentiator until `--check` is invoked from a transition
(queued as `docs/impl/02-wire-zero-caller-checks.md`).

§9 open question 1 — whether B8 should hard-fail or record evidence — is therefore not yet live:
the gate does neither. Answer it after wiring, not before.

**A4 is half-true.** No unified registry exists, but four standing doc-claim invariant suites
deliver its function domain-by-domain. Queued as `docs/impl/08-claim-assertion-coverage-ledger.md`.

Successor documents: `docs/OPPORTUNITY-MAP.md`, `docs/ideation-report.md`, and the build queue in
`docs/impl/00-INDEX.md`.
