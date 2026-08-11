# Installation & Configuration

## Quick start

```bash
git clone https://github.com/amartinawi/zodyssey.git
cd zodyssey
node scripts/install.mjs   # configures MCPs + AGENTS.md + purges old pollution
```

Then install the plugin itself via the ZCode marketplace (the marketplace owns the cache + the manifest, including the enforcement hooks):

> **Settings → Plugin Management → Discover → `+` → local directory →** `<path>/zodyssey` **→ click Get on zodyssey.**

Start a **new** ZCode session (hooks load at startup), `cd` into any repo, and run:

```
/orchestrate add a /healthz endpoint that returns 200
```

That's it. The installer is idempotent — re-run it after a `git pull` to refresh MCPs and purge stale state.

## What the installer does

As of v0.3.1 the split of responsibility is: **the ZCode marketplace owns the plugin** (cache copy, `installed_plugins.json` entry, and the manifest — including the enforcement hooks), and **this installer owns the surrounding user-scope configuration** (pipeline MCPs, the AGENTS.md block, eval dir, and cleanup of legacy state). The installer no longer hand-writes `installed_plugins.json` or `config.json` hooks — that was the v0.3.0 bug (the hand-written `marketplace:"local"` wasn't in `known_marketplaces.json`, and the hooks were written against a cache path the marketplace install later moved).

Every path is derived from `os.homedir()` — no hardcoded `/home/...` or literal `~` anywhere, so the same script is portable across machines.

1. **Marketplace bootstrap.** Verifies `marketplace.json` exists at the repo root and reports whether the plugin is marketplace-installed. If it isn't, prints the exact GUI steps (Discover → `+` → local directory → Get). The installer never hand-writes the marketplace registry.
2. **Purge pre-v0.3.0 pollution.** Removes the old top-level copies that pre-v0.3.0 installs left behind: `~/.zcode/skills/odyssey/`, the stale `~/.zcode/skills/odyssey.bak.1786309084/`, the 8 `~/.zcode/agents/*.md`, and `~/.zcode/commands/orchestrate{,-consult}.md`. Each `rmSync` is guarded by `existsSync` and scoped to ZOdyssey-owned names only; absent entries are skipped silently.
3. **Migrate v0.3.0 orphaned hooks out of `config.json`.** v0.3.0 wrote the 4 hooks into `~/.zcode/cli/config.json` against `cache/local/zodyssey/<ver>/`. When the v0.3.1 marketplace install cached the plugin at `cache/<marketplace>/zodyssey/<ver>/`, those entries orphaned and began failing on every tool call. v0.3.1 drives hooks from the manifest (via `${CLAUDE_PLUGIN_ROOT}`, resolved by ZCode to wherever the plugin is cached), so this step sweeps every ZOdyssey hook ref out of `config.json`. Your existing config is backed up to `config.json.zodyssey-backup-<ts>` first.
4. **Registers 5 pipeline MCPs** in `config.json`'s `mcp.servers`:
   - `memory` — cross-run knowledge graph
   - `sequential-thinking` — hard multi-step reasoning
   - `codegraph` — call-graph impact analysis for declared `Files:`
   - `chrome-devtools` — executable UI verification (F3)
   - `zai-mcp-server` — UI diff + error diagnosis (F3)

   Each is **gated on its backend being on PATH**. If the backend binary isn't installed, the MCP is **skipped with a warning** (and a hint) rather than writing a dead config entry that would error on every session. MCPs deliberately stay in `config.json` (not the manifest's `mcpServers`) because plugin-manifest MCPs are namespaced `plugin:zodyssey:<server>`, which would rename every tool the conductor references by its bare name. A `config.json` entry overrides the manifest base layer anyway, so any value you customize by hand wins.
5. **Hooks** — declared in `.zcode-plugin/plugin.json` under the `hooks` field, loaded automatically by ZCode. Plugin hooks **auto-enable the hook runner**, so no `config.json` surgery is required. `${CLAUDE_PLUGIN_ROOT}` resolves to the cache path, so the hooks can never orphan when the cache moves.
6. **Merges** the `<!-- ZODYSSEY_START -->…<!-- ZODYSSEY_END -->` block into `~/.zcode/AGENTS.md` (refreshes in place if already present).
7. **Inits** `~/.zcode/orchestration/eval/` with a `.gitkeep` and (if shipped) the eval seed.
8. **Detects the `superpowers` plugin** (source of most routed skills: `tdd`, `systematic-debugging`, `writing-plans`, `brainstorming`, `premortem`, etc.). If it's missing, prints a one-line pointer to [github.com/obra/superpowers](https://github.com/obra/superpowers). ZOdyssey works without it — you get the 3 shipped skill capsules (`tdd`, `debugging`, `executing-plans`) either way — but the conductor will reach for skills that aren't there until you install it.

> **Namespacing:** every component is dispatchable under the `zodyssey:` namespace (derived from `plugin.json:name`). The conductor skill loads as `zodyssey:odyssey`; the agents dispatch as `zodyssey:metis`, `zodyssey:prometheus`, `zodyssey:momus`, `zodyssey:sisyphus-junior`, `zodyssey:explore`, `zodyssey:librarian`, `zodyssey:oracle`, `zodyssey:multimodal-looker`; the commands declare `skills: zodyssey:odyssey`. Component `name:` frontmatter stays bare — only the dispatch references are namespaced.

> The hooks are **NO-OP unless an orchestration run is active**. Installing ZOdyssey does not change how ZCode behaves for normal requests — the gate only arms when you run `/orchestrate`, and only inside the repo where you invoked it.

## Verify the install

The installer ships a built-in health check:

```bash
node scripts/install.mjs --verify
```

It checks, in order:

- **Node ≥18** on PATH
- **Plugin is marketplace-installed**: an entry for `zodyssey` exists in `installed_plugins.json` (any marketplace), its `installPath` exists, and the cached manifest matches the repo's `name` + `version`
- The **manifest declares the 4 hook events** (`PreToolUse`, `PostToolUse`, `Stop`, `UserPromptSubmit`); each hook script resolves against the cached `installPath` (via `${CLAUDE_PLUGIN_ROOT}`) and parses (`node --check`)
- **Each deployed hook is byte-identical to the repo's** (sha256). Parsing at the cached path says nothing about *whose* code is there — a stale cache runs older logic while every other check stays green. This caught a real drift on the day it was added, with `--verify` otherwise reporting 18/18
- **No orphaned ZOdyssey hooks remain in `config.json`** — hooks are manifest-driven now; any `config.json` copy is pollution swept by the migrate step
- The **marketplace is registered** in `known_marketplaces.json`
- **No pre-v0.3.0 pollution** remains (no top-level `~/.zcode/skills/odyssey/`)
- Each **pipeline MCP** is registered in `config.json` AND its backend is on PATH (npx / codegraph / zai-mcp-server)
- The **superpowers plugin** (optional, for routed skills)

Exit code is `0` when everything passes, `1` if any check fails — so `--verify` works in CI / install scripts. The output tells you exactly what's missing and how to fix it (which MCP to install, which command to re-run, or that the cached copy is stale and needs a marketplace Update).

> **After a `git pull` that bumps the version**, `--verify` will report the cached manifest as stale until you re-Get the plugin via the marketplace (Discover → Update on zodyssey). That refreshes the cache copy — including the manifest hooks — from the repo source.

## Is enforcement actually live?

`--verify` answers "is the install well-formed". It cannot answer "does the gate fire" — and that
distinction is the whole v0.3.0 regression: every file was correct, the hooks were registered, and
`--verify` reported green while the enforcement chain was completely offline, because the
registered path pointed somewhere the marketplace install never populated.

```bash
node scripts/smoke-gate.mjs          # automated checks + scaffolds the live fixture
node scripts/smoke-gate.mjs --clean  # remove the fixture when done
```

**Automated** — registration and install path, manifest hook declarations, `${CLAUDE_PLUGIN_ROOT}`
usage (a baked-in literal path is flagged: it goes stale on the next version bump), cached-vs-repo
sha for all four hooks, no orphaned `config.json` hooks, and a direct-invoke probe confirming the
deployed hook blocks a pre-OKAY `Edit`, blocks write-capable `Bash`, and **allows** read-only Bash.
That last one matters: a hook that errors on every call blocks everything, which is indistinguishable
from working unless you check that legitimate calls still pass.

**Manual, and irreducible** — `/usr/bin/zcode` is a compiled binary. Whether ZCode substitutes
`${CLAUDE_PLUGIN_ROOT}` and honours the manifest `hooks` field for marketplace-installed plugins
cannot be determined by reading files, by this script, or by any external auditor. The script
scaffolds a repo at `/tmp/zodyssey-gate-smoke` with an active run held at `verdict: REJECT`:

1. Open a **new** ZCode session there (hooks load at session start)
2. Ask it to edit `src/foo.js` → **must be refused**, citing the review gate
3. Ask it to run `ls -la` → **must be allowed** (the control)
4. Flip the verdict to `OKAY`, edit `src/foo.js` → **allowed**
5. Edit `src/out-of-scope.js` → **refused**, scope violation

If step 1 succeeds, enforcement is offline and nothing else on the page matters. Steps 2 and 4
exist because only testing that the gate says *no* cannot distinguish enforcement from a crash.

<details>
<summary>Manual checks (if you prefer to inspect by hand)</summary>

```bash
# plugin registered + where?
node -e "const p=require(require('os').homedir()+'/.zcode/cli/plugins/installed_plugins.json').plugins.find(x=>x.name==='zodyssey'); console.log(p?.id, p?.version, '→', p?.installPath)"

# manifest declares hooks?
node -e "const m=require('./.zcode-plugin/plugin.json'); console.log(Object.keys(m.hooks||{}))"

# no orphaned zodyssey hooks in config.json? (should print nothing)
node -e "const c=require(require('os').homedir()+'/.zcode/cli/config.json'); for(const[k,arr]of Object.entries(c.hooks?.events??{}))for(const e of arr||[])for(const h of e?.hooks||[])if((h.args||[]).some(a=>typeof a==='string'&&a.includes('skills/odyssey/hooks/')))console.log('ORPHAN:',k,h.args)"

# MCPs registered?
node -e "const c=require(require('os').homedir()+'/.zcode/cli/config.json'); console.log(Object.keys(c.mcp?.servers ?? {}).filter(n=>['memory','sequential-thinking','codegraph','chrome-devtools','zai-mcp-server'].includes(n)).sort())"

# marketplace registered?
node -e "const m=require(require('os').homedir()+'/.zcode/cli/plugins/known_marketplaces.json').marketplaces.find(x=>x.id?.includes('zodyssey')); console.log(m?.id, m?.source)"
```

</details>

## Uninstall

```bash
node scripts/install.mjs --uninstall
```

Removes any ZOdyssey hook refs + the 5 pipeline MCPs from `config.json`, the AGENTS.md block, and any pre-v0.3.0 top-level pollution. Then GUI-uninstall the plugin itself: **Settings → Plugin Management → Installed → zodyssey → Uninstall** (the marketplace owns the cache copy + `installed_plugins.json` entry). Run records under `<repo>/.zcode/` are left in place — delete those manually if you want a clean slate.

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

It shouldn't — the gate has a trusted-script allowlist for the recorder scripts under the plugin cache (`.../cache/<marketplace>/zodyssey/<version>/skills/odyssey/scripts/*`, resolved via the plugin root at runtime). If you moved the scripts, update the paths in the gate's `isTrustedScriptInvoke` check, or re-Get the plugin via the marketplace (which rewrites the cache location).

### "Phase transitions are stuck"

The phase-transition DAG (in `set-phase.mjs`) enforces legal transitions and rejects `--force` on `execute`/`done` (those would skip a gate). To recover a genuinely stuck run:
```bash
node ~/.zcode/cli/plugins/cache/*/zodyssey/*/skills/odyssey/scripts/set-phase.mjs <repo> <slug> blocked --force
# then resume forward through the gate normally
/orchestrate resume <slug>
```

### "Config.json got mangled"

The installer writes a timestamped backup to `~/.zcode/cli/config.json.zodyssey-backup-<ts>` before its first write to config.json in a run (the migrate + MCP steps). Find the most recent one and restore with:
```bash
cp ~/.zcode/cli/config.json.zodyssey-backup-* ~/.zcode/cli/config.json   # pick the right timestamp
```

## Updating

Two things update on a new release — the repo source, and the cached plugin copy:

```bash
cd zodyssey          # wherever you cloned it
git pull
node scripts/install.mjs   # idempotent — re-purges stale pollution, re-migrates any
                           # config.json hook orphans, refreshes the pipeline MCPs
```

Then refresh the **cached** plugin copy so the new manifest (hooks included) takes effect: **Settings → Plugin Management → Discover → Update** on zodyssey (for a `directory` marketplace this re-copies from the repo you just pulled). Start a new ZCode session to pick up the new hooks.

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
