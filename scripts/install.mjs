#!/usr/bin/env node
// ZOdyssey installer — three-phase idempotent plugin-cache installer.
// Installs ZOdyssey as a proper ZCode plugin under the plugin cache (NOT copied
// to top-level <home>/.zcode/skills|agents|commands, which is the pollution we
// removed in v0.3.0). Zero npm dependencies.
//
// Usage:
//   node scripts/install.mjs                      # run all 3 phases (default)
//   node scripts/install.mjs --phase copy         # phase 1 only: copy + register
//   node scripts/install.mjs --phase purge        # phase 2 only: purge pre-0.3.0 pollution
//   node scripts/install.mjs --phase hooks        # phase 3 only: rewrite config.json hooks
//   node scripts/install.mjs --uninstall          # remove ZOdyssey completely
//   node scripts/install.mjs --dry-run            # show what would happen, change nothing
//   node scripts/install.mjs --verify             # health-check the install
//
// The three phases (each independently re-runnable, each safe to run alone):
//   1. COPY + REGISTER — cpSync the repo tree into
//      <home>/.zcode/cli/plugins/cache/local/zodyssey/<version>/ and upsert a
//      `zodyssey@local` entry in <home>/.zcode/cli/plugins/installed_plugins.json
//      (shape mirrors superpowers@claude-plugins-official).
//   2. PURGE — remove pre-0.3.0 top-level pollution: <home>/.zcode/skills/odyssey/,
//      the stale <home>/.zcode/skills/odyssey.bak.1786309084/ backup dir, the 8
//      <home>/.zcode/agents/<name>.md + <home>/.zcode/agents/README.md, and the 2
//      <home>/.zcode/commands/orchestrate[-consult].md.
//   3. HOOKS — back up <home>/.zcode/cli/config.json to a timestamped sibling, then
//      rewrite the 4 hook args to the new cache path; also (re)registers the
//      pipeline MCPs, merges the AGENTS.md ZODYSSEY block, inits the eval dir,
//      and detects the optional superpowers plugin.
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

// ---------- paths (all derived from homedir + repo location) ----------

const ZCODE_DIR = join(homedir(), ".zcode");
const CLI_DIR = join(ZCODE_DIR, "cli");
const CONFIG_PATH = join(CLI_DIR, "config.json");
const PLUGINS_JSON_PATH = join(CLI_DIR, "plugins", "installed_plugins.json");
const CACHE_BASE = join(CLI_DIR, "plugins", "cache");
const AGENTS_MD_PATH = join(ZCODE_DIR, "AGENTS.md");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);
const PLUGIN_JSON_PATH = join(REPO_ROOT, ".zcode-plugin", "plugin.json");

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
const VERSION = MANIFEST.version;                           // "0.3.0" (read, not hard-coded)
const MARKETPLACE = "local";
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE}`;          // "zodyssey@local"
const CACHE_DIR = join(CACHE_BASE, MARKETPLACE, PLUGIN_NAME, VERSION);
const CACHE_HOOKS_DIR = join(CACHE_DIR, "skills", "odyssey", "hooks");

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

const VALID_PHASES = ["copy", "purge", "hooks"];
let PHASE = null;
const phaseIdx = argv.indexOf("--phase");
if (phaseIdx !== -1) {
  const next = argv[phaseIdx + 1];
  if (!next || !VALID_PHASES.includes(next)) {
    console.error(`ERROR: --phase requires one of: ${VALID_PHASES.join(", ")}`);
    exit(1);
  }
  PHASE = next;
}
// --uninstall / --verify take precedence over --phase (they're top-level modes).
const RUN_COPY = !PHASE || PHASE === "copy";
const RUN_PURGE = !PHASE || PHASE === "purge";
const RUN_HOOKS = !PHASE || PHASE === "hooks";

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

function savePluginsJson(data) {
  if (DRY) return;
  mkdirSync(dirname(PLUGINS_JSON_PATH), { recursive: true });
  writeFileSync(PLUGINS_JSON_PATH, JSON.stringify(data, null, 2) + "\n");
}

// ---------- hook specs (point at the NEW cache location) ----------

const HOOK_SPECS = [
  { event: "PreToolUse",  matcher: "Write|Edit|ApplyPatch|MultiEdit|NotebookEdit|Bash|Task|Agent",
    script: join(CACHE_HOOKS_DIR, "pre-tool.mjs") },
  // PostToolUse matcher MUST include the edit tools so the post-edit diagnostics arm fires.
  // (v0.1.0 shipped "Task|Agent" only, which silently dead-coded the diagnostics arm.)
  { event: "PostToolUse", matcher: "Task|Agent|Edit|Write|MultiEdit",
    script: join(CACHE_HOOKS_DIR, "post-tool.mjs") },
  { event: "Stop",        matcher: ".*",
    script: join(CACHE_HOOKS_DIR, "stop.mjs") },
  // UserPromptSubmit (v0.1.1): trivial-gate warning-only hook. Never blocks (exit 0).
  { event: "UserPromptSubmit", matcher: ".*",
    script: join(CACHE_HOOKS_DIR, "user-prompt-submit.mjs") },
];

// Any hook arg referencing `skills/odyssey/hooks/` is a ZOdyssey-owned hook
// registration (current cache path OR a stale pre-0.3.0 top-level path). Used to
// dedupe on register and to sweep everything on unregister.
function isZodysseyHookArg(a) {
  return typeof a === "string" && a.includes("skills/odyssey/hooks/");
}

function resolveNodeBin() {
  // absolute path avoids PATH issues inside ZCode hook spawns
  for (const p of ["/usr/bin/node", "/usr/local/bin/node"]) if (existsSync(p)) return p;
  return "node";
}

// ============================================================
// PHASE 1 — copy repo tree into the plugin cache + register
// ============================================================

// Repo entries copied verbatim into the cache dir. Mirrors the
// cache/<marketplace>/<name>/<version>/ layout used by every other installed plugin.
const CACHE_COPY_ENTRIES = ["skills", "agents", "commands", ".zcode-plugin", "scripts", "docs"];
const CACHE_COPY_FILES = ["README.md", "CHANGELOG.md", "LICENSE"];

function phaseCopyAndRegister() {
  log(`\n=== Phase 1: copy + register (${PLUGIN_ID} @ ${VERSION}) ===\n`);

  // 1a. (Re)copy repo tree into the cache dir. rmSync first so re-runs leave no
  // stale files (e.g. a renamed agent file from an older version).
  log(`copy repo tree → ${CACHE_DIR}`);
  if (DRY) {
    logDim(`entries: ${CACHE_COPY_ENTRIES.join(", ")} (+ ${CACHE_COPY_FILES.join(", ")})`);
  } else {
    rmSync(CACHE_DIR, { recursive: true, force: true });
    mkdirSync(CACHE_DIR, { recursive: true });
    for (const entry of CACHE_COPY_ENTRIES) {
      const src = join(REPO_ROOT, entry);
      if (existsSync(src)) cpSync(src, join(CACHE_DIR, entry), { recursive: true, force: true });
    }
    for (const f of CACHE_COPY_FILES) {
      const src = join(REPO_ROOT, f);
      if (existsSync(src)) cpSync(src, join(CACHE_DIR, f), { force: true });
    }
    logDim(`cache populated`);
  }

  // 1b. Upsert the `zodyssey@local` entry in installed_plugins.json (idempotent).
  registerInPluginsJson();
}

function registerInPluginsJson() {
  log(`register ${PLUGIN_ID} in ${PLUGINS_JSON_PATH}`);
  const data = loadPluginsJson();
  const now = new Date().toISOString();
  const existingIdx = data.plugins.findIndex((p) => p && p.id === PLUGIN_ID);
  const preservedInstalledAt = existingIdx !== -1 ? (data.plugins[existingIdx].installedAt || now) : now;

  if (DRY) {
    logDim(existingIdx !== -1
      ? `update existing entry (version→${VERSION}, installPath→${CACHE_DIR}, updatedAt refreshed)`
      : `append new entry`);
    return;
  }

  const entry = {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    marketplace: MARKETPLACE,
    version: VERSION,
    installPath: CACHE_DIR,
    installedAt: preservedInstalledAt,
    updatedAt: now,
    scope: "user",
    source: MARKETPLACE,
  };

  if (existingIdx !== -1) {
    data.plugins[existingIdx] = entry;
    logDim(`updated existing entry (idempotent)`);
  } else {
    data.plugins.push(entry);
    logDim(`appended new entry`);
  }
  savePluginsJson(data);
}

function unregisterFromPluginsJson() {
  log(`unregister ${PLUGIN_ID} from ${PLUGINS_JSON_PATH}`);
  if (DRY) return;
  if (!existsSync(PLUGINS_JSON_PATH)) { log("  (installed_plugins.json absent — nothing to remove)"); return; }
  const data = loadPluginsJson();
  const before = data.plugins.length;
  data.plugins = data.plugins.filter((p) => p && p.id !== PLUGIN_ID);
  const removed = before - data.plugins.length;
  if (removed > 0) {
    savePluginsJson(data);
    log(`  removed ${removed} entr${removed === 1 ? "y" : "ies"}`);
  } else {
    log("  (entry not present — skipping)");
  }
}

// ============================================================
// PHASE 2 — purge pre-0.3.0 top-level pollution
// ============================================================

// Ownership marker for <home>/.zcode/agents/README.md. `agents/` is user-extensible
// and "README.md" is a generic name, so we only purge that file when its content
// carries the ZOdyssey ownership marker — a hand-written or ZCode-default agents
// README is left in place on install/upgrade. (--uninstall removes it regardless.)
const ZODYSSEY_AGENTS_README_MARKER = "# ZCode Sub-Agents (ported from oh-my-openagent)";

// Every path here is unambiguously ZOdyssey-owned (the pre-0.3.0 installer
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
  log(`\n=== Phase 2: purge pre-0.3.0 top-level pollution ===\n`);
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
// PHASE 3 — rewrite config.json hooks (timestamped backup first)
// ============================================================

function phaseRewriteHooks() {
  log(`\n=== Phase 3: rewrite config.json hooks → cache path ===\n`);

  if (!existsSync(CACHE_HOOKS_DIR)) {
    logDim(`warn: ${CACHE_HOOKS_DIR} not present — run --phase copy first or hooks will miss.`);
  }

  registerHooks();
  registerMCPs();
  mergeAgentsMd();
  initEvalDir();
  detectSuperpowers();

  if (_configBackupPath) log(`config.json backup: ${_configBackupPath}`);
}

// ---------- hook registration ----------

function registerHooks() {
  log(`register hooks in ${CONFIG_PATH}`);
  if (DRY) { HOOK_SPECS.forEach((h) => logDim(`${h.event} [${h.matcher}] → ${h.script}`)); return; }

  const config = loadConfig();
  if (!config.hooks || typeof config.hooks !== "object") config.hooks = {};
  config.hooks.enabled = true;
  if (!config.hooks.events || typeof config.hooks.events !== "object") config.hooks.events = {};

  const nodeBin = resolveNodeBin();
  let added = 0, updated = 0, swept = 0;
  for (const spec of HOOK_SPECS) {
    if (!Array.isArray(config.hooks.events[spec.event])) config.hooks.events[spec.event] = [];
    let entry = config.hooks.events[spec.event].find((e) => e && e.matcher === spec.matcher);
    if (!entry) {
      entry = { matcher: spec.matcher, hooks: [] };
      config.hooks.events[spec.event].push(entry);
    }
    const before = entry.hooks.length;
    entry.hooks = entry.hooks.filter((h) => {
      if (!h.args) return true;
      if (h.args.includes(spec.script)) return false;             // dedupe current cache path
      if (h.args.some(isZodysseyHookArg)) return false;            // sweep stale pre-0.3.0 paths
      return true;
    });
    swept += before - entry.hooks.length;
    entry.hooks.push({ type: "process", command: nodeBin, args: [spec.script], timeoutMs: 5000 });
    logDim(`${spec.event} [${spec.matcher}] → ${spec.script}`);
    added++;
  }

  saveConfig(config);
  log(`  hooks registered: ${added} ${DRY ? "(would write)" : "written"}${swept > 0 ? `, ${swept} stale path(s) swept` : ""}`);
}

function unregisterHooks() {
  log(`unregister hooks from ${CONFIG_PATH}`);
  if (DRY) return;
  let config;
  try { config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")); }
  catch { log("  (config.json not readable — nothing to remove)"); return; }
  if (!config.hooks || !config.hooks.events) { log("  (no hooks.events — nothing to remove)"); return; }
  let removed = 0;
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
        removed += before - entry.hooks.length;
      }
    }
    config.hooks.events[eventName] = config.hooks.events[eventName].filter((e) => e && e.hooks && e.hooks.length > 0);
    if (config.hooks.events[eventName].length === 0) delete config.hooks.events[eventName];
  }
  if (Object.keys(config.hooks.events).length === 0) config.hooks.enabled = false;
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  log(`  removed ${removed} hook(s)`);
}

// ---------- MCP registration (pipeline MCPs only) ----------
//
// The ZOdyssey pipeline routes a handful of MCPs at runtime. We register ONLY
// those (not the user's other 20 MCPs). Each spec declares how to (a) detect the
// backend is installable and (b) the config block to write into cli/config.json's
// mcp.servers. If the backend is missing we skip with a warning instead of
// writing a dead entry that would error on every session.

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
  log(`register pipeline MCPs in ${CONFIG_PATH}`);
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
    join(ZCODE_DIR, "skills", "test-driven-development"),  // flat-install fallback
  ];
  const found = cacheLocations.some((p) => {
    try { return existsSync(p); } catch { return false; }
  });
  // installed_plugins.json is a more reliable signal than dir presence.
  try {
    if (existsSync(PLUGINS_JSON_PATH)) {
      const data = JSON.parse(readFileSync(PLUGINS_JSON_PATH, "utf8"));
      const list = Array.isArray(data) ? data : (Array.isArray(data.plugins) ? data.plugins : Object.values(data).flat());
      if (list.some((p) => p && (p.name || p.id || "").includes("superpowers"))) {
        log("  superpowers: detected (installed_plugins.json)");
        return;
      }
    }
  } catch { /* ignore */ }

  if (found) {
    log("  superpowers: detected (plugin cache)");
  } else if (DRY) {
    logDim("(would warn) superpowers: NOT detected — 8+ routed skills will be unavailable");
  } else {
    console.log(`   ⚠  superpowers plugin not detected. Most routed skills (tdd, systematic-debugging,\n      writing-plans, brainstorming, premortem, etc.) live there, not in this repo.\n      Install it separately — see https://github.com/obra/superpowers\n      (ZOdyssey works without it; you get the 3 shipped capsules either way.)`);
  }
}

// ---------- --verify: health-check the install ----------

function verify() {
  console.log(`\nZOdyssey verify — health check (${PLUGIN_ID} @ ${VERSION})\n`);
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

  // 2. Cache dir present + plugin manifest at cache parses with right name/version
  check(`cache dir exists: ${CACHE_DIR}`, existsSync(CACHE_DIR), "run: node scripts/install.mjs --phase copy");
  let cacheManifestOk = false;
  try {
    const cm = JSON.parse(readFileSync(join(CACHE_DIR, ".zcode-plugin", "plugin.json"), "utf8"));
    cacheManifestOk = cm.name === PLUGIN_NAME && cm.version === VERSION;
  } catch { /* leave false */ }
  check(`cache .zcode-plugin/plugin.json (name=${PLUGIN_NAME}, version=${VERSION})`, cacheManifestOk, "re-run installer");

  // 3. Skill + hooks present at the cache path; each hook parses
  check(`skill: ${join(CACHE_DIR, "skills", "odyssey", "SKILL.md")}`,
    existsSync(join(CACHE_DIR, "skills", "odyssey", "SKILL.md")), "re-run installer");
  for (const spec of HOOK_SPECS) {
    const exists = existsSync(spec.script);
    let parses = false;
    if (exists) {
      try { execSync(`node --check ${JSON.stringify(spec.script)}`, { stdio: "ignore" }); parses = true; }
      catch { parses = false; }
    }
    check(`hook ${spec.event} script parses`, exists && parses, exists ? "syntax error" : `missing: ${spec.script}`);
  }

  // 4. Hooks registered in config.json at the NEW cache path
  try {
    const config = loadConfig();
    const events = config.hooks && config.hooks.events;
    for (const spec of HOOK_SPECS) {
      const arr = events && events[spec.event];
      const registered = Array.isArray(arr) && arr.some((e) => e && e.hooks && e.hooks.some((h) => h.args && h.args.includes(spec.script)));
      check(`${spec.event} registered at cache path`, registered, "run: node scripts/install.mjs --phase hooks");
    }
    // And NO stale pre-0.3.0 top-level hook registrations remain
    let stale = 0;
    if (events) {
      for (const arr of Object.values(events)) {
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          if (!e || !e.hooks) continue;
          for (const h of e.hooks) {
            if (h.args && h.args.some((a) => isZodysseyHookArg(a) && !HOOK_SPECS.some((s) => h.args.includes(s.script)))) stale++;
          }
        }
      }
    }
    check("no stale pre-0.3.0 hook paths in config.json", stale === 0, `run: node scripts/install.mjs --phase hooks (${stale} stale)`);
  } catch (e) {
    check("config.json readable", false, e.message);
  }

  // 5. installed_plugins.json has the zodyssey@local entry at the right version/marketplace
  try {
    const data = loadPluginsJson();
    const entry = data.plugins.find((p) => p && p.id === PLUGIN_ID);
    const ok = entry && entry.version === VERSION && entry.marketplace === MARKETPLACE &&
      entry.installPath === CACHE_DIR && entry.scope === "user";
    check(`installed_plugins.json: ${PLUGIN_ID} @ ${VERSION} (marketplace=${MARKETPLACE})`, ok,
      entry ? "fields mismatch — re-run installer" : "run: node scripts/install.mjs --phase copy");
  } catch (e) {
    check("installed_plugins.json readable", false, e.message);
  }

  // 6. NO top-level pre-0.3.0 pollution remains
  const leftover = purgePaths()
    .filter((e) => existsSync(e.path) && (!e.owns || e.owns(e.path)))
    .map((e) => e.path);
  check("no pre-0.3.0 top-level pollution", leftover.length === 0,
    leftover.length ? `run: node scripts/install.mjs --phase purge (${leftover.length} left): ${leftover.join(", ")}` : "");

  // 7. Pipeline MCPs: config entry present + backend on PATH
  try {
    const config = loadConfig();
    const servers = (config.mcp && config.mcp.servers) || {};
    for (const spec of MCP_SPECS) {
      const entry = servers[spec.name];
      const backend = spec.backendPresent();
      check(`MCP ${spec.name}: ${entry ? "registered" : "NOT registered"}, backend ${backend ? "present" : "missing"}`,
        entry && backend,
        !backend ? spec.backendHint : (!entry ? "run: node scripts/install.mjs --phase hooks" : ""));
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
  log("\n=== Removing ZOdyssey ===\n");
  // 1. cache dir
  if (existsSync(CACHE_DIR)) {
    log(`rm -rf ${CACHE_DIR}`);
    if (!DRY) rmSync(CACHE_DIR, { recursive: true, force: true });
  } else {
    log(`(cache dir absent: ${CACHE_DIR})`);
  }
  // 2. installed_plugins.json entry
  unregisterFromPluginsJson();
  // 3. config.json hooks + MCPs (sweeps both cache paths and stale pre-0.3.0 paths)
  unregisterHooks();
  unregisterMCPs();
  // 4. AGENTS.md block
  unmergeAgentsMd();
  // 5. any pre-0.3.0 top-level pollution still on disk.
  //    --uninstall ignores the `owns` predicates (explicit removal by user request).
  for (const entry of purgePaths()) {
    if (existsSync(entry.path)) {
      log(`rm ${entry.path}`);
      if (!DRY) rmSync(entry.path, { recursive: true, force: true });
    }
  }
  log("\nUninstalled. (Run records under <repo>/.zcode/ are left in place — delete manually if desired.)\n");
}

// ============================================================
// summary
// ============================================================

function printSummary() {
  log("\n=== Summary ===");
  if (RUN_COPY) {
    log(`  Phase 1 (copy+register): cache → ${CACHE_DIR}`);
    log(`                          registered ${PLUGIN_ID} @ ${VERSION} in installed_plugins.json`);
  }
  if (RUN_PURGE) {
    log(`  Phase 2 (purge):         ${DRY ? "would remove" : "removed"} ${_purgeRemoved} pre-0.3.0 path(s), ${_purgeAbsent} already absent`);
  }
  if (RUN_HOOKS) {
    log(`  Phase 3 (hooks):         4 hooks → ${CACHE_HOOKS_DIR}/`);
    if (_configBackupPath) log(`                          config.json backup → ${_configBackupPath}`);
  }
}

// ---------- main ----------

function main() {
  console.log(`\nZOdyssey installer${DRY ? " (DRY RUN)" : UNINSTALL ? " (UNINSTALL)" : VERIFY ? " (VERIFY)" : PHASE ? ` (PHASE=${PHASE})` : ""}`);
  console.log(`  ZCode dir:   ${ZCODE_DIR}`);
  console.log(`  Repo:        ${REPO_ROOT}`);
  console.log(`  Plugin:      ${PLUGIN_ID} @ ${VERSION}\n`);

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

  if (RUN_COPY) phaseCopyAndRegister();
  if (RUN_PURGE) phasePurge();
  if (RUN_HOOKS) phaseRewriteHooks();

  printSummary();

  log("\n=== Done ===");
  log(`Next: start a NEW ZCode session (hooks load at startup), then run /orchestrate <task> in any repo.`);
  log(`Health-check the install: node scripts/install.mjs --verify`);
  log(`Config + troubleshooting: docs/INSTALL.md`);
  log(`Adapting to other harnesses (omo, Claude Code, ...): docs/ADAPT.md\n`);
  exit(0);
}

main();
