# Changelog

All notable changes to ZOdyssey are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.1] — 2026-08-22

### Fixed — the retroactive-audit vehicle can reach `audited` (candidate C1)

A run opened only to carry an external audit of already-shipped work executes nothing, so it could
never reach `done` and therefore never `audited` — it ended at `abandoned` and contributed ZERO
records to the trend log (the auto-append fires on done|audited only, set-phase.mjs:477), the one
run class whose external-audit origin most deserves recording. set-phase.mjs gains an
`abandoned → audited` edge gated on a real external-audit ACCEPT (state.consult.verdict === ACCEPT,
minted only by trusted consult.mjs) — audited stays out of the --force set, so the abandoned-force
two-step cannot mint the label. The destination gate also closes the latent hole that done → audited
never required an audit. All 16 existing audited runs satisfy the new precondition. Suite 55 → 56.

## [0.7.0] — 2026-08-22

### Added — the eval-loop meta-layer: the corpus learns, staging-only (item 25)

mine-corrections.mjs mines the run corpora for RECURRING failure patterns (criterion-shape
families, reject-blocker classes, verify-fail cycles, consult-gap categories; recurrence ≥ 3
runs) and writes STAGED PROPOSALS under .zcode/staging/proposals/ — deterministic pattern
counting, zero LLM calls, never a live edit. Metis's consult dispatch now lists unapplied
proposals as risk-input. Applying a proposal stays a separate human-approved action, exactly
the staging-only model recall-corrections.mjs:32 prescribed for its edit half. Suite 54 → 55.

## [0.6.17] — 2026-08-21

### Fixed — the regression gate is wired: `done` runs the comparison (item 24)

regression-gate.mjs --check shipped in v0.6.0's B8 wave with zero code callers — the snapshot
ran, the done refusals waited, and nothing ever compared. The done transition now invokes
--check over the exact tree the final wave judged, re-reads the recorded lane, and refuses on
what it says; the subprocess exit never gates, the recorded status does. Gate-vs-inert
unchanged: inert/no-baseline never block, an already-red baseline is recorded, not enforced.
The 54th suite pins invoke+record+consume together (12/12; 4/12 on the pre-wiring tree), and
the eval-lane suite's refused-done fixture now derives its regression from a real red suite.
README's enforcement table loses its last ⚠️ row — zero half-wirings remain. Also: docs
swept current (README diagrams F1–F5, delta rows for v0.6.15/v0.6.16), the stale illustrative
citation pair in check-anchors.mjs re-pointed (consult-r3 advisory), and item 23's INDEX row
backfilled.

## [0.6.16] — 2026-08-21

### Fixed — per-call project-scoped run selection: one workspace, several projects (items I1–I6)

An audit proved that when one session watches a folder containing several projects, the gate
could act on the wrong run: a single "active run" was picked once per hook invocation and every
check — review gate, scope, probe destination, ledger append, protected dirs — followed it,
regardless of which project the tool call actually touched. An MCP write aimed at project-b was
judged (and logged) by project-a's run (I1); edits into BOTH projects' state were allowed when
either run had cleared the gate (I2); a `plan_path` stored as an absolute path in one repo could
be opened by readers in another (I3); state files were not bound to the repo they govern (I4);
ungated Bash run from project-b's cwd appended to the recency winner's ledger (I5); and the
discovery DFS existed as two divergent twins, one private to the hook (I6).

The fix is a **per-call selection model**: discovery is unified (one `discoverStateDirs` in
`find-run.mjs`, the hook's private twin deleted) and returns ALL live runs behind a TTL-bounded
cache; each tool call then selects the governing run by its own anchor — Edit target, Bash and
dispatch cwd, or the deepest run root enclosing any path-shaped MCP payload string (recency
fallback when nothing matches, recency tie-break at equal depth). `runRepo` and the unguarded
ledger are derived per call; `protectedDirs` is the union across every discovered run, so writes
into ANY project's state dir are blocked without needing to know which run "wins". The plan-path
fallback `plan_path || join(...)` now lives in exactly one helper (`scripts/lib/plan-path.mjs`,
`resolvePlanPath`) used by all reader sites, and a foreign plan_path resolves to the caller's
own repo and names the violation. The run marker's identity gains an ADDITIVE optional
`project_dir` field (appended last, so every pre-0.6.16 marker verifies byte-identically);
`scaffold` stamps it at creation and `--adopt` re-stamps it, and discovery rejects a bound state
found under the wrong repo root.

Paired probes, RED first: `pre-tool.project-isolation.test.mjs` was 5/9 RED on the unmodified
hook (RED confined to I1/I2/I5/TIE/TTL; PARITY/SYMLINK/FALLBACK/DECOY already green), 9/9 after (real `spawnSync`, hermetic fixtures); `plan-path.test.mjs` reproduced the
foreign-plan leak live before the helper closed it; `state-auth.project-binding.test.mjs` was
1/5 (only the backward-compat case green, as the plan demands) and is 5/5 after;
`find-run.pin.test.mjs` pins that the real hook and the shared module assert the same governing
slug on one tree. The suite count goes 49 → 53.

Documented, deliberately not fixed: `post-tool.mjs`/`stop.mjs` still select via `mostRecent` on
every path (deferred by conductor decision — they only record, never enforce); Bash invoked with
cwd = the parent workspace itself still attributes to the recency winner (the accepted I5
residual — there is no per-call signal deeper than cwd); a pre-0.6.16 hook silently treats a
bound state as unmarked (version-skew downgrade, same mechanics as the strip case); relocating a
repo disarms its bound runs until `scaffold --adopt` re-stamps them. Noted safe, not changed:
Bash/Edit cross-repo write targets already fail closed via the scope check (`quickClassify`) —
payload steering there yields denial, not bypass.

## [0.6.15] — 2026-08-20

### Fixed — the eval harness declares its synthetic lane at every producer site (item 22)

The two-arm evaluation harness built synthetic runs end to end — fresh-copied fixtures, a
spawnable external CLI, self-appended measurement records — and never declared itself
synthetic anywhere: no `ZODYSSEY_EVAL_LANE` at the scaffold spawn or the baseline CLI spawn,
and the baseline arm's efficiency record self-appended straight to the operator-lane
`results.jsonl`. The lane contract (references/scripts.md) says fixture harnesses MUST declare
the lane at spawn; the harness postdated item 05's lane split and reopened exactly that class —
measured 2026-08-20, 2 fake `arm:"baseline"` records sat among the operator's 418 real ones.

The fix is producer-side and unconditional: both spawns stamp
`ZODYSSEY_EVAL_LANE: "synthetic"` (the run-tests declaration idiom) so everything they start
inherits the declaration, and the baseline self-append routes to `results.synthetic.jsonl` by
CONSTANT — the harness IS the synthetic generator, so it declares its lane at source rather
than asking the operator's env (`env.ZODYSSEY_EVAL_LANE ||` is forbidden in it). A spawn-only
fix could not have routed the direct append, and the 2 polluted records went through exactly
that path.

Paired probes, RED first: a hermetic baseline run (temp HOME, stub CLI, scrubbed env) landed
one `arm:"baseline"` record in the operator lane with the synthetic file absent — exit 0 with
the defect present; after the fix the mirrored probe holds exactly one record in
`results.synthetic.jsonl` with the operator file never created, and the spawned CLI witnesses
`ZODYSSEY_EVAL_LANE=synthetic`. The new suite `harness.eval-lane.test.mjs` was RED at 2/9 on
the unmodified harness and is 9/9 after; the suite count goes 48 → 49.

Known, not fixed: the dashboard's default view reads the operator lane, so harness baseline
rows now render only from the synthetic lane; zodyssey-arm scorecards from the operator's
interactive conductor sessions cannot be harness-tagged (no harness spawn to tag — routing
them would need lane persistence in run state); and the 2 polluted records are documented and
retained pending an operator-side data decision.

## [0.6.14] — 2026-08-20

### Fixed — the live cache dir can never be pruned, including on a mismatched registry (item 13, consult r1)

The v0.6.13 "catastrophic-case guard" was dead code: it pushed the live directory into `keep` but
never removed it from `prune`, and `prune` was ordered by the registry's `version` field while the
live directory is `basename(installPath)`. When those two registry fields disagreed by more than
the retained pair — the exact hand-edited-registry rollback shape — the live directory appeared in
both lists and was deleted, by the explicit `--prune-cache` and silently by the default install's
final step. Found by the external consult auditor (round 1); missed by the in-session review and
the suite because no family covered `version` ≠ `basename(installPath)`.

- The live dir is now carved out of the removal list itself (`prune` filters it), not merely
  re-reported as kept; the guard's comment no longer claims more than the code provides.
- Containment tightened: an `installPath` exactly equal to the cache base now fails closed
  (`{ error }`) instead of walking the plugins directory (flagged by both the in-session F2 and
  the auditor's advisories).
- The suite gains the mismatch family: registry `version` 0.6.12 with `installPath` → `0.4.0`
  asserts the live dir has no rm line and stays byte-identical through both consumers, plus the
  cache-base fail-closed shape — asserted, not promised. 48/48.

## [0.6.13] — 2026-08-20

### Added — the installer prunes stale plugin-cache versions (item 13)

The plugin cache accumulated forever: every marketplace Get added a version dir under `.../cache/<marketplace>/zodyssey/` and nothing ever removed one. The installer now derives the removal list from `installed_plugins.json` — the only source of truth for which copy is live — through two surfaces: an exclusive `--prune-cache` mode (`--dry-run` previews the exact removal list) and the **final step of every ordinary install run** (best-effort: silent when the cache is already within the kept pair; a warning and no deletion when the registry cannot prove live-ness — fail closed means delete nothing, not block the installer). `--verify` gains one informational line — `stale cache dirs: N` — that never fails a check.

Retention is the registry-live version plus its on-disk predecessor (the highest semver dir strictly below live — read from disk, never live-minus-one arithmetic), nothing else: the predecessor is kept (a) so a botched marketplace Update can be inspected against the last known-good dir, and (b) so a clean Update still leaves a coherent one-release rollback (today's version mixtures came from `--sync-cache` layering, not Updates). Everything provably older than that pair is pruned; everything newer than live is kept (a downloaded-but-unregistered update is indistinguishable from an orphan); non-semver-shaped entries in the parent dir are reported as skipped and never touched. Only the parent of the registry-resolved install path is walked — other marketplaces', other plugins', and sibling trees are invisible. Fail-closed rule: a registry that cannot prove live-ness (missing, unparseable, entry-less, pathless, or pointing outside the cache) makes the explicit flag print the reason and exit 1 having deleted nothing. `installed_plugins.json` is read, never written.

One plan function computes the list, the dry run prints it, and the execution deletes exactly it: the live dir's byte-integrity and the registry's read-only treatment are asserted by the new suite (`scripts/cache-prune.test.mjs`), not promised.

Paired probe, both directions: before, `node scripts/install.mjs --dry-run --prune-cache` was silently ignored — unknown argv ran the default flow, exit 0, nothing listed or deleted, indistinguishable from success; after, the same command prints the exact plan (`prune-plan: live=<V> keep=<V1,V2> prune=<N>` plus one `[dry-run] rm` line per dir) and the non-dry execution's on-disk delta equals the printed list and the summary count. Measured anchor, census on this machine 2026-08-20: 10 cache dirs, 214M total, 138.3M prunable — live 0.6.12, on-disk predecessor 0.6.9 (no 0.6.10/0.6.11 dir exists), 8 dirs prunable (0.3.2, 0.4.0, 0.4.1, 0.5.0, 0.5.1, 0.5.2, 0.6.0, 0.6.2).

**Known, not fixed:**

- Versions newer than live are never pruned — pending-update ambiguity is unresolvable from the registry; an orphaned newer dir is kept until a later release makes it the predecessor.
- Shared-cache multi-home setups: each home prunes by its own registry only; consulting foreign registries was deliberately not built.
- `--verify` reports the stale count but never prunes; the prune fires on install runs or the explicit flag.
- The retention constant (`CACHE_PRUNE_KEEP = 2`) is stated policy, not a derived number — no measurement exists that says the kept pair should be any other size.

Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs` (which now prunes as part of the run), then re-Get/Update the plugin — a fix that stays only in the repo fires in no run.

## [0.6.12] — 2026-08-20

### Added — acceptance criteria can be user-confirmed at PRIME (item 12)

The acceptance criteria that gate every run were model-authored end-to-end; the user — the one party independent of the model — never saw them before execution. PRIME now appends **one** AskUserQuestion round to the existing ambiguity ritual when the primed brief's success criteria are **measurable** (phrasable as command + expected outcome): it presents at most 3 proposed criteria in at most 4 options, one always an explicit skip — confirm / adjust / skip — **inside** the standing max-3-questions budget, never beside it. The outcome is a machine-readable artifact, not a claim: the conductor passes it to the scaffold it already invokes, and `scaffold --criteria-state confirmed|adjusted|skipped` stamps a single first line — `<!-- criteria-confirmation: <state>@<ISO-8601> -->` — on `plans/<slug>.task.md`; the brief body stays byte-identical (additive, asserted by Buffer equality). At PLAN, the stamp keys transcription: `adjusted` criteria are transcribed verbatim as executable commands (the user's wording is the source of truth); `confirmed` uses the presented criteria; `skipped` or no stamp keeps today's authorship unchanged. Skip, no answer, or AskUserQuestion unavailable (headless/autonomous) → `skipped` → the run proceeds exactly as today — **the mechanism never blocks**; there is no gate, precondition, or state-lane anywhere. Bad flag values exit 2 before any file is written; no flag is byte-identical legacy output.

Paired probe, both directions: before, `grep -c AskUserQuestion skills/odyssey/SKILL.md` → 1 (the momus rail only) and `grep -rn criteria-confirmation` → 0 hits (no confirmation state existed to record; the flag was silently ignored); after → 2 and 3 (PRIME round + PLAN rule + invocation line). The recording suite (33 checks, RED-proven 17/33 against the unmodified scaffold; the stash-form paired-direction proof re-reddens with only the scaffold reverted) asserts byte-additivity, the no-brief warning path, plan.md/state.json independence, and the legacy byte-identity. External evidence, carried with its caveat labels and **not re-fetched**: TiCoder reports +22.49–37.71 (MBPP) and +24.79–53.98 (HumanEval) absolute pass@1 with 1–5 user queries, follow-up avg +45.97% with human study; caveats: single corporate research group, simulated (oracle) user, MBPP/HumanEval only — generalization to orchestration acceptance criteria is an extrapolation (`docs/ideation-report.md:450`). The mechanism supports asking the *user*; it is why this change adds no model anywhere.

**Known, not fixed:**

- The act of asking remains conductor prose. The mechanism guarantees a confirmation, when obtained, is recorded and honored downstream; it cannot force the question to be asked. The SKILL.md tripwires (`criteria-confirmation` ≥2, `AskUserQuestion` ≥2, budget clause ==1) assert the contract's presence, not the conductor's behavior.
- The external accuracy numbers keep their caveat labels and were not re-fetched; no ZOdyssey-native measurement exists that the round improves outcomes here. The two-arm eval (queue items 09/10) is the instrument that could produce one.
- A forged `--criteria-state confirmed` stamp is inert-but-possible: the flag records a label, it authenticates nothing (no argv flag authenticates anyone). Hardening it into a credential would be a new change with its own audit.

## [0.6.11] — 2026-08-20

### Added — prompt-surface measurement: evidence statuses for the guidance text (item 10)

`skills/odyssey/scripts/prompt-surface.mjs` renders a census of the guidance surface (every `## ` section of SKILL.md, every capability-matrix row, every agent prompt) tagged with an evidence status — `measured-load-bearing` / `unmeasured` / `contradicted` — computed mechanically from the two-arm deltas item 09 produces, joined to hook-witnessed capability activity in run state by exact identity (`MIN_N = 3`, delta band ±0.15, both printed as header conventions). The report is stdout-only and mutates nothing. Without a seed judged under both arms it refuses: exit 3, stderr naming `two-arm` and the producing commands — a deliberate divergence from `dashboard.mjs`'s exit-0-on-empty convention, because an absent substrate is a named blocker here, not an empty table.

The header carries a substrate line — `substrate: <k> of <N> run states carry a capabilities key` — so the headline unmeasured fraction cannot be quoted as a claim about the guidance when the cause is instrumentation coverage. Today it reads `0 of 6` (the field-not-slug join consults four slugs, each resolving state in both the harness-stamped and legacy repo layouts): the first quotable fraction is 1.000 for a named, checkable reason.

This repo cites its probes: refusal proven live against the pre-09 ledger; all three statuses threshold-proven in the suite; the layout-agnostic state join (`runs/*/.zcode/state/<slug>.json`) proven against both layouts on disk — the first cut resolved a fictional `-live`-only layout, was caught by the final-wave code review, and was fixed fixtures-first RED→GREEN before release.

**Known, not fixed:**

- Initial tagging is coarse: two arms measure the pipeline as a whole; per-section and per-agent attribution require ablation runs. Agent blocks inherit the aggregate delta's status; SKILL.md sections read `unmeasured` by construction.
- The witnessed-activity substrate is empty beyond the brief's prediction — the `capabilities` key is absent entirely from every eval-run state on disk (both layouts, both arms; the two zodyssey-arm `-live` states predate the capability-observation write). The fraction cannot move until a fresh zodyssey-arm run is driven on a seed — the same interactive-conductor bottleneck as the eval itself; nothing automatable clears it.
- Guidance-version skew: eval runs are driven by the *cached* plugin's prompt surface; the report tags the tree it is pointed at (`repo-root` argv). Exact version pinning is follow-up work.
- `MIN_N = 3` and the ±0.15 band are named conventions, not laws.
- The report mutates nothing; pruning, if any, is a human decision in a separate change.

## [0.6.10] — 2026-08-20

### Added — compaction now fires from the final-phase transition (item 11)

Entering `final` now auto-invokes `skills/odyssey/scripts/compact.mjs` from `set-phase.mjs` — after the phase write, outside the state lock, best-effort: a missing notepad dir, failure, or timeout warns on stderr and the transition still exits 0. Compaction gates nothing. Above `AUTO_COMPACT_MIN_LINES = 400` aggregate non-empty notepad lines the transition writes `_compact-brief.md` and prints its path; at or below the threshold it is inert (no writes, no deletions, one printed line). `ZODYSSEY_NO_AUTO_COMPACT=1` skips the invocation entirely. Direct two-arg invocation is unchanged byte-for-byte; the only new CLI surface is `--min-lines <N>`, which fails closed (non-integer or negative N exits 2) and short-circuits inert below the threshold without touching a stale manual brief.

The additive invariant — every source notepad stays byte-identical across every path — is now an asserted test rather than a comment: `compact.test.mjs` (suite 44 → 45) hashes every notepad before and after each invocation, transition paths included, and fails on any byte drift.

Paired probe, RED first: against the unmodified v0.6.9 tree, hand-invoking `compact.mjs` produced a brief while entering `final` produced none (cases f/g/h failed); after the wiring, the same transition produces one with sources unchanged. This repo cites its probes, not just its diffs.

**Known, not fixed:**

- The threshold value (400) is a stated judgment — 10× the per-notepad cap — not a derived number; the two-arm eval (queue items 09/10) is the instrument that could measure real context cost and replace the constant with data.
- Pointing F1–F4 dispatches at the brief remains conductor prose anchored to the printed path signal; the mechanism guarantees the brief exists and is signalled, not that anyone reads it.
- A below-threshold re-entry of `final` never deletes a stale brief from an earlier entry (deletion is non-additive); freshness is the per-entry printed line, not cleanup.
- `skills/odyssey/scripts/build-capsules.mjs` remains a zero-caller outside this change's scope (already named in prompt 02's Known-not-fixed; still true).

## [0.6.9] — 2026-08-19

### Fixed — every number of a citation is checked; CHANGELOG targets content-pinned (item 21)

The anchor checker verified only the first number of a citation: its regex required a path
prefix per number, so comma pairs (`harness.mjs:88,62`), slash continuations, and bare-colon
continuations were invisible — unpinned and unswept. CHANGELOG.md lines were not pinned at
all, which is how 3afd81c's +17 half-shift shipped unnoticed: the path-form halves were
re-anchored and the continuation halves silently kept their old numbers.

Discovery is now structural: a contiguous number chain binds to its path-form cite, a bare
`:1105`-style token binds to the nearest preceding path form on the same line, ambiguity
fails, and every number gets its own range, contentless, pin, and drift check. Reversed
ranges are refused as `backwards-range` instead of passing the contentless check vacuously.
CHANGELOG.md is pinned as a target and scanned as a citing document for its TOP SECTION only
(operator-proxy decision, OVERRIDABLE — released history below the second version heading is
never rescanned; the fallback restores the exemption, not the pinning).

Paired probes, RED first: four groups (comma-pair, backwards-range, a +16-line CHANGELOG
shift, the CHANGELOG top section) failed against the unmodified checker — exit 1, 43 passed,
11 failed — and pass after the change. `--update` ran ONCE, after every newly discovered
citation was verified at source.

### Fixed — external-audit remediation: judge numerics and the harness work guard

The first external consult audit of the two-arm instrument found two gaps, with one more of
the same class disclosed on re-read; all three fixed probe-first. `judge.mjs --compare`
scored a null or missing `overall` as a real 0.0 (`Number(x) || 0` — `Number(null)` is 0 and
finite) and let an absent one inflate n; non-numeric records are now excluded from every
mean and n and print as their own `unscored: k` line, and an all-unscored arm prints `no
scored records` instead of a mean over nothing. The same coercion sat in the live judge-run
path: a non-numeric verdict `overall` is now recorded as `overall: null` (unscored), never
a fabricated 0.0, and `--double` runs its disagreement arithmetic on numeric pairs only — a
non-numeric pass is disclosed as `unscored_pass` rather than coerced to zero and averaged in
as fake agreement. In the harness, the empty-baseline guard decided "work happened" from
`git status --porcelain` alone, so an agent that committed its work still failed as a no-op
and its measured run was discarded; committed work is now also decided against the run's
`run_start_sha..HEAD` diff, with unreadable state or git still failing closed.

## [0.6.8] — 2026-08-19

### Fixed — the baseline arm's tool surface is pinned, and a no-op baseline is a capability failure (item 09 follow-up)

v0.6.7 shipped the baseline arm as the only external-CLI spawn in the repo with no permission flags. Every other spawn pins its surface deliberately — `judge.mjs` and `consult.mjs` both pass `--permission-mode plan --allowedTools ""`, because an auditor must not write — and the baseline arm is the one spawn that *must* write. Flagless, its tool access was an **uncontrolled variable in a controlled experiment**: what the control arm was permitted to do depended on whichever `CLAUDE_CLI` binary was on PATH, and nothing recorded it. Pinned now via `BASELINE_PERMISSION_MODE` (default `acceptEdits`, overridable with `ZODYSSEY_BASELINE_PERMISSION_MODE`), and stamped into the appended record as `baseline_permission_mode` so the experiment's conditions live in the data rather than in the operator's memory.

The second half is the one that bites. Requirement 3's loud-failure rule fires on spawn error, non-zero exit and timeout — a permission-starved agent does none of those. It runs, writes nothing, exits 0. At v0.6.7 that was appended as a **measured** baseline, handing the judge an empty diff to score near zero, so a dead tool surface would have entered the corpus as an arm loss. The bias runs one way: it flatters the pipeline arm, inside the one instrument built to let this project be wrong about itself. An empty baseline diff is now a capability failure on the same terms as a timeout — `status: "failed"`, no append, excluded from per-arm means — decided mechanically (any change outside `.zcode/`, via `git status --porcelain`) rather than left to a reader noticing a suspiciously empty diff. Unreadable git fails closed.

Paired probe: a stub CLI that consumes stdin, writes nothing and exits 0 produced **two measured baseline records** and a batch exit of 0 before the fix; after, it appends nothing and the batch exits 4 naming the capability failure. A writing stub still measures, and its record carries the permission mode. Both directions pinned in `two-arm-eval.test.mjs` (cases (h) and (i), 47/47); criterion 4's stash proof re-proves the red on demand. Suite 44/44.

### Fixed — the citation work two earlier commits promised to fold in

`a461f5e` (ideation-report bare-continuation cite broken by the v0.6.6 sweep) and `632478b` (the four unswept `CHANGELOG.md` citations, +32) each shipped with "folded into the next release entry" in their message; the `[0.6.7]` entry did not carry it. Discharged here, together with the citations this release's own `harness.mjs` edit shifted (+10): `impl/09:65`, `:265`, `ideation-report.md:370`, `:416`, `ROADMAP.md:33`.

Two of those were already wrong before this change and neither was catchable: `ROADMAP.md:33` cited `harness.mjs:88,62`, where `:62` was the `USAGE` constant and never a `REPLACE_WITH` gate, and `ideation-report.md:416` cited `harness.mjs:69-70,19,128-131`. `check-anchors`' `CITE` regex requires a path prefix per citation, so in both cases only the **first** number was ever checked — the rest were invisible and free to rot. Both are rewritten as separately-prefixed citations so the checker can see every one. The general fix (teaching `CITE` comma-pairs, and content-pinning `NO_PIN_TARGETS`) stays queued as candidate C2; this release only stops the two known instances from lying.

## [0.6.7] — 2026-08-19

### Added — the two-arm eval instrument (item 09)

The core bet — that enforced orchestration beats a single capable agent — had one real arm and a printed paragraph for a control: the baseline existed as instructions to run by hand, and a judged record took its label from the run slug rather than from the runner. Both arms are machinery now. `judge.mjs --arm zodyssey|baseline` stamps the record with the arm the invocation judged under — a validated enum (anything else exits 2), defaulting with no flag to the existing slug-suffix derivation bit-for-bit, and the arm never enters the judged prompt, so the one external judge stays blind to which arm produced the work. `harness.mjs --arm baseline` executes the control arm end-to-end instead of printing instructions: the shared fresh-copy / git-baseline / scaffold prefix runs unchanged for both arms, then one external-CLI agent receives the seed's prompt alone — no plan, no criteria, no sub-agents — bounded by a named 240-minute constant (`BASELINE_TIMEOUT_MIN`, its reasoning stated in its header per the 2026-08-19 amendment), and on completion the harness self-appends an efficiency record to the operator lane's `results.jsonl` in the run-report schema — honest nulls for pipeline-only fields, measured `wall_clock_min`, never a fabricated `success`; a missing CLI, a non-zero exit, or a timeout marks that seed failed with no vacuous append, and a batch in which every seed failed exits 4. `harness.mjs --dry-run [--arm zodyssey|baseline]` proves both arms selectable safely: it prints each runnable seed's exact plan (spawn, cwd, append destination, judge command carrying the arm) and exits 0 having written and spawned nothing. `judge.mjs --compare` is the read-only third surface — per-seed `{zodyssey, baseline, delta}` of the judge `overall` plus per-arm means and n, grouped by the STAMPED arm with no slug-sniffing and no everything-else-to-zodyssey default: an unknown arm prints as its own warned group, and a record whose slug suffix disagrees with its stamp gets a mismatch warning line.

Paired probe, as this repo cites its probes: pre-fix, the corpus already carries the falsified direction — records `std-01-baseline` and `arch-01-baseline` (`~/.zcode/orchestration/eval/judged.jsonl`, both 2026-08-01) are stamped `arm: "zodyssey"`, baseline runs judged and filed under the wrong label — and criterion 4's stash proof re-proves the red on demand: with only the stamp reverted to the slug derivation, `two-arm-eval.test.mjs` exits 1 (cases (a)/(b) fail — every record wears the derived arm). Post-fix, stamp==argv holds across the enum (41/41, including `--arm baseline` on a zodyssey-shaped slug and the `--arm zodyssey` override on a `-baseline` slug), and `--compare` over the real corpus warns on exactly those two historical records, exits 0, and writes nothing.

**Known, not fixed:**
- No baseline data exists yet. The instrument ships; the corpus populates on the first explicit operator run (`harness.mjs --arm baseline`; `--double` recommended for the settling measurements, `--task` subsets first). Landing this release without running the eval is correct — no baseline number is claimed here.
- The two historical mislabeled judged records (2026-08-01) remain — retention stance per queue item 05; `--compare` flags them on every run rather than rewriting history.
- The zodyssey arm stays conductor-driven and interactive: the harness wires the measurement, the operator runs `/orchestrate`; headless full-pipeline automation is a separate follow-up.
- `dashboard.mjs` still derives arm from slug suffixes and its "arm field is unreliable" header comment is now stale prose — correct behaviour, stale comment; switching it to the stamped field is a follow-up outside this file set.
- The settling number will be directional (small seed set), and judge absolute scores stay untrustworthy (56.6–65.7% on hard pairs, 61.3% flip under paraphrase); only the same-judge delta is the claim.

Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `install.mjs`, then re-Get/Update the plugin so the marketplace cache picks up the new argv surface — a judge left in the stale cache takes its arm from slug derivation instead of the runner's explicit stamp and has no `--compare` to flag the disagreement, which is exactly how mislabels persist unremarked.

## [0.6.6] — 2026-08-19

### Fixed — the consult-r1 remediations, cut as a release (audit gap r2-1)

The consult-round-2 audit accepted both remediation commits and rejected the record: they sat on main after the v0.6.5 tag, unreleased — the tagged v0.6.5 did not carry them and no entry documented them. This release is that entry; it carries commits 8aeedab and 8a56eba.

8aeedab — the ledger's row 9 was registered under a transposed id, `UNGUATED-CALLS-RECORDED`, where the plan's seed table, the v0.6.5 entry below, `docs/ROADMAP.md`, and `docs/DESIGN.md` had all spelled it `UNGATED-CALLS-RECORDED`; the row's id matched none of its namesakes, and v0.6.5 as tagged shipped the typo. Corrected in `scripts/claims-ledger.mjs` and in the row table of `docs/impl/08-claim-assertion-coverage-ledger.md` (where the typo originated), so `scripts/check-claims.mjs` prints `ok: UNGATED-CALLS-RECORDED` and every surface names the same id.

8a56eba — two checker defects from the same audit. The skip-dir scan matched `run-tests.mjs`'s skip directory names (`build/`, `coverage/`, …) against the assertion target's absolute path, so a checkout cloned under a skip-named segment — `~/build/ZOdyssey` is the case that fired — false-reded every suite row: findings for suites nothing runs, in a path shape the runner never walks from the repo root. The scan now checks the repo-root-relative portion of the target and leaves targets resolving outside the root alone (outside the root is none of the checker's business). And the CLI's failure summary was a hardcoded `0/9 rows resolve` — one broken marker read as nine broken rows. The count is now derived from the rows the findings actually name (`failedIds`), so a single mutated BASH-GATE-REGRESSION marker reports `8/9 rows resolve, 1 finding(s)` and exits 1 naming the row.

Both fixes landed test-first: `scripts/check-claims.test.mjs` cases (i) and (j) were committed red against the unmodified checker and are green since (10/10).

**Known, not fixed:**
- Rows sharing a duplicate id produce one finding naming that id, so the honest summary reads `rows.length - 1` for them — the specified semantics (a set of row ids named by findings), kept as designed.
- The in-root skip-dir firing (a genuine `build/` suite under the repo root) is preserved by construction — for in-root rows the repo-relative path IS the declared path — not by a hermetic test; testing it would need a real file under `ROOT/build/`.

## [0.6.5] — 2026-08-19

### Added — the claim→assertion coverage ledger (item 08)

The repo states its guarantees in prose (AGENTS.md, docs/DESIGN.md §6, docs/DEVELOPMENT.md, CHANGELOG.md) and proves them in scattered assertion files, but nothing connected the two: a deleted suite left its claims unbacked with the suite green. This release adds the connection as three files. `scripts/claims-ledger.mjs` — the hand-maintained registry: each row binds ONE documented claim (`documented_at path:line`, liveness-checked only) to the assertion that proves it (`asserted_by` + a single-line `marker` string, `kind: "suite" | "release-gate"`), with the authoring rules in its header (markers verified by a real grep, never by eye; a 12-row rot cap). `scripts/check-claims.mjs` — the checker: per-row mechanical findings (duplicate id, missing fields, prose `asserted_by`, file missing on disk, marker absent from `asserted_by`, unknown kind, a `suite` row bound to a file run-tests.mjs would never run, `documented_at` file missing or line beyond EOF); exit 0 with one OK line per row id when every row resolves, 1 with one finding per row each NAMING ITS ROW ID otherwise, 0 with an `inert:` line when no ledger exists at the path — a missing capability is never a block, and there is no suppression flag. `scripts/check-claims.test.mjs` — the pin: discovered automatically by run-tests.mjs, so `npm test` is the wiring (no caller to forget); it pins the checker's behaviour hermetically, a ≥ 8-row floor, and the five incident ids. Initial coverage, nine rows: the five scattered equivalents — BASH-GATE-REGRESSION, GATE-SURFACE-INVARIANTS, VERSION-CONSISTENCY, SMOKE-GATE-LIVE, and DEPLOY-SURFACE-COVERAGE, which counts `scripts/deploy-surface.test.mjs` for the first time (the drift gate had never been registered as the proof of anything) — plus one row per queue-item claim 01–04: EDIT-PATH-CONTAINMENT, CHECKS-WIRED-AT-TRANSITIONS, NONCE-MINTER-EXACT, UNGATED-CALLS-RECORDED.

Paired probe, as this repo cites its probes: before, deleting `scripts/version-consistency.test.mjs` left the suite green and the "three manifests must agree" claim at `docs/DEVELOPMENT.md:43` unbacked — the founding failure, restated in the suite's own header. After, any broken binding is a named red row, and the mutated-marker variant is criterion 8's probe: a ledger copy whose BASH-GATE-REGRESSION marker reads "silently deleted THRICE" against the unchanged suite makes the checker exit 1 naming `BASH-GATE-REGRESSION: marker not found in skills/odyssey/hooks/pre-tool.bash-gate.test.mjs — the binding is broken`, and `npm test` is red the same push (discovery). The suite was also committed RED before its implementation — the imports unresolvable, exit 1 by construction — so the assertions are proven to actually run, the zero-caller class this item exists to close, one level up.

**Known, not fixed:**
- Initial coverage is nine rows only, under a deliberate 12-row rot cap (`docs/ROADMAP.md:160`: an exhaustive registry rots). README's comparison table, DESIGN.md §6 beyond the rows bound, and SKILL.md's gate claims are not exhaustively registered; growth is by incident.
- A claim that was never registered remains invisible to the checker — the registry sees its own rows. The guard is the docs rule in `skills/odyssey/references/scripts.md` (a new load-bearing claim gets a row), not code; that is the residual gap between registry and total coverage.
- Non-pinned rows can be deleted in a diff without failing anything; only the five incident ids (and the ≥ 8-row floor) are suite-pinned by `scripts/check-claims.test.mjs`.
- `kind: "release-gate"` rows verify existence and binding, not execution cadence — nothing in CI proves `scripts/smoke-gate.mjs` actually ran at release time.

This release also closes the v0.6.4 tag drift as a side effect: the v0.6.4 tag (dde1560, 2026-08-19 01:31 +0400) sat six commits behind main — the two consult-r1 disclosure commits (73692b8, 1be011f), the consult-r1 lint-reason hook fix (7cda406, a real `pre-tool.mjs` fix), and item 08's three commits (5102ed6, cc483ec, 9bf27c3) — and the marketplace cache serves the tagged version, so it had held the v0.6.4 bytes behind main since the tag. Tagging v0.6.5 at current main and re-syncing the cache puts the fixed hook and the ledger into the live install in one step.

## [0.6.4] — 2026-08-19

### Fixed — post-edit lint failures are attributed against a pre-edit baseline (item 07 / B10)

The post-edit lint arm ran the repo's own lint on an edited file AFTER the edit and blocked on any non-zero exit — comparing against nothing. Pre-existing lint noise on a file the run touched was reported to the executor as this edit's failure (the executor then paid to "fix" or argue with noise it inherited), a timed-out lint (`spawnSync` → `status: null`) was graded as a diagnostic, and the arm's true positive (an edit that actually introduced diagnostics) was byte-indistinguishable from its false one. Fixed by giving the arm a "before": on the run's FIRST edit to each file, `pre-tool.mjs` (allow path, Edit-family, `execute`/`verify`/`final` phases — mirroring the post arm's existing phase guard) runs the same lint command and freezes the exit status into `.zcode/state/<slug>.lint-baseline.json` (per-target keys `clean`/`failing`/`inert`, atomic tmp+rename, first-touch frozen for the run; a `Write` creating a new file records an implicit clean baseline). The post arm then blocks only on diagnostics NEW to the edit — clean baseline + non-zero now → block whose reason names the target and states the diagnostics are new to this edit; failing baseline + non-zero → no block, recorded seen-not-new; absent entry or `inert` → no block. Pre and post invoke one shared module (`hooks/lib/lint-invocation.mjs`: whitespace-split argv, `spawnSync` argv-array `shell:false`, 5s cap) so the comparison can never measure two different invocations, and `find-run.mjs` explicitly skips the side-file so run discovery never parses it.

Paired probe, as this repo cites its probes: in a fixture repo whose lint exits 1 iff the target contains `FAIL-MARKER`, a benign edit to a pre-failing file produced a byte-identical block to an edit introducing the marker before the fix — after, the benign edit sails through (recorded seen-not-new) and the marker-introducing edit blocks with attribution. The 39-case suite was demonstrated RED against the unmodified hooks before any hook edit (13 failing assertions, scenario (a) = the live defect); criterion 8's stash-dance keeps both directions re-provable on demand, and criterion 9's tripwire greps guard against one-sided unhooking. Two riding fixes ship in the same entry: a timed-out lint now records `inert` instead of blocking (a capability failure is never a diagnostic, on either side), and runs created before this change (no side-file) degrade to `inert` rather than misattribute — strictly fewer blocks, never more. Unchanged controls verified on both builds: no-`lint_cmd` repos spawn nothing, `plan`-phase edits lint nothing, the Task ledger drain, the `Skill` capability arm, and every pre-tool gate are byte-identical, and item 06's session-stamp arm + 15-case suite are untouched. 73 shifted citations were reconciled at the source and the C2 bare-continuation halves hand-swept before the anchor lock re-pinned. **Not part of item 07:** this release commit also carried `docs/ISNAD.md` — the ISNAD adaptation's provenance record for the v0.6.0 wave (rows 17-20), written the same day — plus its README provenance subsection and the matching lock entries. That doc work was uncommitted in the tree when the release was cut and was swept in; it is recorded here because the commit subject does not name it. The audit range (72483b6..dde1560) carried more of the same: the README comparison-table and prerequisites refresh for v0.5.4-v0.6.3, including the zero-caller caveat correction (bad2d71), docs/diagrams.md's two new sections from that commit — §1b "Terminal phases and the escape hatches" and §5 "The evidence lane" — and the three citation-only edits those README/diagrams line shifts cascaded into docs/MEASUREMENT.md, docs/impl/02-wire-zero-caller-checks.md, and docs/impl/11-compaction-phase-wiring.md (bare line-number re-pins, nothing else). None of it is item 07 work, and none of it is reverted; it is named here so the release record discloses everything that shipped.

**Known, not fixed:**
- Attribution is exit-code-level. Per-diagnostic diffing (which message is new) is deliberately unbuilt — runner-specific output parsing is the conceded-to-rot class (`skills/odyssey/scripts/regression-gate.mjs:15-21` carries the principle).
- The baseline is per-run, frozen at first touch. Cross-file induced diagnostics (editing A changes what B's lint reports) are baselined at B's first touch, not at run start — chosen to bound cost; a full-repo lint at execute entry was rejected as too slow for big repos.
- `lint_cmd` comes from `package.json` `scripts.lint` only: a repo with an eslint config but no lint script records `inert`. Extending detection is probe-side work, out of scope.
- First-touch capture adds one pre-edit lint run per file per run — bounded by the 5s cap on both sides, the accepted latency cost.

## [0.6.3] — 2026-08-18

### Fixed — run-close token records are populated or reason-stamped (item 06)

Every record the set-phase auto-append writes at `done|audited` now carries a `tokens` value that is populated or explains its absence — never a bare, unexplained null. Mechanism: the five null sites in `collectRunTokens` (`skills/odyssey/scripts/lib/tokens.mjs`) now stamp an inert object `{inert:true, reason, node_version, at}` with a closed reason set — `bad-args | db-missing | binding-unavailable | db-unreachable | no-usage-in-window` (`binding-unavailable` names the `node:sqlite` Node >= 22.5 floor against the engines floor >= 18) — and `run-report.mjs` passes the inert through unflattened instead of collapsing every absence into one sentinel. Attribution upgrades from estimate to exact whenever the run's orchestrator session id was witnessed: a new pass-through first-witness arm in `post-tool.mjs` stamps `state.session_id` on the existing locked-write pattern (only-if-absent, skip-fast, exit-0-always), and token collection then scopes by `(s.id = :sid OR s.parent_id = :sid)` reporting `attribution:"session"` / `confidence:"exact"`; runs without a witnessed id keep the (repo, window) heuristic with `confidence:"estimate"`, as before. The same change guards both inert-truthiness dereferences in `run-report.mjs` (`tokens_per_todo` and the text-mode block) — an inert object is truthy, and the unguarded code would have crashed run-report at close, silently writing no record at all (the exact defect class this item closes; found at consult, witnessed RED in the suite before the fix).

Measured against the operator lane on 2026-08-18 (393 records: 356 fixture-marked — 87 field-absent + 269 retained-historical nulls — plus 37 real: 29 field-absent, 0 null, 8 populated): since telemetry went live, every real run populated, 8 for 8, and zero real runs have ever produced a bare null. The defect was never a broken mechanism — it was that the record could not express the difference between healthy and dead: five distinct null conditions flattened into one sentinel. That unobservability was the item; three greps over the trend log now partition every record into populated / inert-with-reason / historical, and the historical bucket is frozen by construction.

Paired probe, as this repo cites its probes: probe A (degradation observability) returned indistinguishable nulls on the pre-fix build — nonexistent `dbPath` and the `globalThis.__zodysseySqlite = {}` Node-floor seam both `null`/exit 1 — and returns `{inert:true, reason:"db-missing"}` / `{inert:true, reason:"binding-unavailable"}` naming the Node floor after; probe B (attribution exactness) seeded a three-session database (orchestrator + child + unlinked interloper in one directory, one window): the pre-fix window heuristic counted all three (total 7700, `estimate`), the post-fix session scope excludes the interloper and includes the child (1650 vs 9350, `session`/`exact`), and the no-session-id fallback is byte-comparable to the old heuristic. Criterion 6's stash-dance keeps both directions re-provable on demand.

**Known, not fixed:**
- The 116 field-absent and pre-0.5.2 null records stay exactly as they are — historical nulls are not backfilled; the fraction command counts them as a frozen historical bucket.
- The `engines` floor stays `>=18` (`package.json`); token telemetry requires Node >= 22.5 via `node:sqlite` and degrades to a stamped `binding-unavailable` inert below it. The floor is documented, not raised — telemetry is optional and its absence must never fail a run's close.
- Exact attribution depends on a hook payload carrying `session_id`; a run whose events never did (headless, exotic harness) keeps `confidence:"estimate"`. Two concurrent runs in one repo remain inseparable in that fallback — unchanged except the record now names which mode it used.
- The end-to-end new shape in the live trend log is only observable after this release reaches the plugin cache (the auto-append executes the CACHED run-report — the `truncate-roundto` pair is the standing proof that a dev-tree-only fix populates nothing); this run's own close record predates the stamp arm and reports `estimate`, by design.

## [0.6.2] — 2026-08-18

### Fixed — the ZODYSSEY_UNGATE_BASH hatch now testifies (item 04)

`ZODYSSEY_UNGATE_BASH=1` still opens the Bash write-gate — the documented power-user hatch is deliberate and unchanged — but it is no longer silent. Every call that walks through the open gate appends one JSON line `{at, command}` to `.zcode/state/<slug>.ungated.jsonl` (read-only calls included: under the hatch the hook witnesses, it does not judge — filtering by write-capability would re-run the gate analysis the hatch exists to skip), and `run-report.mjs` counts the ledger as `ungated_bash_calls` on every scorecard and in every trend-log record via the existing set-phase auto-append. Recording is unconditional and best-effort by design — the one place in this repo where fail-open is correct: the operator has explicitly disabled enforcement, and a recording failure must not silently re-gate the call they ungated. A failed append degrades to one stderr line; exit 0 regardless.

The silence, never the openness, was the failure mode: the Bash gate was deleted twice (v0.1.1, v0.2.0) by this variable's ambient presence in a private copy being mirrored verbatim into public releases — three external audits missed the second deletion (`skills/odyssey/hooks/pre-tool.bash-gate.test.mjs:3-11` records the history) — and the same leakage fired live again during this queue's own probing (2026-08-16: an executor shell silently re-opened the gate mid-probe; only pinning the variable empty exposed it). A structural scan in the regression suite now enforces the class, not the instance: every `process.env.ZODYSSEY_*` read whose branch guards an early `exit(0)` must route through the recorder between read and exit, so a second bypass variable added without a witness fails the suite the day it lands, not two releases later.

Paired probe, as this repo cites its probes: an ungated write-capable call was exit 0 with no record anywhere before, and is exit 0 with exactly one ledger row and `ungated_bash_calls: 1` after; the gated control (variable pinned empty, write-capable, undeclared target) is exit 2 with no record on both builds; read-only passthrough, trusted-script invokes, and the no-active-run no-op are unchanged in both directions.

**Known, not fixed:**
- Recording is append-only audit, not prevention: the ungated call still executes before any row exists. The ledger is evidence, not a barrier; the barrier is leaving the variable unset.
- The ledger records raw command strings — a command carrying a secret is persisted to `.zcode/state/<slug>.ungated.jsonl` (gitignored with all of `.zcode/`, bounded by the run's Bash call count). Deliberate: redaction would re-run gate analysis inside the hatch; an operator who shells secrets with the gate open accepts the ledger as part of the documented tradeoff.
- The best-effort append degrades to a stderr line and never blocks the call — a recording failure must not silently revoke a documented affordance.
- The variable still bypasses the whole gate — verdict, tamper guard, and scope together, no per-check granularity. Deliberate, same reason.
- Bash calls with the variable set but no active run remain unrecorded (the hook is a no-op without a run; there is no run state to audit into).
- The regression suite's bypass-site scan uses a six-line proximity window between an env read and its guarded `exit(0)`; a future env read legitimately sitting within six lines of an unrelated early exit would false-positive as a bypass site. Fail-closed brittleness, deliberate: when it fires, extend the scan deliberately rather than loosening it.

## [0.6.1] — 2026-08-17

### Changed — the metrics corpus is decontaminated

Fixture/synthetic runs append to `~/.zcode/orchestration/eval/results.synthetic.jsonl`; `results.jsonl` holds real runs only. Provenance is declared at source — `ZODYSSEY_EVAL_LANE=synthetic` (exact match; unset/misspelled = operator lane; never a gate) in the env of the process spawning `set-phase.mjs` — never guessed from slugs. The rolling cap applies to both lanes; `dashboard.mjs` needed zero changes (the design's point: the default read is clean with no consumer-side filter conventions). `run-tests.mjs` exports the lane for the whole suite run, so the repo's own suite stopped contaminating — including the four `t`-slug `done` transitions item 02's check-wiring suite drives, a polluter that postdated the brief that named only `add-truncate`. Paired probe, as this repo cites its probes: a full suite run before the fix grew the operator log by ~28 fixture records (observed live 137 → 143 during the v0.6 planning run; 359 → 387 across the release cycle); after — byte-identical operator log (387 → 387, both markers frozen across repeated runs), synthetic lane receiving the fixture records.

**Known, not fixed:**
- The historical synthetic records (211 `add-truncate` + 142 `"slug":"t"` = 91.2% at the 2026-08-17 cutover, 387 records) remain in `results.jsonl` — retained, not quarantined; flagged in `MEASUREMENT.md`'s corpus-hygiene block with the cutover date; aged out by the 1000-record cap. Deleting or moving them was rejected as history-rewriting by product code with an enumeration-shaped classifier.
- `judged.jsonl` has no lane split — zero fixture writes today; queue item 09 must extend the lane mechanism when the baseline arm lands.
- No permanent sentinel re-runs the whole suite against the live operator file on every commit; the guard is the hermetic lane suite plus the re-runnable marker invariant (`b=$(grep -c add-truncate results.jsonl); npm test; a=$(…); test "$b" -eq "$a"`).
- `run-report.mjs`'s manual-append footer names `results.jsonl` only — a human hand-appending a synthetic report lands it in the operator log (docs caveat in the scripts reference; no code change).
- The `"slug":"t"` records' original writer predates the current tree (2026-08-15 bursts) — unattributed archaeology, harmless under retention.

## [0.5.3] — 2026-08-17

### Fixed — the post-OKAY Edit-path containment escape

`classifyTarget` returned `rel: ""` for any target outside both the run repo and `PROJECT_DIR`, so every post-OKAY guard hanging off `if (rel)` — the plan-sha tamper check, `Files:` containment, the fail-closed catch, the file lock — silently skipped and the edit fell through to the unconditional allow. The Bash twin's classifier already handled exactly this class, so an executor could edit `~/.zcode/cli/config.json`, `/etc/...`, or a sibling project via Edit while the identical write-capable Bash command was already blocked.

Converged the twins: an outside-both-roots target now yields `rel: <absolute path>` with bookkeeping flags false, mirroring the Bash classifier's fall-through, and the existing `if (rel)` boundary then applies verbatim. A plan that literally declares the outside absolute path in `Files:` keeps working — exact-match containment. Paired probe, both directions, armed post-OKAY run: an Edit to an outside target was exit 0 on the prior build and is exit 2 (scope violation naming the target) on this one; the Bash twin, the declared/undeclared in-repo controls, and the no-run no-op are unchanged on both builds.

**Known, not fixed:** Edit events with no resolvable target path still pass; a target exactly equal to the run repo or `PROJECT_DIR` still yields `rel: ""` on both twins (the tools reject directory targets themselves); the pre-existing new-file lexical fallback / symlink redirect and the unlocked state writes are untouched.

## [0.5.4] — 2026-08-17

### Fixed — the last tool that could still write the gate

Item 01 closed the post-OKAY Edit-path containment escape; the Bash twin was already closed. That left one class: a non-native tool. The H3 guard protected the run's `.zcode/state` and `.zcode/reviews` — correct when it was written, and the weak link once its neighbours were fixed. Measured on one armed run: `Edit` and `Bash` to `~/.zcode/cli/config.json` both blocked, `mcp__fs__write_file` to the same path allowed; same split on the running hook itself.

The protected set is now the enforcement subtree — `skills/odyssey/` (conductor prompt, hooks, trusted scripts, verdict-shaping references), `agents/`, `commands/`, the plugin manifest — anchored on an install root resolved from the running hook's own location the way the trusted-script allowlist already resolves `SCRIPTS_DIR`, plus the host hook registry and the two run-scoped directories. Declared-scope parity was rejected deliberately: the hook cannot tell a write from a read on a non-native tool, so parity would block every read-only MCP that names a path. The subtree, not the whole root, because in a dev checkout the install root IS the user's repo — whole-root protection blocked every MCP write into it, declared files included.

**Known, not fixed:** a non-native tool can still write ordinary repo files outside the plan's declared scope. That is the isolation gap rather than the takeover gap, and closing it needs the harness to declare tool write-capability — the same class of dependency as the nonce-to-transcript binding.

**Known, deliberate:** the boundary is `skills/odyssey/`, not `skills/`. Exactly one skill ships today, so they are equivalent — but a second skill added under `skills/` lands outside the enforcement set *by decision, not oversight*. When adding one, decide explicitly whether it belongs in the set; if it carries a prompt or a script the run trusts, the T4-4 principle says it does.

## [0.5.5] — 2026-08-17

### Fixed — nonce minting is restricted to the exact declared minter type per lane

The review/F2/F4 nonce minters decided identity with a final-segment matcher built for routing, so any dispatch whose type merely ended in `momus`/`code-reviewer`/`oracle` (`evil:momus`, `someplugin:oracle`, `evil:code-reviewer`) minted a genuine, hook-witnessed nonce — and the credential chain then treated whatever artifact followed as reviewed. The gate-surface suite had asserted that lookalike mint as intended behaviour; this release flips those assertions (stated plainly: the suite was grading the hole as correct). Mechanism, in one clause: a lane-local allowlist of exact dispatch types at the mint site — `sameName`'s segment tolerance retained only for routing (the phase gate and F5 capability matching) — with the round-cap twin sharing the same set so the two sites cannot disagree on what counts as the reviewer. A lookalike still dispatches, because read-only routing tolerance grants no authority, but mints nothing and is named in a one-line stderr warning.

Paired probe, both directions, active run: `evil:momus`, `someplugin:momus`, `evil:code-reviewer` and `someplugin:oracle` minted on the prior build (exit 0, nonce written) and mint nothing on this one (exit 0, warning only); the canonical controls — `zodyssey:momus`, bare `momus`, `code-reviewer`, `feature-dev:code-reviewer`, `zodyssey:oracle` — mint on both builds. The `capability-name.mjs` header now states the matcher is routing-grade only: an authority-bearing consumer must compare exact types at its own site.

**Known, not fixed:** a lookalike `*:momus` dispatch is still allowed by design — every write the dispatched agent attempts remains scope- and verdict-gated; the orchestrator-adversary residual stands unchanged (the nonce binds a real dispatch, not what the reviewer returned); a new legitimate reviewer packaging now requires a one-line allowlist edit, surfaced loudly by the near-miss warning rather than silently at the final wave; the `agent_type`/`type` extractor fallback fields are unchanged and out of scope; and case variance narrows with the same stroke — a mixed-case dispatch (`ZODYSSEY:momus`) minted before via the matcher's lowercasing and now falls to the warning, fail-closed on the harness's lowercase dispatch behaviour.

## [0.6.0] — 2026-08-17

### Added — the zero-caller checks fire from phase transitions

`check-imports`, `coverage-delta` and `resolve-capabilities` each shipped with a passing suite and zero code callers — "run it during verify" prose addressed to a conductor. They now fire as mechanism. Entering `execute` captures the run's git baseline (HEAD + untracked set), idempotently, in both execute-entry paths. Entering `verify` invokes `check-imports` on the run's changed set (baseline diff plus files created since execute entry — plain `--since` is blind to untracked files) and records `state.imports`; a new `done` precondition refuses while its status is `unresolved`, naming the findings. Entering `final` records `state.coverage` and `state.capabilities_check` — neither gates: coverage is evidence by contract, and capability-absent or failing infrastructure records `inert`, never a block, because over-blocking is the failure class the wiring exists to avoid. Paired probe: hand-invocation exited 9 on a passing run before the wiring; after it, entering `verify` records `unresolved` and `done` refuses.

**Known, not fixed:** `regression-gate --check` still has no code caller (the snapshot is wired; the comparison is invoked by prose convention only — a follow-up using this change's pattern); `capabilities.lock.json` still has no consumer; `state.coverage` is recorded but nothing renders it yet; and `build-capsules.mjs` is a fourth zero-caller outside this change's named set.

The ISNAD-engine adaptation (queue rows 17-20, `docs/impl/17`–`20`): four non-duplicate capabilities ported from a provenance/trust layer, chosen precisely because ZOdyssey already enforces the rest in stronger form.

### Added — fluency-exclusion invariant (ISNAD R8, row 17)
`judge-rubric.test.mjs`, the sixth doc-claim invariant suite: pins the judge rubric to the five `MEASUREMENT.md` §2 dimensions and their weights, denies style/fluency/verbosity terms inside the rubric segment, and pins the auditor's no-style-rejections clause. Paired probe: an injected `Clarity of prose (0.1)` dimension fails the suite on two assertions.

### Added — verification-origin labeling (ISNAD R4, row 18)
Every run-report and `results.jsonl` record now states whether `success` stands on an external audit (`external-audit`, with `consult_rounds`) or in-session verification only (`in-session-only`); the dashboard's Recent-runs table renders a `verify` column, legacy records render `-`. Labeling only — nothing consumes the field as a gate. `run-report.mjs` gains its first test file.

### Added — narrator trust registry (ISNAD R2, row 19)
`registry-report.mjs`: cross-run agent-config reliability mined from external-audit verdicts (ACCEPT after momus OKAY → momus ✓; compliance gap → momus ✗; bug/quality/security gap → executor ✗) and judged criterion results (executor ✓/✗, zodyssey-arm records only). Keys are `sha256(agents/<name>.md)` content hashes — a prompt edit starts a new key at the cold-start prior (structural decay; trust attaches to the configuration, never the model name). Trust is Laplace `(s+1)/(s+m+2)` and n is ALWAYS printed beside it. Global idempotent ledger under `~/.zcode/orchestration/registry/`; consumed advisory-only by metis at consult. Real-data smoke on landing: momus 0.67 (n=4), executor 0.73 (n=9).

### Fixed — judged records no longer hardcode `arm: "zodyssey"` (row 19, A0 rider)
`lib/arm.mjs` derives the arm from the slug suffix (the authoritative source — `harness.mjs` constructs `${seed.id}-${arm}`), shared by `judge.mjs` and `dashboard.mjs` (private copy removed). Baseline runs no longer land in `judged.jsonl` mislabeled. Queue item 09's residual scope (explicit `--arm` instrument channel + baseline-arm automation) unchanged.

### Added — agent citation discipline (ISNAD R5, row 20)
Executor notepads/summaries must cite the `path:line` or command output that witnessed each factual claim; momus blockers must anchor to plan text. Prompt-layer advisory only — the enforcement twins (notepad append-only, test-integrity guard, record-verify executed criteria) already exist.

### Known, not fixed
- Judge-lane registry evidence predates agent hashing and attributes to the *current* config key (`assumed_current_config` marked on rows/entries).
- The registry is consult-fed and starts sparse by design; consult is opt-in.
- Nothing renders narrator trust in `dashboard.mjs` yet.
- Registry ledger idempotence is bounded by the rolling 1000-row cap: evidence aged out past the cap re-appends on re-scan under the same ids (harmless at current volumes).
- `registry-report.mjs --json` emits a wrapper object (`{scanned_repo, …, entries}`), richer than the briefs' "array" phrasing.

## [0.5.2] — 2026-08-15

An independent paired run against v0.5.1 found **no new bypasses** — the first round in four that didn't. What it did confirm is that the remaining surface is no longer pattern-shaped. Two items here are that surface's narrow, structural end; the rest is documented as the queue it is.

### Fixed — direct execution of a path (G-class)

`./deploy.sh`, `/tmp/evil`, `~/bin/evil`, `src/foo.js` and `exec /tmp/evil` all ran as **read-only, pre-OKAY, in any phase**. This is the same severity as the v0.5.1 CRITICAL and no amount of naming interpreters reaches it — *there is no interpreter token to name*. What identifies these is structural: the command **head** is a path, so the shell executes that file with whatever privileges the agent has.

Matched at command position only. A path as an **argument** — `cat ./deploy.sh`, `ls /tmp/evil`, `grep x src/foo.js` — is untouched, because reading a file is not running it and conflating the two would block most ordinary work.

### Fixed — two sed in-place forms the pattern missed (G-class)

`-i\b` missed a clustered short flag (`sed -ni` — no word boundary before the `i`) and the long option (`sed --in-place`). `-i.bak` and `-e … -i` were already caught. An incomplete pattern, not a new binary.

### Known, not fixed — and why the next move is structural

Three rounds of enumeration produced three bypasses; the fourth produced none only because the enumeration questions are exhausted. What remains does not yield to more patterns:

- **F — shell-level escaping splits the token.** `p\ython -c`, `py''thon -c` reach the interpreter while defeating any regex over the raw string, because the *shell* reassembles the token after the gate has read it. Quoted (`"python"`), env-prefixed (`PATH=/tmp python`), and `env`/`command`-wrapped forms are all caught; the escaping forms are not, and cannot be without parsing shell grammar.
- **G — interpreters outside the list.** `gawk`, `mawk`, `pypy`, `perl6`, `raku`, `jshell`, `ts-node`. Adding them is the fourth enumeration round and buys nothing structural: the list is unbounded by construction.
- **H — accepted over-blocks.** Invoking a safe binary by absolute path (`/usr/bin/git status`) is now gated, because "is this path safe to execute" cannot be answered without an allowlist. Asserted in the test suite so it reads as a decision rather than a surprise.

**The terminus is head-allowlist inversion:** classify by the command head against a list of known-safe *heads*, rather than denying known-bad shapes. It subsumes F, G and H at once — an escaped, unlisted, or absolute-path head simply is not on the allowlist. It is deliberately **not** in this release: it inverts the default for every command the gate has ever seen, `npm test` and friends need enumerating on the allow side, and shipping that days after a security deploy trades one risk for a larger one. It wants its own release and its own paired run.

### Verification

Probed against the **deployed** build, not the repo, for every claim. Gate-surface is 98 cases (was 80), including the argument-vs-head controls, the read-only `sed` controls, and the H-class over-block asserted explicitly.

## [0.5.1] — 2026-08-15

A second independent audit of v0.5.0 found the CRITICAL takeover chain **reopened through a different door**, plus ungated waiver flags that reach `done` more cheaply than forging a verdict ever would. v0.5.0's central claim — "`.zcode/state/` now has no unsanctioned write path" — was false, and the marker system rests on it.

### Fixed — CRITICAL: arbitrary code execution classified as read-only (audit-3 #1)

The v0.5.0 sweep added ten write primitives and declared T1-1 closed. It missed the shape that needs no new primitive at all: the two interpreter patterns were **positional**.

- The eval-flag pattern required the eval flag to be the *first* token after the interpreter, so `python -u -c`, `python3 -B -c`, `node --no-warnings -e` and `ruby -w -e` matched nothing.
- The script-indirection pattern explicitly skipped any invocation whose next token starts with `-`, so those same commands fell through it too — as did `python - <<'EOF'`, where the operand is literally `-`.

Chained with the marker key being readable through ungated `cat`, this restores the full forged-run takeover: compute a valid marker, write arbitrary state.

Enumerating flag shapes is what failed twice. Interpreters are now **inverted to an allowlist**, the same posture SEC-2 took for git: any invocation is gated except a bare version/help query. The sanctioned `node <odyssey-script>` path is unaffected — it never relied on classifying as read-only, and `isTrustedScriptInvoke` allows it one step later.

### Fixed — bare redirection disarmed every hook in one command (audit-3 #3)

The redirect pattern required a *word* before the `>`, so a command consisting only of `> .zcode/state/t.json` matched nothing and ran as read-only. That truncates the state file; discovery then fails to parse it, finds no run, and every hook becomes a no-op. `shred` was also absent. The operator is matched wherever it appears now.

### Fixed — F2/F4 artifacts could be written with no dispatch behind them (audit-3 #2)

`record-final-artifact` checked the nonce as `if (nonceArg && pending && …)`: **omitting** `--nonce` skipped the comparison entirely, and a missing pending nonce only printed a warning. Both now refuse.

**The residual is unchanged and is stated here because the apparatus reads stronger than it is:** the nonce proves a reviewer was *dispatched*, not what the reviewer *said*. It lives in `.zcode/state/`, readable by any agent, so an injected executor can wait for the legitimate dispatch, read the nonce, and submit its own verdict bytes under it. Closing that needs the artifact bound to the reviewer's transcript hash — a harness change, not a script change, and it is not done.

### Fixed — waivers that reached `done` more cheaply than forgery (audit-3 #4, #5, #6)

- **`--skip F2,F4,F5`** produced `all_pass: true` and `final.verdict: "pass"` — exactly what `set-phase done` requires — with no phase check, no evidence, and no confirmation. Skipping a security item now requires `--skip-reason`, is recorded in `state.final.waived`, and `done` refuses until acknowledged with `--accept-waivers`. This is **not** authorization: every script is invocable by any agent, so no argv flag authenticates anyone. What it removes is the *silent* path — two deliberate, separately-recorded actions instead of one flag.
- **`set-phase done` blocked only on `status === "regressed"`**, so `toolchain-drift` — regression-gate *refusing to compare* because `toolchain.json` changed, which is precisely how the gate would be neutered — sailed through. The gate refused at the source and failed open at the consumer. A refusal is not a pass.
- **`record-verify` checked only the COUNT of declared criteria, never the content.** `--criterion true --trust-argv --exit-code 0`, repeated as many times as the plan has criteria, marked every acceptance criterion passed with `executed: false`. Undeclared criteria are still recorded but no longer count toward covering the plan, so a fabricated criterion cannot substitute for a declared one.

### Fixed — the round cap didn't agree with the minter about what "momus" is (audit-3 #7)

`subagent === "momus"` guarded the round cap while the nonce minter used segment matching, so `evil:momus` skipped the cap and the pre-dispatch lint, then minted a review nonce. Bounded — `record-review` enforces the cap independently — but it is the one-path-not-its-twin shape v0.5.0 was written to hunt, left in the file by the release that hunted it.

### Fixed — R1/R2/R3, found verifying this release

An independent paired-probe verification of v0.5.1 found the redirect fix had **regressed its own class**.

- **R1 (regression, deploy-blocking).** The first redirect pattern excluded `&` and a digit before the `>`, on the reasoning that they were fd forms. `2> .zcode/state/t.json`, `&> …`, `1> …`, `2>> …` and `exec 3> …` went **BLOCK (0.5.0) → ALLOW (0.5.1)** — one keystroke from the exact command the fix was written for, with the hole and the fix shipping in the same regex. `FD_DUP` already strips descriptor duplication, so a digit still sitting before a `>` is always a real file redirect. `>&` and `>|` are caught now too; neither build ever caught them. `FD_DUP` is also global — a non-global replace left every occurrence after the first in place.
- **R2 (availability regression).** `\b` treats `.` as a word boundary, so `\bsh\b` matched the *extension* in `deploy.sh`, and `cat deploy.sh` / `wc -l build.sh` / `ls *.sh` started blocking in every phase. Interpreter tokens now require **command position** via lookbehind: a filename is not an invocation, while `sh script`, `; sh evil` and `/usr/bin/python3` all still match.
- **R3 (pre-existing, both builds).** `source`, `.`, `curl -o`, `wget`, `sed 'w file'` and `busybox` all passed as read-only — `curl -o /tmp/x` followed by `source /tmp/x` is a two-command ungated arbitrary-execution chain, pre-OKAY, in any phase. The suggestion was to name these as residuals rather than enumerate them, since the honest fix is command-position-aware classification. R2 added exactly that, so they are closed *using* it rather than deferred.

### Changed — interpreter eval is unavailable through Bash during a run

A consequence worth stating rather than leaving to be discovered. `node -e` and `python -c` are gated in every phase, so inspecting run state with `node -e "require('./.zcode/state/…')"` no longer works. Use `dashboard.mjs` (on the trusted-script allowlist), the `Read` tool, or `cat`/`grep` — reads are never gated.

Executable checks belong in **acceptance criteria**, where `record-verify` executes them *and records the result as evidence*, which a Bash one-liner never did. If you want to run an interpreter to prove something works, that is the signal it should be a criterion. SKILL.md documents this and the e2e fixture's checkpoints were repointed.

### Known, not fixed

Named here rather than left for a third audit to find:

- **Nonces are readable from state** (see #2 above). Needs harness-supplied transcript binding.
- **Segment-tolerant matching applies to the nonce minters and the read-only exemption**, so any third-party agent named `*:oracle` / `*:code-reviewer` / `*:momus` gets those lanes. `capability-name.mjs`'s header claims the nonce chain is exempt from the tolerance it introduces; that claim is false in code. The right fix is an allowlist for minters rather than open segment matching.
- **The Edit-path scope gate is skipped for targets outside `PROJECT_DIR`** (`if (rel)` with `rel` empty), while the Bash twin fails closed.
- **New-file classification falls back to lexical path resolution**, so a symlinked in-scope directory can redirect a Write into `.zcode/state/`.
- **Three state writes still do unlocked read-modify-write** (`regression-gate` writeState, the record-verify stall counter, `scaffold --adopt`); the v0.5.0 fix covered the five `record-*` writers only.
- **Deploy verification never content-compares `plugin.json`** — the file that decides which hooks run — and the cache is never pruned of files deleted from the repo.
- **`scaffold --adopt` blesses whatever is on disk**, with no phase/verdict/provenance check.

### Honest summary

v0.5.1 closes every named finding from both audits. The adversarial residual is unchanged in kind: an executor-adversary with prompt injection reaches a forged `done` through whichever of the ungated paths is fixed last. Each round has raised the cost and narrowed the surface; none has eliminated the class, because the trusted-script allowlist gives every agent the same argv surface the operator has.

## [0.5.0] — 2026-08-15

**A security release.** Two independent investigations landed together: a live e2e run surfaced three defects, and a 4-partition adversarial audit of v0.4.1 filed 52 findings (1 CRITICAL, 4 HIGH, 14 MEDIUM, 14 LOW, 19 INFO). Sweeping for the *classes* behind them found systemic siblings — including a second undiscovered SEC-6 bypass and a fail-open defect in a guard shipped in v0.4.1.

Minor-versioned rather than a patch because run state gains a required authenticity marker (a state-contract change) and the Bash gate tightens materially.

### ⚠️ Upgrade order

Run discovery is now authenticated. A run created before v0.5.0 has no marker and **stops being discovered** until adopted once:

```
node <plugin>/skills/odyssey/scripts/scaffold.mjs <repo> <slug> --adopt
```

Adopt any in-flight runs BEFORE deploying, or finish them first. `--adopt` only stamps a state file that already exists; it cannot bless a dropped one.

### Fixed — CRITICAL: forged-run takeover (T1-1, T1-7)

The audit reproduced an end-to-end takeover. Two independent halves, both fixed:

- **Write primitives classified as read-only.** Ten passed `looksReadOnly` and ran pre-OKAY in any phase: `sort -o`, `touch`, `sponge`, `gsed -i`, `crontab`, `scp`, `sftp`, `sqlite3 <db> <sql>`, `at` and `batch`. (`dd`, `truncate`, `xargs` and `busybox sed -i` are also in the pattern list now, but v0.4.1 already blocked all four — they are belt-and-braces, not closed holes. Each of the ten was confirmed by running the same command against both builds: allowed on 0.4.1, blocked on 0.5.0.)
- **Unauthenticated run discovery.** `findActiveRun` trusted ANY parseable `.json` in a state dir, newest `updated_at` winning — so a dropped `decoy.json` carrying `verdict: OKAY` governed the review gate, the scope gate and the tamper guard at once. Discovery now requires an identity-bound marker, applied in `hooks/lib/find-run.mjs` too, since that copy feeds `selectByTarget` and the other two hooks.

The marker's header states plainly what it does *not* buy: with arbitrary read+write as this user, no in-band marker is unforgeable. It makes a *dropped* file inert; the durable control is that `.zcode/state/` now has no unsanctioned write path.

### Fixed — HIGH: the Bash path never got the Edit path's guards (T1-2..T1-6)

Every protection added to the Edit path over three releases had a `sed -i`/redirect twin that walked straight through. `TEST_PATH_RE` had exactly one use in the whole file, inside the Edit branch.

- Notepad clobbering via Bash now blocks; append and new-notepad creation stay allowed.
- `sed -i` / `awk -i` / `tee` push EVERY operand — previously one, so `sed -i 's/a/b/' out-of-scope.js in-scope.js` passed the scope check on the in-scope file and mutated both.
- The verify/final test freeze applies on the Bash path.
- `isState` was computed at two sites, returned, and never used in a conditional: a plan declaring `.zcode/state/` in `Files:` made verdict, phase and acceptance directly editable. v0.4.1's guard covered MCP tools but not the native Edit path.

  The first attempt at this fix armed `isState` on the Edit path **only** — the same one-path-not-its-twin shape as the rest of this section. `quickClassify`, the Bash-path target classifier, did not even compute `isState`, with a comment asserting that was safe "because the Bash path blocks anything non-bookkeeping that isn't in declared scope". Declaring the path in `Files:` is precisely what puts it *in* scope, so `sed -i 's/OKAY/X/' .zcode/state/t.json` was still allowed. Caught by re-verifying the release against 0.4.1 rather than by the suite.
- Rewriting the plan post-OKAY blocks; the tamper guard previously noticed only on the next gated call, after the command had run.

### Fixed — normalized compared against un-normalized (Class B)

Three guards failed OPEN because one side was realpath'd and the other was not: SEC-6 in `record-momus-artifact` (proven bypassed with a relative repo arg), a byte-identical undiscovered clone in `record-final-artifact`, and **the `.zcode/state`/`.zcode/reviews` guard added in v0.4.1**, which realpath'd neither side. All three route through `lib/repo-path.mjs` now, as do the persisted `plan_path`, the three hooks' `PROJECT_DIR`, and `find-run`'s state-dir discovery.

**Docs moved in the same change, deliberately.** `scripts.md` and `SKILL.md` told the conductor to stage verdicts in `.zcode/plans/` — exactly what SEC-6 refuses. That flow worked only *because* the guard was bypassed, so arming it without repointing the docs at `.zcode/staging/` would have recreated the SEC-6b total review-gate deadlock.

### Fixed — capability names compared four different ways (Class C)

- **F5 skill branch** used exact equality, so `skill:test-driven-development` (what `capabilities.md` lists and every plan declares) never matched an observed `skill:superpowers:test-driven-development`. 34 installed skills are plugin-namespaced; this is the failure the live run hit.
- **F5 discovery branch** hard-coded `skill:find-skills` and discarded the declared value, making it UNSATISFIABLE wherever find-skills is namespaced — with no per-plan workaround.
- **F5 mcp branch** tolerated a tool-name suffix but not a plugin prefix, missing `mcp__plugin_<plugin>_<server>__<tool>`.
- **Nonce minters** used bare equality plus one hard-coded special case, so a namespaced reviewer minted nothing and the wave failed later with no hint that the dispatch name was the cause.
- **The dispatch phase gate**, which runs *before* the minters, was bare-set membership (`READONLY_AGENTS.has(subagent)`) with three hard-coded `feature-dev:` entries — the same shape one function earlier. A third-party-namespaced read-only agent was rejected there as an "executor" and never reached the fixed minter, so fixing the minters alone changed nothing observable. Also found by re-verification.
- **drift-check** truncated `Task: zodyssey:<agent>` at the colon and compared namespaced routes against a bare inventory, reporting every real agent as both stale and orphaned.

Matching is segment-tolerant everywhere now: exact wins, else the final name segment. Declaring the bare or the namespaced form both work.

### Fixed — state integrity and injection (T2-1, T2-2, T2-3)

- Five trusted writers fell back to a **non-atomic, unlocked** `writeFileSync` on lock contention, one commented "rather than lose the verdict" — trading a visible failure for a silent last-writer-wins clobber. All five now refuse, as `record-todo` already did.
- `lint-untrusted` masked EVERY nested bullet, so an injected directive in `  - What to do:` was never flagged while identical text at column 0 was — and the nested form is what reaches dispatch prompts. The exemption now tracks field context, so only acceptance-criteria and QA payloads are exempt.
- `regression-gate` ran `toolchain.json`'s `test_cmd` with `shell:true` on the stated basis that the file is machine-derived — but a plan declaring it in `Files:` makes it executor-writable. The toolchain sha is bound at baseline and `--check` fails closed on drift.

### Added — real token accounting

`lib/tokens.mjs` fills run-report's long-standing `tokens_per_todo` placeholder from ZCode's durable telemetry. The rollout JSONL is ephemeral (deleted at session end), so the durable store is the session DB. Three arithmetic rules are encoded because each silently corrupts a total: `inputTokens` already includes `cacheReadTokens`; `model_usage` and `turn_usage` are the same data at different granularity; `retry_count` is not extra requests. Cost is opt-in — this provider is flat-rate and lists `cost: 0` locally, so a dollar figure would be a shadow price rather than a bill.

### Changed — drift detection covered half the deploy surface (T4-4)

`--verify` and smoke-gate compared 3 code trees while `--sync-cache` deploys 6, so a drifted `agents/momus.md` would run a stale reviewer prompt with both gates green. Prompts are enforcement; they are compared now.

Widening the list was not enough. Running `--verify` during this release showed the widened list was still **flat**, so `skills/odyssey/hooks/lib/find-run.mjs` was deployed but never compared — the file that authenticates run discovery, the CRITICAL fix above. The root cause was never the list's contents but that a list existed at all. `scripts/lib/deploy-surface.mjs` now holds one definition that the deployer copies from and both gates walk recursively — every file under a deployed tree, with nothing left to keep in sync by hand. (The earlier fix widened a hard-coded list from 3 directories to 6; the count is deliberately not restated here, because a number in a release note is the same brittle artifact as a list in the code.)

### Tests

32 suites, up from 26. New: `pre-tool.gate-surface.test.mjs` (23 cases ported from the auditor's probes), `sec6-repo-arg.test.mjs` (10 cases), and `deploy-surface.test.mjs`, which asserts *coverage* rather than a blessed list of filenames — a list would be the same bug in test form. `pipeline-integration` now loads a **namespaced** skill and still reaches `done`, so the live F5 failure is regression-locked end to end.

The suite was structurally blind to both classes: all 62 fixtures passed absolute repo paths, and no F5 fixture used a namespaced name — the one that looked namespaced compared two identical strings and would pass with the stripper deleted.

### Fixed — found by the deep verification of this branch

An independent verification pass re-ran every claim against a v0.4.1 worktree and found five more items. Four are defects; one is a reporting flaw.

- **ORCH-2: F5 still failed on a routing line carrying prose.** Segment-tolerant matching fixed the *namespace* half of the live F5 failure and left the other half standing. `norm()` strips ALL whitespace — the tolerance that lets `skill: x` read as one token — so `routed: skill:x — primary; generic fallback` became `skill:x—primary;genericfallback`, a name matching nothing. A plan written the way people actually write them failed F5 with a message about the skill never being observed. New `capabilityToken()` ends the token at the first character a capability name cannot contain, and the parser and the matcher both call it so lint and gate agree on where the token ends.
- **T3-2: momus following her own prompt deadlocked the review gate.** `momus-prompt.md` documents a `VERDICT: OKAY | REJECT` text block; `record-momus-artifact.mjs` accepted strict JSON only and answered a conforming artifact with exit 6. JSON remains the preferred wire form and is tried first; the prose fallback requires an explicit line-anchored `VERDICT:` token and fails closed when the text says both or neither. The parser is shared with `record-final-wave` via `lib/verdict-schema.mjs` rather than duplicated — two copies of a verdict parser is exactly the drift this release exists to stop.
- **ORCH-1: read-only runs were unfinishable.** `--allow-untouched` waived *some* declared files being untouched but never *all* of them, so a run whose diff is legitimately empty — an audit or review that produces a report and changes no declared file — could not reach `done`. The guard exists to stop a *silent* vacuous pass; an explicit operator waiver is not silent, and is now recorded in the artifact as `empty_diff_waived`.
- **ORCH-3:** `.zcode/reports/` was unignored while `.zcode/audits/` was, so future run reports would accumulate as tracked files. Now ignored, with the v0.4.1 report kept by name as this release's provenance.
- **Token figures are now self-describing.** Attribution is scoped by *(repo × window)* and the output named neither, so two readers summarising "the same run" reached 10.8M and 24.3M and both were right. `collectRunTokens` echoes the repo it matched and reports `shares` with the denominator in the key name. A bare percentage is unfalsifiable without its denominator, and these are estimates by construction — `attribution: "time-window"` was always in the output and should be read as a caveat, not decoration.

### Verification method

Every finding was re-verified by running the **identical scenario against both builds** — a worktree at v0.4.1 and this branch — asserting two things, not one: that 0.4.1 behaves as the finding claims (the defect was real), and that 0.5.0 behaves as the fix claims (the remediation landed). 18 findings, 61 paired assertions.

That second direction is what a normal green suite cannot give you, and it earned its cost immediately: it found **two incomplete fixes in this very release** (T1-5 on the Bash path, and the dispatch phase gate above), and corrected an overstated claim — `dd`, `truncate`, `xargs` and `busybox sed -i` were listed as closed holes when v0.4.1 already blocked all four. Three probes also had to be fixed first, each failing on both builds, which is the harness reporting a bad probe rather than a fixed bug.

## [0.4.1] — 2026-08-14

**Security remediation of the v0.4.0 full audit.** The audit found the core property — a non-forgeable OKAY review verdict — broken two independent ways, the flagship F5 routing gate at risk of being inert in production, several softer gate weaknesses, secret-leak / prompt-injection holes in the measurement loop, and a cluster of documentation drift. This release fixes every finding, each security fix shipping with a regression test that fails on the old code.

### Fixed — the two verdict-forge paths (CRITICAL / HIGH)

- **Newline injection through the trusted-script gate (CRITICAL, `pre-tool.mjs`).** `shellSafeForTrustedInvoke` scanned for `;&|` `` ` `` `$<>()` but never rejected a newline, and the operand regex only read the first line — so `node <trusted-script>\n<second-command>` passed the allowlist and the shell ran the second command ungated (`sed` `verdict:OKAY` into state.json, no momus dispatch needed). The scan now rejects any control character (`< 0x20`) before parsing. New cases in `pre-tool.trusted-invoke.test.mjs` prove newline/CR/tab injections stay blocked while quoted metachars still pass.
- **Plan-sha rebind (HIGH, `record-momus-artifact.mjs` + `record-review.mjs`).** The momus artifact recorded no hash of the plan it approved, and `record-review`'s plan-sha check compared a caller-supplied value to the current disk — both agent-controlled. An agent could get a real OKAY on a minimal plan, swap in a scope-widened plan that still lints, and record OKAY bound to it. The recorder now stamps the sha of the plan momus actually read into the consumed-nonce; `record-review` requires a **triple-bind** (argv === what-momus-read === disk). Regression in `pipeline-integration.test.mjs`.

### Fixed — the F5 routing gate and its blind spots

- **Matcher coverage (HIGH, `.zcode-plugin/plugin.json` + `smoke-gate.mjs`).** The PreToolUse/PostToolUse matchers excluded `Skill` and `mcp__*`, so the hook that records F5's evidence never fired for those tools in a real install — the flagship gate could be inert. Both matchers now include `Skill|mcp__.*` (and `dispatch_agent`); smoke-gate asserts matcher coverage so the blind spot can't return silently.
- **Attempt vs load (M7).** The capability observation moved from PreToolUse (fires on tool *attempt*, even for a nonexistent skill) to PostToolUse (fires after a successful load). Pre-tool now records `attempted`; F5 counts only `observed`.
- **Agent routing verified (M4).** `routed: agent:X` was a declaration-only pass. post-tool now records each completed Task dispatch as an observed `agent:<name>` capability, and F5 requires it. `parse-plan --lint` also rejects a `routed:` value that is not `skill:`/`mcp:`/`agent:`-shaped.
- **Stale observations (M5).** F5 ignored phase, so a capability loaded in prime/triage (before the routing decision existed) could satisfy it. F5 now excludes pre-decision phases.

### Fixed — gate hardening

- **MCP / non-native write path (HIGH → H3, `pre-tool.mjs`).** Any tool that is not natively classified (all `mcp__*` and unknown tools) fell through to `exit(0)`. A local-filesystem MCP could write state.json or a `.zcode/reviews/` artifact and forge a verdict ungated. Such tools are now blocked from targeting `.zcode/state` and `.zcode/reviews`; ordinary MCP reads/writes elsewhere are unaffected.
- **Dispatch run-selection (M8).** A `Task(momus)` carried no file target, so run-selection fell back to the globally most-recent run — in a multi-run workspace the nonce could mint into the wrong run and deadlock the intended one. Dispatch now re-selects the run whose repo root encloses the working directory.
- **File-lock owner (M9).** With `agent_id` absent the owner collapsed to `session_id`, identical across parallel executors, so two editing the same file both saw the lock as self-owned. `parent_tool_use_id` (stable per executor, distinct between them) is now preferred.
- **Partial completion (M6, `record-final-wave.mjs`).** F1 computed `declared_untouched` but never gated on it — declaring `Files:[A,B,C]` and touching only A reached `done`. F1 now fails on untouched declared files, waivable with `--allow-untouched` for context-only entries.

### Fixed — the measurement loop

- **Secret redaction (M1, `lib/redact.mjs`).** The redaction regex anchored `.env` to a filename start, so `prod.env` / `staging.env` / `.envrc` / `aws.credentials` leaked verbatim to the external auditor, and a path with a space defeated the hunk-path capture. Extracted to a shared `lib/redact.mjs` with suffix-matching + space-tolerant capture, unit-tested, and imported by consult, judge, and both recall scripts.
- **judge.mjs hardening (M2 + LOW).** The independent eval scorer ingested the agent-authored diff with no DATA-framing and no secret redaction (an agent could inflate its own score with a planted comment and exfiltrate fixture secrets). It now redacts the diff, fences it as DATA, uses the shared EPIPE-tolerant spawn check (`lib/spawn.mjs`), and fails loudly on a missing `run_start_sha` instead of scoring a blank diff.
- **Recall injection (M3, `recall-corrections.mjs` + `recall-outcomes.mjs`).** Agent-influenced criterion/blocker/observation text was replayed verbatim into a later run's Metis prompt. It is now sanitized (control chars stripped) and fenced as untrusted DATA, distinct from the script's own directive.
- **Consult in-scope diff cap (LOW).** The in-scope diff is capped at 200KB to match the out-of-scope discipline.

### Changed — documentation brought back in sync

A sweep corrected drift the audit surfaced: the plan-checkbox-tick instruction that the tamper guard punishes (removed), the purged pre-v0.3.0 `capabilities.md` path three agents still read, the "bash is ungated" claim in `sisyphus-junior.md` (the gate is live), F5 added to every operator-facing final-wave surface, the momus prose-vs-JSON verdict contract, the "hooks in config.json" / "(unreleased)" labels in README, the stale "no CI / no test runner" claims, the non-executable example run, and previously undocumented env vars/flags (`ZODYSSEY_REGRESSION_TIMEOUT_MS`, `CLAUDE_CLI_2`, `scaffold --reset`, `consult --plan-audit`).

### Verification

Full `node --test` green, plus new regression coverage: newline-injection (trusted-invoke), plan-sha rebind (pipeline-integration), F1 partial-completion + `--allow-untouched` (record-final-wave), F5 agent-verified + stale-phase (final-artifact), malformed-`routed:` lint (parse-plan), MCP write-to-`.zcode/state` block (pre-tool.scope), and secret-redaction suffix/space cases (`lib/redact`). Smoke-gate gains a matcher-coverage assertion; version consistent at 0.4.1 across all four declarers.

## [0.4.0] — 2026-08-14

**Routing becomes a default, gated behavior.** Two probe runs proved the conductor hand-rolls from model knowledge: given an AWS Lambda task it ignored the installed `aws-serverless` skill (Task B), and given a Helm-chart gap it never loaded `find-skills` (Task A). v0.3.4's routing rows were passive reference material — a capable model skips the lookup whenever it can do the task from memory, which is most of the time. This release adds the two things that actually change behavior: a hard default in the conductor prompt, and two gates that make skipping routing unable to reach `done`.

### Added — the routing-default gates

- **F5 (behavioral cross-check, `record-final-wave.mjs`):** the plan's routing declaration is cross-checked against `state.capabilities[]` — the hook-witnessed log of real `Skill` / `mcp__*` invocations that `pre-tool.mjs` has recorded all along (with phase stamps, and previously consumed only by the run-report scorecard). `routed: skill:X` requires an observed `skill:X` entry (spacing-normalized); `routed: mcp:S` requires an `mcp__S`-prefixed entry (records keep full tool names); `discovered:` and `generic:` both require an observed `skill:find-skills` — generic is valid only AFTER discovery was attempted. `routed: agent:X` passes declaration-only with an explicit unverifiable note (Task dispatches are not hook-observed — documented limit). A declared-but-never-loaded routing fails the final wave, so a run that hand-rolled past its own declaration cannot reach `done`. `--skip F5` is the escape hatch.
- **`## Capability routing` plan section (scaffold template + parser):** every scaffolded plan now carries a tri-state declaration — `routed: skill:<name>` / `discovered: find-skills` / `generic: <reason>` — with one evidence line. `parse-plan.mjs` extracts the token into `--all` output (placeholders like `<token>`/`<name>` are rejected as non-tokens; the template's option list lives in a parser-stripped comment so an unfilled scaffold cannot false-match), and `--lint` fails without a real token. Because `record-review.mjs` already gates OKAY on a clean lint, the presence gate needed zero new wiring.

### Changed — the conductor prompt makes routing the default

- **`SKILL.md`** gains the binding rule: *routing is the DEFAULT, generic knowledge is the FALLBACK* — scan `capabilities.md` for a fitting installed capability and USE it; if none fits, load `find-skills` and run the ≥1K/official/~100★ quality gate; only then go generic, and only if discovery returned nothing reputable. The rule names the exact Task A/B failure modes and states the gate mechanics, including that the orchestrator must load skills in the **parent thread** (sub-agents can't — trust anchor) because the parent-thread load is what the hook observes and F5 checks.
- **`metis.md`**: the advisory "name the capability in Pre-Analysis Findings" is replaced by a MANDATORY typed `## Capability routing` field in her output contract (the tri-state + one evidence line), marked as enforced.
- **`prometheus.md`**: transcribes Metis's tri-state into the plan's `## Capability routing` section; the section joins the canonical section order (after TL;DR). Burying routing in Verification-strategy prose is explicitly disallowed — it must be its own typed section so the gate can read it.
- **`momus.md`**: a 5th check in her "ONLY THESE" list — routing section PRESENT with a non-vacuous token, framed as a missing-required-section blocker (same class as a missing QA scenario). Deliberately presence-not-quality: routing quality is F5's job at the final wave, and a quality framing would collide with her blocker-finder/approve-by-default identity.
- **`capabilities.md`**: an "enforced, not advisory" callout above the Quick matrix naming both gates and pointing to the SKILL.md rule.

### Honest limits (known, deliberate)

- **F5 proves the `find-skills` SKILL was loaded, not that the actual `npx skills find` search ran.** Closing that needs `pre-tool.mjs`'s Bash branch to recognize + record discovery commands — the load-bearing hook (the bash-gate-deleted-twice file), so it is a separate release with `pre-tool.bash-gate.test.mjs` + `pre-tool.trusted-invoke.test.mjs` run after (tracked as Phase B).
- **`routed: agent:X` is verified by declaration only** — Task dispatches are not in the observed-capabilities log. The declaration's presence was review-gated; the load itself is not hook-witnessed.
- **Over-gating cost (accepted):** every non-trivial standard/architecture task now requires either a routed skill or a `find-skills` load. Trivial tasks still deflect at Phase 0 (no plan is scaffolded) and are unaffected.
- The cwd-anchoring run-resolution bug surfaced by the first Task B attempt (hooks DFS from process cwd, not the declared repo root — misattributing dispatches to a sibling run) is tracked as a separate `fix(hook)`.

### Verification

Full `node --test` **25/25 suites**: `parse-plan` 28/28 (6 new routing cases: missing section, placeholder rejection, three real tokens, `--all` extraction), `final-artifact-and-acceptance` 30/30 (9 new F5 cases: honored/not-honored, spacing normalization, MCP prefix-match, discovered, generic-without-attempt fails, agent note, absent section, skip), `pipeline-integration` 25/25 — a fixture run **reaching `done` through the new gates**, including the hook recording a real `Skill` load as an observed capability, and `pre-tool.trusted-invoke` 35/0 (fixtures updated: the momus pre-dispatch lint now requires routing, proving the gate fires in the hook itself). `node --check` on all touched `.mjs`; smoke-gate enforcement checks pass.

## [0.3.4] — 2026-08-13

Four changes accumulated on main since v0.3.3 — the first real increment of the measurement→improvement loop that v0.3.3's plumbing was built to support, a routing blind-spot fix, a consult diff-base race fix, and a small run-artifact ignore leak.

### Added — correction-signal capture for consult (`recall-corrections.mjs`)

The measurement loop scored every run (`judge.mjs`, `run-report.mjs`) and fed nothing back — the largest adaptation gap surfaced by the task-observer study. v0.3.4 adds the first read-only increment: a sibling to `recall-outcomes.mjs` that mines correction signals from on-disk run state and surfaces a bounded summary to Metis at consult.

- **`recall-corrections.mjs` (NEW):** scans `<repo>/.zcode/state/*.json` for two correction signals — verify-fail (`state.verify.history[].passed === false`) and Momus-REJECT with blockers (`state.review.history[].verdict === 'REJECT' && blockers.length > 0`) — dedups, and prints top-K=5 (recency-first, REJECT > verify-fail) with a `(showing K of N)` footer and closing `Metis:` directive. Defensive reads throughout (`|| []`, `?.`); exit 0/2/3.
- **Scope discipline:** read-only capture only. No part of this loop modifies live skill/agent files — the periodic-improvement-pass is explicitly EXCLUDED (staging-only, future work). Signal 3 (user mid-run corrections) is not recorded on disk today.
- **Wiring:** `agents/metis.md` and `SKILL.md` (phase-1 consult box) now reference BOTH `recall-outcomes` and `recall-corrections` for premortem grounding — `recall-outcomes` was previously documented-but-unwired; this completes it. `references/scripts.md` gains the signature entry.
- **Trusted-invoke regression:** `pre-tool.mjs` is NOT edited — the trusted-script allowlist is realpath-containment based, so the new sibling is auto-trusted. A new regression case in `pre-tool.trusted-invoke.test.mjs` proves it (35/0).

### Changed — route the find-skills capability + external-skill quality discipline

The conductor's routing table had no row for discovering skills the environment does not yet have — only an installed-only `find ~/.zcode -name SKILL.md` walk — and no quality/reputation gate anywhere. The already-installed `find-skills` skill was invisible to the conductor (`grep -rn find-skills skills/` returned zero hits).

- **`capabilities.md`:** new Quick-matrix row — `Discover a skill not yet installed` → `find-skills` (local) / `npx skills find` (external), reinforcing `find ~/.zcode -name SKILL.md` (installed inventory).
- **`SKILL.md`:** a lean external-skill quality bullet after the routing summary — prefer ≥1K installs and official sources (`vercel-labs`, `anthropics`, `microsoft`); be skeptical below ~100 GitHub stars; apply before recommending or auto-using any external skill. (Already-installed local skills are inventory, not reputation.)

Docs/routing only — no hooks, no `SEC-*` interaction. Went through the full pipeline (consult → plan → gated review → execute → verify → final wave) and an independent external audit (`/orchestrate-consult`): ACCEPT, zero gaps.

### Fixed — run-artifact ignore leak

- **`.zcode/staging/` and `.zcode/toolchain.json` leaked past `.gitignore`.** The granular `.zcode/` ignore list never added these two newer run-artifact paths, so a `git add -A` in a repo where `/orchestrate` had run would have staged final-wave intermediates (the f2/f3/f4 JSON, the PR-body draft, the verify script) and resolved toolchain state. Nothing under `.zcode/` is tracked, so plugging the two entries is safe; the granular one-path-per-artifact style is kept over a blanket ignore for now (#12).

### Fixed — consult diff-base race (`audit_head` freeze)

The diff is gathered into a frozen string at T1, but the external auditor can reason about (or, if its tool surface is less locked than `--allowedTools ""` promises, inspect) live HEAD, which may advance past the run's work during the multi-minute call — round 3 of `correction-signal-capture` hit this: PRs merged mid-audit, making the supplied diff look "stale" next to the repo. The auditor's round-3 advisory flagged the race; this closes it.

- **`consult.mjs` (`runPostDoneConsult`) now freezes the audit tip.** It captures `HEAD` as a concrete SHA (`audit_head`) once at gather time; injects an `AUDIT RANGE` section into the prompt naming the exact frozen range `run_start_sha..audit_head` and instructing the auditor to reason about THAT range, not live HEAD; records `run_start_sha` + `audit_head` on each `consult.history` entry for traceability; and after the audit returns, warns if HEAD moved during the round (the verdict still covers the frozen range — the warning tells a human to re-run after the repo settles, so the race is visible rather than silent).
- Validated end-to-end with a stub auditor against a throwaway smoke slug (recorded `audit_head` on the history round; `AUDIT RANGE` section present in the prompt), plus the existing 67 `consult.test.mjs` assertions and the full suite. `pre-tool.mjs` is untouched.

## [0.3.3] — 2026-08-12

A release-plumbing release. **v0.3.2 was tagged uninstallable** — the version lives in three files read by three different consumers and only two were bumped, so the marketplace kept serving 0.3.1 no matter how many times Update was clicked. v0.3.3 supersedes it; there is no reason to install v0.3.2.

The pattern repeated twice more in the same afternoon, both times as *a check that could not detect the class of failure it exists for* — the theme of this entire release series. The drift detector compared 4 hooks and reported green while 4 scripts were stale. The upgrade chain has three hops and tooling covered only the middle one.

### Fixed — release plumbing and a stale duplicate (post-0.3.2)

- **The drift check covered 4 hooks and missed 51 other files.** `smoke-gate` and `--verify` sha-compared only `hooks/`, so on 2026-08-12 both reported green while `consult.mjs`, `scaffold.mjs` and two test files in the running cache were behind the repo — the commits happened to touch scripts rather than hooks. The scripts are not less load-bearing: `record-todo.mjs` holds the verify transition guard, `record-final-wave.mjs` holds F1–F4, `record-verify.mjs` executes the criteria. A stale script runs old enforcement exactly as silently as a stale hook. Both checks now compare all 55 plugin `.mjs` files, verified by drifting `record-todo.mjs` and watching them go red.
- **`--sync-cache` now reports a stale marketplace source.** The upgrade chain is `repo → marketplaces/<name>/ → cache/<mp>/<plugin>/<version>/`. `--sync-cache` handles the second hop; nothing covered the first, and the marketplace clone is what a GUI Update actually reads. A clone one commit behind kept serving the previous version while the repo looked correct throughout — that is what made v0.3.2 appear uninstallable even after `marketplace.json` was fixed. Refreshing it is the marketplace subsystem's job, so this detects, names the file, and prints the one-line `git -C <path> pull --ff-only`.
- **`marketplace.json` was missed in the v0.3.2 bump.** The version lives in three files read by three different consumers — `marketplace.json` (the marketplace, resolving what to install), `.zcode-plugin/plugin.json` (the loader), `package.json` (npm/CI) — and nothing compared them. The tag was pushed, the release published, CI green, and the plugin was **uninstallable at the new version**: clicking Update kept returning 0.3.1, because the marketplace serves what its own index advertises. `scripts/version-consistency.test.mjs` now runs in CI and fails on any disagreement, a non-semver version, a plugin missing from the marketplace index, or a version with no CHANGELOG entry.
- **A third copy in the upgrade chain.** `repo → marketplaces/<name>/ → cache/<mp>/<plugin>/<version>/`. `--sync-cache` handles the second hop; nothing handled the first, so a stale marketplace clone kept serving the old version even after the repo was correct. Both fixes were needed — either alone still yielded 0.3.1.
- **`--sync-cache` cannot complete a version bump, and now says so.** It copies into the *registered* version's directory; the marketplace owns the versioned dir and the registry. Hand-writing `installed_plugins.json` is not the fix — that was the v0.3.0 bug. It now detects the bump, states what it can and cannot do, and reports that an Update is still required.
- **Removed the write-only `state.plan_sha256`.** `scaffold` stamped it; nothing read it. Every consumer — the hook's plan-tamper guard (two sites) and F1's tamper check — uses `state.review.plan_sha256`, which `record-review` re-binds per verdict. So the top-level copy went stale on any plan edit while sitting beside the authoritative field looking equally official. Shakedown round 4 hit the drift and had to work out which one mattered. Same shape as the version number in three files: it does not fail, it waits for someone to read the wrong one.

## [0.3.2] — 2026-08-12

The release where the enforcement layer started being true.

v0.2.0 through v0.3.1 shipped with the Bash write-gate **deleted** — every other enforcement (review gate, scope isolation, plan-sha guard, file locks) lives on the Edit branch, so an ungated `sed -i` walked past all four. Three external audits reviewed v0.2.0 and none noticed. Restoring it exposed a second problem: the final wave proved a reviewer had been *dispatched* and never read what it *said*, so an artifact reading `{"verdict":"REJECT"}` passed both F2 and F4.

Fixing those uncovered a pattern that runs through the whole release — **a check that cannot detect the class of failure it exists for**. `install.mjs --verify` checked paths, not liveness. `harness.mjs --list` matched a sentinel the seeds had stopped using. A 0-byte verdict file still read as "audited". The regression gate was wired into a code path real runs never take. The trusted-script allowlist was corrupting the evidence it existed to protect.

Most of these were found by **running the pipeline end to end**, three times, and fixing what stopped it. Unit tests assert a gate can say *no*; only a real run shows two correct gates combining into something unusable. Round 1 could not complete at all. Round 2 completed but could not reach `done`. Round 3 completed with no out-of-band escapes.

This release also adds the thing whose absence allowed all of it: **CI**. 23 suites, run on every push, on the Node floor the code claims and on current LTS.

### Changed — three ergonomics fixes from shakedown round 3

None of these are correctness bugs. All three cost real time in a live run, and each has now cost it twice.

- **The plan is linted BEFORE momus is dispatched.** `record-review` gates OKAY on a clean `parse-plan --lint`, but that ran at the *end* of the review: momus approved, `record-review` rejected on criteria the parser could have flagged first, fixing them changed the plan-sha, that invalidated the review, and momus had to be dispatched again. A whole review round spent learning something a parser knew before it started. The hook now blocks the dispatch and lists the specific problems. Fails **open** if the lint cannot run — it is an ergonomic guard, and `record-review` still enforces the real gate.
- **`record-momus-artifact`'s `<round>` is optional.** It is 1-indexed while `state.review.round` counts *completed* rounds from 0. That off-by-one cost rounds 1 and 3 a re-dispatch each. Omit it and the round is computed; pass it and a mismatch names both numbers instead of leaving you to work out which end is off. An index convention that has to be explained is one the tool should compute.
- **The failed-final-wave recovery path is documented.** F1 can fail on something still fixable — usually test-integrity — but test files are read-only in `verify`/`final` and the DAG has no `final → execute` edge. The legal route is `final → verify → execute`, restore, then back. It works; nobody would find it under pressure. Now in `references/scripts.md` along with the note that a failed F1 leaves the F2/F4 nonces unconsumed, so the retry needs no re-dispatch.

### Fixed — the trusted-script allowlist rejected quoted data as shell syntax (round 3)

`isTrustedScriptInvoke` tested the whole command for ``; & | ` $ < > ( )`` and refused on any hit — including metacharacters **inside a quoted argument**, where the shell never acts on them.

Round 3 paid for it: `record-verify.mjs --criterion "node -e 'process.exit(0)'"` was blocked over the parens *inside the criterion*. Only 1 of 4 acceptance criteria could be recorded, and the run reached `done` with `acceptance {pass:false, criteria_run:1, criteria_declared:4}`. **A rule written to protect the evidence chain was degrading it**, and it silently excluded most real-world criteria — anything containing `()`, `$`, or nested quotes.

The scan now follows actual shell quoting: unquoted, every metacharacter is live; inside double quotes only `$` and `` ` `` are live; inside single quotes nothing is; backslash escapes are honoured outside single quotes; an unterminated quote is untrusted. 30 assertions, **19 of them injection attempts** — chaining, backgrounding, pipes, redirects, `$()` and backticks both bare and inside double quotes, subshells, escaped-quote-then-chain, unterminated quotes, non-node commands, scripts outside the scripts dir, and path traversal. Loosening a security rule is only defensible if what it exists to stop is still stopped.

### Fixed — a todo could reach `done` with most of its exam unwritten

The verify guard accepted any todo with ≥1 passing record and no failures. Round 3 finished with 1 of 4 declared criteria verified — the state file recorded `criteria_run: 1, criteria_declared: 4` and the gate simply wasn't reading it.

`record-todo` now requires the recorded criteria to cover what the plan declares, using the same source `record-verify` uses for `acceptance[].pass`, so the two cannot disagree. Re-running one criterion three times does not satisfy three declared criteria. Fails **open** on an unreadable plan, keeping the ≥1-passing floor, rather than blocking every run in a repo whose plan cannot be parsed.

### Changed — `Files:` is now the only source of scope (SEC-M7c)

**BREAKING for plans that widened scope in prose.** The `## Scope` prose harvest is deleted. The declared set comes from `Files:` blocks alone, in both the hook and F1.

Its history is the argument. SEC-M7 narrowed a whole-plan harvest to `## Scope` after a prohibition granted access; SEC-M7b then had to strip `Must NOT` subsections *inside* `## Scope` after the same bug reappeared one level down. Two fixes in two days, same shape — because reading paths out of prose cannot distinguish "edit this" from "do not edit this" from "this is what the style looks like".

Shakedown round 2 showed the third case biting: a plan naming `test/text.test.js` as a **style reference** thereby granted write access to it. And F1 never honoured the harvest at all — it derives `declared` from `Files:` only. So a Scope-granted file passed the gate and then *guaranteed* an F1 failure at the end of the run. The gate authorised precisely what the final wave would reject.

A plan that needs a file in scope declares it in `Files:`, which F1 requires anyway. One source, two consumers, no disagreement. This reverses an assertion added earlier the same day; the test now states the new invariant explicitly, including the style-reference case that motivated it.

### Fixed — F1 no longer fails a run for mess it inherited

F1 measures `git diff --name-only <run_start_sha>` ∪ untracked, so a file left modified or untracked *before* the run started landed in `actual`, was absent from `declared`, and failed F1 as a scope violation the run never committed.

Round 2 could not reach `done` because of this: a stale uncommitted pair from the previous run failed F1, and every sanctioned way to clean it — stash, `git checkout --`, editing the files — was blocked by the scope gate, correctly, since those files were out of scope. Committing does not help either, because F1 diffs against `run_start_sha`. The gate and F1 between them made the run unfinishable through any legitimate path.

`scaffold.mjs` now records `state.dirty_at_start` (excluding `.zcode/`), and F1 subtracts it **from the scope-violation calculation only**. Those files stay in `actual`, so `declared_untouched`, the empty-diff check, and test-integrity keep their current meaning — a deleted test cannot be laundered by marking it dirty-at-start, and a file created *during* the run is still scope creep. What F1 ignored is reported as `inherited_dirty_ignored` rather than silently dropped. Absent on older runs, which keep the previous behaviour.

### Added — `record-final-artifact.mjs`, the missing trusted writer (2026-08-12)

`.zcode/reviews/` is deliberately not bookkeeping, so no agent can `Write` there — that is what makes a review artifact unforgeable. The review lane has had a trusted writer since W7-2 (`record-momus-artifact.mjs`); the **final wave never got one**, so `record-final-wave.mjs` demanded F2/F4 artifacts from a directory nothing in the toolchain could write. The shakedown run had to place them out-of-band through an MCP terminal.

- `record-final-artifact.mjs <repo> <slug> <F2|F4> [--nonce N] [--from <file>]` — places the artifact, stamps provenance, and **does not consume the nonce** (that stays with `record-final-wave`, which sha-binds it to the artifact bytes). SEC-6 parity: `--from` is refused under `plans/`/`notepads/`; `.zcode/staging/` and stdin are the intended paths.
- It **rejects an unrecognized verdict at write time**. `record-final-wave` resolves anything ambiguous to `missing` and fails closed, which is correct but arrives after the nonce is spent.

### Fixed — a failed F1 no longer burns the F2/F4 nonces

F2/F4 nonces are one-time, and `consumeFinalNonce` spent them even when F1 had already failed and the call could not reach `pass`. Observed cost in the shakedown: F1 tripped on stray untracked files (an MCP tool's session state inside the repo), which burned both nonces, so fixing that trivial problem required **re-dispatching both reviewers purely to mint replacements**. When F1 has already failed, F2/F4 are now recorded as `not_evaluated` and their nonces are left intact for the retry. Not a weakening: `not_evaluated` is not `passed`, so the call still fails — it just stops setting fire to the evidence chain on its way out.

### Fixed — `acceptance[id].pass` was always false

It was gated on `todos[id].status === 'done'`. That closed a real mid-verify race (pass must not flip true after criterion N while N+1..M are unrun) but used the wrong proxy: the natural call order is verify-then-done, so **every successfully verified todo recorded `pass: false`**. The shakedown saw `verify.history` 4/4 passed, `todos.verified: true`, and `acceptance.pass: false`. A field that is always false is worse than an absent one — a resuming orchestrator reads it as "not accepted" and redoes finished work.

Now derived from completeness instead of status: the plan's declared criteria count for that todo is compared against what actually ran, so `pass` is true only when **every declared criterion ran and passed** — independent of call order, with the race still closed. `criteria_run` / `criteria_declared` are recorded alongside. Falls back to the old status gate when the plan cannot be read, rather than assuming completeness from an unknown denominator.

### Fixed — two failures found by the first end-to-end shakedown run (2026-08-12)

Both survived every unit test in the repo, because both are properties of how the pieces combine rather than of any single piece. Neither is reachable by testing a gate in isolation.

- **SEC-M7b — a prohibition GRANTED access.** `declaredScopeForRun` harvested backtick-quoted paths from the whole `## Scope` section, and a plan-level `### Must NOT have` subsection lives *inside* `## Scope`. So the sentence ``- `src/unrelated.js` MUST NOT be touched by any todo.`` added that file to the declared set. **The scope gate inverted: the more emphatically a plan forbade a file, the more certainly it authorised writing to it.** Caught live — a shakedown probe expecting a scope violation was ALLOWED. SEC-M7 had fixed only the per-todo `Must NOT do` case and missed the plan-level subsection. Prohibition content (`### Must NOT` / `### Out of scope` / `### Never` subsections, and inline must-not lines) is now stripped before the harvest; positive Scope mentions still widen scope, which is asserted explicitly so the fix cannot over-correct into "Scope grants nothing".

- **SEC-6b — phase 3 was deadlocked under a gated Bash.** Reaching `execute` requires `review.verdict === OKAY`, which only `record-review.mjs` sets, which requires an artifact from `record-momus-artifact.mjs`, which takes the verdict via `--from` or stdin. Pre-OKAY every route was closed: SEC-6 refuses `--from` under `plans/` and `notepads/`; the Write gate allowed **only** `plans/` and `notepads/`; and any stdin pipe contains a metacharacter, so it is not a trusted-script invoke and falls through to the write-capable gate, which blocks pre-OKAY. **No gated run could leave phase 3 at all.**

  It hid because the Bash gate was deleted from v0.1.1 through v0.3.1. SEC-6 landed 2026-08-04 while the gate was off, so the two were never armed together until the gate was restored on 2026-08-11 — restoring a dormant guard woke a deadlock that had been latent the whole time. `.zcode/staging/` is now bookkeeping: writable pre-OKAY and accepted as a `--from` source. It is not a security boundary on its own — SEC-6's real value is keeping the verdict out of the dirs the *planner* writes, and the artifact's actual protection is the hook-minted nonce plus the sha binding.

Also recorded from the same run: F1 in `record-final-wave.mjs` derives `declared` from `Files:` only and never harvested `## Scope`, so the hook and F1 disagreed about what was in scope — a file granted by the Scope harvest would pass the hook and then fail F1. Narrowing the harvest brings them closer; making them share one implementation is still open.

### Security — the Bash write-gate was deleted a SECOND time and shipped in v0.2.0

`e57b01b` (PR #1, the v0.2.0 cycle) replaced ~170 lines of Bash gate with `if (isBash) exit(0);`, re-breaking the exact fix `433c037` (v0.1.2) had made two releases earlier and published a post-mortem about. **Three independent external audits ran on v0.2.0 and none of them noticed.**

This matters beyond one file. Every other enforcement — the review gate, scope isolation, the plan-sha tamper guard, the file-lock ledger — lives on the `isEdit` branch. With Bash ungated, `sed -i`, `cat >`, `python -c`, and `git checkout --` walk past all four. The "enforcement delta" that is this project's stated reason to exist was honour-system again, while `README.md` and `install.mjs` continued to advertise it as code-enforced. `ZODYSSEY_UNGATE_BASH` survived in four documentation locations and **zero lines of executable code**, and `install.mjs:450` wrote that false claim into every user's `AGENTS.md` at install time.

- **Restored** the full v0.1.2 gate: read-only passthrough, trusted-script allowlist, OKAY-verdict requirement, SEC-4 plan-sha tamper guard, SEC-H5 per-target scope check, and the `ZODYSSEY_UNGATE_BASH=1` opt-out.
- **Fixed a layout deadlock the restored code would have introduced.** v0.1.2 resolved `SCRIPTS_DIR` from `<PROJECT_DIR>/skills/…` or `~/.zcode/skills/…`. Under v0.3.x's plugin-cache layout neither exists in a user repo, so `isTrustedScriptInvoke` would have failed closed, blocked every `record-review.mjs` call pre-OKAY, and made the OKAY verdict unreachable — the gate deadlocking the pipeline it protects. Now resolved self-relative via `import.meta.url`, correct in every layout.
- **Closed a hostile-repo trust hole that predates the regression.** The `<PROJECT_DIR>/skills/odyssey/scripts` fallback trusted a path inside the repo *being audited*; a hostile repo shipping that directory got its scripts allowlisted past the gate. Both path guesses removed.
- **Added `hooks/pre-tool.bash-gate.test.mjs`** (22 assertions), demonstrated failing 11/22 against the broken hook before being accepted. Audits check the diff in front of them; nothing was re-checking invariants from two releases back. This is that check.

### Added — the final wave now judges content, not ceremony

- **F2/F4 parse the review verdict.** They previously confirmed a path, existence, and a nonce, then set `passed: true` without opening the artifact — one reading `{"verdict":"REJECT","blockers":["completely broken"]}` passed both. The verdict is now read from a JSON `verdict` field or a `VERDICT: APPROVE|REJECT` line. **Ambiguous or absent resolves to `missing` and fails** — an unknown verdict must never close a gate. Prose mentioning the words is not a verdict.
- **F1 checks the converse.** It only ever computed `actual \ declared` (scope creep), so an EMPTY diff passed vacuously — a hole this file's own SEC-H1 comment conceded. A plan that declares files against an empty diff now fails, and `declared_untouched` is recorded as evidence.
- **F1 enforces test integrity.** Deleted test files, net-negative test-file line counts, and newly added `skip`/`only`/`xfail` markers now fail F1. Weakening a test is the cheapest way to turn a failing acceptance criterion green, and a test file listed in the plan's `Files:` was *in scope*, so F1 waved it through while the suite went quietly hollow. No other OSS orchestrator implements this (verified against omo, prime-agent, spec-kit, SWE-agent, Cline/Roo, claude-flow).
- **Notepads are append-only.** `if (bookkeeping) exit(0)` let any agent replace a notepad wholesale in any phase. Notepads are what F1–F4 read: verdicts were nonce-bound and sha-anchored while the evidence behind them stayed writable by the party being judged. `Write` over an existing notepad is now blocked; `Edit` and new-file creation are unaffected.
- **Test files are read-only during `verify`/`final`.** Scoped to those phases deliberately — during `execute`, writing tests is the work (this project mandates TDD). Once criteria are being executed, editing a test moves the goalposts rather than meeting them. Measured exploitation rates for exactly this behaviour: 76% (GPT-5), 46% (Claude Opus 4.1) on ImpossibleBench, where restricting access drops it to near zero and prompting does not help.

### Fixed — claims that had no implementation behind them

- **The verify transition guard now exists.** `record-verify.mjs:9-10` had asserted since it was written that "a todo cannot reach `done` without verify evidence (enforced by record-todo.mjs's transition guard, added alongside this)". It was never written. `record-todo.mjs` now refuses `done` (exit `7`) unless `state.verify.history` carries passing records for that todo, with `--force-done` as an auditable escape that stamps `forced: true`. The guard reads `verify.history` rather than `acceptance[]` because `record-verify` only sets `acceptance[id].pass` once the todo is already `done` — gating on that would deadlock rather than break the circularity.
- **`probe-toolchain.mjs` is wired in.** It had **zero callers** anywhere, yet two consumers depend on the `toolchain.json` it writes: `post-tool.mjs`'s post-edit lint arm and `parse-plan.mjs`'s toolchain-aware criterion lint. Both were shipped, documented, and dead. Now invoked from `scaffold.mjs` at run creation — in code rather than as a SKILL.md instruction, since a conductor prompt is the kind of "enforcement" this project exists to replace.
- **`harness.mjs` stops reporting unrunnable seeds as ready.** Readiness was `!seed.repo.includes("REPLACE_WITH")`, but the seeds carried a different placeholder, so the sentinel never matched: `--list` printed ✓ for every seed while each run died on `cpSync` ENOENT. Readiness is now `existsSync(seed.repo)`, which cannot drift out of sync with reality, and a run where every seed skipped exits non-zero instead of reporting a clean summary having measured nothing.
- **`install.mjs --verify` compares the deployed hook against the repo.** It verified each hook *parses at the cached path* and never asked whether the cached bytes were your bytes — reporting 18/18 green on 2026-08-11 while the deployed `pre-tool.mjs` was a commit behind. That is the v0.3.0 failure mode (the verified artifact is not the running artifact) surviving into v0.3.1's rewritten verify.

### Added — the three gates `MEASUREMENT.md` promised and never had

- **`scripts/regression-gate.mjs` — pass-to-pass.** Snapshots the pre-existing suite as the run enters `execute` (wired into `set-phase.mjs`, the one moment a truthful "before" reading exists), re-runs at `--check`, and blocks `done` if a suite that was green goes red. Nothing in the pipeline had ever run the repo's own tests: F1 checks which *files* changed, verify runs the todo's *own* planner-authored criteria, and neither can see a change that satisfied its criteria while breaking twelve unrelated tests. Deliberately coarse — the enforceable signal is the suite exit code, not parsed test names, because name parsing is runner-specific and brittle in exactly the way `harness.mjs`'s sentinel check was. A suite that was **already red** before the run never fails the gate, and a repo with no test command records `inert`; a gate that punishes inherited breakage or blocks bare repos is one that gets switched off.
- **`scripts/check-imports.mjs` — hallucinated dependencies.** Flags imports that resolve against neither the repo's declared dependencies nor `node_modules` (JS/TS ESM + CJS) or `requirements`/`pyproject` (Python). Offline by construction: "does this resolve *here*" is both stricter than a registry lookup (a real package that isn't a dependency is still a broken import) and never flaky, and a check that needs the network dies in CI. Across 576,000 generated samples, **19.7% of recommended packages do not exist**, and the invented names recur across runs — which is what makes registering them a workable supply-chain attack.
- **Acceptance criteria must be executable (`parse-plan --lint`).** The old test was `!/\b(npm|node|…)\b|[\/.]|[\|>]/.test(c)` — an alternation binding looser than it reads, so **any string containing a `.` or a `/` counted as executable**. `- GET /healthz returns 200 {ok:true}` passed. `- The endpoint returns 200.` passed. Since the planner also authors the criteria and momus explicitly declines to judge them, that regex was the entire quality bar on the pipeline's own exam. Criteria must now *begin* with a recognized command, and — when `toolchain.json` declares one — **at least one criterion per todo must invoke the repo's real test command**, anchoring one point of the exam to something the planner did not author.

### Added — prime-agent's stall detector (the 4th primitive)

- **`record-verify.mjs` refuses to re-run a criterion against an unchanged workspace** (exit `10`). Ported from prime-agent's `captureGitWorktreeSnapshot` (`core/autonomous.ts`) — the one primitive left on the table after v0.2.0's fit study that needs no daemon.

  The loop it breaks: a criterion fails → the executor is dispatched to fix it → it returns having changed nothing that matters → verify re-runs the identical command against an identical workspace → identical failure → repeat to the cap. Failed agentic attempts burn roughly 3.5× the steps of successful ones, and this shape is much of why: the harness could not distinguish "tried again" from "tried again with something different". The stall is counted so the attempt cap still converges, and the run reports what happened instead of spinning invisibly.

  Fingerprint = tracked status + tracked diff + untracked file **contents**. Content matters because `git status --porcelain` lists untracked files by name only, so hashing names alone would call a genuine fix a stall. `.zcode/` is excluded: it holds this run's own state and the verify artifacts the script writes on every invocation, so including it made the fingerprint change by construction — the detector would have passed its first tests and then never fired in a real user repo, which does not gitignore `.zcode/`. Non-git repos stay inert; `--no-stall-check` overrides.

### Added — release gate

- **`scripts/smoke-gate.mjs`** — automates every part of "is enforcement live" that can be automated (registration, manifest hooks, cached-vs-repo sha, orphan sweep, direct-invoke proof that the deployed hook blocks) and scaffolds the one irreducible manual check: a live ZCode session attempting a pre-OKAY edit. `/usr/bin/zcode` is a compiled binary, so `${CLAUDE_PLUGIN_ROOT}` resolution and manifest-hook honouring are **not statically decidable by any auditor** — only a live session settles it.
- **`docs/ROADMAP.md`** — the evidence-ranked plan these changes come from, including which claims were verified first-hand and which are relayed.

### Note on the pattern

Five findings in this release share one shape: **a check that cannot detect the class of failure it exists for.** `--verify` checked paths, not liveness. Three audits checked diffs, not standing invariants. `harness.mjs --list` checked a sentinel that never matched. `v0.3.0-verdict.json` was 0 bytes and still read as "audited". F2/F4 checked that a reviewer was summoned, not what it said. Each new check above was demonstrated failing against the broken code before being accepted.

## [0.3.1] — 2026-08-11

### Fixed — enforcement was dead: orphaned hooks after the marketplace install (the v0.3.0 regression)

The v0.3.0 installer wrote the 4 enforcement hooks into `~/.zcode/cli/config.json` pointing at `cache/local/zodyssey/0.3.0/…`. Installing via the ZCode marketplace (the supported path) cached the plugin at `cache/<marketplace>/zodyssey/0.3.0/` instead — so every hook spawn resolved a now-empty path and failed silently. The plugin itself loaded (skill/agents/commands resolved), but the enforcement gate — the entire point of the project — was offline. `install.mjs --verify` missed it because it checked files/paths/registration but not whether ZCode's loader actually accepted the hand-written `installed_plugins.json` entry.

### Changed — hooks are now manifest-declared (never orphan again)

The 4 hooks moved **out of `config.json` and into `.zcode-plugin/plugin.json`** under a `hooks` field, using `${CLAUDE_PLUGIN_ROOT}/skills/odyssey/hooks/<name>.mjs` for the script paths. ZCode resolves the template var to wherever the plugin is cached, so the hooks track the cache location automatically — the path can never go stale. Plugin hooks also **auto-enable the hook runner**, so no `config.json` surgery is required at all. The matchers, events (`PreToolUse`/`PostToolUse`/`Stop`/`UserPromptSubmit`), timeouts, and the gate logic (`pre-tool.mjs` — untouched) are identical to v0.3.0.

### Changed — `install.mjs` no longer fights ZCode's registries

The installer stopped hand-writing `installed_plugins.json` (the v0.3.0 bug source: `marketplace:"local"` wasn't in `known_marketplaces.json` so the loader skipped the entry) and stopped writing hooks into `config.json`. New responsibilities:

- **Marketplace bootstrap** — verifies `marketplace.json` exists, reports whether the plugin is installed, and prints the exact GUI steps if not. Never hand-writes the registry.
- **Purge** — pre-v0.3.0 top-level pollution (unchanged).
- **Migrate v0.3.0 orphaned hooks** — sweeps every ZOdyssey hook ref out of `config.json` (they're manifest-driven now; any copy is pollution that would keep firing-and-failing). Idempotent; config.json backed up first.
- **MCP registration** — the 5 pipeline MCPs still go into `config.json`'s `mcp.servers` (gated on each backend being on PATH). MCPs deliberately stay out of the manifest's `mcpServers` field because plugin-manifest MCPs are namespaced `plugin:zodyssey:<server>`, which would rename every tool the conductor references by its bare name.
- **AGENTS.md / eval / superpowers** — unchanged.

The `--phase copy|purge|hooks` sub-phase flags are removed (the installer is now a single idempotent shot). `--verify` now resolves the install path dynamically from `installed_plugins.json` (instead of assuming `cache/local/…`), checks the manifest declares the 4 hooks + each hook script parses at the cached path, and confirms no orphaned hooks remain in `config.json`.

### Upgrade path

`git pull && node scripts/install.mjs` (re-purges + migrates the v0.3.0 hook orphans + refreshes MCPs), then **Settings → Plugin Management → Discover → Update** on zodyssey to refresh the cached plugin copy (so the new manifest with hooks takes effect). Start a new ZCode session.

### Not in this release

No pipeline-semantic changes — only how the gate is *registered* changed. The single-seam namespaced-dispatch matcher (`pre-tool.mjs`) is untouched (no security audit needed). The 8-phase state machine, hook event types, matchers, and exit codes are identical to v0.3.0.

## [0.3.0] — 2026-08-11

### BREAKING — ZOdyssey is now a proper ZCode plugin (`zodyssey:` namespaced)

ZOdyssey no longer pollutes `~/.zcode/skills/`, `~/.zcode/agents/`, or `~/.zcode/commands/` with top-level copies. It installs as a local plugin under the ZCode plugin cache, and every component is namespaced `zodyssey:` (derived from `.zcode-plugin/plugin.json:name`):

- Skill `odyssey` → dispatchable as **`zodyssey:odyssey`** (also still loadable bare, mirroring `superpowers:brainstorming`).
- The 8 repo agents → dispatchable as **`zodyssey:metis`**, **`zodyssey:prometheus`**, **`zodyssey:momus`**, **`zodyssey:sisyphus-junior`**, **`zodyssey:explore`**, **`zodyssey:librarian`**, **`zodyssey:oracle`**, **`zodyssey:multimodal-looker`**.
- The `/orchestrate` and `/orchestrate-consult` commands now declare `skills: zodyssey:odyssey` in their frontmatter.

Component `name:` frontmatter stays **bare** (the namespace is derived from `plugin.json:name`, not the file's `name:` field) — only the *dispatch* references changed. External references (`prompt-master`, `premortem`, `superpowers:*`, `feature-dev:code-reviewer`, `code-architect`, `code-explorer`) are untouched.

### Migration — finish active runs before upgrading

**Finish any active orchestration runs before upgrading.** Existing `<repo>/.zcode/state/<slug>.json` files that record bare agent names in their dispatch history are **NOT auto-migrated** (decision: document, don't migrate — option C). All known prior runs are terminal, so this is a documentation concern, not a data-loss one. The v0.3.0 installer's purge phase removes the pre-0.3.0 top-level copies (`~/.zcode/skills/odyssey/`, the stale `~/.zcode/skills/odyssey.bak.1786309084/`, the 8 `~/.zcode/agents/*.md`, and `~/.zcode/commands/orchestrate*.md`) — back up `~/.zcode/` first if you want a rollback path.

### Changed — `install.mjs` rewritten as three idempotent phases

The installer is restructured into three explicit, independently re-runnable phases, each safe to run alone:

1. **Copy + register:** `cpSync` the repo tree (`skills/`, `agents/`, `commands/`, `.zcode-plugin/`, `scripts/`, `docs/`, `README.md`, `CHANGELOG.md`, `LICENSE`) into `~/.zcode/cli/plugins/cache/local/zodyssey/0.3.0/`, then upsert a `zodyssey@local` entry in `~/.zcode/cli/plugins/installed_plugins.json` (shaped like the existing `superpowers@claude-plugins-official` entry: `{id, name, marketplace:"local", version, installPath, installedAt, updatedAt, scope:"user", source:"local"}`; idempotent — updates `updatedAt` + `installPath` if the entry exists, else appends).
2. **Purge pre-0.3.0 pollution:** remove the old top-level copies listed under Migration above. Each `rmSync` is guarded by `existsSync` and scoped to ZOdyssey-owned names only; absent entries are skipped silently.
3. **Rewrite `config.json` hooks:** point each hook's `script:` at the new cache path (`<cache>/skills/odyssey/hooks/<name>.mjs`). MCP registration, the `AGENTS.md` block merge, eval-dir init, and superpowers detection are preserved. `--verify` checks the cache paths + the `installed_plugins.json` entry + that no top-level `~/.zcode/skills/odyssey/` remains; `--uninstall` removes the cache dir + the registration + the config hooks.

Every path is derived from `os.homedir()` — **no hardcoded `/home/...` or literal `~`** anywhere in the installer. Portable to any machine (proven by a fresh-`HOME=` clone test that seeds pre-0.3.0 pollution, runs the installer, and asserts the cache tree is grep-clean).

### Fixed — hooks + scripts resolve their own paths via `import.meta.url`

Pre-0.3.0, `consult.mjs` and several sibling scripts joined `env.HOME` with `.zcode/skills/odyssey/...` to locate the auditor prompt and sibling scripts — correct only when the skill lived at the top-level install path, broken once it moved into the plugin cache. These now resolve relative to the script's own location via ESM `import.meta.url` (e.g. `new URL("../references/auditor-prompt.md", import.meta.url)`), so they work from any install path. The `ZCAP_CAPS_MD` env override in `resolve-capabilities.mjs` is preserved (tests rely on it); only the default fallback changed. `hooks/*.mjs` were already portable (env-driven project dir + relative ESM for the sibling `find-run.mjs` + state-dir-relative repo root) — confirmed unchanged by the cache move.

### Fixed — single-seam namespaced-dispatch matching in `pre-tool.mjs`

The review-gate nonce chain depends on `pre-tool.mjs` recognizing the dispatched sub-agent by name. After namespacing, a `Task(subagent_type="zodyssey:momus")` dispatch would have silently failed the bare `=== "momus"` comparison → nonce never minted → review verdict unrecordable → full run deadlock. Fixed at a single seam: the matcher normalizes `subagent` at extraction by stripping a leading `zodyssey:` prefix (scoped — it does **not** strip `feature-dev:`, which is external), so every existing bare-string comparator (`=== "momus"`, `=== "oracle"`, the `READONLY_AGENTS` / `PLANNER_AGENTS` `Set`s) keeps working unchanged. `code-reviewer` / `feature-dev:code-reviewer` handling is untouched.

### Not in this release

No pipeline-semantic changes — names and install paths only; the 8-phase state machine, hook event types, matchers, and exit codes are identical. No new dependencies (still zero npm deps). No auto-migration of in-flight runs (documented above).

## [0.2.0] — 2026-08-11

### Added — prime-agent adaptation (3 of 9 primitives borrowed)

Studied [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) and adapted the borrowable ideas. Decision: **adapt-ideas** (NOT adopt-as-is) — 6 of 9 primitives require a long-lived daemon ZOdyssey doesn't have; only 3 fit the synchronous single-session model.

- **`scripts/compact.mjs`** — OPTIONAL pre-final-wave notepad compactor (borrows prime-agent primitive #8). Deterministic, $0, additive: concatenates each notepad (truncated ~40 lines, `## <name>` headers) into a single `_compact-brief.md` the F1–F4 sub-agents consume instead of the full doc set. Never modifies source notepads.
- **SEC-1s bounded-recursion guard** (`hooks/pre-tool.mjs`) — new ADDITIVE dispatch-gate enforcement branch, a sibling to SEC-1 (the review-nonce gate). Blocks a `Task()` dispatch whose prompt/message payload embeds a serialized nested tool invocation — both the generic `{\"tool_name\":\"Task\",...}` shape AND the Claude/ZCode-native `{\"type\":\"tool_use\",\"name\":\"Task\"}` shape. Defense-in-depth behind the harness tool-grant boundary (sub-agents aren't granted the Task tool at all); catches prompt-injection attempts that try to coerce a downstream agent into emitting a forged tool call.
- **`state.acceptance` + `state.notepad_pointers`** — new OPTIONAL resume-format fields (SEC-7 candidate, format-only — no daemon). `acceptance[id] = {pass, at, evidence}` per verified todo; `notepad_pointers[id] = path` for inherited context. Backward-compatible (older state loads fine; consumers use `|| {}`).
- **`status.mjs` consumer** — surfaces the new fields in `--json` (`acceptance`, `notepad_pointers`, `verified_count`) and human mode (gated `verified: N passed · M notepad(s) linked` line, only when fields have content — byte-identical backward compat).
- **`ZODYSSEY_RECURSION_CAP`** env var (default 1; reserved for a future real depth counter — today the SEC-1s guard is a payload-pattern match).
- **sisyphus-junior admission-only-handle return contract** + process-isolation trust model docs — formalizes the existing fan-out/fan-in shape as `{status, files-changed, acceptance-evidence, notepad-path}` (the trust-equivalent of prime-agent's `rlm(...)` admission handle) and documents verbatim that the sub-agent process boundary is lifecycle containment, NOT a security sandbox.

### Changed
- `SKILL.md` — phase-6 documents the optional compaction step; context-economy section names `.zcode/notepads/<slug>/<id>.md` as load-bearing working memory; resume section consumes the new fields (skip `acceptance[id].pass === true` todos, read `notepad_pointers[id]` for context, run `status.mjs` to orient).
- `record-verify.mjs` — populates the new state fields on every verify.
- `references/scripts.md` — documents `compact.mjs` + the new state fields + `status.mjs`'s `--json` output + the full `record-verify` flag set.

### Fixed (audit-driven — 3 independent external audits)
- **record-verify.mjs mid-verify race** — `acceptance[todoId].pass` now gated on `todos[todoId].status === 'done'` (previously flipped true after criterion N while N+1..M were still unrun; a resuming orchestrator could prematurely skip the todo).
- **sisyphus-junior.md capability-routing contradiction** — rewrote the pre-existing "delegate to further sisyphus-junior dispatches" line (sub-agents cannot dispatch; they request through the orchestrator).
- **pre-tool.mjs ledger leak** — moved the SEC-1s recursion guard BEFORE the parallel-cap ledger push so a blocked dispatch never consumes an in-flight slot until TTL.
- **pre-tool.mjs SEC-1s regex** — extended to also catch the Claude/ZCode-native `name:`-shape (the previously-documented false-negative is now CLOSED); block message reframed to honestly say "payload-pattern match" rather than "recursion depth bound".

### Security posture
- **No existing SEC-1..6 member weakened.** The SEC-1s guard is additive, a sibling to SEC-1.
- **Three independent external audits** (Claude Opus 5, manual `claude -p` payload): round 1 ACCEPT with 6 advisories → fixed → round 2 REJECT (scripts.md signature stale) → fixed (PR #2) → round 3 ACCEPT clean.
- **Honest residual limit:** the SEC-1s regex matches literal JSON spellings — escaped (backslash-quoted) or single-quote variants still slip past. Accepted as defense-in-depth; the primary control remains the harness tool-grant boundary.

### Not in this release (parked — require a daemon runtime layer)
5 prime-agent primitives need a long-lived supervisor process ZOdyssey doesn't have. Deferred until/unless SEC-7 is authorized as a real enforcement member with a daemon runtime:
- daemon-backed session survival, persistent goals, the three heartbeat surfaces, agent-to-agent messaging, autonomous mode.

## [0.1.3] — 2026-08-10

Installer now covers all pipeline dependencies, not just hooks.

### Added
- **Installer registers the 5 pipeline MCPs** in `~/.zcode/cli/config.json`'s `mcp.servers`: `memory`, `sequential-thinking`, `codegraph`, `chrome-devtools`, `zai-mcp-server`. Each is gated on its backend being on PATH — if the binary isn't installed, the MCP is skipped with a hint instead of writing a dead config entry that would error on every session. The 4 npx-backed MCPs auto-install on first spawn; `codegraph` and `zai-mcp-server` print install pointers if missing.
- **`--verify` mode**: `node scripts/install.mjs --verify` health-checks the install — Node version, each hook script exists + parses + is registered, each pipeline MCP is registered AND its backend is resolvable, core skills + agents present, superpowers plugin detected. Exits `0` on pass, `1` on any failure (CI-usable). Tells you exactly what's missing and how to fix it.
- **Superpowers detection**: the installer detects whether the [`superpowers`](https://github.com/obra/superpowers) plugin (source of most routed skills — `tdd`, `systematic-debugging`, `writing-plans`, `brainstorming`, `premortem`, etc.) is installed, and prints a pointer if not. ZOdyssey works without it (the 3 shipped capsules cover the load-bearing cases); the conductor just can't reach the full routed set until you install it. The installer does NOT auto-install a third-party plugin — that's the user's call.
- **`--uninstall` now removes the MCPs too** (was: hooks + files only).

### Changed
- **INSTALL.md** rewritten with a 6-step "what the installer does" section, a `--verify` section, and a collapsible manual-checks appendix.
- **README Prerequisites** Path B step 4 now shows the `--verify` invocation and mentions MCP registration.

## [0.1.2] — 2026-08-10

Public-default security fix. Restores the Bash write-gate that v0.1.1's verbatim mirror had deleted, so the public repo ships with the "secure by default" posture the README advertises.

### Fixed
- **Bash write-gate restored in the public copy.** v0.1.1 mirrored the installed hook verbatim, which had `if (isBash) exit(0);` — the gate deleted outright (the original author's personal `ZODYSSEY_UNGATE_BASH=1` setup, accepted locally 2026-08-08). That made the public README's "Secure by default; `ZODYSSEY_UNGATE_BASH=1` disables" claim false: v0.1.1 shipped an insecure default to other users. The full v0.1.0 Bash-gate logic is now back in `hooks/pre-tool.mjs` (escape hatch + `isTrustedScriptInvoke` allowlist + OKAY-verdict gate + plan-sha tamper guard + per-target scope check). Users who want the ungated behavior set `ZODYSSEY_UNGATE_BASH=1` in their environment — identical runtime effect, honest default for everyone else.

  > **This fix did not hold.** `e57b01b` (PR #1, the v0.2.0 cycle) deleted the gate again — the same ~170 lines, the same `if (isBash) exit(0);` — so releases v0.2.0 through v0.3.1 shipped without it, and the entry above described a state that had not been true since. Restored again in [Unreleased], this time with `hooks/pre-tool.bash-gate.test.mjs` behind it so a third deletion fails CI rather than a release. Read this entry as history, not as a description of any released version between v0.1.2 and v0.3.1.

### Changed
- **DESIGN §12 item 7** (trivial-gate): marked `done` (was `partial`). v0.1.1's `UserPromptSubmit` hook code-enforces it; the manifest and §12 prose now reflect that. The enforcement-hooks manifest row also lists the 4th hook.

### Note
This fix addresses a public-release integrity problem introduced in v0.1.1. The enhancement work itself (v0.1.1) is unchanged. No behavior change for users who never set `ZODYSSEY_UNGATE_BASH`; users who relied on v0.1.1's ungated default must now set the env var explicitly.

## [0.1.1] — 2026-08-10

Pipeline accuracy + enforcement hardening. Validated a ~30-proposal enhancement backlog against the live codebase, shipped 20 todos across 5 blast-radius-ordered waves. All 42 `.mjs` files syntax-clean, 12 test suites pass, the run's own plan passes the new extended lint.

### Added
- **Toolchain probe** (`scripts/probe-toolchain.mjs`): detects test runner / package manager / lint command → writes `.zcode/toolchain.json`. Foundation for the toolchain-aware lint, post-edit diagnostics, and coverage delta. Handles bare repos (no `package.json`).
- **Structured verdict schema** (`scripts/lib/verdict-schema.mjs`): centralizes the three verdict lanes (review `OKAY/REJECT`, consult `ACCEPT/REJECT`, final `pass/fail`) + the duplicated review default `{round,max_rounds,verdict,history}` that was drift-prone across `scaffold.mjs` + `record-review.mjs`. Fail-closed `normalizeConsultVerdict` preserves the `.includes("ACCEPT")` false-positive fix.
- **Capabilities autogen + drift check** (`scripts/resolve-capabilities.mjs --drift-check`): generates `~/.zcode/capabilities.lock.json` from the live inventory and flags routes that name missing/extra capabilities. The routing table's "intelligence" is now self-maintaining.
- **Pre-execution plan audit** (`scripts/consult.mjs --plan-audit`): the independent external-CLI verifier, previously post-done only, now runs pre-execution at the cheapest fix point. Opt-in, for architecture intent.
- **Multi-auditor consult** (`scripts/consult.mjs --multi-auditor`): ports `judge.mjs`'s double-judge + `>0.15` disagreement flag to the consult lane; disagreements surface to a human instead of auto-looping and are recorded to memory for recall.
- **Trivial-gate `UserPromptSubmit` hook** (`hooks/user-prompt-submit.mjs`): warning-only heuristic that deflects one-line fixes away from the full pipeline. Closes the v0.1.0 "Known limitation" that the trivial gate was prompt-only. Override with "force orchestrate".
- **Post-edit diagnostics arm** (`hooks/post-tool.mjs`): when an executor edits a file in execute/verify/final phases, auto-runs the `lint_cmd` (from `toolchain.json`) scoped to the edited file and injects failures back. Turns verify into the second line of defense. Uses `spawnSync(argv, {shell:false})` — no shell-injection surface.
- **Review-round residual cap** (`hooks/pre-tool.mjs`): blocks a new momus dispatch when `state.review.round >= max_rounds`, closing the REJECT→replan residual (the OKAY path was already capped in `record-review.mjs`).
- **Untrusted-content lint** (`scripts/lint-untrusted.mjs`): scans plan text for prompt-injection patterns (`ignore previous instructions`, `system:` directive prefix, `<function=` tool-call bait, prose `rm -rf`) and exits 6. Wired into `parse-plan --lint` so a plan carrying payloads cannot pass the review gate. Spares backticked acceptance-criteria commands (legit).
- **Flake detection** (`scripts/record-verify.mjs --flake-check`): runs each acceptance command twice; disagreement marks the criterion `flaky` (distinct state, exit 7 — not passed, not failed, surfaced to human). Opt-in.
- **Coverage delta** (`scripts/coverage-delta.mjs`): reads `toolchain.json` to know your coverage tool, parses the coverage report for changed files, reports the delta as verify-phase evidence. Graceful no-op in bare repos.
- **Skill capsules** (`scripts/build-capsules.mjs`): compiles `tdd`, `debugging`, `executing-plans` into deterministic ≤200-word capsules for sub-agent dispatch context (sub-agents can't load skills). Loud-fail if any capsule exceeds 200 words.
- **Codegraph impact-derived Files** (`scripts/codegraph-impact.mjs`): shells `codegraph explore` for given symbols, emits the impacted file set so planners can derive declared `Files:` from real impact. Graceful no-op when no `.codegraph/`.
- **F3 executable UI wiring** (`references/f3-ui-verify.md`): documents the chrome-devtools + zai-mcp-server sequence for executable UI verification, feeding `record-final-wave.mjs --f3-checklist`.
- **Adversarial review panel** (`references/momus-prompt.md` + `agents/oracle.md`): momus now reviews through three lens-diverse refutations (correctness, scope, verification-rigor), oracle takes a distinct design-level lens. Majority rules.
- **Eval dashboard** (`scripts/dashboard.mjs`): renders `results.jsonl` + `judged.jsonl` into a markdown scorecard (per-seed win-rate, mean overall judge score, score-over-time).
- **Memory schema bridge** (`scripts/lib/memory-schema.mjs`): couples the MCP graph store and the per-repo `outcomes.jsonl` store with `validateOutcome` / `validateGraphEntity` / `outcomeToGraphEntity`. `recall-outcomes.mjs` now validates + skips malformed lines instead of crashing.

### Fixed
- **`hooks/stop.mjs` undefined `STATE_DIR`**: line 36 referenced an undeclared identifier, throwing `ReferenceError` on every Stop hook before the checkpoint logic ran. Resume checkpointing was silently broken on all prior runs. Removed the redundant guard (the `findActiveRuns` null-check already handles the no-active-run case).
- **PostToolUse matcher dead-code** (caught by F2 post-verify): v0.1.0's `"Task|Agent"` matcher meant the new post-edit diagnostics arm never fired for Edit/Write/MultiEdit. Installer + existing configs widened to `"Task|Agent|Edit|Write|MultiEdit"`.

### Changed
- **Installer registers 4 hooks** (was 3): adds `UserPromptSubmit`; widens `PostToolUse` matcher to include the edit tools.
- **`parse-plan --lint` extended** (additive): adds toolchain-aware acceptance-criteria checks + the untrusted-content injection scan on top of the existing shell-token / slop / empty-Files / path-grammar checks.

### Not in this release (deferred)
- Worktree isolation, seed growth 18→50 + omo cross-eval, real model routing — see the run report for the per-item rationale.

## [0.1.0] — 2026-08-09

First public release. Extracted from a personal ZCode orchestration setup that has been iterated on through ~20 security/operational audit rounds (see `docs/` for the design and measurement docs).

### Added
- **The enforcement gate** (`skills/odyssey/hooks/pre-tool.mjs`): the review gate, scope-isolation boundary (fail-closed), file-lock ledger, parallel-cap counter, and secure-by-default Bash write-gate. This is the core delta over prompt-convention orchestrators.
- **The 8-phase pipeline conductor** (`skills/odyssey/SKILL.md`): prime → triage → consult → plan → review → execute → verify → final-wave.
- **The cast of 8 sub-agents** (`agents/`): `metis` (consult), `prometheus` (plan), `momus` (review), `sisyphus-junior` (execute), plus read-only `explore`, `librarian`, `oracle`, `multimodal-looker`.
- **Slash commands** (`commands/`): `/orchestrate` (run + resume + status), `/orchestrate-consult` (external audit).
- **Evidence-chain scripts** (`scripts/`): `record-review`, `record-momus-artifact`, `record-todo`, `record-verify`, `record-final-wave`, `record-capability` — nonce + plan-sha binding so OKAY/F2/F4 verdicts are non-forgeable.
- **Eval harness** (`scripts/harness.mjs` + `judge.mjs` + `seed.jsonl`): LLM-as-judge scoring of completed runs.
- **External consult gate** (`scripts/consult.mjs`): hands plan + diff to an independent Claude CLI for ACCEPT/REJECT, with auto-remediation loop.
- **Installer** (`scripts/install.mjs`): copy + register hooks + merge AGENTS.md, idempotent, zero npm dependencies.
- **Docs**: `DESIGN.md` (full design), `ADAPT.md` (porting to omo / other harnesses), `INSTALL.md` (config + troubleshooting), plus `ECOSYSTEM_GRAPH.md`, `MEASUREMENT.md`, `RESUME.md`, `deep-audit-prompt.md`.

### Security posture
- Bash gate ships **secure by default** (write-capable Bash gated like Edit). `ZODYSSEY_UNGATE_BASH=1` restores the original author's ungated personal setup for users who want minimum friction and accept the tradeoff.
- Scope boundary **fails closed** on unreadable or empty plans.
- Review verdict + final-wave evidence is **non-forgeable** against executor agents (nonce + sha + recorder-only writes). The documented residual limit is the orchestrator adversary (a malicious orchestrator-level prompt), which is out of scope for v1.

### Known limitations
- **Single harness.** The reference implementation targets ZCode. The pattern is portable (see `docs/ADAPT.md`).
- **Single-executor per todo.** Parallel multi-executor team mode (mailbox + worktrees) is designed but deferred to v2.
- **Single connected model.** Model routing is designed in (`category` field) but reduces to effort/variant selection until a second provider is wired.
- **Trivial-gate is prompt-guided, not hook-enforced.** The triage step that deflects one-line fixes away from the full pipeline is in the conductor prompt; a future `UserPromptSubmit` hook will make it code-enforced.

### Provenance
Pipeline shape and agent cast modeled on [omo](https://github.com/code-yeongyu/oh-my-openagent). Enforcement layer (the 4-5 hooks) is the differentiator. Research grounding in `docs/DESIGN.md §0 + §15`.
