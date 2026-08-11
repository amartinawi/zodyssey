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

1. Update `CHANGELOG.md` with a new `## [0.x.0] — YYYY-MM-DD` entry (see Keep a Changelog format at the top).
2. Commit: `git commit -m "docs(changelog): v0.x.0"`.
3. Tag: `git tag v0.x.0 && git push origin v0.x.0`.
4. (Optional) `gh release create v0.x.0 --notes-from-tag`.

## Upgrading the active install (~/.zcode)

When a release is published, upgrade the live install:

```bash
cd ~/Desktop/ZOdyssey
git pull origin main
node scripts/install.mjs            # installs as a plugin under the ZCode cache; re-runs all 3 phases
```

The installer is idempotent — safe to re-run. It refreshes the cache copy, re-purges any stale pre-v0.3.0 top-level pollution, and rewrites the config.json hook paths to the cache.

## Repository layout (what's load-bearing)

| Path | Role |
|---|---|
| `skills/odyssey/SKILL.md` | the conductor prompt (the orchestrator's brain) |
| `skills/odyssey/hooks/pre-tool.mjs` | the enforcement gate (the delta — code-enforces the review gate, scope, parallel cap, SEC-1..6, SEC-1s) |
| `skills/odyssey/scripts/` | trusted-writer scripts (scaffold, set-phase, record-*, compact, consult, etc.) |
| `skills/odyssey/references/` | load-on-demand docs (capabilities.md, scripts.md, auditor-prompt.md) |
| `agents/` | the 8 sub-agent definitions |
| `commands/` | the `/orchestrate` slash commands |
| `scripts/install.mjs` | the installer (copy + register hooks) |
| `docs/` | design + adaptation + measurement docs |

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
