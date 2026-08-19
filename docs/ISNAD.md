# The ISNAD adaptation

ZOdyssey's v0.6.0 wave ported four capabilities from an **isnād engine** — a provenance and trust layer derived from the hadith authentication methodology, where a report's credibility is judged by the chain of narrators who transmitted it rather than by how convincing the report sounds.

The fit is not decorative. ZOdyssey already refuses to trust a model's assertion about its own work: the review gate reads the verdict artifact instead of believing the executor, `record-verify` records a command's exit code instead of accepting "tests pass", and the external auditor runs in a separate process precisely so it cannot inherit the run's assumptions. That is chain-of-transmission reasoning applied to agents. The study asked which parts of a mature version of that discipline ZOdyssey was still missing.

**Studied 2026-08-17. Four workstreams shipped in v0.6.0** as queue rows 17–20 ([`docs/impl/00-INDEX.md`](impl/00-INDEX.md)), audited externally over four rounds to ACCEPT.

---

## The seven domains

The source document covered seven areas. The study's brief was explicit that duplication was the thing to avoid — *"make sure to not have any duplications"* — so each domain was mapped against existing machinery before anything was written.

| Domain | Verdict | Rule |
|---|---|---|
| Atomic claims | already covered | — |
| Source-trust registry | **adopted** | R2 |
| Independence-weighted corroboration | **adopted** | R4 |
| Span-entailment attribution | **adopted** | R5 |
| Conflict handling | already covered | — |
| Expert sampling | not adopted | — |
| Fluency exclusion | **adopted** | R8 |

---

## Adopted

### R2 — narrator trust registry (row 19)

Cross-run reliability for agent *configurations*, not agent names. Evidence comes from consult ACCEPT/REJECT gaps and judged criterion results; trust is a Laplace-smoothed ratio `(s+1)/(s+m+2)` with a 0.50 cold-start prior (`registry-report.mjs:32`), and **`n` is always printed beside the score** so a 1.00 at n=1 cannot masquerade as a track record.

The load-bearing detail is the key: configs are keyed on `sha256(agents/<name>.md)`, so editing a prompt starts a **new** narrator at the cold-start prior rather than inheriting its predecessor's reputation. That is the stochastic-narrator rule — trust attaches to the exact configuration that produced the evidence, never to the label. Full contract at [`references/scripts.md:52`](../skills/odyssey/references/scripts.md).

**Advisory only.** metis folds low-trust/high-n narrators into Identified Risks at consult. Nothing gates on it.

### R4 — verification-origin labeling (row 18)

Every run report and trend record now carries `verify_origin` (`external-audit` | `in-session-only`) plus `consult_rounds` (`run-report.mjs:124`). Before this, the docs claimed the external auditor was the strongest check while the corpus could not distinguish an audited run from a self-graded one — the independence claim was unfalsifiable from its own records.

Labeling only, no gate.

### R5 — span-entailment attribution, *tadlīs* (row 20)

*Tadlīs* is the hadith term for attribution that omits the link it actually came through — technically true, unverifiable in practice. The agent-prompt analogue is a claim like "the tests cover this" with nothing behind it.

Both prompts now require a witnessed span: the executor cites a `path:line` it read or a command it ran in *this* dispatch (`agents/sisyphus-junior.md:110`), and momus anchors every blocker to plan text (`agents/momus.md:181`). Vague attribution is unverified by definition, so the rule is to say "I did not read it" instead.

Prompt-layer only. The enforcement twins already existed — notepads are append-only, the test-integrity guard blocks weakened tests, and `record-verify` executes criteria rather than accepting claims about them.

### R8 — fluency-exclusion invariant (row 17)

No stylistic or fluency feature may enter trust scoring. Style-correlated confidence is a measured LLM-judge failure mode, and ZOdyssey's judge rubric was clean *by accident* — five weighted dimensions, none of them prose quality, and nothing pinning them there.

`judge-rubric.test.mjs` now pins it: the five weighted dimensions and their exact weights, the output-contract keys (`judge.mjs:232`), a denylist regex that must match nothing inside the rubric block, and the auditor prompt's existing "Do NOT reject for style preferences" clause. Proved in both directions — adding a `clarity (0.1)` dimension fails the suite.

---

## Not adopted, and why

**Atomic claims** — decomposing work into individually checkable units. ZOdyssey does this structurally: the plan's todos each carry executable acceptance criteria, and `record-verify.mjs` records every criterion's command, exit code and output separately (`record-verify.mjs:7`), with a single failed criterion marking the whole todo not-passed. Porting a second decomposition layer would have duplicated the plan contract.

**Conflict handling** — reconciling sources that disagree. Covered by `--multi-auditor`, which runs two independent auditor passes and flags a DISAGREEMENT when the verdicts differ or the scores diverge by more than 0.15 (`consult.mjs:17`), recording it for future recall rather than silently picking a winner.

**Expert sampling** — weighting or selecting sources by demonstrated competence. **No equivalent exists, and this is a deliberate half-measure.** R2 shipped the measurement side; the selection side is forbidden by the roadmap's standing no-new-gates rule. The registry can tell you a narrator is unreliable at n=9; nothing routes work away from it. That gap is a design choice, not an oversight — but it is a gap.

---

## What this record cannot tell you

Written 2026-08-19, reconstructed from committed artifacts. Two limits worth stating plainly:

**The original rule-by-rule mapping was never written down.** It lived in the study conversation. `CHANGELOG.md:154` asserts the unadopted rules were skipped "precisely because ZOdyssey already enforces the rest in stronger form" — a claim with no supporting mapping in the repo. The "already covered" rows above are *this document's* verification against the current tree, each with a citation you can check. They are not a transcript of what the study concluded, and where the study's reasoning differed it is lost.

**The rule numbering is sparse.** Only R2, R4, R5 and R8 appear anywhere in the repo. R1, R3, R6 and R7 are never named, so the domains above are listed by description rather than assigned numbers that cannot be verified.

**A numbering collision to watch.** `R2` and `R3` already denote something unrelated in this repo — bash command-classification remediation rounds ([`docs/OPPORTUNITY-MAP.md:333`](OPPORTUNITY-MAP.md), `CHANGELOG.md:198`). Two rule namespaces share the same tokens; read the surrounding context, not the number.

**Both CHANGELOG citations above are into an exempt target.** `CHANGELOG.md` is in `check-anchors`' `NO_PIN_TARGETS` — its citations are resolved for range but never content-pinned, because the file's format is unstable by design. Both drifted by +14 within hours of this document being written, when v0.6.4 was cut above them, and the checker reported green throughout. Re-verify them by string, not by trusting the suite.

**The study artifacts are not in the repo.** `.zcode/isnad-adaptation-audit/` — the plan, the task brief, the audit driver and four verdict JSONs — is gitignored as run output, on the same reasoning as `.zcode/audits/` and `.zcode/reports/`. That was consistent with repo convention but it means the ideation study has a committed report ([`docs/ideation-report.md`](ideation-report.md)) while this one did not until this file.

---

## Constraints the adaptation honored

Zero npm dependencies · Node built-ins only · deterministic arithmetic over existing JSONL and state — **no new LLM opinion layers** · **no new gates**; every adopted capability is advisory or labeling. `pre-tool.mjs`, `consult.mjs`, `set-phase.mjs` and `auditor-prompt.md` were declared untouchable at plan time and verified byte-unchanged at audit.
