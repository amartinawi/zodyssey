---
description: Run a task through the ZOdyssey orchestration pipeline (triage → consult → plan → review → execute → verify → final wave). Use for non-trivial multi-step work. Trivial fixes don't need this — just ask normally.
argument-hint: "<task description>  |  resume <slug>  |  status <slug>"
skills: zodyssey:odyssey
---

Load the `zodyssey:odyssey` skill, then act as its conductor for this request:

```
$ARGUMENTS
```

**Modes (detected from the argument):**
- *Default* (a task description): run the full pipeline starting at **Phase -1 (prime)** — ALWAYS refine the prompt first, then triage, then the rest. If triage says `trivial`, tell the user to just ask normally and stop — do not orchestrate.
- `resume <slug>`: read `<repo>/.zcode/state/<slug>.json`, find the last checkpoint, and resume the pipeline from there (no re-priming).
- `status <slug>`: read the state file and report phase, review verdict, todos done/pending, and any active file locks — then stop (no execution).

**Phase -1 — Prime (your FIRST step, always, before anything else):**
Load `skill: prompt-master` and feed it the raw task. It returns a primed brief:
- intent + success criteria (what "done" looks like)
- implicit constraints (tech stack, files-not-to-touch, performance, timeline — surfaced)
- ambiguities → if any, ask the user via AskUserQuestion (max 3 questions) and WAIT before triaging
- a rewritten prompt that REPLACES the original for all downstream phases

Show the user the primed brief (briefly), then proceed to Phase 0 triage using the **primed** prompt, not the raw one. The whole point: every later phase (triage, Metis, planning) starts from a sharp, unambiguous brief instead of the raw request.

**Repo root:** the current workspace's project root (the repo you're in). All plan/state/notepad paths are relative to it under `.zcode/`.

**Before you start (default mode):** confirm the repo root is a git working tree you may modify. If `<repo>/.zcode/` doesn't exist yet, the scaffold script creates it. Follow the zodyssey:odyssey skill's state machine exactly — the enforcement hooks will block any shortcut (edits before plan-OKAY, file collisions, parallel overflow).
