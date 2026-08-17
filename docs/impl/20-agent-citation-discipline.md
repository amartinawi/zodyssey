# 20 — Agent citation discipline (ISNAD R5)

Build order **20** · depends-on **—** · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `20 agent-citation-discipline` · not security-class · minor
release.

This file is a complete, standalone brief. Verify anchors against the tree you are standing in —
line numbers derived 2026-08-17. Do exactly this one change.

## What is broken

Executor notepads and momus blockers are prose claims with no span requirement. The notepad is the
load-bearing handoff between fan-out executors (`skills/odyssey/SKILL.md`'s notepads-as-working-
memory section) and the raw input F1-F4 synthesize — yet nothing requires its factual claims to
cite what witnessed them. The auditor prompt already demands `file + what's wrong` per gap
(`references/auditor-prompt.md`); the agents inside the pipeline do not match their own auditor's
standard. This is the ISNAD R5 (tadlīs) fragment: *attribution without an exact span is
unverified* — never cite a document you have not read in this context.

**Paired probe:** none possible by design — this is a prompt-only tightening (a behavioral prior,
ISNAD Pattern A), the layer the study explicitly flags as advisory. Its enforcement twin already
exists elsewhere: notepad append-only integrity (B2), test-integrity guard (B3/F1),
record-verify's executed-criterion evidence.

## What fixed means

1. `agents/sisyphus-junior.md` — one rule appended to the outcome-first summary section: every
   factual claim in the notepad and final summary cites a `path:line` read or command output run
   **in this dispatch**; vague attribution is named as unverified by definition; "if you did not
   read it or run it, say that."
2. `agents/momus.md` — the REJECT blockers template gains: each blocker anchors to the plan text
   (path:line / section / todo id actually read); "a blocker you cannot anchor is an opinion, not
   a blocker."
3. `references/auditor-prompt.md` deliberately untouched — its gap format already names files, and
   AGENTS.md flags tuning that prompt as gate-tuning.

## Files

- `agents/sisyphus-junior.md` · `agents/momus.md`. Nothing else.

## Must NOT do

- Do not touch `references/auditor-prompt.md` or any hook/script — this is the prompt layer only.
- Do not add a verification agent or checker for citation format (no LLM layer; ROADMAP §3).
- Do not require citation format inside ASCII-boxed SKILL.md sections (width-sensitive).

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active
- **No argv flag authenticates anyone** — every script is invocable by any agent with the same argv
  surface the operator has. A flag can remove a *silent* path; it cannot grant authority.
- Fail closed. An unverifiable state blocks; it never passes.
- A repo-capability check degrades to a recorded `inert`, never to a block.

## Acceptance criteria

1. `node scripts/run-tests.mjs` — exit **0** (39/39; no code changed, suites must stay green).
2. `grep -c "ISNAD R5" agents/sisyphus-junior.md agents/momus.md` — both **≥ 1**.

### Failure-mode check (Step 6)

1. No lists added. 2. Nothing to detect — the change is a stated prior, and the brief says so
   rather than pretending a test covers it (the anti-ceremony stance of the repo's own A4 note).
3. It rides existing enforcement surfaces (notepad append-only, F1) rather than adding ceremony.
4. No self-grading introduced. 5. Cannot reopen its class: the rule tightens attribution; the
   enforcement twin lives in existing gates.

## Docs to update / CHANGELOG entry shape

Queue row 20 (this file). CHANGELOG at release: **Added — agent citation discipline (ISNAD R5)**:
executor notepads/summaries and momus blockers must cite the span that witnessed each claim;
prompt-layer advisory, enforcement unchanged.

## Capability routing

`generic: prompt-text-only change; no capability fits and none will be loaded`.

## Estimated size

~10 lines across two agent files + this brief.
