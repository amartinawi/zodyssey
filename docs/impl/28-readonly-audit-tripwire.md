# Brief 28 — the external auditor's read-only window is verified, not promised (candidate C6, commissioning)

2026-08-24 · QUEUED — the build brief for the next `/orchestrate` run · target release decided by that run

Promotes candidate **C6** (`docs/impl/00-INDEX.md`, "Candidates", appended 2026-08-24 by the
delegate-skills/review-skills adaptation study — `docs/DELEGATE-REVIEW.md` mechanism
`D-read-only-tripwire`, the study's single VIABLE verdict). The study asked what a mature relay
fleet verifies that ZOdyssey still only promises; this is the one answer that survived the
non-goals. Every spawn-site fact below was ground-truthed against the tree 2026-08-24 (post-`73a3577`).

## What is broken

The external auditor is spawned read-only at three sites — post-done (`skills/odyssey/scripts/consult.mjs:1162-1176`), plan-audit (`:355-364`), and `runSingleAudit` (`:610-621`) — always with `--permission-mode plan --allowedTools ""` (the audit-2026-08-01 gap-#8 injection defense). But the read-only-ness is a **promise with no witness**: nothing before or after the multi-minute spawn checks that the tree is unchanged, and the code knows it — the spawn comment calls the flags the mitigation, while `consult.mjs:905-906` (per the study) treats "did the auditor touch anything" as unasked. The only mid-window detection that exists is HEAD-movement (`consult.mjs:1221-1229`, a stderr warning; `audit_head` recorded at `:1244`), which sees committed history only — a window that dirties the working tree or drops untracked files passes silently.

This is the exact shape the harness already rejects for the *baseline* arm: `harness.mjs:272-309` decides "did the agent work" with a two-surface check (`git status --porcelain --untracked-files=all` filtered by `isWorkPath`, plus the `diff run_start_sha..HEAD` committed-work fallback from GAP-2, fail-closed on unreadable git). The evaluator's own tooling refuses to trust an agent's self-description; the auditor's tooling still does. C6 closes that with the same primitive, inverted: not "did work happen" but "did anything change during the read-only window".

One attribution fact shapes the design: a change during the window is **evidence, not accusation**. `spawnSync` blocks this process, but a concurrent session in the same repo can legitimately commit mid-window (it happened to this repo's own runs — `11f3467` landed inside a run's diff range). So the tripwire records and surfaces; it never fails the verdict or auto-reruns. That is the same philosophy as the DISAGREEMENT verdict (`consult.mjs:766-777`): surface to the human, don't adjudicate.

## What fixed means

Every external-auditor spawn window carries a tri-state `readOnlyViolation` in its `consult.history` entry, computed by one shared helper, honest about what it cannot know.

1. **The helper (in `consult.mjs`, exported for tests like the existing internals).** `workTreeSnapshot(repoAbs)` → `{head, paths}` where `head` is `rev-parse HEAD` and `paths` is the sorted, filtered output of `git status --porcelain --untracked-files=all` under the harness's exclusion set (`.zcode/`, `node_modules`, `dist`, `build`, `target`, `coverage`, `.cache`, `.next` — the auditor has no legal write surface outside those, and `.zcode/` bookkeeping by the conductor/concurrent sessions is legal). `compareWorkTree(before, after)` → `false` (heads equal AND path sets equal), `true` (head changed OR any path entry added/removed/changed), `null` (either git read failed — fail-closed indeterminate, never a silent `false`; the Step-5 constraint, same as `harness.mjs:290-293`).
2. **All three spawn sites** wrap: snapshot → spawn → snapshot → compare → the enclosing `consult.history.push` gains `readOnlyViolation: <tri-state>` beside `audit_head` (known push sites `consult.mjs:756` multi-auditor and `:1236` post-done; the run verifies whether plan-audit records history — if it does not, its violation still warns on stderr and the brief's test t5 pins that). On `true`: a stderr warning in the existing `:1221-1229` family ("read-only window violated — tree changed during audit; could be the auditor OR a concurrent session; verdict below is untouched").
3. **The post-done spawn becomes injectable** (`spawn` param threaded exactly like plan-audit's at `:250-251` and runSingleAudit's at `:503`) so the hermetic test drives all three paths offline — today only the two injectable sites are testable.
4. **Zero behavioral change for honest windows**: the field is additive to history entries, the verdict parse/append paths are untouched, and a `true` never alters exit codes. The value is the permanent, queryable record — the same provenance answer `audit_head` already gives for committed movement, extended to the working tree.

## Files

- `skills/odyssey/scripts/consult.mjs` — helper + 3 site wraps + history field + injectable post-done spawn
- `skills/odyssey/scripts/consult.tripwire.test.mjs` — NEW hermetic suite (the repo norm: one test file per mechanism, RED-first)
- `skills/odyssey/references/scripts.md` — consult.mjs section: document the field + tri-state semantics
- `README.md` — one row in the primitives table (appended AFTER the last row — appending shifts nothing above; impl/11's `README.md:291` pin must survive byte-identical)
- `CHANGELOG.md` — v0.7.3 entry (shape below)
- `scripts/anchors.lock.json` — mechanical re-baseline for new citations (fixed order: write → check → fix-at-source → `--update`)
- `docs/impl/00-INDEX.md` — row 28 outcome fill-in at run close only (not mid-run)

## Must NOT do

- No new process spawns beyond the two `git` reads per snapshot (before + after only — no polling loop, no watchers).
- No verdict mutation, no exit-code changes, no auto-rerun on `true` — surface, don't adjudicate.
- No attribution heuristics (no "was it the auditor" guessing — the warning names both possibilities, verbatim both).
- No dependencies on `harness.mjs` internals (copy the exclusion set; the harness owns its copy, consult owns its — a lib/ extraction is NOT part of this item).
- Zero npm dependencies · Node 18+ built-ins only · synchronous · both git reads fail closed to `null`.

## Acceptance criteria

- `node --check skills/odyssey/scripts/consult.mjs` and `node --check skills/odyssey/scripts/consult.tripwire.test.mjs` — exit 0
- `node skills/odyssey/scripts/consult.tripwire.test.mjs` — exit 0, covering at minimum: clean window → `false` recorded at all three sites; stub-spawn mutating a work file mid-window → `true` recorded + warned; `.zcode/`-only delta → `false`; non-git repo → `null`; HEAD move with clean porcelain → `true`
- `node scripts/run-tests.mjs` — exit 0, suite 57 → 58 (discovery adds exactly the one file; pre-existing tests byte-identical)
- `node skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` — exit 0 (untouched, but the tripwire sits in the gate's family; run it anyway)
- `test -z "$(grep -n 'attribution\|blame' skills/odyssey/scripts/consult.mjs | grep -iv 'no attribution')"` — exit 0 (no attribution heuristics smuggled in)
- `node scripts/check-anchors.mjs` — exit 0 after the fixed-order reconciliation
- `test -z "$(git diff --name-only <run_start_sha>..HEAD | grep -vE '^(skills/odyssey/scripts/consult\.mjs|skills/odyssey/scripts/consult\.tripwire\.test\.mjs|skills/odyssey/references/scripts\.md|README\.md|CHANGELOG\.md|scripts/anchors\.lock\.json|docs/impl/00-INDEX\.md)$')"` — exit 0 (scope = exactly the declared Files plus the INDEX close-fill)

## Paired probe

Hermetic double-run of the tripwire against a scratch git repo: (1) with a stubbed CLI that only reads — assert `readOnlyViolation: false` in the printed history JSON; (2) with a stubbed CLI whose first action is `echo x > probe.txt` — assert `true` lands in history AND the verdict text is byte-identical between the two runs (proving record-not-mutate). Record both outputs in the run notepad.

## What it breaks

Nothing for honest auditors — additive history field, additive stderr warning. The post-done spawn signature gains an optional `spawn` param (default `spawnSync`): any external caller of that internal path (none exist in-tree; consult.mjs is invoked as a CLI) is unaffected. README gains a table row below the last — the run must verify `README.md:291`'s pin hash is unchanged after the append (the F2 `:291` lesson: verify content, not arithmetic).

## The class it closes

"Promises without witnesses" — the last security-relevant spawn whose postcondition went unverified. The prompt-injection defense (gap #8) got its enforcement half: a poisoned diff that somehow escapes the flag sandbox now leaves a permanent, timestamped record in the very history the trust registry (`docs/impl/00-INDEX.md` row 19) and future audits read. It also completes the symmetry with the empty-work guard: the harness verifies the baseline agent did work; consult now verifies the auditor didn't.

## Docs to update

- `skills/odyssey/references/scripts.md` — consult.mjs entry: the field, the tri-state, the fail-closed `null`, the surface-don't-adjudicate rule
- `README.md` — primitives table row: "read-only audit tripwire · consult.mjs · tri-state `readOnlyViolation` in consult history"
- `CHANGELOG.md` — v0.7.3 Added entry
- `docs/impl/00-INDEX.md` — row 28 outcome column at close; C6 candidate block gains its SHIPPED marker

## CHANGELOG entry shape

```markdown
## [0.7.3] — 2026-XX-XX
### Added
- Consult history now records `readOnlyViolation` (tri-state `false|true|null`) for every
  external-auditor spawn window (post-done, plan-audit, multi-auditor passes): a before/after
  two-surface git check (porcelain + untracked, HEAD) filtered to work paths, fail-closed to
  `null`. A violation warns on stderr and is recorded — never mutated into a verdict change
  (a concurrent session can legally commit mid-window). Closes candidate C6
  (delegate-skills adaptation study, docs/DELEGATE-REVIEW.md D-read-only-tripwire).
```

## Anchor-drift reconciliation

Fixed order (the repo's, `docs/impl/00-INDEX.md:63-66`): write docs → `node scripts/check-anchors.mjs` → fix each new citation at the source → `node scripts/check-anchors.mjs --update` → suite. The README row append must land AFTER the last table row; verify the `README.md:291` pin hash is byte-identical post-append. No `:line` citations on external repos (grammar rule, `docs/DELEGATE-REVIEW.md` header).

## Capability routing

`routed: skill:test-driven-development` — the tripwire test file is written RED-first against the unmodified consult.mjs (the run records the RED count in its notepad, then GREEN with zero edits to pre-existing tests). `routed: agent:zodyssey:oracle` for phase-3 co-review is NOT warranted (small, single-file mechanism; momus alone) — declaring it here so the future plan transcribes exactly this.

## Estimated size

S — one helper + three site wraps + one injectable-spawn refactor in consult.mjs (~80 lines), one hermetic test file (~150 lines), three doc surfaces, mechanical anchors. One run, one release (v0.7.3), no migration, no state-format change.
