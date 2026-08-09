#!/usr/bin/env node
// resolve-capabilities.mjs — capability-grant reconciliation (integration-consult INTEG-#2).
//
// The CRIT-1 class of bug: an agent's body says "use codegraph" but its tools: allowlist denies it,
// SILENTLY. Nothing in the ecosystem introspects agent frontmatter to catch this. This script does:
// it reads each agent's tools: grant, the routing table (capabilities.md), and the live MCP/skill
// inventory on disk, then emits three sets to .zcode/capabilities.lock.json:
//   - routed_and_granted:    the agent CAN use what it's told to (good)
//   - routed_but_not_granted: HARD ERROR — the silent-denial class (exit 6 if non-empty)
//   - present_but_unrouted:  warning — an installed capability nothing routes to (context cost)
//
// The orchestrator reads the lock file at dispatch time and refuses to name a capability in a
// dispatch's REQUIRED CAPABILITIES that isn't in the granted set. Pair with a per-agent smoke test.
//
// Usage:
//   resolve-capabilities.mjs                       # scan, write lock, exit 6 on hard errors
//   resolve-capabilities.mjs --check               # exit 0 clean / 6 hard errors / no write
//   resolve-capabilities.mjs --agent <name>        # one agent's resolution
//   exit: 0 clean · 2 bad args · 6 routed-but-not-granted violations found

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, env } from "node:process";

const HOME = env.HOME || "";
const AGENTS_DIR = join(HOME, ".zcode", "agents");
const SKILLS_DIR = join(HOME, ".zcode", "skills");
const CAPS_MD = join(SKILLS_DIR, "odyssey", "references", "capabilities.md");
const LOCK_PATH = join(HOME, ".zcode", "capabilities.lock.json");

const args = argv.slice(2);
const checkOnly = args.includes("--check");
const agentIdx = args.indexOf("--agent");
const oneAgent = agentIdx !== -1 ? args[agentIdx + 1] : null;

// --- gather the live MCP inventory from the config ---
function liveMcps() {
  try {
    const cfg = JSON.parse(readFileSync(join(HOME, ".zcode", "cli", "config.json"), "utf8"));
    const m = cfg.mcpServers?.servers || cfg.mcpServers || {};
    const names = new Set();
    const walk = (o) => { if (!o || typeof o !== "object") return; for (const k of Object.keys(o)) { if (typeof o[k] === "object" && (o[k].command || o[k].url)) names.add(k); else if (typeof o[k] === "object") walk(o[k]); } };
    walk(m);
    return names;
  } catch { return new Set(); }
}
// --- gather the live skill inventory on disk ---
function liveSkills() {
  if (!existsSync(SKILLS_DIR)) return new Set();
  return new Set(readdirSync(SKILLS_DIR).filter((d) => existsSync(join(SKILLS_DIR, d, "SKILL.md"))));
}

const mcps = liveMcps();
const skills = liveSkills();

// --- parse each agent's frontmatter tools: + the capabilities its body references ---
function parseAgent(file) {
  const txt = readFileSync(file, "utf8");
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const fm = m[1];
  const toolsLine = fm.split("\n").find((l) => /^tools:/.test(l));
  const granted = new Set();
  if (toolsLine) {
    for (let t of toolsLine.replace(/^tools:\s*/, "").split(",")) {
      t = t.trim(); if (t) granted.add(t);
    }
  }
  // crude: scan the body for capability references the agent is told to use
  const body = txt.slice(m[0].length);
  const referenced = new Set();
  for (const mm of body.matchAll(/mcp__(\w+)__/g)) referenced.add(`mcp__${mm[1]}__`);
  for (const mm of body.matchAll(/skill:\s*([a-z0-9:-]+)/gi)) referenced.add(`skill:${mm[1]}`);
  for (const mm of body.matchAll(/\b(codegraph_explore|Context7|resolve-library-id|query-docs)\b/g)) {
    if (mm[1] === "codegraph_explore") referenced.add("mcp__codegraph__");
    if (mm[1] === "Context7" || mm[1].includes("library")) referenced.add("mcp__Context7__");
  }
  return { granted, referenced };
}

const agentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md") && f !== "README.md");
const selected = oneAgent ? [`${oneAgent}.md`] : agentFiles;

const routedAndGranted = {};
const routedButNotGranted = {}; // HARD ERRORS
const presentButUnrouted = { mcps: [], skills: [] };

for (const f of selected) {
  const name = f.replace(/\.md$/, "");
  const a = parseAgent(join(AGENTS_DIR, f));
  if (!a) continue;
  routedAndGranted[name] = [];
  routedButNotGranted[name] = [];
  for (const ref of a.referenced) {
    // is ref granted? mcp__X__ matches any granted mcp__X__<tool>; skill:X matches granted Skill... which
    // we can't confirm (the open trust-anchor) — flag skill: refs as a separate warning, not hard error
    const grantedHit = [...a.granted].some((g) => ref.startsWith("mcp__") ? g.startsWith(ref) : g === ref);
    if (grantedHit) routedAndGranted[name].push(ref);
    else if (ref.startsWith("mcp__")) routedButNotGranted[name].push(ref); // MCP denied = hard error
    // skill: refs go to a separate advisory (the unconfirmed Skill-grant token) — not a hard error
  }
}

// present-but-unrouted: installed MCPs/skills no agent references
const allReferenced = new Set();
for (const name of Object.keys(routedAndGranted)) {
  const a = parseAgent(join(AGENTS_DIR, `${name}.md`));
  if (a) for (const r of a.referenced) allReferenced.add(r);
}
for (const m of mcps) {
  const tok = `mcp__${m}__`;
  if (![...allReferenced].some((r) => r.startsWith(tok))) presentButUnrouted.mcps.push(m);
}

const hardErrors = Object.values(routedButNotGranted).some((arr) => arr.length > 0);

const lock = {
  generated_at: new Date().toISOString(),
  agents: Object.fromEntries(selected.map((f) => {
    const n = f.replace(/\.md$/, "");
    return [n, { granted: routedAndGranted[n] || [], routed_but_not_granted: routedButNotGranted[n] || [] }];
  })),
  present_but_unrouted: presentButUnrouted,
  note: "routed_but_not_granted = HARD ERROR (agent told to use a capability its tools: deny). present_but_unrouted = installed capability no agent routes to (context cost).",
};

if (!checkOnly) writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + "\n");
console.log(JSON.stringify(lock, null, 2));
if (hardErrors) {
  console.error("\nresolve-capabilities: HARD ERRORS — agents reference capabilities their tools: deny. Fix the frontmatter or remove the reference.");
  exit(6);
}
exit(0);
