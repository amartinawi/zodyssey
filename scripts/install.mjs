#!/usr/bin/env node
// ZOdyssey installer — marketplace-driven plugin installer + post-install configurator.
//
// As of v0.3.1 the plugin itself is installed via the ZCode marketplace subsystem
// (Settings → Plugin Management → Discover → add this repo as a local directory →
// Get). The marketplace owns the cache copy + the installed_plugins.json entry +
// the plugin's hook/MCP manifest. This script does NOT hand-write those registries
// (hand-writing installed_plugins.json with marketplace:"local" was the v0.3.0 bug:
// "local" wasn't in known_marketplaces.json so the loader skipped the plugin while
// the hooks — written into config.json against a now-stale cache path — orphaned).
//
// What this installer DOES (all idempotent, all safe to re-run):
//   1. BOOTSTRAP  — verify marketplace.json exists at the repo root; report whether
//      the plugin is marketplace-installed and, if not, print the exact GUI steps.
//   2. PURGE      — remove pre-v0.3.0 top-level pollution (~/.zcode/skills|agents|commands).
//   3. MIGRATE    — remove any v0.3.0-era ZOdyssey hook registrations from
//      ~/.zcode/cli/config.json (hooks are now manifest-driven; config.json copies
//      are orphans that would keep firing-and-failing against dead cache paths).
//   4. MCPs       — register the 5 pipeline MCPs into config.json's mcp.servers
//      (gated on each backend being on PATH). MCPs stay in config.json because
//      plugin-manifest MCPs are namespaced `plugin:zodyssey:<server>`, which would
//      rename every tool the conductor references by its bare name.
//   5. AGENTS.md  — merge the ZODYSSEY orchestration block into ~/.zcode/AGENTS.md.
//   6. EVAL DIR   — init ~/.zcode/orchestration/eval/ (seed + .gitkeep).
//   7. SUPERPOWERS — detect the optional superpowers plugin; print a hint if missing.
//
// Usage:
//   node scripts/install.mjs                      # run all steps (default)
//   node scripts/install.mjs --uninstall          # remove ZOdyssey config (marketplace uninstall via GUI)
//   node scripts/install.mjs --dry-run            # show what would happen, change nothing
//   node scripts/install.mjs --verify             # health-check the install
//   node scripts/install.mjs --sync-cache         # copy this tree into the plugin cache (what actually executes)
//
// All paths derive from os.homedir() and the repo's own .zcode-plugin/plugin.json
// version field — ZERO hard-coded /home/... or literal "~" paths.
//
// Hooks are NO-OP unless an orchestration run is active, so installing this does
// NOT change normal ZCode behavior. The gate only arms when you run /orchestrate.

import { existsSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { argv, exit } from "node:process";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// ---------- paths (all derived from homedir + repo location) ----------

const ZCODE_DIR = join(homedir(), ".zcode");
const CLI_DIR = join(ZCODE_DIR, "cli");
const CONFIG_PATH = join(CLI_DIR, "config.json");
const PLUGINS_JSON_PATH = join(CLI_DIR, "plugins", "installed_plugins.json");
const KNOWN_MARKETPLACES_PATH = join(CLI_DIR, "plugins", "known_marketplaces.json");
const CACHE_BASE = join(CLI_DIR, "plugins", "cache");
const AGENTS_MD_PATH = join(ZCODE_DIR, "AGENTS.md");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);
const PLUGIN_JSON_PATH = join(REPO_ROOT, ".zcode-plugin", "plugin.json");
const MARKETPLACE_JSON_PATH = join(REPO_ROOT, "marketplace.json");

// ---------- plugin identity (read dynamically from the repo's own manifest) ----------

function readPluginManifest() {
  try {
    return JSON.parse(readFileSync(PLUGIN_JSON_PATH, "utf8"));
  } catch (e) {
    throw new Error(`Could not read plugin manifest at ${PLUGIN_JSON_PATH}: ${e.message}`);
  }
}

const MANIFEST = readPluginManifest();
const PLUGIN_NAME = MANIFEST.name;                          // "zodyssey"
const VERSION = MANIFEST.version;                           // "0.3.1" (read, not hard-coded)

// The hook events the manifest declares. Used by verify() to confirm the manifest
// carries the gate. The actual scripts are resolved at runtime via ${CLAUDE_PLUGIN_ROOT}
// inside the manifest — we never hard-code the cache path here.
const MANIFEST_HOOK_EVENTS = MANIFEST.hooks ? Object.keys(MANIFEST.hooks) : [];

// The 8 repo agents. Their frontmatter `name:` stays bare; the DISPATCH refs get
// the `zodyssey:` prefix elsewhere. Here these are FILENAMES to purge, not dispatch refs.
const REPO_AGENTS = [
  "metis", "prometheus", "momus", "sisyphus-junior",
  "explore", "librarian", "oracle", "multimodal-looker",
];

// ---------- flags ----------

const DRY = argv.includes("--dry-run");
const UNINSTALL = argv.includes("--uninstall");
const VERIFY = argv.includes("--verify");
const SYNC_CACHE = argv.includes("--sync-cache");

const log = (m) => console.log(DRY ? `[dry-run] ${m}` : m);
const logDim = (m) => console.log(DRY ? `[dry-run]   ${m}` : `   ${m}`);

// ---------- config.json load / save (timestamped backup once per run) ----------

let _configBackupPath = null;

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") {
      return {};
    }
    throw new Error(`Could not parse ${CONFIG_PATH}: ${e.message}. Fix it manually and re-run.`);
  }
}

// saveConfig writes config.json. The FIRST write in this process also creates a
// timestamped backup of the pre-existing config. Subsequent writes in the same
// run reuse the same backup slot (so the backup always reflects the pre-install state).
function saveConfig(config) {
  if (!_configBackupPath && existsSync(CONFIG_PATH)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    _configBackupPath = `${CONFIG_PATH}.zodyssey-backup-${ts}`;
    if (!DRY) writeFileSync(_configBackupPath, readFileSync(CONFIG_PATH));
  }
  if (!DRY) {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  }
  return _configBackupPath;
}

// ---------- installed_plugins.json load / save ----------
//
// Post-v0.3.1 this installer does NOT hand-write installed_plugins.json — the
// marketplace subsystem owns it. We only READ it back to resolve where the plugin
// is actually cached (for verify + reporting).

function loadPluginsJson() {
  if (!existsSync(PLUGINS_JSON_PATH)) return { version: 1, plugins: [] };
  try {
    const data = JSON.parse(readFileSync(PLUGINS_JSON_PATH, "utf8"));
    if (!data || !Array.isArray(data.plugins)) {
      throw new Error("missing `plugins` array");
    }
    return data;
  } catch (e) {
    throw new Error(`Could not parse ${PLUGINS_JSON_PATH}: ${e.message}`);
  }
}

// Find the installed-plugins entry for this plugin, by name, across ANY marketplace.
// (v0.3.0 hand-wrote marketplace:"local"; the marketplace GUI install uses the name
// from marketplace.json — "zodyssey-local". Either way, name === PLUGIN_NAME.)
function findInstalledEntry() {
  try {
    return loadPluginsJson().plugins.find((p) => p && p.name === PLUGIN_NAME) || null;
  } catch {
    return null;
  }
}

function resolveInstallPath() {
  const entry = findInstalledEntry();
  return entry && entry.installPath ? entry.installPath : null;
}

const RESOLVED_INSTALL_PATH = resolveInstallPath();

// ---------- --sync-cache ----------
//
// WHY THIS EXISTS: shakedown round 2 found that NONE of the shipped fixes were live. They were in
// the repo and in the marketplace tree; the CACHE — which is what ${CLAUDE_PLUGIN_ROOT} resolves
// to and what actually executes — still held the previous versions. The tester had to hand-roll a
// `cp -rT` to make the code under test be the code that runs.
//
// Worse, the drift check pointed the wrong way: it said "Re-run install.mjs + Update the plugin",
// but this installer has never copied anything to the cache (the marketplace subsystem owns it),
// and "Update" is a GUI action in an Electron app. So the one tool that detects the problem named
// a command that cannot fix it. A detector with a wrong remedy is barely better than no detector —
// it sends people in a circle.
//
// This makes the manual workaround a supported, testable command. It does exactly what the
// marketplace Update does to the cached tree, and nothing else: no registry writes, no config
// edits. Idempotent, and safe to run before a session.
function syncCache() {
  const dest = RESOLVED_INSTALL_PATH;
  if (!dest) {
    console.error("--sync-cache: zodyssey is not marketplace-installed (no installPath in installed_plugins.json).\n" +
      "  Install it first: Settings → Plugin Management → Discover → add this repo → Get.");
    exit(1);
  }
  // Refuse mid-run: swapping the hooks under an active orchestration would change the rules
  // between one tool call and the next, and the state file would no longer describe the code
  // enforcing it.
  const active = [];
  try {
    const stateDir = join(REPO_ROOT, ".zcode", "state");
    if (existsSync(stateDir)) {
      for (const f of readdirSync(stateDir)) {
        if (!f.endsWith(".json") || f.endsWith(".inflight.json")) continue;
        try {
          const st = JSON.parse(readFileSync(join(stateDir, f), "utf8"));
          if (st.phase && !["done", "audited", "abandoned"].includes(st.phase)) active.push(`${f} (${st.phase})`);
        } catch {}
      }
    }
  } catch {}
  if (active.length) {
    console.error(`--sync-cache: refusing — an orchestration run is active in this repo: ${active.join(", ")}.\n` +
      "  Swapping the hooks mid-run would change the rules between tool calls. Finish or abandon it first.");
    exit(1);
  }

  // A VERSION BUMP is not a content drift, and this command cannot fix it. The cache is laid out
  // per version (.../zodyssey/<version>/) and installed_plugins.json records which one is live, so
  // after a bump this would copy the new content into the OLD version's directory and leave the
  // registry pointing at a version that no longer matches the repo. Half-done and silent.
  //
  // Hand-writing installed_plugins.json is NOT the fix — that was precisely the v0.3.0 bug (a
  // hand-written marketplace:"local" entry the loader skipped while the hooks orphaned). The
  // marketplace owns the versioned directory and the registry entry. So: say so, do the copy
  // anyway (it is still the right content for the currently-registered version), and be explicit
  // that a GUI Update is required to finish.
  const entry = findInstalledEntry();
  const registeredVersion = entry && entry.version;
  const versionBump = registeredVersion && registeredVersion !== VERSION;
  if (versionBump) {
    console.log(
      `NOTE: the repo is at ${VERSION} but the installed plugin is registered at ${registeredVersion}.\n` +
      `      --sync-cache refreshes CONTENT in the registered version's directory; it cannot move the\n` +
      `      install to a new version, because the marketplace owns the versioned cache dir and the\n` +
      `      installed_plugins.json entry. (Hand-writing that registry was the v0.3.0 bug.)\n` +
      `      To complete a version bump: Settings → Plugin Management → Discover → Update on zodyssey.\n`
    );
  }

  const entries = ["skills", "agents", "commands", ".zcode-plugin", "scripts", "docs"];
  console.log(`sync-cache: ${REPO_ROOT}\n         -> ${dest}`);
  let copied = 0;
  for (const e of entries) {
    const src = join(REPO_ROOT, e);
    if (!existsSync(src)) continue;
    if (DRY) { console.log(`[dry-run]   would copy ${e}/`); copied++; continue; }
    try {
      cpSync(src, join(dest, e), { recursive: true, force: true });
      console.log(`   ✓ ${e}/`);
      copied++;
    } catch (err) {
      console.error(`   ✗ ${e}/ — ${err.message}`);
      exit(1);
    }
  }
  if (!DRY) {
    console.log(`\ncopied ${copied} tree(s). Start a NEW ZCode session — hooks load at session start.`);
    if (versionBump) {
      console.log(`STILL REQUIRED: a marketplace Update, to move the install from ${registeredVersion} to ${VERSION}.`);
    }
    console.log("Confirm with: node scripts/install.mjs --verify   (or: node scripts/smoke-gate.mjs)");
  }
  exit(0);
}
if (SYNC_CACHE) syncCache();

// ---------- hook helpers ----------

// Any hook arg referencing `skills/odyssey/hooks/` is a ZOdyssey-owned hook
// registration. Used by the v0.3.0-orphan migration to sweep every stale entry
// out of config.json (hooks are now manifest-driven, so any config.json copy is pollution).
function isZodysseyHookArg(a) {
  return typeof a === "string" && a.includes("skills/odyssey/hooks/");
}

function resolveNodeBin() {
  // absolute path avoids PATH issues inside ZCode hook spawns
  for (const p of ["/usr/bin/node", "/usr/local/bin/node"]) if (existsSync(p)) return p;
  return "node";
}

// ============================================================
// STEP 1 — marketplace bootstrap (replaces the old phase-1 copy+register)
// ============================================================

function readMarketplaceJson() {
  try {
    return JSON.parse(readFileSync(MARKETPLACE_JSON_PATH, "utf8"));
  } catch (e) {
    return null;
  }
}

function findKnownMarketplace() {
  if (!existsSync(KNOWN_MARKETPLACES_PATH)) return null;
  try {
    const data = JSON.parse(readFileSync(KNOWN_MARKETPLACES_PATH, "utf8"));
    const list = data && Array.isArray(data.marketplaces) ? data.marketplaces : [];
    // Match on marketplace.json's `name` (e.g. "zodyssey-local") OR any marketplace
    // whose source path points at this repo.
    const mp = readMarketplaceJson();
    const mpName = mp && mp.name;
    return list.find((m) => {
      if (mpName && m.id === mpName) return true;
      const src = m.source && (m.source.path || m.source.url);
      return typeof src === "string" && src.includes("ZOdyssey");
    }) || null;
  } catch {
    return null;
  }
}

function phaseBootstrapMarketplace() {
  log(`\n=== Step 1: marketplace bootstrap ===\n`);

  const mp = readMarketplaceJson();
  if (!mp) {
    logDim(`warn: ${MARKETPLACE_JSON_PATH} missing or unreadable — create it before installing.`);
  } else {
    logDim(`marketplace.json: name=${mp.name}, ${mp.plugins ? mp.plugins.length : 0} plugin(s)`);
  }

  const known = findKnownMarketplace();
  const entry = findInstalledEntry();
  if (entry) {
    logDim(`installed: ${entry.id} @ ${entry.version} → ${entry.installPath}`);
  } else if (known) {
    logDim(`marketplace "${known.id}" registered, but plugin not yet installed —`);
    logDim(`in ZCode: Settings → Plugin Management → Discover → click Get on zodyssey.`);
  } else {
    logDim(`marketplace not registered and plugin not installed. In ZCode:`);
    logDim(`  Settings → Plugin Management → Discover → "+" → local directory →`);
    logDim(`  ${REPO_ROOT}  →  then click Get on zodyssey.`);
  }
}

// ============================================================
// STEP 2 — purge pre-v0.3.0 top-level pollution
// ============================================================

// Ownership marker for <home>/.zcode/agents/README.md. `agents/` is user-extensible
// and "README.md" is a generic name, so we only purge that file when its content
// carries the ZOdyssey ownership marker — a hand-written or ZCode-default agents
// README is left in place on install/upgrade. (--uninstall removes it regardless.)
const ZODYSSEY_AGENTS_README_MARKER = "# ZCode Sub-Agents (ported from oh-my-openagent)";

// Every path here is unambiguously ZOdyssey-owned (the pre-v0.3.0 installer
// created it). Each entry is { path, owns? }; an optional `owns` content-gate is
// applied for generically-named files in user-extensible dirs. Absent paths are
// skipped silently. NOTE: --uninstall ignores `owns` (explicit removal by request).
function purgePaths() {
  return [
    { path: join(ZCODE_DIR, "skills", "odyssey") },
    { path: join(ZCODE_DIR, "skills", "odyssey.bak.1786309084") },
    ...REPO_AGENTS.map((a) => ({ path: join(ZCODE_DIR, "agents", `${a}.md`) })),
    {
      path: join(ZCODE_DIR, "agents", "README.md"),
      owns: (p) => {
        try { return readFileSync(p, "utf8").includes(ZODYSSEY_AGENTS_README_MARKER); }
        catch { return false; }
      },
    },
    { path: join(ZCODE_DIR, "commands", "orchestrate.md") },
    { path: join(ZCODE_DIR, "commands", "orchestrate-consult.md") },
  ];
}

let _purgeRemoved = 0;
let _purgeAbsent = 0;

function phasePurge() {
  log(`\n=== Step 2: purge pre-v0.3.0 top-level pollution ===\n`);
  const entries = purgePaths();
  for (const entry of entries) {
    if (!existsSync(entry.path)) {
      _purgeAbsent++;
      continue;
    }
    if (entry.owns && !entry.owns(entry.path)) {
      logDim(`skip ${entry.path} (not ZOdyssey-owned — leaving user file in place)`);
      _purgeAbsent++;
      continue;
    }
    log(`rm ${entry.path}`);
    if (!DRY) rmSync(entry.path, { recursive: true, force: true });
    _purgeRemoved++;
  }
  log(`${DRY ? "would remove" : "removed"} ${_purgeRemoved} path${_purgeRemoved === 1 ? "" : "s"} (${_purgeAbsent} already absent)`);
}

// ============================================================
// STEP 3 — migrate v0.3.0 orphaned hooks out of config.json
// ============================================================
//
// v0.3.0 wrote the 4 hooks into config.json pointing at cache/local/zodyssey/<ver>/.
// The v0.3.0→v0.3.1 marketplace install moved the plugin to cache/zodyssey-local/,
// orphaning those config.json entries (they point at a now-empty path → every hook
// spawn fails). v0.3.1 drives hooks from the manifest with ${CLAUDE_PLUGIN_ROOT},
// so config.json must carry ZERO zodyssey hook refs. This step sweeps them all.

let _migratedHooks = 0;

function migrateV030Hooks() {
  log(`\n=== Step 3: migrate v0.3.0 orphaned hooks out of ${CONFIG_PATH} ===\n`);
  if (DRY) {
    logDim(`(would remove every config.json hook whose args match skills/odyssey/hooks/)`);
    return;
  }
  let config;
  try { config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")); }
  catch { log("  (config.json not readable — nothing to migrate)"); return; }
  if (!config.hooks || !config.hooks.events) { log("  (no hooks.events — nothing to migrate)"); return; }

  for (const eventName of Object.keys(config.hooks.events)) {
    const entries = config.hooks.events[eventName];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && entry.hooks) {
        const before = entry.hooks.length;
        entry.hooks = entry.hooks.filter((h) => {
          if (!h.args) return true;
          if (h.args.some(isZodysseyHookArg)) return false;   // remove ANY zodyssey hook ref
          return true;
        });
        _migratedHooks += before - entry.hooks.length;
      }
    }
    config.hooks.events[eventName] = config.hooks.events[eventName].filter((e) => e && e.hooks && e.hooks.length > 0);
    if (config.hooks.events[eventName].length === 0) delete config.hooks.events[eventName];
  }
  if (Object.keys(config.hooks.events).length === 0) {
    // If the only hooks were zodyssey's, leave hooks.enabled alone (harmless) but drop the empty shell.
    delete config.hooks.events;
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  log(`${_migratedHooks === 0 ? "no orphaned hooks found" : `removed ${_migratedHooks} orphaned hook(s)`} (hooks are now manifest-driven)`);
}

// ---------- MCP registration (pipeline MCPs only) ----------
//
// The ZOdyssey pipeline routes a handful of MCPs at runtime. We register ONLY
// those (not the user's other 20 MCPs). Each spec declares how to (a) detect the
// backend is installable and (b) the config block to write into cli/config.json's
// mcp.servers. If the backend is missing we skip with a warning instead of
// writing a dead entry that would error on every session.
//
// NOTE (v0.3.1): MCPs deliberately stay in config.json rather than moving to the
// manifest's `mcpServers` field. Plugin-manifest MCPs are namespaced as
// `plugin:zodyssey:<server>`, which would rename every tool the conductor and
// scripts reference by its bare name (memory, codegraph, sequentialthinking, …).
// config.json MCPs keep their bare names, so the pipeline references stay stable.

const MCP_SPECS = [
  {
    name: "memory",
    reason: "cross-run knowledge graph (read at consult, written at done)",
    config: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      env: { MEMORY_FILE_PATH: join(ZCODE_DIR, "orchestration", "memory.json") },
      enabled: true,
      timeoutMs: 120000,
    },
    backendPresent: () => commandOnPath("npx"),
    backendHint: "install Node 18+ (npx ships with it)",
  },
  {
    name: "sequential-thinking",
    reason: "hard multi-step reasoning (architecture decomposition, 2+ failed-fix debug)",
    config: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      enabled: true,
      timeoutMs: 120000,
    },
    backendPresent: () => commandOnPath("npx"),
    backendHint: "install Node 18+ (npx ships with it)",
  },
  {
    name: "codegraph",
    reason: "call-graph impact analysis for declared Files: derivation",
    config: {
      type: "stdio",
      command: "codegraph",
      args: [],
      enabled: true,
      timeoutMs: 60000,
    },
    // codegraph is a global npm bin (root-owned on the reference machine). It's
    // optional — codegraph-impact.mjs no-ops gracefully when no .codegraph/ index
    // exists in the target repo.
    backendPresent: () => commandOnPath("codegraph"),
    backendHint: "install with: sudo npm install -g @colbymchenry/codegraph",
  },
  {
    name: "chrome-devtools",
    reason: "executable UI verification (F3 final-wave)",
    config: {
      type: "stdio",
      command: "npx",
      args: ["-y", "chrome-devtools-mcp"],
      enabled: true,
      timeoutMs: 60000,
    },
    backendPresent: () => commandOnPath("npx"),
    backendHint: "install Node 18+ (npx ships with it)",
  },
  {
    // zai-mcp-server provides ui_diff_check / diagnose_error_screenshot for the F3 wiring.
    // It is NOT an npm package — it ships as a standalone binary or a uvx-managed Python
    // tool. We register it only if the binary is already on PATH; otherwise we print the
    // hint and skip (the F3 wiring doc references it by name).
    name: "zai-mcp-server",
    reason: "UI diff + error diagnosis for executable F3 verification",
    config: {
      type: "stdio",
      command: "zai-mcp-server",
      args: [],
      enabled: true,
      timeoutMs: 120000,
    },
    backendPresent: () => commandOnPath("zai-mcp-server") || commandOnPath("zai-mcp"),
    backendHint: "install the zai-mcp-server package (see your z.ai docs for the current install path)",
  },
];

function commandOnPath(cmd) {
  // `command -v` is portable (works in dash/bash/sh). Returns true if the binary resolves.
  try {
    execSync(`command -v ${cmd} >/dev/null 2>&1`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function registerMCPs() {
  log(`\n=== Step 4: register pipeline MCPs in ${CONFIG_PATH} ===\n`);
  if (DRY) {
    for (const spec of MCP_SPECS) logDim(`${spec.name} — ${spec.reason}`);
    return;
  }
  const config = loadConfig();
  if (!config.mcp || typeof config.mcp !== "object") config.mcp = {};
  if (!config.mcp.servers || typeof config.mcp.servers !== "object") config.mcp.servers = {};

  let added = 0, skipped = 0;
  for (const spec of MCP_SPECS) {
    if (!spec.backendPresent()) {
      logDim(`(skip) ${spec.name}: backend not on PATH — ${spec.backendHint}`);
      skipped++;
      continue;
    }
    const isNew = !config.mcp.servers[spec.name];
    config.mcp.servers[spec.name] = spec.config;
    logDim(`${isNew ? "added" : "updated"} ${spec.name}`);
    if (isNew) added++;
  }
  saveConfig(config);
  log(`  MCPs: ${added} added, ${MCP_SPECS.length - added - skipped} updated, ${skipped} skipped (backends missing)`);
}

function unregisterMCPs() {
  log(`unregister pipeline MCPs from ${CONFIG_PATH}`);
  if (DRY) { for (const spec of MCP_SPECS) logDim(spec.name); return; }
  let config;
  try { config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")); }
  catch { log("  (config.json not readable — nothing to remove)"); return; }
  if (!config.mcp || !config.mcp.servers) { log("  (no mcp.servers — nothing to remove)"); return; }
  let removed = 0;
  for (const spec of MCP_SPECS) {
    if (config.mcp.servers[spec.name]) {
      delete config.mcp.servers[spec.name];
      removed++;
    }
  }
  if (Object.keys(config.mcp.servers).length === 0) delete config.mcp.servers;
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  log(`  removed ${removed} MCP(s)`);
}

// ---------- superpowers detection ----------
//
// Most routed skills (tdd, systematic-debugging, writing-plans, brainstorming, etc.)
// live in the external superpowers plugin, not this repo. We detect it and print a
// pointer if missing. We do NOT auto-install a third-party plugin — that's the
// user's call.

function detectSuperpowers() {
  log(`check superpowers plugin`);
  const cacheLocations = [
    join(CACHE_BASE, "claude-plugins-official", "superpowers"),
    join(CACHE_BASE, "zcode-plugins-official", "superpowers"),
  ];
  let sp = false;
  for (const p of cacheLocations) {
    try { if (existsSync(p)) { sp = true; break; } } catch {}
  }
  if (!sp && existsSync(PLUGINS_JSON_PATH)) {
    try {
      const data = JSON.parse(readFileSync(PLUGINS_JSON_PATH, "utf8"));
      const list = Array.isArray(data) ? data : (Array.isArray(data.plugins) ? data.plugins : Object.values(data).flat());
      if (list.some((p) => p && (p.name || p.id || "").includes("superpowers"))) sp = true;
    } catch {}
  }
  if (sp) logDim("superpowers detected — routed skills will resolve");
  else logDim("(optional) superpowers not detected — see https://github.com/obra/superpowers");
}

// ============================================================
// --verify
// ============================================================

function verify() {
  console.log(`\nZOdyssey verify — health check (${PLUGIN_NAME} @ ${VERSION})\n`);
  let problems = 0;
  const check = (label, ok, hint) => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${!ok && hint ? ` — ${hint}` : ""}`);
    if (!ok) problems++;
  };

  // 1. Node version >= 18
  try {
    const v = execSync("node --version", { encoding: "utf8" }).trim();
    const major = parseInt(v.replace(/^v/, ""), 10);
    check(`Node ${v} (≥18 required)`, major >= 18, "install Node 18+");
  } catch {
    check("Node on PATH", false, "install Node 18+");
  }

  // 2. Plugin is marketplace-installed + the resolved installPath exists + its manifest matches.
  const entry = findInstalledEntry();
  check(`installed_plugins.json has ${PLUGIN_NAME} (any marketplace)`,
    !!entry, "install via ZCode → Discover → add local directory → Get zodyssey");
  let installPathOk = false;
  let installPath = null;
  if (entry) {
    installPath = entry.installPath;
    installPathOk = !!installPath && existsSync(installPath);
    check(`installPath exists: ${installPath}`, installPathOk, "reinstall via the marketplace");
    if (installPathOk) {
      let cacheManifestOk = false;
      try {
        const cm = JSON.parse(readFileSync(join(installPath, ".zcode-plugin", "plugin.json"), "utf8"));
        cacheManifestOk = cm.name === PLUGIN_NAME && cm.version === VERSION;
      } catch { /* leave false */ }
      check(`cache manifest (name=${PLUGIN_NAME}, version=${VERSION})`, cacheManifestOk,
        "the cached copy is stale — update via the marketplace (Discover → Update)");
    }
  }

  // 3. Manifest declares the 4 hook events; each hook script exists at the resolved installPath + parses.
  const expectedHookEvents = ["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit"];
  const manifestHasAllHooks = expectedHookEvents.every((ev) => MANIFEST_HOOK_EVENTS.includes(ev));
  check(`manifest declares hooks: ${expectedHookEvents.join(", ")}`, manifestHasAllHooks,
    `add a \`hooks\` field to ${PLUGIN_JSON_PATH}`);
  if (installPathOk && manifestHasAllHooks) {
    for (const ev of expectedHookEvents) {
      // extract the script path from the manifest entry, resolve ${CLAUDE_PLUGIN_ROOT}
      const entries = MANIFEST.hooks[ev] || [];
      for (const grp of entries) {
        for (const h of (grp.hooks || [])) {
          const rel = (h.args || []).find((a) => typeof a === "string" && a.includes("hooks/"));
          if (!rel) continue;
          const scriptPath = rel.replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$\{ZCODE_PLUGIN_ROOT\}/g, installPath);
          const exists = existsSync(scriptPath);
          let parses = false;
          if (exists) {
            try { execSync(`node --check ${JSON.stringify(scriptPath)}`, { stdio: "ignore" }); parses = true; }
            catch { parses = false; }
          }
          check(`${ev} script parses: ${scriptPath.replace(installPath, "<installPath>")}`,
            exists && parses, exists ? "syntax error" : `missing: ${scriptPath}`);

          // SHA DRIFT: is the DEPLOYED hook actually this repo's hook?
          //
          // Every check above passes on a cached copy that is not your source. That is not
          // hypothetical — on 2026-08-11 `--verify` reported 18/18 green while the cached
          // pre-tool.mjs was a commit behind the repo. Benign that time (comment-only), but a
          // functional divergence is indistinguishable from the repo side, and "the verified
          // artifact is not the running artifact" is precisely how v0.3.0 shipped with
          // enforcement dead.
          //
          // Compared against the manifest-declared path specifically, because that is the file
          // ZCode is registered to execute — not whatever else happens to sit in the cache.
          if (exists && parses) {
            const relFromRoot = scriptPath.slice(installPath.length).replace(/^[/\\]/, "");
            const repoTwin = join(REPO_ROOT, relFromRoot);
            let drift = null; // null = match, string = reason
            if (!existsSync(repoTwin)) {
              drift = `no repo counterpart at ${relFromRoot}`;
            } else {
              try {
                const a = createHash("sha256").update(readFileSync(scriptPath)).digest("hex");
                const b = createHash("sha256").update(readFileSync(repoTwin)).digest("hex");
                if (a !== b) drift = `cached ${a.slice(0, 12)} != repo ${b.slice(0, 12)}`;
              } catch (e) {
                drift = `unreadable (${e.code || e.message})`; // fail closed
              }
            }
            check(`${ev} deployed == repo source`, drift === null,
              drift ? `${drift} — the running hook is NOT your source. Fix with:\n` +
                      `        node scripts/install.mjs --sync-cache\n` +
                      `      (or Settings → Plugin Management → Discover → Update). NOTE: a plain ` +
                      `\`install.mjs\` run does NOT refresh the cache — it never has — so re-running it ` +
                      `will not clear this.` : "");
          }
        }
      }
    }
  }

  // 4. NO orphaned zodyssey hooks remain in config.json (migration succeeded).
  try {
    const config = loadConfig();
    const events = config.hooks && config.hooks.events;
    let orphaned = 0;
    if (events) {
      for (const arr of Object.values(events)) {
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          if (!e || !e.hooks) continue;
          for (const h of e.hooks) {
            if (h.args && h.args.some(isZodysseyHookArg)) orphaned++;
          }
        }
      }
    }
    check("no orphaned zodyssey hooks in config.json", orphaned === 0,
      orphaned ? `run: node scripts/install.mjs (${orphaned} orphan(s) — hooks are manifest-driven now)` : "");
  } catch (e) {
    check("config.json readable", false, e.message);
  }

  // 5. Marketplace registered in known_marketplaces.json
  const known = findKnownMarketplace();
  check(`marketplace registered in known_marketplaces.json`, !!known,
    "in ZCode: Discover → \"+\" → local directory → " + REPO_ROOT);

  // 6. NO top-level pre-v0.3.0 pollution remains
  const leftover = purgePaths()
    .filter((e) => existsSync(e.path) && (!e.owns || e.owns(e.path)))
    .map((e) => e.path);
  check("no pre-v0.3.0 top-level pollution", leftover.length === 0,
    leftover.length ? `run: node scripts/install.mjs (${leftover.length} left): ${leftover.join(", ")}` : "");

  // 7. Pipeline MCPs: config entry present + backend on PATH
  try {
    const config = loadConfig();
    const servers = (config.mcp && config.mcp.servers) || {};
    for (const spec of MCP_SPECS) {
      const ent = servers[spec.name];
      // Verify the ACTUAL registered command's backend (a user may override an MCP to a
      // different runner — e.g. zai-mcp-server via `npx -y @z_ai/mcp-server` — in which
      // case the spec's backendPresent() is a false negative against the bare binary).
      // Falls back to spec.backendPresent() when the entry isn't registered or has no command.
      const cmd = ent && ent.command;
      const backend = cmd ? commandOnPath(cmd) : spec.backendPresent();
      check(`MCP ${spec.name}: ${ent ? "registered" : "NOT registered"}, backend ${backend ? "present" : "missing"}`,
        ent && backend,
        !ent ? "run: node scripts/install.mjs" : (!backend ? (cmd ? `\`${cmd}\` not on PATH` : spec.backendHint) : ""));
    }
  } catch (e) {
    check("MCP config readable", false, e.message);
  }

  // 8. superpowers
  try {
    let sp = false;
    [join(CACHE_BASE, "claude-plugins-official", "superpowers"),
     join(CACHE_BASE, "zcode-plugins-official", "superpowers")].forEach((p) => {
      try { if (existsSync(p)) sp = true; } catch {}
    });
    if (existsSync(PLUGINS_JSON_PATH)) {
      try {
        const data = JSON.parse(readFileSync(PLUGINS_JSON_PATH, "utf8"));
        const list = Array.isArray(data) ? data : (Array.isArray(data.plugins) ? data.plugins : Object.values(data).flat());
        if (list.some((p) => p && (p.name || p.id || "").includes("superpowers"))) sp = true;
      } catch {}
    }
    check("superpowers plugin (optional, for routed skills)", sp, "see https://github.com/obra/superpowers");
  } catch {}

  console.log(`\n${problems === 0 ? "✓ all checks passed" : `✗ ${problems} problem(s) found`}\n`);
  exit(problems === 0 ? 0 : 1);
}

// ---------- AGENTS.md merge (the installer-managed ZODYSSEY block) ----------

const AGENTS_BLOCK = `
<!-- ZODYSSEY_START -->
# ZOdyssey Orchestration

ZOdyssey is an opt-in multi-agent orchestration pipeline. It is NOT the default mode —
normal requests are handled directly. Use it only when the user invokes \`/orchestrate\`.

## When to use it
- The user typed \`/orchestrate <task>\`, \`/orchestrate resume <slug>\`, or \`/orchestrate status <slug>\`.
- Otherwise: do NOT orchestrate. Answer, edit, and search normally.

## The pipeline (load the \`zodyssey:odyssey\` skill to run it)
Phases: -1 Prime -> 0 Triage -> 1 Consult (\`zodyssey:metis\`) -> 2 Plan (\`zodyssey:prometheus\`) ->
3 Review gate (\`zodyssey:momus\`) -> 4 Execute (\`zodyssey:sisyphus-junior\`, parallel-by-default) ->
5 Verify -> 6 Final wave (F1-F4).

## Enforcement (hooks — hard blocks, not advisory)
When an orchestration run is active, the PreToolUse hook blocks:
- **edits to product code before \`review.verdict == OKAY\`** (the gate omo leaves unenforced)
- **edits outside the plan's declared \`Files:\` scope** (fail-closed on unreadable/empty plan)
- **write-capable Bash** before OKAY or outside declared scope (secure by default; set
  \`ZODYSSEY_UNGATE_BASH=1\` to disable if you trust your agents)
- **Task dispatches beyond the parallel cap** (default 4, override via \`ZODYSSEY_PARALLEL_CAP\`)
These hooks are NO-OPS when no run is active, so normal editing is never affected.

## External consult/audit (opt-in, \`/orchestrate-consult <slug>\`)
After a run is done, \`/orchestrate-consult\` hands the plan + full git diff to an **external
Claude CLI** (separate process, independent model) for an ACCEPT/REJECT audit. On REJECT,
ZOdyssey auto-remediates and re-audits until ACCEPT. Stronger than any in-session reviewer
because the auditor cannot inherit the run's assumptions.

Full design: https://github.com/amartinawi/zodyssey/blob/main/docs/DESIGN.md
<!-- ZODYSSEY_END -->
`;

function mergeAgentsMd() {
  log(`merge ZOdyssey block into ${AGENTS_MD_PATH}`);
  if (DRY) return;
  let existing = "";
  try { existing = readFileSync(AGENTS_MD_PATH, "utf8"); } catch { /* may not exist */ }
  if (existing.includes("<!-- ZODYSSEY_START -->")) {
    // Replace the existing block in-place so dispatch refs stay current across upgrades.
    const next = existing.replace(/<!-- ZODYSSEY_START -->[\s\S]*?<!-- ZODYSSEY_END -->\n?/, AGENTS_BLOCK.trimEnd() + "\n");
    writeFileSync(AGENTS_MD_PATH, next);
    log("  block refreshed");
    return;
  }
  const next = existing ? existing.replace(/\s*$/, "") + "\n" + AGENTS_BLOCK : AGENTS_BLOCK;
  writeFileSync(AGENTS_MD_PATH, next);
  log("  block appended");
}

function unmergeAgentsMd() {
  log(`remove ZOdyssey block from ${AGENTS_MD_PATH}`);
  if (DRY) return;
  let existing;
  try { existing = readFileSync(AGENTS_MD_PATH, "utf8"); } catch { log("  (AGENTS.md not found — nothing to remove)"); return; }
  if (!existing.includes("<!-- ZODYSSEY_START -->")) { log("  (block not present — skipping)"); return; }
  const next = existing.replace(/<!-- ZODYSSEY_START -->[\s\S]*?<!-- ZODYSSEY_END -->\n?/, "").replace(/\n{3,}/g, "\n\n");
  writeFileSync(AGENTS_MD_PATH, next);
  log("  block removed");
}

// ---------- orchestration/eval init ----------

function initEvalDir() {
  const evalDir = join(ZCODE_DIR, "orchestration", "eval");
  log(`init eval dir: ${evalDir}`);
  if (DRY) return;
  mkdirSync(evalDir, { recursive: true });
  // seed.jsonl ships with the plugin (under skills/odyssey/scripts/). Copy it if
  // present and not already there (don't overwrite an existing one — user data).
  const seedSrc = join(REPO_ROOT, "skills", "odyssey", "scripts", "seed.jsonl");
  const seedDst = join(evalDir, "seed.jsonl");
  try { if (existsSync(seedSrc) && !existsSync(seedDst)) cpSync(seedSrc, seedDst); } catch {}
  const gitkeep = join(evalDir, ".gitkeep");
  if (!existsSync(gitkeep)) writeFileSync(gitkeep, "");
}

// ============================================================
// --uninstall
// ============================================================

function uninstall() {
  log("\n=== Removing ZOdyssey config ===\n");
  // 1. config.json hooks (sweep any orphaned refs) + MCPs
  migrateV030Hooks();
  unregisterMCPs();
  // 2. AGENTS.md block
  unmergeAgentsMd();
  // 3. any pre-v0.3.0 top-level pollution still on disk.
  //    --uninstall ignores the `owns` predicates (explicit removal by user request).
  for (const entry of purgePaths()) {
    if (existsSync(entry.path)) {
      log(`rm ${entry.path}`);
      if (!DRY) rmSync(entry.path, { recursive: true, force: true });
    }
  }
  log("\nConfig removed. To finish, GUI-uninstall the plugin:");
  log("  Settings → Plugin Management → Installed → zodyssey → Uninstall");
  log("  (the marketplace-owned cache copy + installed_plugins.json entry are managed by ZCode.)\n");
  log("(Run records under <repo>/.zcode/ are left in place — delete manually if desired.)\n");
}

// ============================================================
// summary
// ============================================================

function printSummary() {
  log("\n=== Summary ===");
  log(`  bootstrap: ${findInstalledEntry() ? `installed → ${RESOLVED_INSTALL_PATH || "(path unresolved)"}` : "NOT marketplace-installed (see Step 1 output)"}`);
  log(`  purge:     ${DRY ? "would remove" : "removed"} ${_purgeRemoved} pre-v0.3.0 path(s), ${_purgeAbsent} already absent`);
  log(`  migrate:   ${_migratedHooks} v0.3.0 orphaned hook(s) ${DRY ? "would be" : ""} removed from config.json`);
  if (_configBackupPath) log(`  backup:    config.json → ${_configBackupPath}`);
}

// ---------- main ----------

function main() {
  console.log(`\nZOdyssey installer${DRY ? " (DRY RUN)" : UNINSTALL ? " (UNINSTALL)" : VERIFY ? " (VERIFY)" : ""}`);
  console.log(`  ZCode dir:   ${ZCODE_DIR}`);
  console.log(`  Repo:        ${REPO_ROOT}`);
  console.log(`  Plugin:      ${PLUGIN_NAME} @ ${VERSION}`);
  if (RESOLVED_INSTALL_PATH) console.log(`  Installed:   ${RESOLVED_INSTALL_PATH}`);
  console.log("");

  try {
    execSync("node --version", { stdio: "ignore" });
  } catch {
    console.error("ERROR: node not found on PATH. Install Node 18+ first.");
    exit(1);
  }

  if (VERIFY) {
    verify();  // exits
  }

  if (UNINSTALL) {
    uninstall();
    exit(0);
  }

  phaseBootstrapMarketplace();
  phasePurge();
  migrateV030Hooks();
  registerMCPs();
  mergeAgentsMd();
  initEvalDir();
  detectSuperpowers();

  printSummary();

  log("\n=== Done ===");
  if (!findInstalledEntry()) {
    log(`Plugin not yet marketplace-installed — open ZCode → Settings → Plugin Management →`);
    log(`Discover → \"+\" → local directory → ${REPO_ROOT} → click Get on zodyssey.`);
  } else {
    log(`Next: start a NEW ZCode session (hooks load at startup), then run /orchestrate <task> in any repo.`);
  }
  log(`Health-check: node scripts/install.mjs --verify`);
  log(`Config + troubleshooting: docs/INSTALL.md`);
  log(`Adapting to other harnesses (omo, Claude Code, ...): docs/ADAPT.md\n`);
  exit(0);
}

main();
