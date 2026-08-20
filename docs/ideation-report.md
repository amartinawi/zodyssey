# ZOdyssey v0.6+ ideation report — independent second opinion

**Date:** 2026-08-15. **Run:** `ideation-v0-6`. **Status:** discovery output — nothing here is
scheduled or committed work.

**Method.** Three blind research waves produced the evidence chain before this report was written:
notepad 1 (every brief claim re-derived from code, all suites re-executed), notepad 2 (five-layer
inventory argued from code), notepad 3 (external evidence, every URL fetched, vendor/unreplicated
flags), notepad 4 (oracle position + steelman). Waves 1–2 never read `docs/OPPORTUNITY-MAP.md`;
this report was synthesized blind from notepads 1–4, and only the final Reconciliation section
opens the old map. Where the brief and code disagree, code wins — and where a notepad and code
disagree, code wins too (one such case was found and is annotated in Corrections). External
numbers are grounded exclusively in notepad 3's traceability findings, with conflations,
vendor funding, and unreplicated status stated rather than papered over.

**Hard constraints respected by every proposal below** (violating proposals were cut, not
footnoted): zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon · graceful
no-op when optional tools are absent · hooks no-op unless a run is active · no argv flag
authenticates anyone. **No proposal adds an LLM-opinion layer** — the disconfirming evidence
(LLM-judge accuracy 56–66% on hard pairs; multi-agent debate frequently degrading vs single-agent
baselines; see §5 and Corrections) makes reviewer-agent proposals the first thing not to build.

---

## 1. Opportunity map

Ranked by **(evidence × leverage) ÷ cost**, each factor on a 1–5 scale (evidence = strength of the
cited evidence that the defect exists and the intervention addresses it; leverage = how much of the
defect space it eliminates; cost = implementation and maintenance cost, higher = costlier). The
arithmetic is shown per entry; the rank order is exactly the computed-score order
(10 > 6.67 > 6 > 4 > 3.75 > 3 > 2.67 > 2).

### 1. Wire check invocation into phase transitions — check-imports first

**Score: (4 × 5) ÷ 2 = 10**

- **Claim:** the repo's best-evidenced shipped checks fire only if the conductor prompt is obeyed.
  `check-imports.mjs` has existed since v0.3.2 with a passing test and **zero code callers**; its
  only "caller" is one prose sentence. The same unwired pattern covers compaction and token
  telemetry (entries 3–4).
- **Evidence:** `skills/odyssey/references/scripts.md:47` — "Run it during verify on the run's
  changed files" is an instruction to a model, the only invocation path (notepad 1, rows b-B9-1/2/3);
  `skills/odyssey/scripts/check-imports.mjs:1-23` + `CHANGELOG.md:678` (shipped v0.3.2, offline
  import resolution, exit 9 on unresolved); the wiring pattern is proven in-repo by B8:
  `skills/odyssey/scripts/set-phase.mjs:339` auto-invokes the regression gate at the execute
  transition and nothing depends on prose for it. **no published outcome evidence** exists for
  "check invocation as phase transition" as a mechanism (notepad 3: harness-layer scoring models are
  absent from the fetched literature entirely).
- **Cost:** low (~40 lines in `set-phase.mjs`/`record-verify.mjs` following the existing B8
  pattern; the checks themselves already exist and pass tests).
- **What it breaks:** repos without manifests or with mixed-language trees must degrade to a
  recorded `inert` state, never block — otherwise false positives halt verify. Over-blocking here
  would be a new failure of the class the change exists to remove.
- **Constraints:** respected (trusted scripts, synchronous, no-op without a run).

### 2. A4: unify the scattered doc-claim invariant suites into one claim→assertion registry

**Score: (4 × 5) ÷ 3 = 6.67**

- **Claim:** no unified invariant registry exists, so the question "which documented guarantee
  currently has no test?" is unanswerable — the root cause of the repo's worst incident (the Bash
  write-gate was deleted twice; three external audits missed it). Four standing suites already
  deliver the function domain-by-domain; the missing organ is the index over them.
- **Evidence:** `docs/ROADMAP.md:158` ("the missing organ", per `docs/ROADMAP.md:89`); no
  `invariants.test.mjs` anywhere in the tree (notepad 1, row b-A4 — `find` returned zero hits);
  the scattered equivalents: `skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:17` ("every
  assertion … is an invariant the README/DESIGN.md already CLAIM"), gate-surface header,
  `scripts/version-consistency.test.mjs:15`, `scripts/smoke-gate.mjs:1`. **no published outcome
  evidence** for doc-code invariant registries (notepad 3 states this absence explicitly as a
  finding, not a gap in search).
- **Cost:** medium (~150 lines plus a machine-readable claims file, then maintenance of the claim
  extraction).
- **What it breaks:** CI goes red on arrival — uncovered documented claims surface immediately.
  That is the deliverable, but it must be triaged, not muted; a registry that is silenced to green
  reopens its own class.
- **Constraints:** respected (pure test code, zero runtime surface).

### 3. Land token telemetry by code, not convention

**Score: (4 × 3) ÷ 2 = 6**

- **Claim:** token accounting is real, DB-backed, and verified — and populated in exactly **1 of
  177** run records. The machinery degrades silently by design, which is precisely why nobody is
  alarmed. Observability's runner-up-layer status is half caused by this.
- **Evidence:** `skills/odyssey/scripts/lib/tokens.mjs:36` (reads `~/.zcode/cli/db/db.sqlite`),
  `:105-114` (SQL over `model_usage JOIN session` scoped by repo + time window), `:13-18`
  (double-counting arithmetic rules), `:149` (`confidence: "estimate"`); `skills/odyssey/scripts/
  run-report.mjs:108-117` wires it in; results.jsonl inspected directly: 177 records, 1 populated
  `tokens` object, 60 explicit `null` (notepad 2, observability). **no published outcome evidence**
  for telemetry-wiring as an intervention — the defect is internal and directly measured.
- **Cost:** low (invoke collection where runs already close — the terminal transition — using the
  collection code that already exists).
- **What it breaks:** attribution remains a time-window estimate (the honest labeling must stay);
  run close gains a SQLite read.
- **Constraints:** respected (`node:sqlite` is already a Node 18 built-in in use here).

### 4. Give context/memory a code-enforced floor: wire compaction, verify the cross-run write

**Score: (3 × 4) ÷ 3 = 4**

- **Claim:** the weakest layer's most advanced feature is unwired, lossy truncation; the canonical
  cross-run store is sustained purely by prompt convention; the entire retrieval surface is two
  recency-ordered lists.
- **Evidence:** `skills/odyssey/scripts/compact.mjs` header — "OPT-IN … not wired into any phase
  transition or hook" — with `:37` (`MAX_LINES_PER_NOTEPAD = 40`, truncation to the first 40
  non-empty lines); `skills/odyssey/SKILL.md:396` (memory-MCP knowledge graph written "at end of
  run" by instruction, nothing in code verifies the write); `skills/odyssey/scripts/
  recall-corrections.mjs:2-25` + `recall-outcomes.mjs:2-9` (top-K=5, recency-ranked); the only
  code-enforced property in the layer is negative — append-only notepads
  (`skills/odyssey/hooks/pre-tool.mjs:759-767`). **no published outcome evidence** for memory
  interventions in this context (notepad 3 contains no cluster on it).
- **Cost:** medium (wire compaction into a phase transition with a context-pressure trigger; make
  the cross-run memory write a recorded transition the way outcomes already are).
- **What it breaks:** naively wiring a truncating compactor destroys evidence the final wave reads —
  it must stay additive; a verified memory write adds a terminal-transition step (ceremony risk if
  it records nothing of substance).
- **Constraints:** respected.

### 5. Complete the two-arm eval (judge `--arm` + baseline harness) — the settling experiment

**Score: (3 × 5) ÷ 4 = 3.75**

- **Claim:** the project's core bet is currently unfalsifiable: the judge hardcodes one arm on
  every record, the baseline arm prints instructions instead of running, so no comparison has ever
  been measured. This is the only entry whose output is a decision rather than a defect fix.
- **Evidence:** `skills/odyssey/scripts/judge.mjs:311` (`arm: "zodyssey"` literal in the record
  constructor; only `--double` is parsed, `judge.mjs:150`); `skills/odyssey/scripts/harness.mjs:21-23`
  (baseline marked TODO), `skills/odyssey/scripts/harness.mjs:79-80` (already parses `--arm zodyssey|baseline`),
  `CHANGELOG.md:99` (prints instructions instead of running — pre-09 state); `~/.zcode/orchestration/eval/judged.jsonl` — 5 scored
  records, all `arm: "zodyssey"` (notepad 1, rows b-judge-1..3; re-read during synthesis, see Corrections); the
  settling-experiment design already exists (notepad 4, §5). **no published outcome evidence** that
  orchestration gates help (notepad 4 §5.3: no replicated evidence that enforcement specifically
  wins; the harness-leverage primaries are vendor conflations — see Corrections).
- **Cost:** high (automate both arms over `seed.jsonl`, operator time for ≥25 judged runs per arm,
  blind-judging discipline).
- **What it breaks:** nothing mechanical; it consumes operator time and may produce an
  uncomfortable answer — which is the point.
- **Constraints:** respected (all machinery exists in-repo).

### 6. B10: pre-edit lint baseline

**Score: (3 × 2) ÷ 2 = 3**

- **Claim:** `post-tool.mjs` lints the edited file **after** the edit with no baseline capture, so
  pre-existing lint noise is attributed to the edit that happened to land on the file.
- **Evidence:** `skills/odyssey/hooks/post-tool.mjs:96-177` (Edit arm, no before-reading;
  `lint-untrusted.mjs` is prompt-injection scanning — a different mechanism); no CHANGELOG entry
  ships a B10 baseline (notepad 1, rows b-B10/b-B10-2). **no published outcome evidence** — the
  reasoning is mechanism-internal.
- **Cost:** low (~35 lines: capture baseline pre-edit, diff post-edit).
- **What it breaks:** an extra lint run per Edit (latency); baseline storage for the run's
  duration.
- **Constraints:** respected.

### 7. Head-allowlist inversion (the named terminus)

**Score: (2 × 4) ÷ 3 = 2.67**

- **Claim:** classifying commands by head against known-safe heads eliminates the
  interpreter-enumeration class (residual G), the shell-split false-negative surface (F), and the
  accepted over-blocks (H) — on the Bash path.
- **Evidence:** `CHANGELOG.md:291` (named terminus, deliberately unshipped — "it wants its own
  release and its own paired run"); residuals confirmed live: shell-split
  (`skills/odyssey/hooks/pre-tool.mjs:184,249-272`), unbounded interpreter list
  (`pre-tool.mjs:126,140-154` — posture already inverted, names still enumerated), over-blocks
  (`pre-tool.mjs:173-192`) (notepad 1, rows c-F/c-G/c-H/c-head-allowlist). **no published outcome
  evidence** for the mechanism itself — the closest fetched work (CARE, pre-execution command
  verification, https://arxiv.org/html/2607.21642v2) is canonicalization-plus-attribution,
  explicitly not prefix/head matching, and is a preprint (notepad 3, absence-of-evidence findings).
- **Cost:** medium (own release + paired run, per the project's own rule for this change).
- **What it breaks:** legitimate heads missing from the allowlist over-block — the failure moves
  shape rather than disappearing; and head classification cannot touch the Edit path at all.
- **Constraints:** respected (still zero-npm, synchronous).

### 8. Prune stale plugin-cache versions

**Score: (4 × 1) ÷ 2 = 2**

- **Claim:** five stale plugin versions accumulate in the marketplace cache with no pruning.
- **Evidence:** `~/.zcode/cli/plugins/cache/zodyssey-local/zodyssey/` — 6 dirs on disk (0.3.2,
  0.4.0, 0.4.1, 0.5.0, 0.5.1 stale; 0.5.2 live, all three manifests agree); `scripts/install.mjs`
  contains no pruning, only a stale-cache warning at `install.mjs:686` (notepad 1, row c-cache).
  **no published outcome evidence** — trivially internal.
- **Cost:** low-medium (the safety logic matters: never touch the live/registered version;
  marketplace rollback semantics must survive).
- **What it breaks:** rollback convenience.
- **Constraints:** respected.

**Cut, not footnoted:** OS-level process confinement (cannot wrap the harness's Bash tool —
harness-dependent, outside the constraint set as a complete fix); nonce-to-transcript-hash binding
(explicitly blocked on harness support, `CHANGELOG.md:320`); any additional reviewer/verifier agent
(LLM-opinion evidence against, see §5). Proposals that would have violated a hard constraint were
dropped from candidacy entirely rather than included with a caveat.

---

## 2. Weakest harness layer

Verdicts from the code inventory (notepad 2); citations are `file:line`.

| Layer | Verdict | Load-bearing evidence |
|---|---|---|
| Tool orchestration | **STRONG** | parallel cap hook-enforced (`skills/odyssey/hooks/pre-tool.mjs:43,1439`), per-file locks with owner identity (`pre-tool.mjs:875,905-930`), capability routing cross-checked at F5 (`skills/odyssey/scripts/record-final-wave.mjs:468`), dispatch observation feed (`skills/odyssey/hooks/post-tool.mjs:231-251`) |
| Verification | **STRONG** | criteria executed not trusted, `--trust-argv` required (`skills/odyssey/scripts/record-verify.mjs:69-107`), regression gate three-way semantics (`skills/odyssey/scripts/regression-gate.mjs:2-29`), F1 fails closed (`record-final-wave.mjs:6-7,178-198`); one soft spot — `check-imports.mjs` unwired (`skills/odyssey/references/scripts.md:47` prose-only) |
| Context/memory | **THIN — WEAKEST** | see the three pieces of evidence below |
| Guardrails | **STRONG** | review gate (`pre-tool.mjs:797`), fail-closed scope isolation (`:850`), hook-minted nonces (`:1456-1485`), plan-tamper guard (`:826,1036`), HMAC run discovery (`:30,506`) — the project's center of mass |
| Observability | **MEDIUM** | real DB-backed token accounting (`skills/odyssey/scripts/lib/tokens.mjs:36,105-114`), 177-record longitudinal store, 5 genuinely judged runs, dashboard + written methodology (`docs/MEASUREMENT.md:3-42`) — but telemetry populated 1/177 and the baseline arm never measured (`skills/odyssey/scripts/harness.mjs:21-23`) |

**WEAKEST: context/memory. Runner-up: observability.** The three strongest pieces of code
evidence for that verdict:

1. `skills/odyssey/scripts/compact.mjs` (header, `:37`) — the sole compaction mechanism is
   opt-in, "not wired into any phase transition or hook," and reduces each notepad to its first
   40 non-empty lines. No context-pressure trigger, no summarization: the layer's most advanced
   feature is unwired truncation.
2. `skills/odyssey/SKILL.md:396` — the canonical cross-run store (memory-MCP knowledge graph)
   is sustained purely by end-of-run prompt convention; no hook, script, or gate verifies the
   write occurred. Contrast `skills/odyssey/hooks/pre-tool.mjs:748-766`, which enforces notepads
   append-only: the only code-enforced property in this layer is a negative one (don't destroy),
   never a retrieval one.
3. `skills/odyssey/scripts/recall-corrections.mjs:2-25` + `recall-outcomes.mjs:2-9` — the entire
   retrieval surface over past runs is two recency-ordered structured lists capped at top-K=5;
   in-run handoff is "downstream todos read prior notepads by path" (`skills/odyssey/SKILL.md:209`)
   — pointers the orchestrator must already know. No relevance search over notepad or outcome
   content exists anywhere in the tree.

**The brief's guess — "strong on guardrails and verification, thin on context/memory and
observability" — is half-confirmed, half-disconfirmed.** CONFIRMED: context/memory is thin, and
guardrails/verification are strong. DISCONFIRMED: observability is **medium**, not thin — the code
shows real DB-backed telemetry plumbing, a two-week longitudinal results store, five genuinely
judged runs, a scorecard renderer, and a written methodology. Observability's defects are narrow
and specific (telemetry populating 1/177 records; a never-measured baseline arm), which is a
different disease than context/memory's structural shallowness.

One provenance note carried from notepad 3: the five-layer taxonomy itself traces to no neutral
primary source — the only fetched pages using layer decompositions each use a different one
(five-but-different, four+five, seven), and the strongest harness-engineering writing fetched
(https://martinfowler.com/articles/harness-engineering.html) explicitly avoids layer stacks. It is
used here as a working lens, not as established fact; **no published outcome evidence** ties the
layer decomposition to outcomes.

---

## 3. Three structural changes

Each eliminates a whole class of defect, not an instance.

### S1 — One registry for every documented claim (unify the scattered invariant suites)

Today four standing suites each defend the claims of one domain (`pre-tool.bash-gate.test.mjs`,
`pre-tool.gate-surface.test.mjs`, `scripts/version-consistency.test.mjs`, `scripts/smoke-gate.mjs`),
and no artifact can answer "which documented guarantee currently has no test?" — the exact question
whose unanswerability let the Bash write-gate be deleted twice while three audits missed it
(`docs/ROADMAP.md:89,158`). Build the registry from the claims side: extract every enforced /
blocks / requires / guarantees sentence from README, DESIGN.md, and references into a
machine-readable file; link each row to the assertion that defends it; fail the suite on any claim
with no linked assertion. **Class killed: "a documented guarantee silently stops being tested."**
Expect red on arrival; that red is the deliverable. (§1 entry 2.)

### S2 — Check invocation as a phase transition, not a prompt instruction

The repo ran a natural experiment on convention vs enforcement and convention lost every time:
`check-imports.mjs` shipped v0.3.2 with a passing test and zero code callers (its only invocation
is the prose at `skills/odyssey/references/scripts.md:47`); token telemetry populated 1 of 177
records; `compact.mjs` is opt-in and unwired. Meanwhile the one check that IS wired as a
transition — the B8 regression gate, auto-invoked at `skills/odyssey/scripts/set-phase.mjs:339`
and blocking `done` on regression — holds and accumulated tests. Generalize the B8 pattern to every
shipped check: `check-imports` at verify→final, compaction before final-wave dispatch, token
collection at run close; unsupported repos degrade to a recorded `inert`, never a block.
**Class killed: "the mechanism shipped but its invocation stayed conventional"** —
ceremony-without-mechanism, the project's failure mode #3, in its least visible form. (§1 entries
1, 3, 4.)

### S3 — Finish the two-arm eval: make the core bet falsifiable

`judge.mjs:311` hardcodes the arm; `harness.mjs:21-23` marks baseline TODO while `:79-80` already
parse `--arm`; five judged records exist, all one arm. The settling experiment (§5 below) needs no
new instrument — only the missing half of existing machinery: record the parsed arm, implement the
baseline arm the harness already declares, blind-judge both arms over the existing `seed.jsonl`,
and count gate-classifiable violations in the convention arm by running the gate's classification
in observe-only mode over its transcript. **Class killed: "a core bet that cannot be measured"** —
self-grading at the level of the whole project (failure mode #4). (§1 entry 5.)

**Runner-up considered and not selected: head-allowlist inversion.** It kills the Bash-path
enumeration class, but (a) **no published outcome evidence** exists for the mechanism (notepad 3);
(b) the gate's *posture* was already inverted (`pre-tool.mjs:139`, "Invert instead") while the
enumerated interpreter names remained the residual (`pre-tool.mjs:126`) — a sign-flip alone has not
historically killed this class; (c) it is itself an enumeration, now of safe heads — failure mode
#1 wearing the opposite sign — and it cannot touch the Edit path, where targets are files, not
command heads. It stays ranked (§1 entry 7) but is not one of the three.

---

## 4. Position

POSITION: "Swiss army knife" here must mean the one orchestrator whose guarantees are code-enforced rather than prompt-convention — enforced trust as the product — not breadth of capabilities, because breadth is commodity while every mechanism this repo left to convention measurably failed to fire and every mechanism it enforced in code shipped, held, and passed re-execution.

Supporting argument (from notepad 4, grounded in notepads 1–3):

- **Where the code actually is:** guardrails STRONG (review gate `skills/odyssey/hooks/pre-tool.mjs:797`,
  fail-closed scope isolation `:850`, hook-minted nonces `:1456-1485`), verification STRONG, tool
  orchestration STRONG; context/memory THIN, observability MEDIUM (notepad 2). Breadth builds
  where the repo is weakest, against competitors whose whole product is breadth. The
  enforced-guarantee stack is the one asset that is built, re-executed today (32/32 suites; exactly
  98 gate-surface cases — re-measured, not copied), and not commodity: anyone can bolt on an MCP;
  nobody else ships a nonce chain bound to artifact shas.
- **The repo's own history is a natural experiment on the bet.** Every mechanism left to prompt
  convention measurably failed to fire: `check-imports.mjs` has zero code callers since v0.3.2
  (`skills/odyssey/references/scripts.md:47`); the canonical cross-run memory store is verified by
  nothing (`skills/odyssey/SKILL.md:396`); token telemetry populated 1 of 177 records; `compact.mjs`
  is opt-in and unwired. Everything enforced in code — append-only notepads, review gate,
  regression gate — held and accumulated tests. Inside this codebase the question is already
  answered.
- **The external case for breadth collapses on inspection.** "23%→52% on one model" is a
  conflation across vendors and model generations (the only same-model harness comparison in the
  fetched primaries is +5.9 points, against a +18.4-point model-generation jump, every source
  vendor-funded — notepad 3). The five-layer framing itself is vendor synthesis. The one neutral
  anchor (OWASP LLM06, complete mediation) prescribes enforcement outside the model — the
  code-enforced posture itself — though with no published outcome evidence.
- **The honest limit:** the guarantee is a perimeter with named enumeration-class gaps
  (shell-split, unbounded interpreter list, over-blocks, unshipped head-allowlist inversion —
  notepad 1 c-rows). That argues for deepening the enforced stack, not for breadth: a knife with
  more blades and no lock is not safer.

What would change the oracle's mind: a neutral, non-vendor replication showing capability breadth
moves matched-model task success more than enforcement depth — or this repo's own two-arm eval
showing a prompt-convention arm matching the gated arm on both outcomes and violations.

---

## 5. Strongest argument against the core bet

The steelman (from notepad 4, reproduced):

**A code-enforced gate is a fixed classifier facing an unbounded adversarial grammar — so its
central failure mode is intrinsic, its maintenance is permanently taxing, and no replicated
evidence exists that enforcement specifically wins.**

1. **Enumeration is not a bug in this gate; it is the shape of gate-shaped defense.** The gate
   classifies arbitrary shell via split/regex tokenization, and notepad 1 confirms the consequences
   live: `p\ython -c` reassembles the token after the gate read it (row c-F — the shell and the
   gate disagree about token boundaries by construction, for every quoting form); the interpreter
   name list is "unbounded by construction" (c-G); `/usr/bin/git status` is over-blocked (c-H).
   False-negative classes are discovered only after a bypass; each model generation widens the
   input distribution to classify. The project's own named escape — head-allowlist inversion — is
   explicitly unshipped, and notepad 3 finds **no published outcome evidence** for that mechanism
   either: the exit from enumeration is itself an unevaluated bet. A prompt convention has no
   crisp boundary to attack; its softness degrades gracefully, while the gate fails at a precisely
   locatable edge that concentrates adversarial pressure exactly there.
2. **Enforcement's cost is permanent and historically fatal here.** The Bash write-gate was
   deleted twice (v0.1.1, v0.2.0); `bash-gate.test.mjs` exists solely to catch a third deletion.
   The enforcement layer thus spends recurring engineering merely to continue existing — plus
   release, paired runs, and cache redeployment across a versioned install chain that has already
   accumulated 5 stale versions (notepad 1, c-cache) — while the convention counterfactual adapts
   in one edited sentence at zero code cost, and its failure mode (convention ignored → degraded
   output) is graceful rather than binary (gate bypassed → guarantee silently falsified). Worst of
   both worlds today: the honest path is taxed (over-blocks) while the adversarial path is
   under-covered (F, G).
3. **The evidence does not replicate for enforcement specifically.** The harness-leverage
   headline is a conflation (same-model effect +5.9 pts vs a +18.4-pt model jump, all vendor
   sources); least-privilege 17%/76% traces to one unreplicated vendor-commissioned survey;
   OWASP's complete mediation is prescriptive consensus with no measured trial; TiCoder (+22–54,
   the strongest cluster, fully traced) supports acceptance criteria — which convention-based
   pipelines also write. The bet's best internal evidence (check-imports unwired) shows one
   convention mechanism failing inside a repo whose culture selects for enforcement; it cannot
   ground the general claim that a maintained convention in any competent harness would also fail.

**Settling evidence — the machinery exists and is half-born.** Per notepad 1 rows b-judge-1..3:
`judge.mjs:311` hardcodes `arm: "zodyssey"`; `harness.mjs` already parses
`--arm zodyssey|baseline` (`harness.mjs:79-80`) but the baseline arm is TODO and prints
instructions instead of running (`harness.mjs:21-23`, pre-09 state narrated at `CHANGELOG.md:99`); `judged.jsonl` holds 5 real scored
records — all one arm. The decisive measurement is therefore the missing half of existing
machinery: run the baseline arm as the SAME pipeline with hook gates replaced by their
prompt-convention equivalents (SKILL.md instruction text where `pre-tool.mjs` now enforces — the
exact counterfactual the bet names), over the existing `seed.jsonl`, blind-judged by existing
`judge.mjs`, to ≥25 judged runs per arm. Decision rule: (a) **primary observable — violations**:
actions the gate would have blocked (pre-OKAY product edits, out-of-scope writes, test-file
writes, notepad replacement), counted in the convention arm by running the gate's existing
classification in observe-only mode over its transcript/diff; any sustained nonzero violation rate
settles the bet FOR the gate regardless of scores, because the guarantee is the product.
(b) **If the convention arm shows zero violations AND non-inferior judged outcomes** across the
seed set, the maintenance premium buys nothing measurable and the bet is settled against — at that
point the twice-deleted bash-gate is cost without cover. No new instrument is required beyond the
arm the harness already parses.

---

## Corrections to the brief

Every claim in `docs/ideation-prompt.md` §"What is already built", §"Validated gaps", and
§"Known-unfixed residuals", re-derived from code by the blind pass (notepad 1; suites re-executed,
not copied). Code wins on every disagreement. Suite counts were re-measured: `npm test` → 32/32
suites; `pre-tool.gate-surface.test.mjs` standalone → exactly 98 passed; `pre-tool.bash-gate.test.mjs`
→ 22 passed.

| CLAIM | VERDICT | file:line | one-line evidence |
|---|---|---|---|
| (a1) Phase DAG with hook-enforced gates | CONFIRMED | skills/odyssey/SKILL.md:65; skills/odyssey/scripts/set-phase.mjs:90-93 | 8-phase state machine; TRANSITIONS map refuses illegal transitions (set-phase.mjs:278-281); hook gates at pre-tool.mjs:798,1315 |
| (a2) Non-forgeable verdicts via nonce chain | CONFIRMED | skills/odyssey/hooks/pre-tool.mjs:1457-1483; skills/odyssey/scripts/record-review.mjs:113-124,130-141 | hook mints one-time nonce; record-review refuses verdicts whose nonce is not bound to artifact path+sha256+round; plan-sha mandatory |
| (a3) Authenticated run discovery (HMAC) | CONFIRMED | skills/odyssey/scripts/lib/state-auth.mjs:26,65; skills/odyssey/hooks/lib/find-run.mjs:21 | createHmac over run identity; dropped/copied state files are inert |
| (a4) Bash/Edit write gate with declared-file scope | CONFIRMED | skills/odyssey/hooks/pre-tool.mjs:1011,1142-1143 | write-capable Bash requires OKAY + declared Files:; Edit path same at :798 (boundary behavior of the Edit path — see Reconciliation M1) |
| (a5) Append-only notepads (hook-enforced) | CONFIRMED — enforced by PRE-TOOL | skills/odyssey/hooks/pre-tool.mjs:759-767 | Write on existing `.zcode/notepads/*` blocked: "notepads are APPEND-ONLY" |
| (a6) Test-integrity guard | CONFIRMED | skills/odyssey/scripts/record-final-wave.mjs:131,253-256 | SKIP_MARKER regex + `git diff --numstat` flags deleted/net-weakened test files |
| (a7) Pass-to-pass regression gate | CONFIRMED | skills/odyssey/scripts/regression-gate.mjs:1; skills/odyssey/scripts/set-phase.mjs:339 | auto-snapshot entering execute; exit 8 on pass→fail; done blocked while regressed |
| (a8) F1–F5 incl. behavioural capability cross-check | CONFIRMED | skills/odyssey/scripts/record-final-wave.mjs:86,468-481,500-503; skills/odyssey/hooks/post-tool.mjs:231-251 | F5 cross-checks declared `routed:` tokens against hook-witnessed state.capabilities[] |
| (a9) Segment-tolerant capability matching | CONFIRMED | skills/odyssey/scripts/lib/capability-name.mjs:13; skills/odyssey/scripts/record-final-wave.mjs:61 | exact match wins, else final name segment — bare matches namespaced and vice versa |
| (a10) Real token accounting from the session DB | CONFIRMED — at skills/odyssey/scripts/lib/tokens.mjs, reading ~/.zcode/cli/db/db.sqlite | skills/odyssey/scripts/lib/tokens.mjs:36,83,105-114; skills/odyssey/scripts/run-report.mjs:18,114 | node:sqlite read-only; SQL over model_usage JOIN session by repo+time-window; attribution honestly "estimate" |
| (a11) "32 test suites" | CONFIRMED (re-measured) | package.json test script; npm test 2026-08-15 | `npm test` → "32/32 suite(s) passed in 59318ms" |
| (a12) "~98 gate-surface cases" | CONFIRMED (re-measured; exactly 98 — not approximate) | skills/odyssey/hooks/pre-tool.gate-surface.test.mjs:1; CHANGELOG.md:295 | standalone run: "98 passed, 0 failed"; CHANGELOG v0.5.2: "Gate-surface is 98 cases (was 80)" |
| (a13) Paired old/new probes | CONFIRMED | skills/odyssey/hooks/pre-tool.gate-surface.test.mjs:6; CHANGELOG.md:241,248; skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:17 | "Every case below fails on the pre-v0.5.0 code"; v0.5.2 paired run against v0.5.1 |
| (b-A4) Doc-code invariant registry "never built" (ROADMAP.md:158) | PARTIAL — named artifact absent, four equivalents exist | docs/ROADMAP.md:158; skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:17; scripts/version-consistency.test.mjs:15; scripts/smoke-gate.mjs:1 | no `invariants.test.mjs` anywhere (zero find hits), but bash-gate/gate-surface/version-consistency/smoke-gate deliver the function domain-by-domain without a unified registry |
| (b-B9-1) Package-existence checking "absent" | REFUTED — code wins | skills/odyssey/scripts/check-imports.mjs:1-23; CHANGELOG.md:678 | check-imports.mjs exists (shipped v0.3.2): offline import resolution JS/TS + Python; exit 9 on unresolved import |
| (b-B9-2) check-imports has a test and is wired into a phase | PARTIAL | skills/odyssey/scripts/check-imports.test.mjs:1; skills/odyssey/references/scripts.md:47 | test passes (part of 32/32), but the ONLY caller is documentation — prose instructs the conductor; zero code callers repo-wide |
| (b-B10) Pre-edit lint baseline "absent" | CONFIRMED | skills/odyssey/hooks/post-tool.mjs:96-177; skills/odyssey/scripts/lint-untrusted.mjs:1 | post-tool lints AFTER the edit, no baseline capture; lint-untrusted is injection scanning (different mechanism) |
| (b-judge-1) judge.mjs:311 hardcodes `arm: "zodyssey"` | CONFIRMED | skills/odyssey/scripts/judge.mjs:311 | literal in the record constructor |
| (b-judge-2) judge.mjs "never reads --arm" | CONFIRMED for judge.mjs (nuance: harness parses it) | skills/odyssey/scripts/judge.mjs:150; skills/odyssey/scripts/harness.mjs:79-80, skills/odyssey/scripts/harness.mjs:19, skills/odyssey/scripts/harness.mjs:138-141 | judge parses only `--double`; harness parses `--arm` but baseline is TODO and prints instructions (state at measurement, 2026-08-16; the baseline arm EXECUTES since v0.6.7 — `harness.mjs:138-141` then described the pre-09 instructions block) |
| (b-judge-3) "The eval has never produced a number" | REFUTED — code/filesystem wins | ~/.zcode/orchestration/eval/judged.jsonl:1-5; ~/.zcode/orchestration/eval/results.jsonl (177 lines) | judged.jsonl holds 5 real scored records (2026-08-01); results.jsonl 177 run records. Narrower true statement: the arm FIELD never records baseline (judge.mjs:311) and the harness cannot run the baseline arm (harness.mjs:21-23) — see Reconciliation D1 for the slug-derived baseline records |
| (b-seed) REPLACE_WITH seed bug fixed | CONFIRMED | skills/odyssey/scripts/seed.jsonl:1-5 | `grep REPLACE_WITH` → zero matches; concrete ids/prompts/criteria |
| (b-B1) Verdict ambiguity → `missing` | CONFIRMED shipped | skills/odyssey/scripts/record-final-wave.mjs:96-111; skills/odyssey/scripts/record-final-artifact.mjs:76-86 | "AMBIGUITY RESOLVES TO 'missing', NEVER 'approve'" |
| (b-B2) Append-only notepads shipped | CONFIRMED shipped | skills/odyssey/hooks/pre-tool.mjs:755-772 | block message explicitly permits Edit appends and new notepad files |
| (b-B3) Test-integrity guard shipped | CONFIRMED shipped | skills/odyssey/scripts/record-final-wave.mjs:131,214,253-256 | wired into F1 on the run's start SHA |
| (b-B4) F1 converse (declared-but-untouched) | CONFIRMED shipped | skills/odyssey/scripts/record-final-wave.mjs:45,231,300-302 | `--allow-untouched` flag; ORCH-1 extended it to waive all files for read-only runs |
| (b-B5) Test files read-only at hook layer | CONFIRMED shipped | skills/odyssey/hooks/pre-tool.mjs:789,1288-1292 | Edit path "test files are read-only during phase=…"; Bash path "test files are FROZEN" |
| (b-B6) Criteria must invoke toolchain.test_cmd | CONFIRMED shipped (conditional) | skills/odyssey/scripts/parse-plan.mjs:370-373 | enforced only when .zcode/toolchain.json declares one (bare repo exempt) |
| (b-B7) probe-toolchain called in pipeline | CONFIRMED shipped | skills/odyssey/scripts/scaffold.mjs:313-327; skills/odyssey/scripts/pipeline-integration.test.mjs:98 | scaffold invokes it at run start; integration test asserts the wiring |
| (b-B8) Pass-to-pass regression gate shipped | CONFIRMED shipped | skills/odyssey/scripts/regression-gate.mjs:1; skills/odyssey/scripts/set-phase.mjs:339 | auto-snapshot entering execute; done blocked on regression |
| (b-B9-3) Phase B item B9 shipped | CONFIRMED shipped as standalone script, NOT phase-wired | CHANGELOG.md:678; skills/odyssey/references/scripts.md:47 | shipped v0.3.2; pipeline presence is prompt-convention only |
| (b-B10-2) Phase B item B10 shipped | REFUTED (not shipped; brief correct) | skills/odyssey/hooks/post-tool.mjs:117-170 | no baseline mechanism exists; the lint arm blocks on any non-zero lint of the edited file |
| (c-F) Shell-escaping splits command tokens | CONFIRMED | CHANGELOG.md:287; skills/odyssey/hooks/pre-tool.mjs:184,249-272 | `p\ython -c`, `py''thon -c` defeat regex tokenization; no shell-grammar parser |
| (c-G) Interpreter deny-list unbounded by construction | CONFIRMED (posture inverted; names still enumerated) | CHANGELOG.md:288; skills/odyssey/hooks/pre-tool.mjs:126,140-154 | gawk/mawk/pypy/perl6/raku/jshell/ts-node ungated; posture inverted to allowlist-of-gated-names, but the NAME list remains unbounded |
| (c-H) Accepted over-blocks | CONFIRMED | CHANGELOG.md:289; skills/odyssey/hooks/pre-tool.mjs:173-192 | `/usr/bin/git status` gated (path-heads classified as execution); over-block asserted deliberately in the suite |
| (c-head-allowlist) Head-allowlist inversion unshipped | CONFIRMED | CHANGELOG.md:291; skills/odyssey/hooks/pre-tool.mjs:100-199 | "deliberately **not** in this release: it wants its own release and its own paired run"; code remains a deny-list |
| (c-nonces) Nonces prove dispatched-not-said | CONFIRMED (still true; fix NOT done) | skills/odyssey/scripts/record-final-artifact.mjs:110-116; CHANGELOG.md:320; skills/odyssey/hooks/pre-tool.mjs:1478 | nonce lives in agent-readable .zcode/state/; transcript-hash binding "NOT done" (needs harness support) |
| (c-cache) Five stale cache versions, no pruning | CONFIRMED (5 stale + 1 live) | ~/.zcode/cli/plugins/cache/zodyssey-local/zodyssey/ (6 dirs); package.json:3 (0.5.2 at measurement; 0.6.x across the 2026-08-17/18 releases, cache follows on re-Get); scripts/install.mjs:686 | 0.3.2–0.5.1 stale, 0.5.2 live; install.mjs only warns, never prunes |

**Phase B scorecard (code-derived):** B1–B9 shipped (B9 standalone-only — its invocation is
convention); B10 unshipped. The brief's "validated gaps" section is therefore wrong on B9 (already
built), right on B10, and half-right on A4 and Phase C.

**External-claims corrections** (brief §"What the outside world says"; all verdicts from notepad
3's traceability pass, every URL fetched):

| Brief's external claim | VERDICT | Grounds |
|---|---|---|
| Five-layer production-harness taxonomy | UNVERIFIABLE as an established taxonomy | no neutral primary; each fetched publisher decomposes differently (https://codemyspec.com/blog/five-layers-of-agentic-coding — different five; https://arxiv.org/html/2603.05344v1 — four+five; https://bitloops.com/resources/agent-tooling — seven); strongest fetched writing avoids layer stacks (https://martinfowler.com/articles/harness-engineering.html). Vendor synthesis; no published outcome evidence for the taxonomy |
| "Swapping harnesses moves pass@1 more than most model upgrades (23%→52% on one model)" | REFUTED as stated — a conflation | 23.3/23.1% = GPT-5/Opus-4.1 under Scale's unified scaffold (https://arxiv.org/html/2509.16941v2); 51.80% = Auggie wrapping a different model, Opus 4.5 (https://www.augmentcode.com/blog/auggie-tops-swe-bench-pro). Only same-model comparison in the primaries: Opus 4.5 45.89%→51.80% ≈ +5.9 pts vs a +18.4-pt model-generation jump. Every source vendor-funded; unreplicated by any neutral third party |
| "Least-privilege enforcement correlates with 17% vs 76% incident rate" | PARTIAL — traced to one vendor-commissioned survey | single Teleport-commissioned survey (205 CISOs, Eleven Market Research, 2025-12), https://www.globenewswire.com/news-release/2026/02/17/3239200/0/en/new-teleport-research-reveals-ai-security-crisis-in-the-enterprise-over-privileged-ai-systems-drive-4-5x-higher-incident-rates.html — vendor-funded, self-reported, correlational, unreplicated; directional at best |
| "LLM-judge accuracy on hard cases is 60–67% with ±60pp framing swings" | PARTIAL — substance traced, phrasing not verbatim | JudgeBench (https://arxiv.org/html/2410.12784): GPT-4o 56.57%, Claude-3.5-Sonnet 64.29%, o1-mini 65.71% on hard pairs; JudgeSense (https://arxiv.org/html/2604.23478v2): up to 61.3% per-judge flip rate under paraphrase — a flip rate, not a uniform ±60pp swing; the exact "60–67%"/"±60pp" phrasing appears nowhere fetched |
| "Multi-agent debate degraded accuracy in 5 of 6 measured configurations" | REFUTED as verbatim — untraceable | no fetched primary contains a "5 of 6" tally; closest countable finding: single-agent beats 4 of 6 evaluated debate systems on non-medical datasets (Smit et al., ICML 2024, https://proceedings.mlr.press/v235/smit24a.html); direction supported by https://arxiv.org/html/2509.05396v1 ("debate almost always harms the performance") |
| "TiCoder: +22–54 absolute pass@1" (acceptance-criteria-driven generation) | CONFIRMED — fully traced, the strongest cluster | +22.49–37.71 (MBPP) and +24.79–53.98 (HumanEval) absolute pass@1 (https://arxiv.org/abs/2208.05950); follow-up avg +45.97% with human study (https://www.microsoft.com/en-us/research/publication/llm-based-test-driven-interactive-code-generation-user-study-and-empirical-evaluation/). Caveats: single corporate research group, simulated (oracle) user, MBPP/HumanEval only — generalization to orchestration acceptance criteria is an extrapolation |

**Headline disagreements (code wins):** B9 "absent" is REFUTED (present since v0.3.2 with a passing
test — what's missing is a caller); "the eval has never produced a number" is REFUTED (5 scored
judged records + 177 run records; what never existed is an automated baseline arm and a truthful
arm field); A4 "never built" is PARTIAL (the registry is absent, but four standing doc-claim
invariant suites already deliver its function domain-scattered); suite counts are exact, not
approximate (32 suites, 98 gate-surface cases — both re-executed).

---

## Reconciliation with docs/OPPORTUNITY-MAP.md

This is the only section written with the old map open. Everything above it was synthesized blind
from notepads 1–4. Agreements between two independent passes raise confidence; divergences are
settled by code, never by preference or seniority.

### Agreements (confidence raised)

1. **B9 built-but-unwired** (map §0.1 / item #2 ≡ this report §1 entry 1): both passes found
   `check-imports.mjs` shipped v0.3.2 with a passing test and zero code callers, invocation by
   prose only (`skills/odyssey/references/scripts.md:47`). Two independent censuses agreeing makes
   this the highest-confidence finding in either document.
2. **A4: registry absent, scattered equivalents exist** (map §0.4 ≡ notepad 1 b-A4): no unified
   `invariants.test.mjs` anywhere; the map names two A4-shaped suites, the blind pass found four —
   same conclusion, and the union strengthens it.
3. **The eval has produced numbers** (map §0.3 ≡ notepad 1 b-judge-3): both REFUTE the brief's
   "never produced a number" from the same 5-record `judged.jsonl` (re-read during synthesis).
4. **B10 absent** (map item #11 ≡ §1 entry 6): `post-tool.mjs:96-177`, no baseline mechanism.
5. **Phase B scorecard** (map §0.5 ≡ notepad 1 rows b-B1..b-B10-2): B1–B9 shipped (B9
   standalone-only), B10 unshipped — identical tables.
6. **Context/memory weakest** (map §1.1 ≡ §2): both argue it from `compact.mjs`'s unwired
   truncation, the convention-only memory store (`SKILL.md:396`), and the recency-list retrieval
   surface; the repo's own `outcomes.jsonl` corpus is 8 lines, nearly all contentless template
   entries (re-checked this run).
7. **Observability not thin** (map §1.2 "not thin" ≡ notepad 2 MEDIUM): both disconfirm the
   brief's "thin" via the same code (`skills/odyssey/scripts/lib/tokens.mjs:36,105-114`,
   `dashboard.mjs`, `docs/MEASUREMENT.md`).
8. **§4 stance** (map §4 ≡ notepad 4 POSITION): a blind pass and the prior pass independently
   concluded that enforced guarantees, not breadth, are the differentiator — convergence from
   isolation is the strongest confidence signal in this report.
9. **§5 steelman convergence** (map §5 ≡ §5 above): both identify enumeration-as-intrinsic-shape,
   permanent maintenance cost, and unreplicated evidence as the core attack; both settling designs
   count gate-relevant violations/failures as a primary observable.
10. **Cache pruning residual** (map item #13 ≡ §1 entry 8): 5 stale versions, `install.mjs:686`
    warns but never prunes.

### Divergences (settled by code)

**D1 — Did the baseline arm ever produce a judged number?** Map §0.3: yes — it tabulates
`std-01` 0.83/0.83 and `arch-01` 0.87/0.62 (Δ+0.25). Notepad 1: "no BASELINE-arm number exists."
**Winner: the map, by code.** `judged.jsonl` records 3 and 5 carry slugs `std-01-baseline`
(overall 0.83) and `arch-01-baseline` (0.62), re-read during this synthesis — baseline runs were
judged once per seed on 2026-08-01. Arm attribution is slug-derived because `judge.mjs:311`
hardcodes the arm field on every record, and `dashboard.mjs:20-24` codifies the slug-suffix
workaround. Synthesis: baseline numbers exist at n=1 per seed (map right); an automated baseline
arm and a truthful arm field do not exist (notepad right on the mechanism). The Corrections row
b-judge-3 above stands — with this annotation correcting notepad 1's over-broad parenthetical,
because code wins over notepads too.

**D2 — Which layer is weakest?** Map §1.3: tool orchestration ("gates live in hooks (enforced);
checks live in scripts (convention)"). This report §2 / notepad 2: context/memory.
**Winner: this report, by code.** The orchestration layer's load-bearing mechanisms are
hook-enforced — parallel cap (`skills/odyssey/hooks/pre-tool.mjs:43`), per-file locks
(`:875-936`), routing cross-check (`skills/odyssey/scripts/record-final-wave.mjs:468`),
dispatch observation (`skills/odyssey/hooks/post-tool.mjs:231-251`) — while the unwired scripts
the map counts against orchestration are members of other layers by their own function:
`check-imports.mjs` is a verification check (notepad 2 files it under verification's soft spot),
`compact.mjs` is context/memory machinery, `dashboard`/`status` are observability views. The map's
own §1.1 heading nominates context/memory as "weakest," and the code classification resolves its
internal split. The shared datum — zero-caller mechanisms — is real, agreed, and is this report's
rank-1 opportunity either way.

**D3 — Is the metrics corpus contaminated?** Map §1.2: ~90% synthetic (17 `"t"`-slug + 127
`add-truncate` of 172 records; dashboard win-rate therefore vacuous). Notepad 2: counted 177
records and the telemetry holes but did not tally fixture slugs. **Winner: the map, by code.**
Re-counted this run: 16 `"slug":"t"` + 131 `add-truncate` = 147 of 177 ≈ 83% synthetic —
contamination real and growing (the tallies differ slightly from the map's on both counts; both
support the same conclusion; the file is append-only and live). The blind chain did not test this
(coverage gap, not disagreement), so it is recorded here rather than silently absorbed.

**D4 — Standing of head-allowlist inversion.** The CHANGELOG names it the terminus
(`CHANGELOG.md:291`); the map demotes it ("flips the sign but stays in the same game," §2.1).
**Winner: the map's skepticism, by code.** The gate's posture was already inverted
(`skills/odyssey/hooks/pre-tool.mjs:139`, "Invert instead") while the enumerated interpreter names
remained the unbounded residual (`:152`, `CHANGELOG.md:288`) — a sign-flip alone demonstrably did
not kill this class; head classification is structurally a Bash-command concept and cannot touch
the Edit path; and notepad 3 finds no published outcome evidence for the mechanism. This report
keeps it ranked (§1 entry 7, low) for the same reasons.

**D5 — `results.jsonl` size.** 172 (map) vs 176 (notepad 1) vs 177 (notepad 2). Re-count: 177. A
live append-only file observed at three times — growth, not disagreement; recorded for
completeness, no arbitration needed.

### Map-only findings the blind chain never tested — code-verified during this reconciliation

These were probed by reading code only (no files created, no probe scripts executed); they are
reported here because the blind notepads did not cover them, and they change the priority order
that a merged view should take into v0.6.

**M1 — Edit-path containment escape (map §0.2 / item #1). CONFIRMED IN CODE.** The entire
Edit-path scope check — plan-sha tamper guard, declared-`Files:` containment, fail-closed catch —
is wrapped in `if (rel) {` at `skills/odyssey/hooks/pre-tool.mjs:817`; the file-lock branch is
likewise guarded at `:894`; and the path then falls through to `exit(0)` at `:996` (allow).
`classifyTarget` (`pre-tool.mjs:664-726`) returns `rel: ""` for any target outside both the run
repo and `PROJECT_DIR`. Consequence: once a verdict is OKAY, an executor can Edit/Write
outside-project paths — including `~/.zcode/cli/config.json`, the hook registry itself — with no
scope check, while the Bash twin fails closed for the same targets (the map's probe table
demonstrates the asymmetry against the deployed hook; this pass verified the mechanism by reading
the three deciding lines). Notepad 1 row (a4) confirmed the gate exists at `:944,1085-1086` but did
not probe boundary classification. **Concession: had the blind chain tested target classification,
closing this (~5 lines, converging the Edit path with its Bash twin) would compete for the top of
§1. Nothing in this report's blind ranking supersedes it; in a merged queue it goes first.**

**M2 — `ZODYSSEY_UNGATE_BASH` escape hatch (map item #6). Verified.**
`skills/odyssey/hooks/pre-tool.mjs:1064` — `if (isBash && process.env.ZODYSSEY_UNGATE_BASH === "1")
exit(0);` — one environment variable disables the entire Bash gate, and `scripts/install.mjs:883`
advertises it in every user's AGENTS.md. The map's causal note (mirroring the author's local
UNGATE copy is how v0.1.1 shipped the gate deleted) is consistent with the twice-deleted history
both documents share. Making the hatch loud (record every ungated call into run state) is
constraint-compatible.

**M3 — Nonce-lane name tolerance (map item #12). Verified at the time; FIXED by impl item 03
(2026-08-17).** The momus/F2/F4 nonce lanes had gated on `isAgent(...)` — final-segment matching
via `isAgent = (want) => sameName(want, subagent)` at `skills/odyssey/hooks/pre-tool.mjs:1344`,
from `sameName` in `skills/odyssey/scripts/lib/capability-name.mjs` — so any `*:momus`-suffixed
agent dispatch minted review nonces, while the matcher's own header asserted it is "not a
security boundary." The header's exemption was false in code for the lanes; the map's finding
stood. Item 03 closed it: the mint sites at `skills/odyssey/hooks/pre-tool.mjs:1573-1601` now
require the exact declared minter type per lane (`NONCE_MINTERS`), a lookalike dispatches but
mints nothing and warns on stderr, and the header states the matcher is routing-grade only.

**M4 — Not adjudicated by this run's evidence chain** (no notepad coverage, not code-checked
here): map item #7 (OS-level process confinement — its own text concedes harness dependency for
the full version), item #8 (OTel GenAI spans), item #9 (prompt-surface measurement — blocked on
eval automation), item #10 (user-confirmed acceptance criteria at PRIME; its evidence base, TiCoder,
is the one cluster notepad 3 fully traced, with the simulated-user and MBPP/HumanEval-only caveats
stated above). These carry the map's own flags and are neither endorsed nor refuted by this pass.

### Reconciliation bottom line

Two passes that never saw each other agree on every conclusion the blind chain tested (10
agreements above). Of the code-arbitrated divergences, the map wins D1, D3, D4 and the untested-but-
now-verified M1–M3; this report wins D2. A merged v0.6 queue would take, in order: close the
Edit-path containment escape (M1, map item #1 — most severe, cheapest), wire the unwired checks
(§1 entry 1 ≡ map item #2), then the claim→assertion registry (§1 entry 2 ≡ map item #3), then
decontaminate the metrics corpus (D3) before trusting any trend number, then the two-arm eval
(§1 entry 5 ≡ map item #5). Zero divergences above were settled by preference.

---

## Note — 2026-08-17 (arm hardcode fixed)

`judge.mjs` no longer hardcodes `arm: "zodyssey"`: it derives the arm from the slug suffix via
`skills/odyssey/scripts/lib/arm.mjs` (ISNAD-adaptation queue row 19, build step A0). The (b-judge-1)
and related findings above were verified true as of 2026-08-16 and are preserved as the record of
that date; citations have been re-anchored to the moved line. The residual item-09 scope — the
explicit `--arm` instrument channel and baseline-arm automation in `harness.mjs` — is unaffected.
