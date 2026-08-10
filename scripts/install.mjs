#!/usr/bin/env node
// ZOdyssey installer — copies the plugin into ~/.zcode/, registers hooks + pipeline MCPs,
// and detects optional dependencies. Idempotent: safe to re-run. Zero npm dependencies.
//
// Usage:
//   node scripts/install.mjs                # install (or re-install)
//   node scripts/install.mjs --uninstall    # remove ZOdyssey from ~/.zcode/
//   node scripts/install.mjs --dry-run      # show what would happen, change nothing
//   node scripts/install.mjs --verify       # health-check the install (hooks, MCPs, skills)
//
// What it does:
//   1. Copies skills/odyssey/, agents/*.md, commands/*.md into ~/.zcode/
//   2. Registers the 4 hooks (PreToolUse, PostToolUse, Stop, UserPromptSubmit) in ~/.zcode/cli/config.json
//   3. Registers the 5 pipeline MCPs (memory, sequential-thinking, codegraph, chrome-devtools,
//      zai-mcp-server) — each gated on its backend being on PATH; skipped with a hint if not.
//   4. Merges the ZOdyssey section into ~/.zcode/AGENTS.md (if the marker isn't already present)
//   5. Inits ~/.zcode/orchestration/eval/ (for the optional eval harness)
//   6. Detects the superpowers plugin (source of most routed skills); prints a pointer if missing
//
// Hooks are NO-OP unless an orchestration run is active, so installing this does NOT change
// normal ZCode behavior. The gate only arms when you run /orchestrate.

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, mkdirSync } from "node:fs";
import { cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { argv, exit } from "node:process";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ZCODE_DIR = join(homedir(), ".zcode");
const CLI_DIR = join(ZCODE_DIR, "cli");
const CONFIG_PATH = join(CLI_DIR, "config.json");
const AGENTS_MD_PATH = join(ZCODE_DIR, "AGENTS.md");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = dirname(__dirname);

const DRY = argv.includes("--dry-run");
const UNINSTALL = argv.includes("--uninstall");
const VERIFY = argv.includes("--verify");

const log = (m) => console.log(DRY ? `[dry-run] ${m}` : m);
const logDim = (m) => console.log(DRY ? `[dry-run]   ${m}` : `   ${m}`);

// ---------- file ops (built-in cpSync, available in Node 16.7+) ----------

function copyTree(src, dst, label) {
  if (!existsSync(src)) { log(`(skip) ${label}: source not found at ${src}`); return; }
  const n = readdirSync(src).length;
  log(`copy ${label}: ${src} → ${dst} (${n} entries)`);
  if (DRY) return;
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true, force: true });
}

function copyFiles(srcDir, dstDir, label) {
  if (!existsSync(srcDir)) { log(`(skip) ${label}: source not found`); return; }
  const files = readdirSync(srcDir).filter((f) => statSync(join(srcDir, f)).isFile());
  log(`copy ${label}: ${files.length} file(s) → ${dstDir}`);
  if (DRY) { files.forEach((f) => logDim(f)); return; }
  mkdirSync(dstDir, { recursive: true });
  for (const f of files) cpSync(join(srcDir, f), join(dstDir, f), { force: true });
}

// ---------- hook registration ----------

const HOOK_SPECS = [
  { event: "PreToolUse",  matcher: "Write|Edit|ApplyPatch|MultiEdit|NotebookEdit|Bash|Task|Agent",
    script: join(ZCODE_DIR, "skills", "odyssey", "hooks", "pre-tool.mjs") },
  // PostToolUse matcher MUST include the edit tools so the post-edit diagnostics arm fires.
  // (v0.1.0 shipped "Task|Agent" only, which silently dead-coded the diagnostics arm.)
  { event: "PostToolUse", matcher: "Task|Agent|Edit|Write|MultiEdit",
    script: join(ZCODE_DIR, "skills", "odyssey", "hooks", "post-tool.mjs") },
  { event: "Stop",        matcher: ".*",
    script: join(ZCODE_DIR, "skills", "odyssey", "hooks", "stop.mjs") },
  // UserPromptSubmit (v0.1.1): trivial-gate warning-only hook. Never blocks (exit 0).
  { event: "UserPromptSubmit", matcher: ".*",
    script: join(ZCODE_DIR, "skills", "odyssey", "hooks", "user-prompt-submit.mjs") },
];

function resolveNodeBin() {
  // absolute path avoids PATH issues inside ZCode hook spawns
  for (const p of ["/usr/bin/node", "/usr/local/bin/node"]) if (existsSync(p)) return p;
  return "node";
}

function registerHooks() {
  log(`register hooks in ${CONFIG_PATH}`);
  if (DRY) { HOOK_SPECS.forEach((h) => logDim(`${h.event} [${h.matcher}] → ${h.script}`)); return; }

  const config = loadConfig();
  if (!config.hooks || typeof config.hooks !== "object") config.hooks = {};
  config.hooks.enabled = true;
  if (!config.hooks.events || typeof config.hooks.events !== "object") config.hooks.events = {};

  const nodeBin = resolveNodeBin();
  let added = 0, updated = 0;
  for (const spec of HOOK_SPECS) {
    if (!Array.isArray(config.hooks.events[spec.event])) config.hooks.events[spec.event] = [];
    let entry = config.hooks.events[spec.event].find((e) => e && e.matcher === spec.matcher);
    const hookObj = { type: "process", command: nodeBin, args: [spec.script], timeoutMs: 5000 };
    if (!entry) {
      entry = { matcher: spec.matcher, hooks: [] };
      config.hooks.events[spec.event].push(entry);
    }
    const before = entry.hooks.length;
    entry.hooks = entry.hooks.filter((h) => !(h.args && h.args.includes(spec.script)));
    const isNew = entry.hooks.length === before;
    entry.hooks.push(hookObj);
    if (isNew) added++; else updated++;
    logDim(`${isNew ? "added" : "updated"} ${spec.event} [${spec.matcher}]`);
  }

  saveConfig(config);
  log(`  hooks registered (${added} added, ${updated} updated). Backup: ${CONFIG_PATH}.zodyssey-backup`);
}

function unregisterHooks() {
  log(`unregister hooks from ${CONFIG_PATH}`);
  if (DRY) return;
  let config;
  try { config = JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { log("  (config.json not readable — nothing to remove)"); return; }
  if (!config.hooks || !config.hooks.events) { log("  (no hooks.events — nothing to remove)"); return; }
  let removed = 0;
  for (const spec of HOOK_SPECS) {
    const entries = config.hooks.events[spec.event];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && entry.hooks) {
        const before = entry.hooks.length;
        entry.hooks = entry.hooks.filter((h) => !(h.args && h.args.includes(spec.script)));
        removed += before - entry.hooks.length;
      }
    }
    config.hooks.events[spec.event] = config.hooks.events[spec.event].filter((e) => e && e.hooks && e.hooks.length > 0);
    if (config.hooks.events[spec.event].length === 0) delete config.hooks.events[spec.event];
  }
  if (Object.keys(config.hooks.events).length === 0) config.hooks.enabled = false;
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  log(`  removed ${removed} hook(s)`);
}

// ---------- MCP registration (pipeline MCPs only) ----------
//
// The ZOdyssey pipeline routes a handful of MCPs at runtime. We register ONLY those (not the
// user's other 20 MCPs). Each spec declares how to (a) detect the backend is installable and
// (b) the config block to write into cli/config.json's mcp.servers. If the backend is missing
// we skip with a warning instead of writing a dead entry that would error on every session.
//
// Detection is conservative: `which`/`command -v` for binaries, `npx -y <pkg> --help` is NOT
// run (too slow); for npx-backed MCPs we trust that `npx` exists + the package name is public.
// The user still has to be online the first time the MCP actually spawns (npx caches it).

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
    // codegraph is a global npm bin (root-owned on the reference machine). It's optional —
    // codegraph-impact.mjs no-ops gracefully when no .codegraph/ index exists in the target repo.
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
    // It is NOT an npm package — it ships as a standalone binary or a uvx-managed Python tool,
    // depending on the install path. We register it only if the binary is already on PATH;
    // otherwise we print the hint and skip (the F3 wiring doc references it by name).
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
  // `which` on most unices, `command -v` as a portable fallback. Returns true if the binary resolves.
  try {
    execSync(`command -v ${cmd} >/dev/null 2>&1`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") {
      mkdirSync(CLI_DIR, { recursive: true });
      return {};
    }
    throw new Error(`Could not parse ${CONFIG_PATH}: ${e.message}. Fix it manually and re-run.`);
  }
}

function saveConfig(config) {
  writeFileSync(CONFIG_PATH + ".zodyssey-backup", readFileSync(CONFIG_PATH));
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
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
  log(`  MCPs registered (${added} added, ${MCP_SPECS.length - added - skipped} updated, ${skipped} skipped — backends missing). Backup: ${CONFIG_PATH}.zodyssey-backup`);
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
// Most routed skills (tdd, systematic-debugging, writing-plans, brainstorming, etc.) live in the
// external superpowers plugin, not this repo. We detect it and print a pointer if missing.
// We do NOT auto-install a third-party plugin — that's the user's call.
// Detection: superpowers skills land under the plugin cache OR ~/.zcode/skills/ when installed.

function detectSuperpowers() {
  log(`check superpowers plugin`);
  const locations = [
    join(ZCODE_DIR, "cli", "plugins", "cache", "claude-plugins-official", "superpowers"),
    join(ZCODE_DIR, "cli", "plugins", "cache", "zcode-plugins-official", "superpowers"),
    join(ZCODE_DIR, "skills", "test-driven-development"),  // flat-install fallback
  ];
  const found = locations.some((p) => {
    try { return existsSync(p) && statSync(p).isDirectory(); } catch { return false; }
  });
  // Also check installed_plugins.json if it exists (more reliable signal than dir presence)
  try {
    const ip = join(ZCODE_DIR, "cli", "plugins", "installed_plugins.json");
    if (existsSync(ip)) {
      const data = JSON.parse(readFileSync(ip, "utf8"));
      const list = Array.isArray(data) ? data : Object.values(data).flat();
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
  console.log(`\nZOdyssey verify — health check\n`);
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

  // 2. Each registered hook script exists + parses
  for (const spec of HOOK_SPECS) {
    const exists = existsSync(spec.script);
    let parses = false;
    if (exists) {
      try { execSync(`node --check ${JSON.stringify(spec.script)}`, { stdio: "ignore" }); parses = true; }
      catch { parses = false; }
    }
    check(`hook ${spec.event} script parses`, exists && parses, exists ? "syntax error" : `missing: ${spec.script}`);
  }

  // 3. Hooks registered in config.json
  try {
    const config = loadConfig();
    const events = config.hooks && config.hooks.events;
    for (const spec of HOOK_SPECS) {
      const arr = events && events[spec.event];
      const registered = Array.isArray(arr) && arr.some((e) => e && e.hooks && e.hooks.some((h) => h.args && h.args.includes(spec.script)));
      check(`${spec.event} hook registered in config.json`, registered, `run: node scripts/install.mjs`);
    }
  } catch (e) {
    check("config.json readable", false, e.message);
  }

  // 4. Pipeline MCPs: config entry present + backend on PATH
  try {
    const config = loadConfig();
    const servers = (config.mcp && config.mcp.servers) || {};
    for (const spec of MCP_SPECS) {
      const entry = servers[spec.name];
      const backend = spec.backendPresent();
      check(`MCP ${spec.name}: ${entry ? "registered" : "NOT registered"}, backend ${backend ? "present" : "missing"}`,
        entry && backend,
        !backend ? spec.backendHint : (!entry ? "run: node scripts/install.mjs" : ""));
    }
  } catch (e) {
    check("MCP config readable", false, e.message);
  }

  // 5. Core skills + agents present
  check("skills/odyssey/SKILL.md", existsSync(join(ZCODE_DIR, "skills", "odyssey", "SKILL.md")), "re-run installer");
  for (const a of ["metis", "prometheus", "momus", "sisyphus-junior"]) {
    check(`agents/${a}.md`, existsSync(join(ZCODE_DIR, "agents", `${a}.md`)), "re-run installer");
  }

  // 6. superpowers
  try {
    const ip = join(ZCODE_DIR, "cli", "plugins", "installed_plugins.json");
    let sp = false;
    [join(ZCODE_DIR, "cli", "plugins", "cache", "claude-plugins-official", "superpowers"),
     join(ZCODE_DIR, "cli", "plugins", "cache", "zcode-plugins-official", "superpowers")].forEach((p) => {
      try { if (existsSync(p)) sp = true; } catch {}
    });
    if (existsSync(ip)) {
      try {
        const data = JSON.parse(readFileSync(ip, "utf8"));
        const list = Array.isArray(data) ? data : Object.values(data).flat();
        if (list.some((p) => p && (p.name || p.id || "").includes("superpowers"))) sp = true;
      } catch {}
    }
    check("superpowers plugin (optional, for routed skills)", sp, "see https://github.com/obra/superpowers");
  } catch {}

  console.log(`\n${problems === 0 ? "✓ all checks passed" : `✗ ${problems} problem(s) found`}\n`);
  exit(problems === 0 ? 0 : 1);
}

// ---------- AGENTS.md merge ----------

const AGENTS_BLOCK = `
<!-- ZODYSSEY_START -->
# ZOdyssey Orchestration

ZOdyssey is an opt-in multi-agent orchestration pipeline. It is NOT the default mode —
normal requests are handled directly. Use it only when the user invokes \`/orchestrate\`.

## When to use it
- The user typed \`/orchestrate <task>\`, \`/orchestrate resume <slug>\`, or \`/orchestrate status <slug>\`.
- Otherwise: do NOT orchestrate. Answer, edit, and search normally.

## The pipeline (load the \`odyssey\` skill to run it)
Phases: -1 Prime -> 0 Triage -> 1 Consult (metis) -> 2 Plan (prometheus) -> 3 Review gate (momus) ->
4 Execute (sisyphus-junior, parallel-by-default) -> 5 Verify -> 6 Final wave (F1-F4).

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
  if (existing.includes("<!-- ZODYSSEY_START -->")) { log("  (block already present — skipping)"); return; }
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
  const seedSrc = join(REPO_ROOT, "skills", "odyssey", "scripts");
  // seed.jsonl ships the eval seed. Copy it if present (don't overwrite an existing one).
  const seedDst = join(evalDir, "seed.jsonl");
  try { if (existsSync(join(seedSrc, "seed.jsonl")) && !existsSync(seedDst)) cpSync(join(seedSrc, "seed.jsonl"), seedDst); } catch {}
  const gitkeep = join(evalDir, ".gitkeep");
  if (!existsSync(gitkeep)) writeFileSync(gitkeep, "");
}

// ---------- main ----------

function main() {
  console.log(`\nZOdyssey installer${DRY ? " (DRY RUN)" : UNINSTALL ? " (UNINSTALL)" : VERIFY ? " (VERIFY)" : ""}`);
  console.log(`  ZCode dir: ${ZCODE_DIR}`);
  console.log(`  Repo:      ${REPO_ROOT}\n`);

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
    log("\n=== Removing ZOdyssey ===\n");
    unregisterHooks();
    unregisterMCPs();
    unmergeAgentsMd();
    for (const p of [
      join(ZCODE_DIR, "skills", "odyssey"),
      ...["metis","prometheus","momus","sisyphus-junior","explore","librarian","oracle","multimodal-looker"].map((a) => join(ZCODE_DIR, "agents", `${a}.md`)),
      join(ZCODE_DIR, "commands", "orchestrate.md"),
      join(ZCODE_DIR, "commands", "orchestrate-consult.md"),
    ]) {
      if (existsSync(p)) { log(`rm ${p}`); if (!DRY) rmSync(p, { recursive: true, force: true }); }
    }
    log("\nUninstalled. (Run records under <repo>/.zcode/ are left in place — delete manually if desired.)\n");
    exit(0);
  }

  log("\n=== Installing ZOdyssey ===\n");
  copyTree(join(REPO_ROOT, "skills", "odyssey"), join(ZCODE_DIR, "skills", "odyssey"), "skills/odyssey");
  copyFiles(join(REPO_ROOT, "agents"), join(ZCODE_DIR, "agents"), "agents/");
  copyFiles(join(REPO_ROOT, "commands"), join(ZCODE_DIR, "commands"), "commands/");
  registerHooks();
  registerMCPs();
  mergeAgentsMd();
  initEvalDir();
  detectSuperpowers();

  log("\n=== Done ===");
  log(`Next: start a NEW ZCode session (hooks load at startup), then run /orchestrate <task> in any repo.`);
  log(`Health-check the install: node scripts/install.mjs --verify`);
  log(`Config + troubleshooting: docs/INSTALL.md`);
  log(`Adapting to other harnesses (omo, Claude Code, ...): docs/ADAPT.md\n`);
  exit(0);
}

main();
