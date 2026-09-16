# Brief 30 — route the external line-precise reviewer (`ocr`) as a capability (commissioning)

2026-09-15 · QUEUED — the build brief for the next `/orchestrate` run · target release decided by that run

Commissioned from the open-code-review adaptation study (2026-09-15, chat-only; the study's
memory file carries the full VIABLE/DUPLICATE/REJECTED map). `alibaba/open-code-review` is a
production-hardened AI code-review CLI (`ocr`, Go, Apache-2.0, 28k★) that reads git diffs and
emits structured line-precise comments (path, line range, category, severity, suggested fix),
with a deterministic-plus-agent hybrid architecture and a published ground-truth benchmark
(AACR-Bench). The study's top VIABLE adaptation is the literal adoption: **route it, don't
rebuilt it** — ZOdyssey is a capability router, and "review this PR / these changes
line-by-line" is the single most common coding ask the routing table has no best-in-class
answer for. Every capability fact below was ground-truthed against this tree 2026-09-15
(post-`eaeb427`, suite 59/59); the `ocr` install story was verified against the npm registry
2026-09-15 (`@alibaba-group/open-code-review` v1.12.2, license Apache-2.0, installs the `ocr`
bin).

## What is broken

ZOdyssey's promise is "always use the best available capability for the job"
(`skills/odyssey/references/capabilities.md:3`), enforced as the default
(`skills/odyssey/SKILL.md:47-58` — generic knowledge is the FALLBACK). For code review the
table routes two in-session shapes — "Audit code" (`SKILL.md:36`) and "Review code
(pre-merge)" (`capabilities.md:49`) — and F2 routes `Task: code-reviewer`
(`capabilities.md:103`). Missing: the activity "review a PR / changeset line-by-line in
THIS repo with an external specialized reviewer". A user asking ZOdyssey exactly that gets a
generic in-session review, the Task-B failure class the routing rule exists to prevent
(an installed best capability bypassed). `ocr` clears the external-skill quality gate
(`SKILL.md:45` — prefer ≥1K installs and official sources) with room to spare: alibaba org,
28k★, Apache-2.0, npm-distributed. This is a routing gap, not a mechanism gap — no pipeline
code is missing, only the table rows that make the capability visible to triage/metis.

## What fixed means

1. **`capabilities.md` quick matrix gains ONE new activity row, appended as the LAST row of
   the matrix (after `capabilities.md:54`)** — a genuinely new activity, not a duplicate of
   the `:49` pre-merge row (that row covers the in-session review flow; this one is an
   external line-precise reviewer over arbitrary diffs):
   `| **Review a PR / changeset line-by-line (external reviewer)** | `skill: open-code-review` (`ocr` CLI — external install) | `Task: code-reviewer`, `claude-security` plugin |`
2. **A detail paragraph under the matrix's phase sections** (append at the end of the
   "Cross-cutting" section, before `capabilities.md:123`'s newest-capabilities heading, or as
   a new final section — placement keeps all pins above it intact) carrying:
   - the install story: `npm i -g @alibaba-group/open-code-review` (v1.12.2, Apache-2.0,
     installs `ocr`; Git ≥ 2.41) + its own LLM config (`ocr config provider`) — NOT the
     ZOdyssey auditor's `CLAUDE_CLI`; `ocr` is a routed user-facing capability, never a
     pipeline dependency;
   - the invocation discipline distilled from their shipped skill: always
     `ocr review --audience agent -b "<business context from the task>"`, prefer
     `--output <file>` read in full (never pipe through `tail`/`head` — drops comments),
     report grouped by severity discarding `low` as likely false positives, and never
     auto-apply fixes without explicit user request;
   - the routing condition: route when the user wants line-precise review of changes/PRs in
     their repo AND `ocr` is installed; not installed → the discovery tri-state
     (`SKILL.md:49-58`) with the manual-install pointer above. Absence degrades to today's
     routing; nothing blocks.
3. **`SKILL.md` headline table gains ONE row, appended after `SKILL.md:40`** (end of table;
   all pins `≥:41` shift — declared below):
   `| Review a PR/changeset line-by-line | `skill: open-code-review` (`ocr` — external install, own LLM) |`

## Files

- `skills/odyssey/references/capabilities.md` — one matrix row (append at matrix end) + one detail paragraph
- `skills/odyssey/SKILL.md` — one headline-table row (append at table end)
- `CHANGELOG.md` — entry (shape below; rides whichever release implements it)
- `scripts/anchors.lock.json` — mechanical re-baseline (fixed order)
- `docs/impl/00-INDEX.md` — row 30 outcome fill-in at run close only (not mid-run)

## Must NOT do

- No pipeline wiring: `ocr` NEVER joins consult/F2/F4 — the enforcement path keeps
  `CLAUDE_CLI`/`CLAUDE_CLI_2` (`SKILL.md:459`) as its only external binaries; adopting OCR as
  machinery was the study's REJECTED option (own API-key lifecycle, marginal over the
  existing second-model knob).
- No vendoring of their SKILL.md into the plugin — it would ship foreign content to every
  install and drag versioning; the routing row points at the external install.
- No new MCP registration (`capabilities.md:154` discipline: route high-leverage unrouted
  ones first; `ocr` is a CLI skill route, not an MCP).
- No modification of existing matrix rows — additive only; the `:49` pre-merge row is
  untouched (one activity per row).
- The row must read as OPTIONAL/external: a repo without `ocr` degrades to today's routing;
  absence is never a gate, never a warning.

## Acceptance criteria

- `grep -c "open-code-review" skills/odyssey/references/capabilities.md` — ≥2 (matrix row + detail paragraph)
- `grep -c "open-code-review" skills/odyssey/SKILL.md` — ≥1
- `grep -q "external install" skills/odyssey/references/capabilities.md` — exit 0 (the optionality marker)
- `node scripts/check-anchors.mjs` — exit 0 after the fixed-order reconciliation
- `node scripts/run-tests.mjs` — exit 0, suite 59 → 59 (docs-only; count unchanged)
- `diff <(git show <run_start_sha>:skills/odyssey/references/capabilities.md | head -54) <(head -54 skills/odyssey/references/capabilities.md)` — empty (the matrix's pre-existing rows and everything above the appended row are byte-identical)
- `test -z "$(git diff --name-only <run_start_sha>..HEAD | grep -vE '^(skills/odyssey/references/capabilities\.md|skills/odyssey/SKILL\.md|CHANGELOG\.md|scripts/anchors\.lock\.json|docs/impl/00-INDEX\.md)$')"` — exit 0 (scope = exactly the declared Files plus the INDEX close-fill)

## Paired probe

RED: on the unmodified tree, both greps above return 0 — the routing table cannot name the
capability (its absence IS the red; the implementing run records both grep outputs). GREEN:
rows present; the two `head -N` diffs prove both files are append-only at their respective
seams; a manual read of the detail paragraph confirms the install story matches the npm facts
(version, license, own-LLM prerequisite) — no invented flags.

## What it breaks

Nothing at runtime — two docs gain additive rows. The honest cost is expectation: the row
advertises a capability the operator must install and configure (`ocr` + an LLM endpoint);
the row text itself carries that prerequisite, and the discovery tri-state handles the
not-installed case. Anchor exposure: SKILL.md pins `≥:41` (the appended table row shifts
everything below) and capabilities.md pins `≥:55` (matrix tail + detail sections shift by the
appended row + paragraph) — both inside the one mechanical re-baseline, fixed order.

## The class it closes

A best-in-class external capability exists and the router cannot see it. ZOdyssey reviews its
own runs (F2, consult) but has no routed answer for the user's own PRs in arbitrary target
repos — the routing table's purpose is exactly to make `metis`/triage name the best tool
instead of defaulting to generic in-session review (the study's "route, don't rebuild"
verdict; OCR's line-precise output + benchmarked precision-over-recall tuning is the
capability being routed, not rebuilt).

## Docs to update

- `README.md` — nothing (this is routing surface, not an enforcement primitive; the
  primitives table stays enforcement-only)
- `CHANGELOG.md` — Added entry (shape below)
- `docs/impl/00-INDEX.md` — row 30 outcome column at close

## CHANGELOG entry shape

```markdown
### Added
- Capability routing: "Review a PR / changeset line-by-line" now routes to the external
  `ocr` CLI (alibaba/open-code-review — Apache-2.0, npm `@alibaba-group/open-code-review`,
  own LLM config) when installed, with the invocation discipline (audience agent, output
  file, severity-grouped reporting) in capabilities.md. Routing-only: the enforcement
  pipeline (consult/F2/F4) keeps its existing binaries; a repo without `ocr` degrades to
  today's in-session review routes.
```

## Anchor-drift reconciliation

Fixed order (the repo's, `docs/impl/29-remediation-plan-contract.md:192`): write docs →
`node scripts/check-anchors.mjs` → fix each shifted citation at the source (verify content,
then repoint) → `node scripts/check-anchors.mjs --update` → suite. Declared exposure:
SKILL.md pins `≥:41` (row 28/29-era cites from `docs/DELEGATE-REVIEW.md` live in that band)
and capabilities.md pins `≥:55`. No consult.mjs / auditor-prompt.md / hook surface is touched.

## Capability routing

`generic: documentation-only row additions — no code surface; the implementing run
transcribes exactly this` (the external-skill quality gate at `SKILL.md:45` is satisfied
and stamped inside the row text: org, license, star count).

## Estimated size

S — ~30 lines across two docs + CHANGELOG + one anchor re-baseline (a handful of
SKILL.md/capabilities.md pins). One run; rides any release (its own if nothing else is
in flight). No code, no state, no hooks.
