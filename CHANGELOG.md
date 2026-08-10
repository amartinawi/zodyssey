# Changelog

All notable changes to ZOdyssey are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.2] — 2026-08-10

Public-default security fix. Restores the Bash write-gate that v0.1.1's verbatim mirror had deleted, so the public repo ships with the "secure by default" posture the README advertises.

### Fixed
- **Bash write-gate restored in the public copy.** v0.1.1 mirrored the installed hook verbatim, which had `if (isBash) exit(0);` — the gate deleted outright (the original author's personal `ZODYSSEY_UNGATE_BASH=1` setup, accepted locally 2026-08-08). That made the public README's "Secure by default; `ZODYSSEY_UNGATE_BASH=1` disables" claim false: v0.1.1 shipped an insecure default to other users. The full v0.1.0 Bash-gate logic is now back in `hooks/pre-tool.mjs` (escape hatch + `isTrustedScriptInvoke` allowlist + OKAY-verdict gate + plan-sha tamper guard + per-target scope check). Users who want the ungated behavior set `ZODYSSEY_UNGATE_BASH=1` in their environment — identical runtime effect, honest default for everyone else.

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
