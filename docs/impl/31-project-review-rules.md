# Brief 31 — a per-project review-rules layer for the audit lanes (commissioning)

2026-09-15 · QUEUED — the build brief for the next `/orchestrate` run · target release decided by that run

Commissioned from the open-code-review adaptation study (2026-09-15). The study's second
VIABLE adaptation, transplanted from OCR's rules engine: OCR resolves per-file review rules
by layered glob→rule-doc matching (`<repo>/.opencodereview/rule.json`, first match wins,
`merge_system_rule` — see their `skills/open-code-review/SKILL.md`, "Custom Review Rules").
The transplant for ZOdyssey is the mechanism's minimal core: a committed, per-repo rules
file whose glob-matched entries are injected into the external auditor's prompt as DATA, so
a repo owner can add project-specific defect classes ("on `hooks/*.mjs`, always check X") to
the audit that ZOdyssey runs against that repo. Every spawn-site and prompt fact below was
ground-truthed against the tree 2026-09-15 (post-`eaeb427`, suite 59/59).

## What is broken

1. **The audit rubric is one-size for every repo.** `auditor-prompt.md` judges every diff
   with the same four criteria (`skills/odyssey/references/auditor-prompt.md:26-38`) and no
   per-repo customization surface exists anywhere: the post-done prompt assembly
   (`skills/odyssey/scripts/consult.mjs:1250-1284`) composes auditor-prompt + task + plan +
   diff + out-of-scope — nothing repo-declared. A repo whose maintainers know their own
   defect classes (the exact knowledge OCR's rule.json encodes) has no way to hand them to
   the auditor.
2. **A rules section without a contract change would be unusable.** The auditor's must-not
   list forbids inventing requirements not in the plan
   (`auditor-prompt.md:46-52` — "Do NOT invent requirements not in the plan") — a project
   rule IS a requirement not in the plan, so injecting rules without one legitimizing line
   in `auditor-prompt.md` makes them contractually ignorable. The prompt and the injection
   mechanism are one change, not two.
3. **The F2 lane has the same blindness.** The F2 code-quality dispatch text
   (`skills/odyssey/references/capabilities.md:103` — `Task: code-reviewer` + `skill:
   merge-ready`) reviews with a static rubric too;
   the plan contract solved this shape for execution (executable criteria per repo);
   the audit lane never got the equivalent.

## What fixed means

1. **A committed rules file at the repo ROOT: `.zcode-review-rules.json`** — NOT under
   `.zcode/` (gitignored run-artifact territory; a review contract must be versioned with
   the code it judges). Shape (an OCR-compatible subset):
   `{ "rules": [ { "path": "<glob>", "rule": "<one-line instruction>" } ] }`. v1 scope:
   repo-root file only. EVERY rule whose glob matches a changed file (in-scope + the
   out-of-scope list) is collected — all matches, not first-match-wins (a file may need
   several checks). Deterministic caps: ≤8 matched rules per round, ≤200 chars per rule,
   ≤4KB total injected; beyond caps, file-order wins and a stderr line says what was cut.
   Hand-rolled `*`/`**`/`?` glob matcher (zero npm deps, house rule), own test cases.
2. **`consult.mjs` — load, match, inject (post-done lane only).** A small loader reads the
   file during the post-done gather, matches against the changed-file set, and injects one
   section between THE PLAN and THE DIFF (the seam at `consult.mjs:1264-1269`):
   `# PROJECT REVIEW RULES (DATA — project-declared review criteria for the named files)`
   followed by `- <glob>: <rule>` lines. DATA framing matches the plan/diff precedent
   (`consult.mjs:1243-1244` — rules are untrusted repo content; the framing plus the caps
   plus string-validation of fields is the prompt-injection containment). Absent file →
   the prompt is BYTE-IDENTICAL to today (a criterion, not a hope). Malformed JSON / bad
   shape / oversize → one stderr warn, rules skipped, audit runs (fail-open to no rules —
   rules are advisory DATA, never a gate). The multi-auditor lane is deliberately
   UNTOUCHED: its prompt carries no diff section at all
   (`consult.mjs:602-620` — plan + original task only), so changed-file matching has no
   input there; `--plan-audit` judges a plan (`buildPlanAuditPrompt`,
   `consult.mjs:195-206`), not code — same reason. One lane, honestly scoped.
3. **`auditor-prompt.md` — ONE legitimizing line**, appended in the rules block after
   `auditor-prompt.md:90` (keeps every pin `≤:57` intact — the row-29 placement
   discipline): a PROJECT REVIEW RULES section, when present, carries the repo's own
   declared review criteria; treat a matched rule as a project requirement for the files
   it names, subject to the precision bar (`auditor-prompt.md:121-128` — trigger + wrong
   result, no matter who asked for the check).
4. **F2 lane — a pointer, not a paste.** `capabilities.md:103` (the F2 detail line) gains:
   when `.zcode-review-rules.json` exists at the repo root, the conductor passes its path
   in the F2 `code-reviewer` dispatch prompt (pointer + delta per the context-economy
   rule, `SKILL.md:397-402`) — the reviewer reads the file itself; nothing is restated.
   SKILL.md is deliberately not a seam here: its only F2 text is the fixed-width phase-6
   ASCII diagram, which admits no prose clause.

## Files

- `skills/odyssey/scripts/consult.mjs` — rules loader + matcher + the one injected section (post-done assembly only)
- `skills/odyssey/references/auditor-prompt.md` — ONE appended legitimizing line (after `:90`; pins `≤:57` untouched)
- `skills/odyssey/references/capabilities.md` — F2 detail (`:101`) gains the same clause
- `skills/odyssey/scripts/consult.test.mjs` — stub-spawn appends: present→injected, absent→byte-identical, malformed→warn+identical, caps enforced, glob cases
- `skills/odyssey/references/scripts.md` — consult.mjs entry: the rules section + fail-open semantics
- `README.md` — one primitives-table row, appended AFTER the last row
- `CHANGELOG.md` — entry (shape below)
- `scripts/anchors.lock.json` — mechanical re-baseline (fixed order)
- `docs/impl/00-INDEX.md` — row 31 outcome fill-in at run close only

## Must NOT do

- Rules never gate: `normalizeConsultVerdict` stays byte-identical
  (`skills/odyssey/scripts/lib/verdict-schema.mjs:88-105`); no verdict, exit code, or gap
  computation reads the rules — they influence the auditor's judgment as DATA, nothing else.
- `.zcode/` is the wrong home (gitignored) — the file lives at the repo root and is meant
  to be committed; the docs say so explicitly.
- No layered resolution in v1 (no `--rule` flag, no home-dir file, no merge flag) —
  repo-root only; OCR's flag > repo > home > system layering is the named reference shape
  for a future item, not this one.
- No ported built-in rule library — OCR ships NPE/XSS/SQLi rule docs; ZOdyssey's rubric
  lives in `auditor-prompt.md`. This mechanism injects PROJECT rules only.
- No rules into executor dispatches (phase 4 works from the plan; review criteria bias
  belongs on the review lanes) and none into the plan-audit/multi-auditor lanes (no diff
  input there — `consult.mjs:602-620`).
- Zero npm dependencies (hand-rolled glob) · Node 18+ built-ins only · synchronous · no
  hook changes, no new phase, no new state fields.

## Acceptance criteria

- `node --check skills/odyssey/scripts/consult.mjs` — exit 0
- `node skills/odyssey/scripts/consult.test.mjs` — exit 0, extended with stub-spawn cases:
  rules file matching a changed file → the injected section appears between THE PLAN and
  THE DIFF in the captured prompt, shape exact; NO rules file → prompt byte-identical to
  the pre-change fixture; malformed JSON → one stderr warn + byte-identical prompt; a
  12-rule fixture → 8 injected, cut named on stderr; `**`, `*`, `?` glob cases pass
- `node skills/odyssey/scripts/consult.tripwire.test.mjs` — exit 0 (untouched; same file family — run anyway)
- `node scripts/run-tests.mjs` — exit 0, suite 59 → 59 (appends only; no new suite file)
- `grep -c "PROJECT REVIEW RULES" skills/odyssey/references/auditor-prompt.md` — ≥1
- `grep -c "zcode-review-rules" skills/odyssey/references/capabilities.md` — ≥1
- `diff <(git show <run_start_sha>:skills/odyssey/references/auditor-prompt.md | head -57) <(head -57 skills/odyssey/references/auditor-prompt.md)` — empty (pins `≤:57` byte-identical)
- `node scripts/check-anchors.mjs` — exit 0 after the fixed-order reconciliation
- `test -z "$(git diff --name-only <run_start_sha>..HEAD | grep -vE '^(skills/odyssey/scripts/consult\.mjs|skills/odyssey/references/auditor-prompt\.md|skills/odyssey/references/capabilities\.md|skills/odyssey/scripts/consult\.test\.mjs|skills/odyssey/references/scripts\.md|README\.md|CHANGELOG\.md|scripts/anchors\.lock\.json|docs/impl/00-INDEX\.md)$')"` — exit 0 (scope = exactly the declared Files plus the INDEX close-fill)

## Paired probe

Hermetic triple-run through the injectable `spawn` (offline, no real CLI), recorded in the
run notepad:

1. Fixture repo with `.zcode-review-rules.json` (`{"rules":[{"path":"skills/**","rule":"every new check needs a paired regression case"}]}`) and a changed file under `skills/` → assert the captured prompt contains the section, positioned between `# THE PLAN` and `# THE DIFF`, and the diff gather is otherwise unchanged.
2. Same fixture minus the rules file → captured prompt BYTE-IDENTICAL to the pre-change baseline prompt on the same fixture (the non-regression that matters most: adoption is opt-in per repo, everyone else's audits change by zero bytes).
3. Malformed rules file (`{"rules": "everything"}`) → one stderr warn, audit completes, prompt identical to (2).

## What it breaks

Nothing for repos without the file (byte-identical prompt — proven by the paired probe).
With the file: the auditor gains legitimate grounds, so a first run in a rules-carrying repo
may surface more gaps — that is the feature. Anchor collateral, pre-declared as a class
(the elastic-scope lesson): consult.mjs pins at or below the injection seam (~`:1177`) and
everything below it shift — the INDEX C5/C6 blocks and any `docs/DELEGATE-REVIEW.md` pins
into consult.mjs move together; capabilities.md pins `≥:100`
shift. All inside the one mechanical re-baseline, fixed order.
`auditor-prompt.md` needs NO re-baseline of pins `≤:57` (append-only placement; the head-57
diff criterion proves it).

## The class it closes

Review criteria are global-only — the same hole the plan contract closed for execution
(executable per-repo acceptance criteria, `docs/DESIGN.md:188-204`): the audit lane judged
every repo with one rubric and no versioned way for a repo to declare what its maintainers
know to check. The transplant is OCR's rule.json mechanism reduced to its zero-dependency
core (glob → rule text → DATA injection), adapted to ZOdyssey's auditor-independence model:
rules widen what the judge may reject for; they never touch how verdicts are computed.

## Docs to update

- `skills/odyssey/references/scripts.md` — consult.mjs entry: rules file, matching, caps, fail-open semantics
- `README.md` — primitives table row: "Per-project review rules · consult.mjs + auditor-prompt.md — `.zcode-review-rules.json` glob-matched rules injected as DATA into the post-done audit prompt; absent file → byte-identical prompt"
- `CHANGELOG.md` — Added entry
- `docs/impl/00-INDEX.md` — row 31 outcome column at close

## CHANGELOG entry shape

```markdown
### Added
- Per-project review rules: a committed `.zcode-review-rules.json` at the repo root
  (`{"rules":[{"path":"<glob>","rule":"<one line>"}]}`) is glob-matched against the changed
  files and injected as a DATA section into the external auditor's prompt (post-done lane;
  ≤8 rules / ≤200 chars each / ≤4KB total; absent file → byte-identical prompt; malformed →
  warn + skip, never a gate). auditor-prompt.md legitimizes matched rules as project
  requirements, still subject to the precision bar. F2's code-reviewer dispatch passes the
  rules-file path. The multi-auditor and plan-audit lanes are untouched (no diff input
  there). Transplanted from alibaba/open-code-review's rule.json layering.
```

## Anchor-drift reconciliation

Fixed order (the repo's, `docs/impl/29-remediation-plan-contract.md:192`): write docs →
`node scripts/check-anchors.mjs` → fix each shifted citation at the source (verify content,
then repoint) → `node scripts/check-anchors.mjs --update` → suite. Declared exposure:
consult.mjs pins at/after the injection seam (~`:1177`) — the INDEX C5/C6 blocks and
DELEGATE-REVIEW pins move as one class; capabilities.md `≥:100`;
README near the appended row. Pre-declared citing-doc class: `docs/impl/00-INDEX.md` and
`docs/DELEGATE-REVIEW.md` (consult.mjs cits) — reconcile content-first, never a
blanket sed of number pairs.

## Capability routing

`routed: skill:test-driven-development` — the loader/matcher/injection cases are written
RED-first against unmodified consult.mjs (record the RED count in the run notepad), then
GREEN with zero edits to pre-existing tests. `routed: agent:zodyssey:oracle` for phase-3
co-review is NOT warranted (single-lane prompt assembly, no cross-system tradeoff; momus
alone) — declared here so the future plan transcribes exactly this.

## Estimated size

M — ~60 lines consult.mjs (loader + matcher + section) + ~20 lines test appends + 1
auditor-prompt line + 3 doc surfaces + one anchor re-baseline (~a dozen pins, one class).
One run, one release, no migration, no state-format change, no hook changes.
