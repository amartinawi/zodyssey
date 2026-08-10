# executing-plans capsule (for sub-agent dispatch)

Step 1 — Load and review: ensure an isolated workspace (use using-git-worktrees or verify the existing one); read the plan; review it critically and identify concerns; raise concerns before starting. If no concerns, create todos for the plan items.

Step 2 — Execute: for each task, mark it in_progress; follow each plan step exactly (the plan is bite-sized); run the verifications the plan specifies; mark it completed.

Step 3 — Complete development: after all tasks are complete and verified, run the finishing-a-development-branch skill to verify tests and execute the chosen finish option.

Must not: skip the critical review; deviate from plan steps; skip verifications; guess past an unclear instruction; start implementation on main/master without explicit user consent.

Stop and ask (do not guess) when: you hit a blocker (missing dependency, failing test, unclear instruction); the plan has a critical gap preventing start; you don't understand an instruction; verification fails repeatedly.

Revisit Step 1 (re-review) when: the partner updates the plan from your feedback; the fundamental approach needs rethinking. Don't force through blockers — stop and ask.
