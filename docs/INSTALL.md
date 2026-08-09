# Installation & Configuration

## Quick start

```bash
git clone https://github.com/amartinawi/zodyssey.git
cd zodyssey
node scripts/install.mjs
```

Start a **new** ZCode session (hooks load at startup), `cd` into any repo, and run:

```
/orchestrate add a /healthz endpoint that returns 200
```

That's it. The installer is idempotent — re-run it after a `git pull` to update.

## What the installer does

1. **Copies** `skills/odyssey/`, `agents/*.md`, `commands/*.md` into `~/.zcode/`.
2. **Registers** 3 hooks (`PreToolUse`, `PostToolUse`, `Stop`) in `~/.zcode/cli/config.json`. It backs up your existing config to `config.json.zodyssey-backup` first.
3. **Merges** the `<!-- ZODYSSEY_START -->…<!-- ZODYSSEY_END -->` block into `~/.zcode/AGENTS.md` (skips if already present).
4. **Inits** `~/.zcode/orchestration/eval/` with a `.gitkeep` and (if shipped) the eval seed.

> The hooks are **NO-OP unless an orchestration run is active**. Installing ZOdyssey does not change how ZCode behaves for normal requests — the gate only arms when you run `/orchestrate`, and only inside the repo where you invoked it.

## Verify the install

```bash
# hooks registered?
node -e "const c=require(require('os').homedir()+'/.zcode/cli/config.json'); console.log(JSON.stringify(c.hooks.events.PreToolUse, null, 2))"
# should show a hook pointing at ~/.zcode/skills/odyssey/hooks/pre-tool.mjs

# agents in place?
ls ~/.zcode/agents/{metis,prometheus,momus,sisyphus-junior}.md

# conductor skill in place?
ls ~/.zcode/skills/odyssey/SKILL.md
```

## Uninstall

```bash
node scripts/install.mjs --uninstall
```

Removes the hooks from `config.json`, the AGENTS.md block, and the copied files. Run records under `<repo>/.zcode/` are left in place — delete those manually if you want a clean slate.

## Dry run

```bash
node scripts/install.mjs --dry-run
```

Prints every action it would take without changing anything. Useful to preview before a first install.

## Configuration (environment variables)

All optional. Set in your shell profile (`~/.bashrc` / `~/.zshrc`) or per-session.

| Variable | Default | Purpose |
|---|---|---|
| `ZODYSSEY_PARALLEL_CAP` | `4` | Max in-flight `Task` dispatches during execute. Raise for beefy machines; lower if you hit rate limits. |
| `ZODYSSEY_STALE_HOURS` | `24` | Hours after which an unfinished run is treated as abandoned (hooks disarm). Lower if you iterate fast. |
| `ZODYSSEY_UNGATE_BASH` | (unset) | **Secure-by-default.** Set to `1` to let ALL Bash calls bypass the review gate + scope check (the original author's personal low-friction setup). Know the tradeoff: ungated Bash lets any agent mutate any file regardless of review verdict. |
| `ZODYSSEY_DEBUG` | (unset) | Set to `1` to write a one-time payload probe per run (for diagnosing owner-identity / lock-attribution issues). |
| `ZODYSSEY_NO_FIND_CACHE` | (unset) | Set to `1` to disable the active-run discovery cache (debugging only — makes every hook call do a fresh DFS). |
| `CLAUDE_CLI` | `claude` | Path to the Claude CLI binary used by `/orchestrate-consult` for the external audit. |

## Troubleshooting

### "The hooks aren't firing / `ZODYSSEY_BLOCK` never appears"

The hooks only arm when a run is **active** — i.e. there is a `<cwd>/.zcode/state/<slug>.json` with a non-terminal phase, not stale. Check:
- Did you run `/orchestrate` in *this* repo, in *this* session?
- Is the run stale? (`updated_at` older than `ZODYSSEY_STALE_HOURS`).
- Did you start a new session after install? (Hooks load at session start.)
- Is `~/.zcode/cli/config.json` valid JSON? A malformed config silently disables all hooks.

### "Every edit is blocked with `SCOPE VIOLATION` after OKAY"

That is the scope-isolation boundary working as designed. The plan's `Files:` union governs what an executor may touch. To edit a file, it must be listed in a todo's `Files:`. Re-run `momus` + `record-review` if you need to widen scope (re-binding the plan-sha). If a plan genuinely edits no files, the executor simply won't issue a Write — a Write to product code when zero files are declared is definitionally out of scope.

### "The gate blocks my recorder scripts (set-phase, record-review, …)"

It shouldn't — the gate has a trusted-script allowlist for `~/.zcode/skills/odyssey/scripts/*`. If you moved the scripts, update the paths in the gate's `isTrustedScriptInvoke` check, or re-run the installer (which copies them to the expected location).

### "Phase transitions are stuck"

The phase-transition DAG (in `set-phase.mjs`) enforces legal transitions and rejects `--force` on `execute`/`done` (those would skip a gate). To recover a genuinely stuck run:
```bash
node ~/.zcode/skills/odyssey/scripts/set-phase.mjs <repo> <slug> blocked --force
# then resume forward through the gate normally
/orchestrate resume <slug>
```

### "Config.json got mangled"

The installer writes a backup to `~/.zcode/cli/config.json.zodyssey-backup` before every change. Restore with:
```bash
cp ~/.zcode/cli/config.json.zodyssey-backup ~/.zcode/cli/config.json
```

## Updating

```bash
cd zodyssey          # wherever you cloned it
git pull
node scripts/install.mjs   # idempotent — overwrites the installed copies
```

Start a new ZCode session to pick up the new hooks.

## Where state lives (per repo)

Run artifacts are scoped to the repo where you run `/orchestrate`, under `<repo>/.zcode/`:

| Path | Contents |
|---|---|
| `plans/<slug>.md` | the plan (the contract) |
| `state/<slug>.json` | phase, review verdict, locks, progress |
| `notepads/<slug>/<todo>.md` | per-task findings, forwarded to later todos |
| `memory/outcomes.jsonl` | cross-run outcome memory (lessons that survive one task) |

The cross-run eval ledger (optional, for the harness) lives globally at `~/.zcode/orchestration/eval/results.jsonl`. Everything else is per-repo.

## Node version

The hooks and scripts are ESM (`.mjs`) and use `cpSync` (Node 16.7+). **Node 18+ recommended.** Check with `node --version`.
