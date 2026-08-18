# 00-INDEX — v0.6 build queue

Sixteen Step-2 candidates opened this queue: fourteen became implementation prompts
(`docs/impl/NN-<slug>.md`, written by todos 6-19), two are dropped with file:line reasons below.
Six rows were added after it was written — **15 and 16** on 2026-08-16 (defects found while
verifying the queue), **17-20** on 2026-08-17 (the ISNAD-engine adaptation study): twenty prompts, two drops.
The order is a dependency DAG, not the ideation rank; the sequencing rules applied are the spec's
(docs/implementation-prompt.md:81): blocking edges over rank, the registry wants fixes ahead of
it, one security change per release, group by file only when that violates nothing above,
cheap-and-severe first.

Acyclicity rule: every depends-on edge points at a strictly lower id — a row may depend only on
ids smaller than its own. The graph is acyclic by construction and the numeric order is a valid
topological order.

Every quantitative claim below is this run's own measurement, never an ideation-doc number
(measured-at: 2026-08-16T03:05:00Z, notepad 2 of run impl-prompts-v0-6). `results.jsonl` is live
and drifted repeatedly during this run (see Observations); each NN prompt that quotes it stamps
its own measurement date.

## DAG

| id | slug | depends-on | why-here | outcome |
|---|---|---|---|---|
| 01 | edit-path-containment-escape | — | **SHIPPED v0.5.3.** Cheapest and most severe open defect; the escape is post-OKAY-only (pre-OKAY targets outside PROJECT_DIR are already blocked at skills/odyssey/hooks/pre-tool.mjs:798). Own release, shipped alone. | No edit path skips the scope gate; the `if (rel)` branch is gone. |
| 02 | wire-zero-caller-checks | — | **SHIPPED v0.6.0.** check-imports, coverage-delta and resolve-capabilities have zero code callers (re-confirmed this run); wiring follows the B8 precedent at skills/odyssey/scripts/set-phase.mjs:334. Ahead of 08 so the wired checks land as registry rows. | The three checks fire from phase transitions instead of by hand. |
| 03 | nonce-lane-minter-allowlist | — | **SHIPPED v0.5.5.** Security-class, grouped adjacently with 01/04 (same file cluster) but explicitly not merged — own release. The false header assertion at skills/odyssey/scripts/lib/capability-name.mjs:17 is corrected in the same change. | Only the declared minter can grant the nonce lane. |
| 04 | ungate-bash-record-or-retire | — | **SHIPPED v0.6.2 (2026-08-18).** Decision: record every ungated call, not retirement — the affordance is documented (docs/INSTALL.md:152) and the v0.1.1/v0.2.0 gate-deletion history (CHANGELOG.md:483, CHANGELOG.md:648) is the causal evidence against removal. Security-class, own release. | Every `ZODYSSEY_UNGATE_BASH=1` call is recorded in run state. |
| 05 | metrics-corpus-decontamination | — | **SHIPPED v0.6.1 (2026-08-17).** skills/odyssey/scripts/set-phase.mjs:450 appends every run to the trend log unconditionally: 153/184 records synthetic (83.2%, measured 2026-08-16). All measurement items are gated behind this. | The trend log holds real runs only; the synthetic share is measured, not guessed. |
| 06 | token-telemetry-run-close | 05 | Wiring already exists (skills/odyssey/scripts/set-phase.mjs:430, skills/odyssey/scripts/run-report.mjs:108); the defects are the null population (2/184, measured 2026-08-16) and attribution (skills/odyssey/scripts/lib/tokens.mjs:150). Telemetry numbers are corpus metrics — after 05. | Token counts are populated and attributed per run. |
| 07 | b10-pre-edit-lint-baseline | — | skills/odyssey/hooks/post-tool.mjs:72 lints post-edit only and blocks (skills/odyssey/hooks/post-tool.mjs:81) with no baseline to compare against. Independent of the other tracks. | Lint regressions are caught against a committed baseline. |
| 08 | claim-assertion-coverage-ledger | 01, 02, 03, 04 | The registry wants the four fixes ahead of it so their claims land as rows rather than retrofits. Five scattered equivalents already exist (the four found at verification — skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:4, skills/odyssey/hooks/pre-tool.gate-surface.test.mjs:2, scripts/version-consistency.test.mjs:15, scripts/smoke-gate.mjs:1 — plus a fifth found while writing prompt 08 itself: scripts/deploy-surface.test.mjs:2, commit 26af48b; corrected here 2026-08-16). | One ledger answers "is this claim asserted anywhere". |
| 09 | two-arm-eval-baseline | 05 | skills/odyssey/scripts/judge.mjs:176 hardcoded the arm (fixed 2026-08-17 via lib/arm.mjs, row 19 rider; amendment in the 09 brief); skills/odyssey/scripts/harness.mjs:19 still has baseline = TODO. The settling experiment must draw from a decontaminated corpus or its first number is poisoned. | Both arms run through `judge.mjs --arm`; the baseline arm is automated. |
| 10 | prompt-surface-measurement | 09 | The one hard blocking edge in the queue: prompt-surface cannot start before the eval runs (docs/implementation-prompt.md:83). | The prompt surface has a measured effect on eval outcomes, not an intuition. |
| 11 | compaction-phase-wiring | — | Opt-in and unwired (skills/odyssey/SKILL.md:158); the additive invariant (skills/odyssey/scripts/compact.mjs:16) must hold or final-wave evidence is destroyed. After the measurement block by grouping, no hard edge. | Compaction fires at a phase transition, additive only. |
| 12 | prime-user-confirmed-acceptance | — | The only strong-evidence accuracy item, caveats carried (docs/ideation-report.md:450); the ask-user ritual exists (skills/odyssey/SKILL.md:74) but criteria are never user-confirmed. Proposes USER queries at PRIME — not a reviewer agent. | Acceptance criteria are confirmed by the user at PRIME. |
| 13 | plugin-cache-prune | — | Ops hygiene: 6 cache dirs on disk, one live (0.5.2), five stale (0.3.2-0.5.1), measured 2026-08-16. Unranked-critical, so late. | The installer prunes stale plugin-cache versions. |
| 14 | otel-genai-span-emission | — | Externally blocked: semconv `gen_ai.*` attributes are still "Development" stability (caveat carried from docs/OPPORTUNITY-MAP.md:275, not re-fetched). Last in the queue. | One run-level span at close (built-ins-only OTLP/JSON, inert when unconfigured); per-dispatch granularity named Known-not-fixed — dispatch timestamps do not exist yet. (Outcome narrowed from "per-dispatch spans" while writing prompt 14, 2026-08-16.) |
| 15 | anchor-drift-check | — | **SHIPPED `a9b4cf0` (pre-v0.5.3).** Added 2026-08-16, after the queue was written. This repo documents itself by `file:line` — 761 citations across 28 documents into 68 files (measured 2026-08-16) — and nothing verifies a cited line still says what the citation claims. Two anchors broke in one week: agents/sisyphus-junior.md:93 had drifted onto an unrelated line, and a one-line insertion into skills/odyssey/references/scripts.md invalidated nine citations at once, seven of them in docs/ideation-report.md. No blocking edge, so it takes the next free id rather than renumbering a committed queue — but its value is highest BEFORE items 01-07 run, since pre-tool.mjs (89 citations), set-phase.mjs (62) and post-tool.mjs (23) are exactly what they edit. Recommend pulling it forward in execution. | A cited line that changes fails `npm test`; the drifted citation is named. |
| 16 | mcp-path-containment | 01 | **SHIPPED v0.5.4.** Added 2026-08-16, after item 01 shipped. Item 01 closed the Edit twin and Bash was already closed, leaving one tool class that can still write the enforcement surface from inside an approved run: a non-native/MCP tool. Measured on one armed post-OKAY run — Edit and Bash to `~/.zcode/cli/config.json` both exit 2, `mcp__fs__write_file` to the same path exits 0; same split on the running hook itself. The H3 guard (skills/odyssey/hooks/pre-tool.mjs:1557) protected only the run's .zcode/state and .zcode/reviews (skills/odyssey/hooks/pre-tool.mjs:1603) — correct when written, the weak link once its neighbours were fixed. First cut protected the whole install root, which in a dev checkout IS the user's repo — every MCP write into it blocked, declared files included; amended 2026-08-17 to the enforcement subtree. Security-class, own release. | A non-native tool cannot write the plugin's enforcement subtree (skills/odyssey, agents, commands, manifest) or the hook registry; read-only MCPs and ordinary repo work — including inside a dogfooded checkout — are unaffected. |
| 17 | fluency-invariant | — | **SHIPPED v0.6.0.** Added 2026-08-17, from the ISNAD-engine adaptation study. The judge rubric and the auditor's no-style-rejections clause are clean only by accident — nothing compares judge.mjs to the MEASUREMENT.md §2 claim, and style-correlated confidence is a measured judge failure mode (ROADMAP §2). Sixth doc-claim invariant suite; independent of every other row. | A sixth rubric dimension scoring prose quality fails `npm test`, demonstrated in both directions. |
| 18 | independence-labeling | — | **SHIPPED v0.6.0.** Added 2026-08-17, from the ISNAD-engine adaptation study (rule R4). SKILL.md already states the external auditor is stronger than any in-session reviewer, and the consult lane records the fact on disk — but no report says which origin stands behind `success`. Audited and in-session-only runs are indistinguishable in the trend corpus; labeling only, no gate. | Every run-report/results.jsonl record carries `verify_origin` (`external-audit` \| `in-session-only`) + `consult_rounds`; dashboard renders the column; legacy records render `-`. |
| 19 | narrator-trust-registry | — | **SHIPPED v0.6.0.** Added 2026-08-17, the ISNAD adaptation headline (rule R2). The eval loop's named biggest gap: scores everywhere, nothing feeds back. Deterministic cross-run agent-config reliability from consult verdicts + judge criterion results, keyed on agent-file content hashes (prompt edit = new identity); advisory-only consumption by metis. Ships the A0 rider that fixes the hardcoded judged-record arm via `lib/arm.mjs` — item 09's residual scope (explicit `--arm` + baseline automation) unchanged, amendment appended there. | `registry-report.mjs` scans state + judged.jsonl into a global idempotent ledger; trust = Laplace with n always shown; metis folds low-trust/high-n narrators into Identified Risks. Real-data smoke: momus 0.67 (n=4), executor 0.73 (n=9). |
| 20 | agent-citation-discipline | — | **SHIPPED v0.6.0.** Added 2026-08-17, the ISNAD study's Pattern-A fragment (rule R5 / tadlīs): executor notepads/summaries and momus blockers must cite the span that witnessed each claim. Prompt-layer advisory only — the enforcement twins (notepad append-only, test-integrity guard, record-verify executed criteria) already exist; auditor-prompt deliberately untouched (its gap format already names files). | Both agent prompts carry the span-citation rule; no code, hooks, or scripts change. |

## Amendment — 2026-08-16, after item 15 landed

Item 15 shipped (`a9b4cf0`), so `scripts/check-anchors.test.mjs` now runs inside
`node scripts/run-tests.mjs` and content-pins every `file:line` citation in the docs. Two
consequences were written back into every prompt rather than left for each run to discover:

- **The suite baseline is 33/33, not 32/32.** All fourteen prompts stated 32; all fourteen were
  corrected. Prompt 12's "suite count grows 32 → 33" became 33 → 34, since it adds a test of its own.
- **Editing a cited file now reddens the suite until citations are reconciled.** Each affected
  prompt carries an `### Anchor-drift reconciliation` block stating its own exposure and the fixed
  order: change code → `check-anchors.mjs` → fix each citation at the source → *only then*
  `--update`. Running `--update` first re-pins whatever is there, including already-wrong
  citations — which is how item 15's own lock was seeded over an 11-line-stale README anchor.

Exposure, measured from each prompt's declared `Files` set against the lock (2026-08-16):

| prompt | pinned citations into files it edits | prompt | pinned |
|---|---|---|---|
| 04 ungate-bash | **97** | 12 prime-acceptance | 46 |
| 14 otel-spans | **95** | 05 corpus-decontamination | 38 |
| 11 compaction | **83** | 02 wire-zero-callers | 29 |
| 06 token-telemetry | 69 | 13 cache-prune | 29 |
| 07 b10-lint-baseline | 67 | 10 prompt-surface | 28 |
| 03 nonce-lane | 63 | 09 two-arm-eval | 20 |
| 01 containment-escape | 52 | 08 claims-ledger | **0** |

Fourteen of fifteen are affected; only 08 is clean, because it creates new files rather than
editing cited ones. This is the cost of landing 15 first, and it is the cost worth paying: named
failures instead of silent rot. The heaviest three all edit `pre-tool.mjs` (51 pinned citations)
or `set-phase.mjs` (29).

## Dropped

| candidate | reason (file:line) |
|---|---|
| Per-test regression granularity | Concession confirmed: per-test granularity needs runner-specific parsing that would rot (docs/MEASUREMENT.md:68). Both ideation passes say do not build. Left out. |
| OS-level process confinement (full) | Hooks observe tool calls, not process trees — the boundary is codified at agents/sisyphus-junior.md:89. The in-constraint remainder (write-capable Bash targeting) already exists and is folded into 01. |

## Out-of-rank positions

- nonce-lane (map #12) → 03: security-class items group adjacently (same file cluster: pre-tool.mjs and its libs) for the one-security-change-per-release cadence — sequenced contiguously, explicitly not merged into one change; also cheap.
- UNGATE (map #6) → 04: same security grouping; it lands as record-every-call, not retirement.
- token telemetry (report §1.3; the map missed it) → 06: telemetry numbers are metrics drawn from the corpus, so it follows 05.
- compaction (report §1.4) → 11: rank-free; after the measurement block by grouping, no hard edge.
- TiCoder (map #10) → 12, cache prune (map #13) → 13, OTel (map #8) → 14: demotions — OTel is externally blocked (semconv "Development") so last; prune is cheap ops hygiene; TiCoder is independent and carries external-evidence caveats.
- prompt-surface (map #9) → 10: the hard edge on 09 is preserved verbatim.
- anchor-drift (no map/report rank; found 2026-08-16 while verifying this queue) → 15: it has no blocking edge and takes the next free id rather than renumbering a committed queue whose prompts cross-reference each other by number. **Its execution position should be earlier than its id.** Items 01, 03 and 04 edit pre-tool.mjs (89 citations), 02/05/11 edit set-phase.mjs (62), and 07 edits post-tool.mjs (23) — so running the queue is itself the largest threat to the citation surface, and the check is worth more before that than after. Pull it forward; the id is a label, not a schedule.

## Observations

- Stale anchors: agents/sisyphus-junior.md:93 and docs/ROADMAP.md:188 — both cited regions had drifted. **RESOLVED 2026-08-16.** sisyphus-junior.md:93 was re-anchored (it cited pre-tool.mjs:906-962 for the Bash gate and :807 for the UNGATE hatch; correct values are :1072-1226 and :978, and :807 had become the unrelated `if (rel)` containment escape). ROADMAP.md:188 is valid again — its status addendum was deliberately APPENDED rather than inserted, so every line number in that file is unchanged. Both are now citeable.
- The anchor problem generalised into row 15. Fixing the two above produced two more instances of the same defect inside the same day: a one-line insertion into skills/odyssey/references/scripts.md shifted check-imports from :45 to :46 and silently invalidated nine citations (seven of them in docs/ideation-report.md, a committed audit artifact); and a first draft of the ROADMAP addendum, inserted at the top, broke fourteen more across docs/ideation-report.md, docs/impl/07, docs/impl/08 and this file. Both edits were reshaped to be line-count-neutral, and the class was queued as row 15. Repo-wide surface, measured 2026-08-16: 761 citations, 28 documents, 68 cited-into files, 0 currently out of range.
- build-capsules.mjs is a fourth zero-caller script (zero references of any kind, measured 2026-08-16). Outside the Step-2 candidate set — recorded here, not added as a 15th prompt.
- results.jsonl drift across this task's lifetime: 172 (map, 08-15) → 177 (report, 08-15) → 181 (metis consult, 08-16 early) → 184 (notepad 2, 2026-08-16T03:05:00Z) → 185 (during todo 3, 08-16). Every prompt quoting the file stamps its own count and date.
- CORRECTED during the run (wave 6): an earlier bullet here claimed `docs/ADAPT.md` does not exist — that was wrong. The file exists (committed in 6039199, v0.1.0) and `docs/ADAPT.md:48` is the live, canonical anchor for the ZODYSSEY_UNGATE_BASH affordance ("set ZODYSSEY_UNGATE_BASH=1 if you want the lower-friction ungated behavior"). docs/INSTALL.md:152 and CHANGELOG.md:483/:648 are additional live anchors also used in row 04. Prompt 04 may cite any of these. The false-absence claim was caught by the prompt-04 executor and re-verified by the conductor against the working tree — the exact drift class this INDEX exists to prevent, caught inside the same run that wrote it.

## Amendment — 2026-08-17, item 05 shipped + bookkeeping catch-up

Item 05 (metrics-corpus-decontamination) shipped on `feat/eval-lane-decontamination` → v0.6.1:
two-lane telemetry (`ZODYSSEY_EVAL_LANE=synthetic` declared at source routes terminal-phase
scorecards to `results.synthetic.jsonl`; `run-tests.mjs` exports the lane for the whole suite
run, so the guard holds on both fixture markers, not just `add-truncate`). Stamped at cutover:
387 records / 91.2% synthetic, retained (not quarantined) per the brief's migration stance.
Deviations + the bare-cite reconciliation this sweep required: see the amendment appended to
the item-05 brief itself.

Bookkeeping catch-up (found during the 2026-08-17 external verification of the release state):
rows 01/02/03/15/16 had shipped without shipped-markers in this table (the tags and CHANGELOGs
were the only record). Rows now carry their release stamps: 01 → v0.5.3, 16 → v0.5.4,
03 → v0.5.5, 02 (+ the ISNAD rows 17-20) → v0.6.0, 15 → pre-v0.5.3 (`a9b4cf0`).
Remaining queue: 04, 06, 07, 08, 09, 10, 11, 12, 13, 14 — 06 and 09 are now unblocked (their
depends-on 05 is shipped); 06 is the natural next (its denominators draw from the operator lane).

## Amendment — 2026-08-18, item 04 shipped + shipped-marker sweep

Item 04 (ungate-bash-record-or-retire) shipped → **v0.6.2**. The `ZODYSSEY_UNGATE_BASH=1` hatch
stays open and stops being silent: every call through it appends `{at, command}` to
`.zcode/state/<slug>.ungated.jsonl`, `run-report.mjs` counts it as `ungated_bash_calls` on every
scorecard and trend record, and a structural scan in the regression suite enforces the *class* —
any `process.env.ZODYSSEY_*` read whose branch guards an early `exit(0)` must route through the
recorder between read and exit. Recording is fail-open by deliberate exception: the operator has
disabled enforcement, and a recording failure must not silently re-gate the call they ungated.
Externally audited to ACCEPT with zero gaps; the one advisory it did raise (two half-shifted
CHANGELOG continuation cites) is fixed in `3afd81c` and generalised as candidate C2 below.

**Shipped-marker sweep, the second of its kind.** The 2026-08-17 catch-up stamped rows 01/02/03/05
in the table but named 15/16/17-20 only in its closing prose, so six rows still read as open work
to anyone reading the DAG. All six now carry markers in the table itself. Each was verified against
the tree rather than against the CHANGELOG — existence of mechanism, not existence of entry:
`skills/odyssey/scripts/registry-report.mjs` and `skills/odyssey/scripts/lib/arm.mjs` on disk for
19; `verify_origin` present in both `skills/odyssey/scripts/run-report.mjs` and
`skills/odyssey/scripts/dashboard.mjs` for 18; `skills/odyssey/scripts/judge-rubric.test.mjs` for
17; the ISNAD-R5 clause in *both* agent prompts — `agents/momus.md` and
`agents/sisyphus-junior.md:110` — for 20; `ungated_bash_calls` in
`skills/odyssey/hooks/pre-tool.mjs` for 04; `scripts/check-anchors.mjs` plus its test for 15.

**Correction carried:** an in-session status report earlier on 2026-08-18 listed row 20 as not
started. That was wrong — it shipped with the v0.6.0 ISNAD wave, and both agent prompts carry the
clause. Recorded here because the same report is what prompted this sweep.

Remaining queue: **06, 07, 08, 09, 10, 11, 12, 13, 14** — nine rows, every one with a written
prompt. Row 08 became fully unblocked by this release: it depends on 01, 02, 03 and 04, and 04 was
the last of the four. Row 06 is the natural next — its dependency 05 is shipped, and its
denominators now draw from an operator lane that no longer counts fixture runs.

## Candidates — surfaced 2026-08-18, not yet rows

Two defects found while closing item 04. Recorded here rather than added to the DAG, because
neither has a written prompt and this table's contract is one row = one `docs/impl/NN-<slug>.md`.

**C1 — the retroactive-audit vehicle cannot reach `audited`.** The phase graph gives `audited`
exactly two predecessors: `done` (skills/odyssey/scripts/set-phase.mjs:94) and `remediate`
(skills/odyssey/scripts/set-phase.mjs:93). A run opened purely to carry an external audit of work
that already shipped executes nothing, so it cannot reach either — it ends at `abandoned`, whose
edges are `plan`, `review`, `execute`, `blocked` (skills/odyssey/scripts/set-phase.mjs:97). The
label is unreachable for exactly the runs that earn it. The consequence is not cosmetic: the
terminal auto-append fires on `done` and `audited` only (skills/odyssey/scripts/set-phase.mjs:430),
so an audit-vehicle run contributes no trend-log record at all — and row 18's `external-audit`
origin, the whole point of which is to distinguish audited work from self-graded work, is never
contributed by the run class that most deserves it. Measured on this release's own two runs, a
clean pair: `impl-05-corpus-decontamination` reached `audited` and carries an operator-lane record
labelled `external-audit`; `impl-04-audit` — the run that carried item 04 to an ACCEPT with zero
gaps — sits at `abandoned` in `.zcode/state/impl-04-audit.json` and contributes **zero** records
(measured 2026-08-18: 393 operator-lane records, no match for the item-04 run).
The narrow fix is a single consult-ACCEPT-gated `abandoned → audited` edge. Ungated is not
acceptable: `abandoned` is one of the two forceable targets
(skills/odyssey/scripts/set-phase.mjs:295), so an ungated edge would let `--force` mint the
audited label in two commands — the master-bypass shape that scoping `--force` exists to prevent.

**C2 — item 15 is blind to continuation citations.** `CITE` requires every citation to carry its
own path prefix (scripts/check-anchors.mjs:80), so the second half of a continued form is never
discovered: in `CHANGELOG.md:483/:648` only `:483` is seen, and in a range followed by prose like
"the verdict gate at :1105" only the range is seen. Undiscovered means unpinned, which means
unswept when the file shifts — the citation rots exactly as it did before item 15 existed. This
bit twice in one day, once caught by hand and once by the external auditor, both in the CHANGELOG;
and a live specimen sits in this file's own Observations block, where a bare `:648` has been
invisible to the checker since the day it was written. The fix is a second resolution pass binding
a bare `:NNN` to the nearest preceding path on the same line, carrying forward the rule that makes
15 trustworthy in the first place: where the binding is ambiguous, fail rather than guess.
