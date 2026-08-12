# Development

This repo is the **source of truth** for ZOdyssey. The workflow is:

```
~/Desktop/ZOdyssey/  ←  edit here, branch, PR, merge, tag releases
        ↓ (on release)
~/.zcode/             ←  the ACTIVE install; upgrade via scripts/install.mjs
```

## Setup

```bash
git clone https://github.com/amartinawi/zodyssey.git ~/Desktop/ZOdyssey
cd ~/Desktop/ZOdyssey
git config --local user.name "Your Name"
git config --local user.email "your-handle@users.noreply.github.com"
```

Set the local git identity (don't rely on global) so commits are attributed correctly.

## The edit loop

1. Create a branch: `git checkout -b <type>/<slug>` (types: `fix/`, `feat/`, `docs/`, `refactor/`).
2. Edit. Syntax-check any `.mjs` you touch: `node --check path/to/file.mjs`.
3. Smoke-test the hook if you touched `pre-tool.mjs`:
   ```bash
   echo '{"tool_name":"Bash","tool_input":{"command":"echo hi"}}' | node skills/odyssey/hooks/pre-tool.mjs
   # should exit 0 (bash ungated by default)
   ```
4. Commit, push, open a PR, squash-merge.
5. Delete the branch post-merge: `gh pr merge <n> --squash --delete-branch`.

## Publishing a release

When main has accumulated enough changes:

1. Bump the version in **all three** files that declare it — they are read by different consumers and nothing else keeps them in sync:
   - `.zcode-plugin/plugin.json` — the LOADER (identity, namespace, hooks)
   - `marketplace.json` — the MARKETPLACE, when resolving what to install
   - `package.json` — npm / CI tooling
2. Update `CHANGELOG.md` with a new `## [0.x.0] — YYYY-MM-DD` entry (see Keep a Changelog format at the top).
3. `npm test` — `version-consistency.test.mjs` fails if any of the three disagree, or if the CHANGELOG has no entry for the version being shipped. v0.3.2 was tagged and released **uninstallable** because `marketplace.json` was missed: the marketplace serves what its own index advertises, so Update kept installing 0.3.1 no matter what the plugin manifest said.
4. Commit: `git commit -m "docs(changelog): v0.x.0"`.
5. Tag: `git tag v0.x.0 && git push origin v0.x.0`.
6. (Optional) `gh release create v0.x.0 --notes-from-tag`.
7. Upgrade the local install: **Settings → Plugin Management → Discover → Update on zodyssey** (a version bump needs the marketplace — `--sync-cache` only refreshes content *within* the registered version). Confirm with `node scripts/smoke-gate.mjs`.

## Upgrading the active install (~/.zcode)

When a release is published, upgrade the live install:

```bash
cd ~/Desktop/ZOdyssey
git pull origin main
node scripts/install.mjs            # idempotent — re-purges pollution, re-migrates config.json
                                   # hook orphans, refreshes the pipeline MCPs
```

Then refresh the **cached** plugin copy so manifest/hook/skill changes take effect: **Settings → Plugin Management → Discover → Update** on zodyssey (for the local `directory` marketplace this re-copies from the repo you just pulled). Start a new ZCode session.

The installer does **not** hand-write `installed_plugins.json` or `config.json` hooks (that was the v0.3.0 bug). The marketplace owns the cache + registry + manifest; the installer owns the surrounding user-scope config (MCPs, AGENTS.md, eval, legacy cleanup). Hooks are declared in `.zcode-plugin/plugin.json` under `hooks` (with `${CLAUDE_PLUGIN_ROOT}` paths), so they track the cache location automatically.

## Repository layout (what's load-bearing)

| Path | Role |
|---|---|
| `skills/odyssey/SKILL.md` | the conductor prompt (the orchestrator's brain) |
| `skills/odyssey/hooks/pre-tool.mjs` | the enforcement gate (the delta — code-enforces the review gate, scope, parallel cap, SEC-1..6, SEC-1s) |
| `skills/odyssey/scripts/` | trusted-writer scripts (scaffold, set-phase, record-*, compact, consult, etc.) |
| `skills/odyssey/references/` | load-on-demand docs (capabilities.md, scripts.md, auditor-prompt.md) |
| `agents/` | the 8 sub-agent definitions |
| `commands/` | the `/orchestrate` slash commands |
| `.zcode-plugin/plugin.json` | the plugin manifest — declares `hooks` (the 4 enforcement hooks, via `${CLAUDE_PLUGIN_ROOT}`) + plugin identity |
| `scripts/install.mjs` | the installer (marketplace bootstrap + purge + v0.3.0 hook-orphan migration + MCP registration + cached-vs-repo sha drift check) |
| `scripts/smoke-gate.mjs` | the release gate — automates every checkable part of "is enforcement live" and scaffolds the one manual live-session check |
| `docs/` | design + adaptation + measurement docs, plus `ROADMAP.md` (the evidence-ranked plan) |

## Testing

There is no `package.json` and no CI yet (both are Phase A in [`ROADMAP.md`](ROADMAP.md)). Run the
suites directly:

```bash
for t in skills/odyssey/scripts/*.test.mjs skills/odyssey/hooks/*.test.mjs; do node "$t" || echo "FAIL $t"; done
```

**The prove-it-fails rule.** A new enforcement test must be demonstrated *failing against the
broken code* before it counts. Stash the fix, run the suite, confirm it goes red, restore. Without
that step a test asserting `exit === 2` that silently never runs looks identical to a passing one —
and the repo's whole history is checks that couldn't detect the failure they existed for
(`--verify` checked paths not liveness; `harness.mjs --list` checked a sentinel that never matched;
F2/F4 checked that a reviewer was summoned, not what it said).

## When something breaks

- `git status` → is the working tree clean?
- `node --check <file>` → did you introduce a syntax error?
- `git log --oneline -5` → what changed recently?
- For hook weirdness: the hook disarms entirely if no active run exists in `<cwd>/.zcode/state/`. Check phase first.
- For install issues: `scripts/install.mjs --help` documents the flags.

## Conventions

- **Commits:** conventional-commit style — `fix(scope): ...`, `feat(scope): ...`, `docs: ...`. Look at `git log` for examples.
- **PRs:** squash-merge to main, delete the branch. One PR per logical change.
- **Security members (SEC-x):** never modify an existing member without an external audit. New members are ADDITIVE siblings (see SEC-1s as the template).
- **Backward-compat:** new state.json fields must be optional (`|| {}` everywhere). Old runs must still load.
