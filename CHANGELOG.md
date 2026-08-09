# Changelog

All notable changes to ZOdyssey are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
