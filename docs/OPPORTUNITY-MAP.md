# ZOdyssey opportunity map

**Date:** 2026-08-15
**Status:** discovery output — answers `docs/ideation-prompt.md`. Nothing here is scheduled or
committed work. Ranked by (evidence strength × leverage) ÷ cost.
**Method:** every ZOdyssey-specific claim below was verified by reading the source or running the
code, not inherited from the brief or from a subagent. External claims carry a source and a note
when they are survey-based, vendor-adjacent, or unreplicated. See Appendix B for what was *not*
verified.

---

## 0. Corrections to the brief

The ideation brief is stale in both directions. Where it and the code disagree, this section
records what the code says.

### 0.1 B9 is built. What is missing is a caller.

`skills/odyssey/scripts/check-imports.mjs` exists (161 lines), passes `check-imports.test.mjs`,
cites the 19.7%/576k figure in its own header, and is offline by construction. It is referenced in
`README.md`, `references/scripts.md`, `MEASUREMENT.md` and `CHANGELOG.md` — and by **zero** `.mjs`
files. `scripts.md` says "Run it during verify on the run's changed files." That is an instruction
to a model.

The check is code. Its invocation is prompt convention. See §1.3 — this is not an isolated case.

### 0.2 The residual list is incomplete, and the omitted item is the most severe

`CHANGELOG.md` v0.5.1 "Known, not fixed" names seven residuals. The brief carries two of them. The
one it omits is the worst:

> **The Edit-path scope gate is skipped for targets outside `PROJECT_DIR`** (`if (rel)` with `rel`
> empty), while the Bash twin fails closed.

Probed against the deployed hook with a valid marked run, `verdict: OKAY`, phase `execute`, and a
plan declaring only `src/text.js`:

| probe | exit | |
|---|---|---|
| `Edit` → `/tmp/outside/victim.txt` | **0** | outside `PROJECT_DIR` |
| `Write` → `skills/odyssey/hooks/pre-tool.mjs` | **0** | ← the enforcement gate itself |
| `Write` → `~/.zcode/cli/config.json` | **0** | ← the hook registry |
| `Bash` → `sed -i s/a/b/ <same hook file>` | 2 | the twin blocks |
| `Edit` → `src/other.js` (in-repo, undeclared) | 2 | control |
| `Edit` → `src/text.js` (declared) | 0 | control |

Mechanism: `classifyTarget` returns `rel: ""` for a target outside both the run repo and
`PROJECT_DIR`; the scope check is wrapped in `if (rel) { … }`, so it is skipped, and execution
falls through the file-lock branch (also `if (rel)`) to `exit(0)`.

The CHANGELOG frames this as a gate asymmetry. Its actual blast radius is that **an approved run
can delete the write-gate** — the repo's canonical worst incident (`5c99927`, `e57b01b`), now
reachable from inside a normally-gated execute phase without forging a verdict, a nonce, or a run
marker. It is also the class of CVE-2025-59536 (repo-planted agent hook config executing when the
agent opens the repo). This belongs at the top of the queue, not in a residual list.

Reproduction script: Appendix C.

### 0.3 The eval has produced numbers — five of them

`~/.zcode/orchestration/eval/judged.jsonl`, dated 2026-08-01:

| seed | zodyssey | baseline | Δ |
|---|---|---|---|
| std-01 | 0.83 | 0.83 | 0.00 |
| arch-01 | 0.87 | 0.62 | +0.25 |

`harness.mjs --list` reports **18/18 seeds runnable**; all four fixtures exist on disk. The
`REPLACE_WITH` sentinel match was replaced with `existsSync`, and the runner now exits 4 when every
seed skips.

`judge.mjs:278` hardcoded `arm: "zodyssey"` (**fixed 2026-08-17**: now derives from the slug suffix via `lib/arm.mjs`), and the damage was visible in the data
(`slug: "std-01-baseline", arm: "zodyssey"`). But `dashboard.mjs:20` states the field is unreliable
and derives the arm from the slug suffix instead. **The arm bug is a data-hygiene defect, not the
Phase C blocker.**

The real blocker is `harness.mjs:13-16` plus the baseline arm printing instructions to a human —
the pre-item-09 state, narrated at `CHANGELOG.md:47`; the zodyssey arm is not automated either.
Every datapoint costs an operator. So: n=1 per arm, 14 days and 12 releases stale, and the lone
`+0.25` on arch-01 is both the project's entire empirical basis and `ROADMAP.md §A6`'s retraction.

### 0.4 A4's pattern shipped; its index did not

`scripts/version-consistency.test.mjs` and `scripts/deploy-surface.test.mjs` are A4-shaped
invariant tests — each headed by the incident it defends against, each asserting a standing claim
rather than a diff. What does not exist is the **map from documented claims to assertions**, so
nothing can answer "which documented guarantee currently has no test?"

That is the question that would have caught the write-gate deletion. `deploy-surface.test.mjs`
already solved the same inversion for files — it "asserts *coverage* rather than a blessed list of
filenames — a list would be the same bug in test form." A4 needs that move applied to claims. See
§2.2.

### 0.5 Phase B is largely done

| item | status |
|---|---|
| B1 verdict ambiguity → `missing` | shipped (`classifyVerdict`, fail-closed; shared via `lib/verdict-schema.mjs`) |
| B2 append-only notepads | shipped, **both** Edit and Bash paths |
| B3 test-integrity guard | shipped (deleted files, net-negative `--numstat`, skip/xfail/`.only`) |
| B4 F1 converse (declared-but-untouched) | shipped, with `--allow-untouched` waiver recorded |
| B5 tests read-only | shipped, scoped to `verify`/`final`, both paths |
| B6 criteria must invoke `toolchain.test_cmd` | partial (`parse-plan --lint` gates executability) |
| B7 call `probe-toolchain.mjs` | shipped (five code callers) |
| B8 pass-to-pass regression gate | **HALF-SHIPPED — corrected 2026-08-16.** The `--snapshot` half is wired (`set-phase.mjs:339`, `record-review.mjs:295`). The `--check` half has **zero code callers**, and `--check` is the only writer of `status: "regressed"` (`regression-gate.mjs:181`) — the field `set-phase.mjs:131` blocks `done` on. The baseline is taken automatically; the comparison never runs, so the gate has never fired in an automated path |
| B9 package-existence check | **built but never invoked from code** (§0.1) |
| B10 pre-edit lint baseline | **absent** — `post-tool.mjs` lints the edited file with no before-reading |

Suite state at time of writing: `node scripts/run-tests.mjs` → **32/32 suites pass, 53.6s**.

---

## 1. Which harness layer is weakest

The brief's five-layer taxonomy (tool orchestration · verification loops · context/memory ·
guardrails · observability) is used as given; no canonical source for it was found.

The brief guesses context/memory and observability. That is half right, and the missing half is
the one that matters.

### 1.1 Context/memory — weakest, and inert rather than thin

`set-phase.mjs:469-477` writes a fixed two-line template on every terminal transition. The entire
production corpus, `.zcode/memory/outcomes.jsonl`, is 8 lines of
`"run <slug> reached done at <iso>"` / `"transition: done"`. Exactly one entry carries content —
the `v0-3-1-audit` review-gate deadlock — because a human passed `--note`.

The read side (`recall-outcomes.mjs`, `recall-corrections.mjs`) has **zero code callers**; both are
phase-1 prompt instructions in `SKILL.md`. The canonical store is named as the memory MCP, written
"before the run truly closes," by instruction, with nothing checking.

A memory system with no writer of substance and no enforced reader.

### 1.2 Observability — not thin, actively misleading

`set-phase.mjs:430-450` appends every terminal run's scorecard to
`$HOME/.zcode/orchestration/eval/results.jsonl` unconditionally — **including from the hermetic
test suite**. The corpus:

- 172 records. **17** carry `slug: "t"`, `intent: null`, `todos_total: 0`, `success: true` — the
  hook-test fixtures, writing into the operator's production trend log.
- `add-truncate` contributes **127** records from one fixture on a single day (2026-08-11).
- `dashboard.mjs` consequently reports a 100% win-rate for nearly every seed.

This is the vacuous-pass class — the failure mode the project keeps fixing in F1 — relocated one
layer up: a metrics system that cannot detect the failure it exists for, reporting success over a
set that is roughly 90% synthetic.

Token accounting is honest about being estimates (`attribution: "time-window"`; the CHANGELOG
concedes two readers derived 10.8M and 24.3M for "the same run"). Honest imprecision on a
contaminated denominator is still not observability.

### 1.3 Tool orchestration — the actual weakest layer

Of 26 non-test scripts, **eight have zero code callers**:

```
build-capsules  check-imports  compact  coverage-delta
dashboard       recall-corrections  resolve-capabilities  status
```

Two are views. Six are mechanisms; three of those are checks.
`resolve-capabilities.mjs` is worse than uncalled — it writes `capabilities.lock.json`, which
**nothing reads**. F5 cross-checks `state.capabilities[]` from the hook instead.

So the architecture is: **gates live in hooks (enforced); checks live in scripts (convention).**
The best-evidenced intervention in the repo fires only if a 34 KB prompt is followed. That is
"ceremony without mechanism" in its newest and least visible form, and it is absent from the
roadmap because the roadmap counts a check as shipped when the file exists.

### 1.4 Where the project is genuinely strong

Verification loops. F1 machine-checks scope in both directions; test-integrity is real; verdict
parsing fails closed on ambiguity; `record-verify` executes declared criteria rather than trusting
a claim. **Corrected 2026-08-16:** this section originally also claimed the pass-to-pass regression
gate is enforced at `done`. It is not — only its baseline half is wired (§0.5). The gate is built,
tested and never invoked, which moves it out of this section and into the §1.3 zero-caller finding
as that finding's most consequential member. The ecosystem null result — that no surveyed
orchestrator implements a pass-to-pass gate or a test-deletion detector — was not disconfirmed by
this pass, but ZOdyssey does not currently implement one either: it ships one that never runs.

Guardrails is the second-strongest layer and carries the §0.2 hole.

---

## 2. Three structural changes

Each eliminates a class of defect rather than an instance.

### 2.1 S1 — confine the process; stop classifying the command

`WRITE_PATTERNS` is ~40 entries. Three of the named residuals share one root cause: deciding
*whether a string will write* before a shell has parsed it.

- **F** — shell-level escaping (`p\ython -c`, `py''thon -c`) reassembles the token after the gate
  read it.
- **G** — the interpreter list is unbounded by construction (`gawk`, `mawk`, `pypy`, `raku`,
  `jshell`, `ts-node`, …).
- **H** — accepted over-blocks: `/usr/bin/git status` is gated because "is this path safe to
  execute" needs an allowlist.

Head-allowlist inversion (the terminus the CHANGELOG names) flips the sign but stays in the same
game, and it cannot touch the Edit-tool path at all — which is where §0.2 lives.

Both major harnesses moved past this in 2026. Claude Code ships Seatbelt (macOS) / bubblewrap +
seccomp (Linux) with writes limited to the working directory and network via an out-of-sandbox
proxy, reporting an 84% cut in permission prompts. Codex CLI ships Landlock + seccomp / Seatbelt /
restricted tokens, network off by default, writes limited to the workspace. A kernel-enforced write
set is not defeated by `p\ython`, does not care that `mawk` is unlisted, and does not over-block
`/usr/bin/git status`.

**Honest constraint:** ZOdyssey cannot wrap the harness's Bash tool, so full S1 depends on harness
support. The in-constraint version of the same class kill is available today and is what should
ship first: make the gate **target-oriented rather than command-oriented on every path** — compute
a write-target set, require containment in `declared ∪ bookkeeping`, and remove the `if (rel)`
escape so an unclassifiable target blocks instead of passing. That closes §0.2, closes the
lexical/symlink new-file residual, and demotes `looksReadOnly` from a containment mechanism to a
permission heuristic, which is the only role it can actually hold.

### 2.2 S2 — invert the registry from "tests I wrote" to "claims that exist"

A4 as specified enumerates 8–12 assertions, so it can only ever cover claims someone remembered.
Build the ledger from the other end:

1. Extract the claim set mechanically — every enforced-column row in `README.md`'s comparison
   table, every "blocks / requires / enforces" sentence in `DESIGN.md §6`, every documented exit
   code in `references/scripts.md` — into a machine-readable file.
2. Link each row to the assertion that defends it.
3. **Fail CI on any claim with no linked assertion.**

This is the only structure that detects *unchecked claims*, which is the single thing that would
have caught the write-gate deletion in v0.1.1 and again in v0.2.0. `deploy-surface.mjs` already
proved the pattern in this repo. Expect red on arrival; `ROADMAP.md §4` already accepts that
framing.

### 2.3 S3 — make invoking a check a phase transition, not an instruction

Every zero-caller mechanism becomes a precondition inside `set-phase.mjs`. B8 is the model for the
shape (`:206-211` snapshots at `execute`; `:124-140` refuses `done` on `regressed` and correctly
treats `toolchain-drift` as failure rather than a pass) — **and, corrected 2026-08-16, also the
cautionary case.** Only the producer half is wired: `--check`, the sole writer of the status the
refusal reads, has no code caller, so the refusal reads a field nothing populates.

That makes the class one notch wider than first stated. It is not only "the mechanism shipped and
its invocation stayed conventional" but **"a mechanism wired on one side only"** — a consumer with
no producer reads as enforcement and is inert. Any wiring done under S3 must assert both ends in
the same test, or it reproduces exactly this.

| check | transition | on unsupported repo |
|---|---|---|
| `check-imports` | verify → final | `inert` |
| `resolve-capabilities` | before F5 (and something must read the lock) | `inert` |
| `coverage-delta` | at verify | `inert` |

This eliminates the class "we built the mechanism and left its invocation to the prompt," which
currently covers six shipped mechanisms and is the largest remaining gap between what `README.md`
claims and what the code enforces.

None of the three adds an LLM opinion layer.

---

## 3. The opportunity map

| # | Item | Claim | Evidence | Cost | What it breaks |
|---|---|---|---|---|---|
| **1** | **Close Edit-path containment** (`rel === ""` → block; same for the lexical/symlink new-file case) | An approved run can overwrite `pre-tool.mjs` and `~/.zcode/cli/config.json` with the Edit tool | **Demonstrated** against the deployed build (Appendix C); named in CHANGELOG v0.5.1 | ~5 lines + paired probe | Nothing real — the Bash twin already refuses these, so the paths *converge* |
| **2** | **Wire the six zero-caller mechanisms into `set-phase`** (S3) | The best-evidenced check in the repo fires only if a prompt is obeyed | 19.7% of 576k LLM-recommended packages do not exist (Spracklen et al., USENIX Sec 2025); internally, `probe-toolchain`'s own history of being dead by default | ~40 lines | Noisy repos — must degrade to `inert`, never block |
| **3** | **Claim→assertion coverage ledger** (S2) | Nothing today can name an unguarded documented claim | Strongest evidence in the repo: gate deleted twice, three external audits missed it | ~150 lines + claims file | CI red on day one. That is the deliverable |
| **4** | **Decontaminate the metrics corpus** | ~90% of the trend log is test fixtures and repeated smoke runs; the dashboard reports 100% | Direct inspection (§1.2) | ~10 lines (env guard on the append + purge synthetic slugs) | Historical trend resets. It was never real |
| **5** | **Automate one eval arm end-to-end** (+ 2-line `--arm` fix in `judge.mjs`) | The only thing that can falsify the project's premise | **No published outcome evidence that ZOdyssey helps.** Local evidence is n=1 per arm, 14 days and 12 releases stale | High — needs headless `/orchestrate` | Nothing. Blocks #9 until done |
| **6** | **Retire `ZODYSSEY_UNGATE_BASH`, or make it loud** | One env var disables the whole Bash gate. `pre-tool.bash-gate.test.mjs:5` records that mirroring the author's local `UNGATE=1` copy is *how v0.1.1 shipped the gate deleted*; `install.mjs` still advertises it in every user's `AGENTS.md` | Internal, causal | ~15 lines (record every ungated call into run state) | The author's personal workflow |
| **7** | **Process confinement** (S1, full) | Kills residual classes F, G and H at once | Claude Code and Codex both shipped OS-level sandboxing in 2026; Anthropic reports 84% fewer permission prompts. Capability-minimization framing exists as a preprint (arXiv 2606.13884) whose numbers could not be extracted — **framing, not evidence** | High + harness dependency | The ungate hatch; builds that legitimately write outside cwd |
| **8** | **Emit OTel GenAI spans** (`invoke_agent` → `execute_tool`) | Replaces time-window token attribution with real per-dispatch attribution, and makes the data legible to standard tooling | Industry converged; Claude Code emits (beta). **Caveat: every `gen_ai.*` attribute is still "Development" stability, none Stable** | Medium | Nothing; additive |
| **9** | **Measure the 164 KB prompt surface** (`SKILL.md` alone is 34 KB) | The largest untested artifact in the project | Genuinely contested: Gloaguen et al. (arXiv 2602.11988) — LLM-written context files ≈ −3% success, human-written ≈ +4%, **+20% inference cost**; Lulla 2026 counters with −28.6% runtime on focused PRs | Low — **but blocked on #5** | Nothing. Do not cut prompts on intuition; the direction is contested |
| **10** | **User-confirmed acceptance criteria at PRIME** | Closes the last self-grading gap: prometheus authors the criteria, momus declines to judge them | TiCoder: **+22.49 to +53.98 absolute pass@1** with 1–5 user queries (arXiv 2208.05950). The mechanism is *interactive user queries*, not planner-authored criteria — so the evidence supports asking the user, not adding a reviewer | Low — PRIME already has the "max 3 questions, then commit" ritual | Interactivity in headless runs |
| **11** | **B10 pre-edit lint baseline** | Pre-existing lint noise was attributed to the edit | **Shipped v0.6.4** — no published analog; the baseline-before-measurement reasoning is the design | ~210 hook lines + 365-line paired suite | One extra pre-edit lint per file per run, 5s-capped |
| **12** | **Nonce minter allowlist** | Segment-tolerant matching grants any `*:momus` / `*:oracle` / `*:code-reviewer` the nonce lanes; `capability-name.mjs`'s header claims an exemption that is false in code | Named in CHANGELOG v0.5.1 | ~10 lines | Third-party reviewer packagings |
| **13** | **Prune stale plugin-cache versions** | Five versions accumulate with no pruning | Known, trivial | ~20 lines | Rollback convenience |
| — | ~~Per-test regression granularity~~ | **Do not build.** `MEASUREMENT.md` already concedes suite-level only; per-test needs runner-specific parsing that will rot — enumeration failure wearing a different hat | — | — | — |

Items checked against the project's five named failure modes: none is an enumeration round (#1, #2,
#3 and #7 are the anti-enumeration items); none is a check that cannot see its own failure class
(#3 and #4 exist specifically to fix instances of that); none is ceremony without mechanism (#2 and
#10 convert ceremony *into* mechanism); none is self-grading (#10 routes to the user, not to
another agent); none reopens its own class (#1 makes two paths converge rather than adding a
pattern). No item adds an LLM opinion layer.

---

## 4. What "swiss army knife" should mean

**Breadth is the wrong goal, and pursuing it is currently making the product worse.**

Every capability added over the last six releases landed on the *convention* side of the
enforced/dispatched boundary: six mechanisms with no caller, and an 18 KB capability-routing table
that F5 checks only for **declaration consistency** — F5 verifies the run did what it said it would
do, not that what it said was right. More MCPs, more languages, more skills all widen the surface
that a 34 KB unmeasured prompt is responsible for.

The differentiator is real and narrow: **ZOdyssey is the only orchestrator in the surveyed field
whose pipeline guarantees are executable rather than conventional.** The 2026 spec-framework
landscape sorts by gate strictness — OpenSpec has no gates, Spec Kit's are bypassable, BMad and
Gangsta Agents enforce phases, Superpowers is a skills library rather than a schema. All of them
enforce *phase ordering*. None enforces *what the model may touch, when, and on what evidence, at
the tool call*. That is a harder claim, and ZOdyssey is the only one making it.

So the product statement is **not "the orchestrator that does the most" but "the orchestrator whose
claims you can execute."** The shippable form of that is S2 made public: a claim ledger where every
row links a documented guarantee to the assertion that defends it *and the probe that proved it
fails without it*. The paired old/new probe discipline this project already runs (18 findings, 61
paired assertions in v0.5.0; it caught two incomplete fixes inside its own release) is a rare
artifact that nobody else in the field publishes. Lead with it.

Breadth should be earned one enforced hook at a time. A capability that is not gated is not a
ZOdyssey feature; it is a skill the user could install directly.

---

## 5. The strongest argument against the core bet

Not "gates are wrong." This:

**Gates relocate failure rather than remove it, each relocation is less visible than the last, and
the cost is now measurable while the benefit is not.**

The repo supplies its own evidence. The gate has been the *cause* of failure at least three times:

- **SEC-6b** — every route to recording an OKAY was closed at once; no gated run could leave phase
  3. It stayed latent only because the Bash gate was deleted from v0.1.1 through v0.3.1. Restoring
  a dormant guard woke a total deadlock.
- **R2 (v0.5.1)** — `\bsh\b` matched the extension in `deploy.sh`, so `cat deploy.sh`, `wc -l
  build.sh` and `ls *.sh` were blocked in every phase.
- **Shakedown round 3** — the trusted-invoke metachar rule blocked criteria containing parentheses,
  so the tester recorded 1 of 4 acceptance criteria and the run reached `done` with
  `acceptance {pass: false, criteria_run: 1, criteria_declared: 4}`. A rule protecting the evidence
  chain degraded it.

Against five releases of security work, the measured accuracy benefit is one architecture seed at
n=1. Meanwhile the platform underneath has started enforcing filesystem confinement at the kernel —
strictly stronger than any regex, at zero cost to this project. The steelman is uncomfortable:
**ZOdyssey may be paying a high and rising price for a weaker version of what the harness now gives
away, while the intervention with the best published evidence (executable intent, TiCoder-style)
remains authored by the agent being graded.**

The second-order version is harder. If multi-agent debate degrades accuracy, LLM judges run 60–67%
on hard code cases against 95–97% on easy ones with 13.6% pairwise flip rates, and AGENTS.md-style
context can cost 20% for nothing, then the honest possibility is that **ZOdyssey's measurable
contribution is negative and its guardrails insure against a threat model — a prompt-injected
executor inside an approved run — that has not been observed happening to this user.** The
field-wide numbers are real (1.8M injection attempts at a 3.3% policy-violation rate; Clinejection;
GTG-1002), but they describe agents reading untrusted repository content, a threat these gates
address only partially — and §0.2 is precisely the path that threat would take.

### What would settle it

A three-arm eval on ≥20 seeds, scored on `pass^k` rather than `pass@k`:

1. judged-score delta, zodyssey vs single-agent baseline;
2. **gate-caused failure rate** — runs where a hook blocked legitimate work or deadlocked. Never
   counted today; every incident above would have registered;
3. the same run with gates disarmed (`ZODYSSEY_UNGATE_BASH=1`), isolating the gate's contribution
   from the pipeline's.

If (1) minus (2) is not clearly positive, the bet is wrong as implemented.

**The practical asymmetry:** (2) is measurable *today* from `run-report`'s `hook_blocks` plus a
"was this block correct" annotation, at a fraction of (1)'s cost. Start measuring the cost side
before spending on the benefit side — the cost side is cheap, currently zero-instrumented, and is
where every observed failure of the last five releases actually landed.

This is also why item #1 outranks everything: it is simultaneously the most severe open defect and
among the cheapest, and it needs no eval to justify.

---

## Appendix A — sources

**Package hallucination / supply chain**
Spracklen et al., *We Have a Package for You* (USENIX ;login: / USENIX Security 2025) — 19.7% of
recommended packages across 576,000 samples from 16 models do not exist; open-source models 21.7%,
commercial 5.2%; 38% conflations, 13% typo variants, 51% fabrications ·
<https://www.usenix.org/publications/loginonline/we-have-package-you-comprehensive-analysis-package-hallucinations-code>
· PackMonitor, arXiv 2602.20717 · CSA slopsquatting research note, 2026-04.

**Test integrity / reward hacking**
ImpossibleBench, arXiv 2510.20270 — hiding test files drops hacking to near zero but degrades
legitimate performance; **read-only access is the recommended middle ground**, which is what B5
implements (writable in `execute` for TDD, frozen in `verify`/`final`) ·
<https://arxiv.org/html/2510.20270v1>

**Executable intent**
TiCoder, arXiv 2208.05950 — +22.49 to +53.98 absolute pass@1 with 1–5 *simulated user queries*.
The mechanism is interactive intent formalization, not planner-authored criteria · user study
arXiv 2404.10100 · Intent Formalization as a grand challenge, arXiv 2603.17150.

**Disconfirming — reviewer layers and judges**
Multi-agent debate failure modes, arXiv 2509.05396 · sycophancy in debate (ICLR 2026 submission,
OpenReview `hkBM5QkFVg`) · LLM-as-judge on SE, arXiv 2604.16790 — 60.24% (CodeGen), 65.82%
(CodeRepair), 67.23% (TestGen) on hard subsets vs 95–97% easy · The Coin Flip Judge, arXiv
2606.13685 — 13.6% mean pairwise flip rate; ~11 trials to recover a 50-trial reference verdict.

**Context files**
Gloaguen et al., *Evaluating AGENTS.md*, arXiv 2602.11988 — LLM-generated context files ≈ −3%
success, human-written ≈ +4%, **>20% inference cost** · counter-result: Lulla 2026, −28.6% runtime
and −16.6% output tokens on focused PRs (measures cost, not correctness) · Probe-and-Refine
repository guidance, arXiv 2606.20512.

**Repair loops**
Iterative self-repair across model scales, arXiv 2604.10508 — two rounds capture 76–95% of
achievable gain · To Run or Not to Run, arXiv 2606.26978.

**Sandboxing / capability minimization**
Claude Code and Codex sandbox internals (Seatbelt · bubblewrap+seccomp · Landlock) — Anthropic
reports an 84% reduction in permission prompts; write access limited to the working directory,
network via out-of-sandbox proxy · Capability Minimization as a Safety Primitive, arXiv 2606.13884
— **preprint; the PDF's numbers could not be extracted, so it is cited as framing, not evidence**.

**Observability**
OpenTelemetry GenAI semantic conventions, 2026 — `invoke_agent` → `chat` / `execute_tool` span
tree; Claude Code emits in beta. **Every `gen_ai.*` attribute still carries "Development"
stability; none is Stable.**

**Threat landscape**
CSA research note on Claude Code GitHub Action prompt injection · CVE-2025-59536 (repo-planted
agent hook configuration) · Clinejection, 2026-02-17 · GTG-1002 · OWASP 2026 LLM Security Report ·
measured 1.8M injection attempts with >60,000 policy violations (3.3%).

**Harness leverage / ecosystem**
Coding-agent harness benchmarks: the same model moved 23%→52% pass@1 on SWE-bench Pro across
harnesses (and 15%→36% on a second model) · 2026 spec-framework comparison (OpenSpec, Spec Kit,
Superpowers, BMAD, GSD) for the gate-strictness landscape.

**Marked as weak evidence**
The least-privilege 17% vs 76% incident-rate figure traces to the *2026 Infrastructure Identity
Survey*, relayed through vendor security blogs. Survey-based and correlational; it is not used to
justify any item above on its own.

---

## Appendix B — verification status

**Verified by reading source or running code:** every claim in §0, §1 and §2 about ZOdyssey's own
behaviour. Specifically — the caller census (grep over all `.mjs`), `check-imports.mjs` and its
absence of callers, the `judged.jsonl` / `results.jsonl` / `outcomes.jsonl` contents, the 32/32
suite run, `harness.mjs --list` reporting 18/18, `dashboard.mjs`'s slug-derived arm workaround, the
zero consumers of `capabilities.lock.json`, and the §0.2 probe results (Appendix C).

**Verified by web search against primary or near-primary sources:** every external number in
Appendix A. Where a source is a preprint, a survey, or a secondary relay, it is labelled as such
inline.

**Not verified:** the ecosystem null result (that no other orchestrator implements a pass-to-pass
gate or test-deletion detector) is relayed from the earlier competitive scan and was not
independently re-run. The five-layer harness taxonomy has no canonical source that could be found;
§1 answers it as given. The `+0.25` arch-01 delta is reported as recorded — the underlying run was
not re-executed.

---

## Appendix C — reproduction of §0.2

Run against the deployed hook, not a mock. Mirrors `pre-tool.scope.test.mjs`'s fixture
construction, including the v0.5.0 authenticity marker.

```js
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stampMarker } from "<repo>/skills/odyssey/scripts/lib/state-auth.mjs";

const HOOK = "<repo>/skills/odyssey/hooks/pre-tool.mjs";

function repo() {
  const r = realpathSync(mkdtempSync(join(tmpdir(), "zod-probe-")));
  mkdirSync(join(r, ".zcode", "state"), { recursive: true });
  mkdirSync(join(r, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(r, "src"), { recursive: true });
  writeFileSync(join(r, "src", "text.js"), "//\n");
  const planPath = join(r, ".zcode", "plans", "t.md");
  const planText = "# t\n\n## Todos\n\n- [ ] 1. go\n  - Files: [`src/text.js`]\n";
  writeFileSync(planPath, planText);
  writeFileSync(join(r, ".zcode", "state", "t.json"), JSON.stringify(stampMarker({
    slug: "t", phase: "execute", updated_at: new Date().toISOString(), plan_path: planPath,
    review: { verdict: "OKAY", round: 1, max_rounds: 3,
              plan_sha256: createHash("sha256").update(planText).digest("hex") },
  }, "t"), null, 2));
  return r;
}

const hook = (r, tool_name, tool_input) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ tool_name, tool_input }), encoding: "utf8",
  env: { ...process.env, CLAUDE_PROJECT_DIR: r, ZODYSSEY_UNGATE_BASH: "" },
}).status;

const r = repo();
console.log(hook(r, "Edit",  { file_path: HOOK }));                       // 0  ← the gate itself
console.log(hook(r, "Write", { file_path: HOOK }));                       // 0
console.log(hook(r, "Bash",  { command: `sed -i s/a/b/ ${HOOK}` }));      // 2  ← the twin blocks
console.log(hook(r, "Edit",  { file_path: join(r, "src", "other.js") })); // 2  ← control
console.log(hook(r, "Edit",  { file_path: join(r, "src", "text.js") }));  // 0  ← control
```

Under the prove-it-fails rule, a fix for this must be demonstrated flipping rows 1 and 2 from
`0` to `2` while leaving rows 3–5 unchanged.
