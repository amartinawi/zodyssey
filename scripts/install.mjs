#!/usr/bin/env node
// ZOdyssey installer — copies the plugin into ~/.zcode/ and registers the enforcement hooks.
// Idempotent: safe to re-run. Zero npm dependencies (uses only Node built-ins).
//
// Usage:
//   node scripts/install.mjs                # install (or re-install)
//   node scripts/install.mjs --uninstall    # remove ZOdyssey from ~/.zcode/
//   node scripts/install.mjs --dry-run      # show what would happen, change nothing
//
// What it does:
//   1. Copies skills/odyssey/, agents/*.md, commands/*.md into ~/.zcode/
//   2. Registers the 4 hooks (PreToolUse, PostToolUse, Stop, UserPromptSubmit) in ~/.zcode/cli/config.json
//   3. Merges the ZOdyssey section into ~/.zcode/AGENTS.md (if the marker isn't already present)
//   4. Inits ~/.zcode/orchestration/eval/ (for the optional eval harness)
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

  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") {
      log(`  (config.json not found — creating fresh at ${CONFIG_PATH})`);
      mkdirSync(CLI_DIR, { recursive: true });
      config = {};
    } else {
      throw new Error(`Could not parse ${CONFIG_PATH}: ${e.message}. Fix it manually and re-run.`);
    }
  }
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

  // backup + write
  writeFileSync(CONFIG_PATH + ".zodyssey-backup", readFileSync(CONFIG_PATH));
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
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
  console.log(`\nZOdyssey installer${DRY ? " (DRY RUN)" : UNINSTALL ? " (UNINSTALL)" : ""}`);
  console.log(`  ZCode dir: ${ZCODE_DIR}`);
  console.log(`  Repo:      ${REPO_ROOT}\n`);

  try {
    execSync("node --version", { stdio: "ignore" });
  } catch {
    console.error("ERROR: node not found on PATH. Install Node 18+ first.");
    exit(1);
  }

  if (UNINSTALL) {
    log("\n=== Removing ZOdyssey ===\n");
    unregisterHooks();
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
  mergeAgentsMd();
  initEvalDir();

  log("\n=== Done ===");
  log(`Next: start a NEW ZCode session (hooks load at startup), then run /orchestrate <task> in any repo.`);
  log(`Config + troubleshooting: docs/INSTALL.md`);
  log(`Adapting to other harnesses (omo, Claude Code, ...): docs/ADAPT.md\n`);
  exit(0);
}

main();
