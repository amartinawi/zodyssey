You are a senior security/correctness auditor. Conduct a DEEP, ADVERSARIAL audit of the ZOdyssey orchestration system. Assume there are more bugs than have been found — your job is to find them. Do not re-discover the known issues listed below; go deeper and look for the unknown ones.

# What ZOdyssey is
A multi-agent orchestration pipeline for the ZCode harness. Phases: Prime→Triage→Consult→Plan→Review→Execute→Verify→Final→Done. An enforcement hook gates every tool call (Write/Edit/Bash/Task) against the active run's phase + verdict + scope + file-locks + parallel-cap. "Trusted writer" scripts are the sanctioned escape hatches that mutate run state. The core security property: an OKAY review verdict is NON-FORGEABLE — it requires a nonce the hook mints only when it witnesses a real Task(momus) dispatch, bound through an artifact under a gated directory.

# Where everything lives (read these)
- Skill (conductor's instructions): ~/.zcode/skills/odyssey/SKILL.md
- Enforcement hook (the gate — most bug-dense file): ~/.zcode/skills/odyssey/hooks/pre-tool.mjs
- Other hooks: ~/.zcode/skills/odyssey/hooks/{stop,post-tool}.mjs
- Trusted-writer scripts: ~/.zcode/skills/odyssey/scripts/*.mjs  (scaffold, set-phase, record-review, record-momus-artifact, record-final-wave, record-verify, record-todo, record-capability, parse-plan, consult, run-report, harness, judge, status, resolve-capabilities, recall-outcomes)
- Auditor prompt template: ~/.zcode/skills/odyssey/references/auditor-prompt.md
- Harness config: ~/.zcode/cli/config.json
- Per-run state shape: any <repo>/.zcode/state/<slug>.json

# Known-open issues (DO NOT re-report these — build on them, look past them)
1. No sanctioned recorder for F2/F4 final-wave artifacts under .zcode/reviews/ (record-momus-artifact is hardcoded to the review-lane nonce). record-final-wave --skip F2,F4 is the workaround.
2. --note "<text>" is unusable on any pre-verdict trusted script because " is in isTrustedScriptInvoke's metachar denylist. Bare-argv calls work; quoted --note doesn't.
3. status.mjs is neither in TRUSTED_SCRIPTS nor read-only-classified → blocked in the exact stuck states where diagnosis is most needed.
4. No prometheus agent registered in this env → orchestrator writes the plan directly → the plan→review transition is easy to skip (this was the trigger for the nonce-phase-coupling bug, now fixed).
5. The catch-22: the gate blocks edits to the hook file while a run's verdict=null, and there is no recoverable in-run escape (only abandon→manual-rewrite→resume, or external rm).
6. Recently fixed (verify the fix is complete/correct, don't re-find): (a) findActiveRun now recursively discovers nested-repo .zcode/state dirs; (b) classifyTarget now classifies bookkeeping against the run's repo dir, not only PROJECT_DIR; (c) the review/F2/F4 nonce mints were decoupled from the phase condition and now mint on dispatch regardless of phase + emit a warning.

# NEWLY FOUND 2026-08-03 (deep-adversarial-audit-of-odyssey run — VERIFY these are fixed before going deeper; the full report is at ~/.zcode/.zcode/notepads/deep-adversarial-audit-of-odyssey/findings.md)
7. record-final-wave.mjs:36 — the `--f4-artifact` branch assigns to `f4Nonce` (wrong var); the real F4 handler at :38 is DEAD → F4 only works via --skip. Verify the wrong-var is gone.
8. F2/F4 nonces are minted (pre-tool.mjs:646,654 into state.final_f2/final_f4) but NEVER consumed (grep-proven: zero readers) → a lifted nonce is infinitely reusable. The review lane (record-momus-artifact.mjs:101 does `delete`) is sound; the FINAL lane is theatre. Verify a consume+delete analog now exists in record-final-wave.mjs.
9. Non-git F1: git diff throws into a bare `catch {}` (record-final-wave.mjs:83,85) → `actual=[]` → `outOfScope=[]` → F1 passes vacuously. Combined with --skip F2,F4 + any non-empty F3 → final.verdict=pass with NO evidence. (The REVIEW-lane OKAY is still required by set-phase.mjs:81, so this is a FINAL-lane hole, not a review-lane hole.) Verify F1 fails-closed on non-git instead of passing vacuously.
10. record-verify.mjs:38 — records the agent's CLAIMED `--exit-code`, never runs `--criterion`; the header-promised record-todo.mjs guard DOES NOT EXIST; state.verify is written but never read as a gate. Verify the criterion is now executed (or a verify precondition gates done).
11. set-phase.mjs:99-104 — `done --force` bypasses the final.verdict precondition; done is TERMINAL → disarms all hooks. The DAG check (:93) does NOT save it (final→done is a valid transition). Verify --force can no longer target done.
12. pre-tool.mjs:516 — metachar denylist omits `\r` (and `\t`, `'`, bare parens). `\r` enables second-command injection through the trusted-writer gate (the hook sees clean argv[1], /bin/sh splits on \r). This is the BROADER bypass of which known-issue #2 is the false-positive symptom. Verify the denylist became an allowlist.
13. post-tool.mjs:39-58 + stop.mjs:40-64 — findActiveRun is FLAT (no DFS); known-issue #6a was fixed in pre-tool.mjs only. Nested-repo runs: parallel-cap ledger never drains (30-min stall), resume checkpoint never written. Verify findActiveRun was extracted to a shared module.
14. WRITE_PATTERNS (pre-tool.mjs:61-87) false-negatives: bare `git stash` (only stash pop/drop caught), `git merge/pull/fetch/branch/tag/checkout<branch>`, `tar`, `unzip`, `gcc -o`, `make`, `docker run -v` all slip pre-verdict. Verify the git check was inverted to a safe-verb allowlist.
15. File-lock owner (pre-tool.mjs:421) collapses to session_id — agent_id is ABSENT in this harness's payload (proven by a live payload-probe). Parallel executors on a shared file don't serialize (MEDIUM — requires plan-level file-overlap, not the default case). Verify the owner key uses tool_use_id or the orchestrator passes distinct agent_id.
16. TRANSITIONS (set-phase.mjs:64-74) has no keys for abandoned/blocked → unrecoverable DAG dead-ends; --force does NOT help (the DAG check :93 runs before the --force branch :99). Verify abandoned/blocked now have re-entry edges.
17. CLAUDE_CLI (consult.mjs:339, judge.mjs:109) is taken raw, unvalidated, despite SKILL.md:285 claiming "all validated". Verify it's validated or the SKILL.md claim is corrected.

# Adversarial questions — answer each with concrete evidence (file:line)

## A. Security property — non-forgeability of an OKAY verdict
- Can an agent self-mint a review nonce without a real Task(momus) dispatch? Enumerate every path that writes state.review.pending_nonce and prove each is gated.
- Can an agent forge the momus artifact under .zcode/reviews/? The dir is gated (non-bookkeeping) — but is the gate's path classification correct for symlinks, .. traversal, case-insensitive FS, non-UTF8 paths?
- record-review.mjs binds the artifact + plan-sha + verdict. Are all three checks sound? Can any be satisfied with stale/reused inputs (e.g., a nonce from a previous round, a plan-sha from before an edit)?
- The TRUSTED_SCRIPTS allowlist: is every script in it safe to run pre-verdict? Specifically, can any of them write state.json review.verdict, mint a nonce, or transition to execute? (resolve-capabilities, parse-plan, run-report, status — are they truly read-only?)
- isTrustedScriptInvoke's metachar denylist: list every shell metachar it blocks, then find a bypass (process substitution, brace expansion, IFS, locales, unicode lookalikes). What's the minimal command that writes a file but passes the check?

## B. Phase DAG + state machine
- Read the TRANSITIONS map in set-phase.mjs. Are there unreachable phases, dead-ends (like abandoned), or missing edges? For each phase, is there a sanctioned path OUT for every realistic stuck condition?
- The preconditions (execute needs verdict===OKAY; done needs final.verdict===pass): are they complete? Can any phase be entered with an inconsistent state (e.g., execute with round=0)?
- Can a run get permanently stuck in {review, final, remediate} with no recovery? Enumerate every (phase, verdict) pair and the recovery for each.

## C. The gate logic (pre-tool.mjs) — correctness + false positives/negatives
- classifyTarget: re-verify the run-repo-relative + PROJECT_DIR-relative classification for: nested repos (2+ levels deep), symlinks inside/outside the repo, paths with .., absolute paths, paths on a different mount.
- findActiveRun: the recursive DFS — can it loop on symlink cycles (seen-set uses realpath, but is realpathSync.native enough)? What's the worst-case cost on a huge PROJECT_DIR? Can a permission-locked dir make readdirSync throw and crash the hook (uncaught → what does the harness do)?
- looksReadOnly + WRITE_PATTERNS: find a destructive Bash command that classifies as read-only (false negative) AND a read-only command that gets gated (false positive). The trusted-script escape is one vector; what are the others?
- The file-lock logic (W7-1): owner = agent_id || session_id. If agent_id is absent (it is, per the payload-probe), do parallel executors sharing a session_id deadlock or clobber? Can a lock be held forever (TTL reaping sound)?
- The parallel-cap ledger: race conditions between concurrent hook invocations writing the inflight.json?

## D. Trusted-writer scripts (each is a bypass surface)
For every script in TRUSTED_SCRIPTS: what can it write, what does it validate, and what's the minimal argv that does something dangerous? Specifically audit:
- record-final-wave.mjs: the F1 set-difference is machine-checked, but F2/F4 are nonce-bound artifacts — with the --skip flag, can a run reach done without any real review?
- record-todo.mjs / record-verify.mjs: can they be driven to mark a todo verified without the criterion actually passing?
- consult.mjs: it spawns an external claude CLI with the repo diff. Re-check the secret-redaction (SECRET_PATH_RE), the prompt-size cap, and whether a poisoned diff can steer the verdict (the prompt frames the diff as DATA — is that framing robust?).
- set-phase.mjs --force: documented as an escape hatch. Enumerate exactly which transitions --force permits and prove none can skip the review gate into execute/done.

## E. Concurrency + partial failure
- Two executors edit different files in the same run: does the file-lock + state-merge logic hold? Read the re-read-after-lock pattern (W5-H3) — is it correct under 4-way parallel?
- A trusted-script write crashes mid-rename (tmp file left): does the next call recover or deadlock?
- The hook spawns per tool call; if two tool calls race (same turn, parallel), can state.json be corrupted (last-writer-wins vs atomic-rename)?

## F. Eval harness integrity
- harness.mjs fresh-copies a repo and drives a run. Can a run fake success (reach done) without real work? The success flag is derived from state.final.verdict — is that derivable from forgeable inputs?
- judge.mjs uses an external LLM. Is the prompt injection-resistant given it ingests untrusted repo content?

## G. Consistency drift
- Does SKILL.md match what the hooks/scripts actually enforce? Find every prose instruction in the skill that has NO code-level enforcement (like the old "set state.phase = review after planner returns"). Each is a latent bug.
- Are there code paths the skill never describes (undocumented escape hatches, debug flags, env-var overrides like ZODYSSEY_PARALLEL_CAP / ZODYSSEY_STALE_HOURS / CLAUDE_CLI)?

# Output format (MANDATORY — return ONLY this, no preamble)
A prioritized finding list as one markdown document:

## Findings (severity-ranked)
For each finding:
### [SEVERITY] short title
- **Layer:** hook | script:<name> | skill | dag | eval | config
- **Location:** file:line (or "skill §<section>")
- **Class:** security-bypass | correctness-bug | deadlock | false-positive-gate | false-negative-gate | drift | robustness
- **Claim:** one sentence.
- **Evidence:** the exact code + a concrete trigger (command/sequence that demonstrates it).
- **Impact:** what breaks / what an agent could do.
- **Fix:** concrete patch (diff or precise instruction).
- **Confidence:** high | medium | low (and what would raise/lower it).

Severity scale: CRITICAL (forgeable verdict / silent data loss / permanent deadlock), HIGH (run lost / gate bypass / security weakening), MEDIUM (recovery friction / false gate), LOW (quality/drift).

## Verdict on the security property
One paragraph: is an OKAY verdict non-forgeable given the current code? If not, the minimal attack.

## What I could NOT verify
Honest list of things the code made un-auditable from static review (needs runtime, needs a specific env, needs a real run).

Rules:
- Zero nitpicks. Only real findings where something breaks or the property weakens.
- If you cannot confirm a claim, say "low confidence" and why — do not inflate.
- Prefer 5 deep, proven findings over 30 shallow ones.
- Read the actual files. Cite real line numbers. Do not trust the skill's description of the code — verify it.
