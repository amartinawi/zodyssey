# AGENTS.md — ZOdyssey

This repo is the **source of truth** for the [ZOdyssey](https://github.com/amartinawi/zodyssey) ZCode plugin — a hybrid-enforced multi-agent orchestration pipeline (prime → triage → consult → plan → review → execute → verify → final-wave). The delta vs. other orchestrators is a **code-enforced review gate + scope isolation**; everything else is the pipeline shape.

Read [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) first — it is the authoritative dev-loop doc. This file is the cheat sheet.

## Two installs — know which one is live

- **This dir (`~/Desktop/ZOdyssey/`)** is where you edit, branch, and PR.
- **The active install** is marketplace-owned, cached at `~/.zcode/cli/plugins/cache/<marketplace>/zodyssey/<version>/` (the `<marketplace>` segment comes from `marketplace.json` — e.g. `zodyssey-local`). Edits here do **not** take effect until you **re-Get/Update the plugin via Settings → Plugin Management → Discover** (which re-caches from this dir, including the manifest-declared hooks) **and** start a new ZCode session. `node scripts/install.mjs` only configures surrounding user-scope state (MCPs, AGENTS.md, purge, v0.3.0 hook-orphan migration) — it does **not** touch the cache (exception: `--sync-cache` refreshes content inside the registered version's cache dir), `installed_plugins.json`, or the hooks (all manifest-driven now).
- Run artifacts (state, plans, notepads) are per-repo under `<repo>/.zcode/` and are gitignored — never commit them.

## Build / test / verify (package.json present, no build step)

Everything is ESM `.mjs` (Node ≥18). There is no transpile, no lint config, but there is a central test runner: `scripts/run-tests.mjs` (`npm test`).

- **Syntax-check anything you touch:** `node --check path/to/file.mjs`
- **Tests are per-file, run directly** (exit 0 = pass, 1 = fail). Run the test(s) relevant to your change:
  - `node skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` — **run this after every `pre-tool.mjs` edit** (see below).
  - `node skills/odyssey/scripts/<name>.test.mjs` — parser/recorder/coverage/etc. unit tests.
- **Hook smoke test:** `echo '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}' | node skills/odyssey/hooks/pre-tool.mjs` (should exit 0).
- **Install health check:** `node scripts/install.mjs --verify` (CI-friendly; exit 0/1).
- **Installer dry run:** `node scripts/install.mjs --dry-run`.

## Load-bearing paths (touch with care)

| Path | Role |
|---|---|
| `skills/odyssey/SKILL.md` | the conductor prompt (orchestrator's brain + state machine) |
| `skills/odyssey/hooks/pre-tool.mjs` | **the enforcement gate** — review gate, scope isolation, parallel cap, all `SEC-*` members. The whole point of the project. |
| `skills/odyssey/hooks/{post-tool,stop,user-prompt-submit}.mjs` | the other 3 hooks |
| `skills/odyssey/scripts/` | trusted-writer scripts (`scaffold`, `set-phase`, `record-*`, `compact`, `consult`…). Full signatures in `skills/odyssey/references/scripts.md`. |
| `skills/odyssey/references/` | load-on-demand docs (`capabilities.md`, `scripts.md`, `auditor-prompt.md`) |
| `agents/` | 8 sub-agent definitions (`metis`, `prometheus`, `momus`, `sisyphus-junior`, `explore`, `librarian`, `oracle`, `multimodal-looker`) |
| `commands/` | `/orchestrate` + `/orchestrate-consult` slash commands |
| `scripts/install.mjs` | the installer (3 explicit phases — see `docs/INSTALL.md`) |
| `docs/DESIGN.md` | the enforcement principle, plan contract, state model |

## Conventions that will bite you if ignored

- **Conventional commits** (`fix(scope): …`, `feat(scope): …`, `docs: …`). One logical change per PR, squash-merge to `main`, delete the branch. Branch types: `fix/`, `feat/`, `docs/`, `refactor/`.
- **`SEC-*` security members are append-only.** Never modify an existing `SEC-x` block in `pre-tool.mjs`; new checks are **additive siblings** (use `SEC-1s` as the template). Modifying an existing member requires an external audit.
- **The Bash write-gate has been deleted twice** (v0.1.1 and v0.2.0). `pre-tool.bash-gate.test.mjs` exists specifically to catch a third deletion — its header explains why. Do not short-circuit `if (isBash) exit(0)` and always run that test after touching the hook.
- **Backward-compat `state.json`:** any new field must be optional (`|| {}` everywhere). Old runs must still load.
- **Trusted-script allowlist:** the gate allows `node …/skills/odyssey/scripts/*` to bypass the review gate. If you move scripts, update `isTrustedScriptInvoke` in `pre-tool.mjs` (and re-run the installer, which writes the cache paths).
- **Namespace vs. `name:`:** components dispatch under the `zodyssey:` prefix (`Task(subagent_type: "zodyssey:metis")`, `skills: zodyssey:odyssey`), but the `name:` frontmatter inside each file stays **bare**. The plugin loader adds the namespace; do not hard-code it into `name:`.
- **Hooks are NO-OP unless a run is active** — a run is active only when `<cwd>/.zcode/state/<slug>.json` exists with a non-terminal, non-stale phase. Normal editing in this repo is never blocked, so you cannot reproduce a gate block without first running `/orchestrate` somewhere.

## Read before changing sensitive areas

- **The gate (`pre-tool.mjs`):** also read `docs/DESIGN.md` (enforcement principle) and the bash-gate regression-test header.
- **The installer (`scripts/install.mjs`):** also read `docs/INSTALL.md` (marketplace bootstrap → purge → v0.3.0 hook-orphan migration → MCP registration; hooks are manifest-driven, not in config.json).
- **Pipeline logic / conductor:** `skills/odyssey/SKILL.md` + `skills/odyssey/references/scripts.md` + `docs/DESIGN.md`.
- **Agents:** `agents/README.md` (the porting map from `oh-my-openagent`; explains why each agent's prompt is shaped the way it is).
- **Releasing:** the "Publishing a release" + "Upgrading the active install" sections of `docs/DEVELOPMENT.md` (CHANGELOG → tag → `install.mjs`).
