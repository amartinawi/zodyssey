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

As of v0.3.0 the installer is structured as **three explicit, independently re-runnable phases** (each safe to run alone), followed by the auxiliary registrations. Every path is derived from `os.homedir()` — no hardcoded `/home/...` or literal `~` anywhere, so the same script is portable across machines.

1. **Copy + register (phase 1).** `cpSync` the repo tree (`skills/`, `agents/`, `commands/`, `.zcode-plugin/`, `scripts/`, `docs/`, `README.md`, `CHANGELOG.md`, `LICENSE`) into the ZCode plugin cache at `~/.zcode/cli/plugins/cache/local/zodyssey/<version>/` (mirroring the `cache/<marketplace>/<name>/<version>/` layout used by `superpowers` and other plugins). It then upserts a `zodyssey@local` entry in `~/.zcode/cli/plugins/installed_plugins.json`, shaped like the existing entries (`{id, name, marketplace:"local", version, installPath, installedAt, updatedAt, scope:"user", source:"local"}`). Idempotent: if the entry already exists, `updatedAt` + `installPath` are refreshed; otherwise it is appended.
2. **Purge pre-v0.3.0 pollution (phase 2).** Removes the old top-level copies that pre-v0.3.0 installs left behind: `~/.zcode/skills/odyssey/`, the stale `~/.zcode/skills/odyssey.bak.1786309084/`, the 8 `~/.zcode/agents/*.md` (`metis`, `prometheus`, `momus`, `sisyphus-junior`, `explore`, `librarian`, `oracle`, `multimodal-looker`), and `~/.zcode/commands/orchestrate{,-consult}.md`. Each `rmSync` is guarded by `existsSync` and scoped to ZOdyssey-owned names only; absent entries are skipped silently. (Without this phase the old top-level copies would double-load with the cache copy.)
3. **Rewrite `config.json` hooks (phase 3).** Rewrites each of the 4 hook registrations in `~/.zcode/cli/config.json` so its `script:` points at the NEW cache path (`<cache>/skills/odyssey/hooks/<name>.mjs`). Your existing config is backed up to `config.json.zodyssey-backup` first.
4. **Registers 4 hooks** total (`PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit`) — the registration step within phase 3.
5. **Registers 5 pipeline MCPs** in `config.json`'s `mcp.servers`:
   - `memory` — cross-run knowledge graph
   - `sequential-thinking` — hard multi-step reasoning
   - `codegraph` — call-graph impact analysis for declared `Files:`
   - `chrome-devtools` — executable UI verification (F3)
   - `zai-mcp-server` — UI diff + error diagnosis (F3)

   Each is **gated on its backend being on PATH**. If the backend binary isn't installed, the MCP is **skipped with a warning** (and a hint) rather than writing a dead config entry that would error on every session. So on a fresh machine the installer registers the npx-backed MCPs immediately (they auto-install on first spawn) and prints install hints for `codegraph` and `zai-mcp-server`.
6. **Merges** the `<!-- ZODYSSEY_START -->…<!-- ZODYSSEY_END -->` block into `~/.zcode/AGENTS.md` (skips if already present).
7. **Inits** `~/.zcode/orchestration/eval/` with a `.gitkeep` and (if shipped) the eval seed.
8. **Detects the `superpowers` plugin** (source of most routed skills: `tdd`, `systematic-debugging`, `writing-plans`, `brainstorming`, `premortem`, etc.). If it's missing, prints a one-line pointer to [github.com/obra/superpowers](https://github.com/obra/superpowers). ZOdyssey works without it — you get the 3 shipped skill capsules (`tdd`, `debugging`, `executing-plans`) either way — but the conductor will reach for skills that aren't there until you install it.

> **Namespacing (v0.3.0):** every component is dispatchable under the `zodyssey:` namespace (derived from `plugin.json:name`). The conductor skill loads as `zodyssey:odyssey`; the agents dispatch as `zodyssey:metis`, `zodyssey:prometheus`, `zodyssey:momus`, `zodyssey:sisyphus-junior`, `zodyssey:explore`, `zodyssey:librarian`, `zodyssey:oracle`, `zodyssey:multimodal-looker`; the commands declare `skills: zodyssey:odyssey`. Component `name:` frontmatter stays bare — only the dispatch references are namespaced. See the [v0.3.0 CHANGELOG entry](../CHANGELOG.md#030---2026-08-11) for the migration note.

> The hooks are **NO-OP unless an orchestration run is active**. Installing ZOdyssey does not change how ZCode behaves for normal requests — the gate only arms when you run `/orchestrate`, and only inside the repo where you invoked it.

## Verify the install

The installer ships a built-in health check that covers everything it set up:

```bash
node scripts/install.mjs --verify
```

It checks, in order:

- **Node ≥18** on PATH
- Each **hook script** exists at the cache path + parses (`node --check`) + is registered in `config.json`
- Each **pipeline MCP** is registered in `config.json` AND its backend is on PATH (npx / codegraph / zai-mcp-server)
- The **`zodyssey@local` entry** is present in `installed_plugins.json` at the expected version, AND the **core skills + agents** are present under the plugin cache (`~/.zcode/cli/plugins/cache/local/zodyssey/<version>/`)
- **No pre-v0.3.0 pollution** remains (no top-level `~/.zcode/skills/odyssey/`)
- The **superpowers plugin** (optional, for routed skills)

Exit code is `0` when everything passes, `1` if any check fails — so `--verify` works in CI / install scripts. The output tells you exactly what's missing and how to fix it (which MCP to install, which command to re-run).

<details>
<summary>Manual checks (if you prefer to inspect by hand)</summary>

```bash
# hooks registered at the cache path?
node -e "const c=require(require('os').homedir()+'/.zcode/cli/config.json'); console.log(JSON.stringify(c.hooks.events.PreToolUse, null, 2))"
# each hook args[] should point at .../cache/local/zodyssey/<version>/skills/odyssey/hooks/pre-tool.mjs

# plugin registered?
node -e "const p=require(require('os').homedir()+'/.zcode/cli/plugins/installed_plugins.json').plugins.find(x=>x.id==='zodyssey@local'); console.log(p?.version, p?.installPath)"

# MCPs registered?
node -e "const c=require(require('os').homedir()+'/.zcode/cli/config.json'); console.log(Object.keys(c.mcp?.servers ?? {}).sort())"
# should include: chrome-devtools, codegraph, memory, sequential-thinking (+ zai-mcp-server if installed)

# agents + conductor skill in place under the cache?
ls ~/.zcode/cli/plugins/cache/local/zodyssey/*/agents/{metis,prometheus,momus,sisyphus-junior}.md
ls ~/.zcode/cli/plugins/cache/local/zodyssey/*/skills/odyssey/SKILL.md
```

</details>

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

It shouldn't — the gate has a trusted-script allowlist for the recorder scripts under the plugin cache (`.../cache/local/zodyssey/<version>/skills/odyssey/scripts/*`). If you moved the scripts, update the paths in the gate's `isTrustedScriptInvoke` check, or re-run the installer (which writes them to the cache location).

### "Phase transitions are stuck"

The phase-transition DAG (in `set-phase.mjs`) enforces legal transitions and rejects `--force` on `execute`/`done` (those would skip a gate). To recover a genuinely stuck run:
```bash
node ~/.zcode/cli/plugins/cache/local/zodyssey/*/skills/odyssey/scripts/set-phase.mjs <repo> <slug> blocked --force
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
node scripts/install.mjs   # idempotent — re-runs all 3 phases (refreshes the cache copy,
                           # re-purges any stale top-level pollution, rewrites hook paths)
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
