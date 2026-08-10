#!/usr/bin/env node
// resolve-capabilities.mjs — capability-grant reconciliation + lock-file snapshot + drift check.
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
// TWO NEW MODES (todo 6 — capabilities autogen):
//   DEFAULT (generate): scan the FULL live inventory (skills incl. plugins/agents-tree, agents,
//     MCPs from cli/config.json, codegraph presence) and write ~/.zcode/capabilities.lock.json as
//     a machine snapshot. The reconciliation section above is preserved and embedded under `agents`.
//   --drift-check: parse capabilities.md for the capability names it ROUTES (skill:<n>, Task:<n>,
//     <n> MCP) and compare against the lock. Exit 6 with a stderr report when:
//       (1) capabilities.md routes a capability NOT installed (stale route), OR
//       (2) an installed capability has NO route in capabilities.md (orphaned install), OR
//       (3) two installed skills share a domain (e.g. UI design) but only one is routed
//           (duplicate-domain drift — surfaces both names).
//     Report-only; never edits capabilities.md.
//
// Usage:
//   resolve-capabilities.mjs                       # generate lock + reconcile; exit 6 on hard errors
//   resolve-capabilities.mjs --check               # reconcile only; exit 0/6; no write
//   resolve-capabilities.mjs --drift-check         # lock vs capabilities.md; exit 6 on drift
//   resolve-capabilities.mjs --agent <name>        # one agent's reconciliation
//   exit: 0 clean · 2 bad args · 6 violations found

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, env } from "node:process";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";

const HOME = env.HOME || "";
const AGENTS_DIR = join(HOME, ".zcode", "agents");
const SKILLS_DIR = join(HOME, ".zcode", "skills");
const AGENTS_SKILLS_DIR = join(HOME, ".agents", "skills");
const PLUGIN_CACHE = join(HOME, ".zcode", "cli", "plugins", "cache");
const CFG_PATH = join(HOME, ".zcode", "cli", "config.json");
const CAPS_MD = join(SKILLS_DIR, "odyssey", "references", "capabilities.md");
const LOCK_PATH = join(HOME, ".zcode", "capabilities.lock.json");

// ENV overrides (used by the test harness so fixtures replace the live tree):
//   ZCAP_HOME            — root that contains .zcode (defaults to $HOME)
//   ZCAP_CAPS_MD         — path to capabilities.md fixture
//   ZCAP_LOCK_PATH       — where to write the lock (defaults to <root>/.zcode/capabilities.lock.json)
//   ZCAP_CFG_PATH        — cli/config.json fixture
//   ZCAP_NO_CODEGRAPH    — "1" forces codegraph=false (tests can't rely on the host binary)
const ROOT = env.ZCAP_HOME || HOME;
const SKILLS_ROOT = join(ROOT, ".zcode", "skills");
const AGENTS_ROOT = join(ROOT, ".zcode", "agents");
const AGENTS_SKILLS_ROOT = join(ROOT, ".agents", "skills");
const PLUGIN_ROOT = join(ROOT, ".zcode", "cli", "plugins", "cache");
const CAPS_MD_PATH = env.ZCAP_CAPS_MD || join(SKILLS_ROOT, "odyssey", "references", "capabilities.md");
const LOCK_OUT = env.ZCAP_LOCK_PATH || join(ROOT, ".zcode", "capabilities.lock.json");
const CFG_FILE = env.ZCAP_CFG_PATH || join(ROOT, ".zcode", "cli", "config.json");

const args = argv.slice(2);
const checkOnly = args.includes("--check");
const driftCheck = args.includes("--drift-check");
const agentIdx = args.indexOf("--agent");
const oneAgent = agentIdx !== -1 ? args[agentIdx + 1] : null;

// ---------------------------------------------------------------------------
// Inventory scanning (the new generate-mode substrate)
// ---------------------------------------------------------------------------

// Extract the `name:` field from a SKILL.md / agent .md frontmatter. Falls back to the basename
// of the containing directory when there's no frontmatter or no name line.
function extractName(filePath, fallback) {
  try {
    const txt = readFileSync(filePath, "utf8");
    const m = txt.match(/^---\n([\s\S]*?)\n---/);
    if (m) {
      const nl = m[1].split("\n").find((l) => /^name:/.test(l));
      if (nl) {
        const v = nl.replace(/^name:\s*/, "").replace(/^["']|["']$/g, "").trim();
        if (v) return v;
      }
    }
  } catch { /* fall through */ }
  return fallback;
}

// Recursively find SKILL.md files under a root, returning [{name, path}].
// Uses readdirSync (not `find`) because `find -name` silently skipped skills on this host
// when the tree contained nested/symlinked dirs — directory-walk is reliable.
// CRITICAL: many user skills are SYMLINKS (playwright, review-agent, ...). Node's Dirent
// reports symlinks-to-dirs as isSymbolicLink()=true / isDirectory()=false, so a naive
// e.isDirectory() check skips them. We statSync (which follows the link) to decide.
function isDirFollowing(entry, fullPath) {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) {
    try { return statSync(fullPath).isDirectory(); } catch { return false; }
  }
  return false;
}
function findSkillFiles(root) {
  const out = [];
  if (!existsSync(root)) return out;
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    if (seen.has(dir)) continue;
    seen.add(dir);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (isDirFollowing(e, full)) stack.push(full);
      else if (e.isFile() && e.name === "SKILL.md") out.push(full);
    }
  }
  return out;
}

function scanSkills() {
  const names = new Set();
  const withMeta = [];
  const roots = [SKILLS_ROOT, AGENTS_SKILLS_ROOT];
  // plugin cache: ~/.zcode/cli/plugins/cache/<org>/<plugin>/<ver>/skills/...
  if (existsSync(PLUGIN_ROOT)) {
    for (const org of readdirSync(PLUGIN_ROOT)) {
      const orgDir = join(PLUGIN_ROOT, org);
      try { if (!existsSync(orgDir)) continue; } catch { continue; }
      for (const pl of readdirSync(orgDir)) {
        const plDir = join(orgDir, pl);
        for (const ver of (existsSync(plDir) ? readdirSync(plDir) : [])) {
          roots.push(join(plDir, ver));
        }
      }
    }
  }
  const dedup = new Map(); // path -> name, to collapse duplicates across roots
  for (const r of roots) {
    for (const f of findSkillFiles(r)) {
      const name = extractName(f, "");
      if (!name) continue;
      names.add(name);
      if (!dedup.has(f)) {
        dedup.set(f, name);
        withMeta.push({ name, path: f });
      }
    }
  }
  return { names, withMeta };
}

// Plugin agents live ONLY in `<plugin>/<ver>/agents/*.md` — never in arbitrary docs/READMEs.
// The cache holds 200+ .md files (plans, AGENTS.md, CLAUDE.md, docs); only the `agents/` subdir
// is authoritative. We collect those dirs explicitly and never recurse into the rest.
function pluginAgentDirs() {
  const dirs = [];
  if (!existsSync(PLUGIN_ROOT)) return dirs;
  for (const org of readdirSync(PLUGIN_ROOT)) {
    const orgDir = join(PLUGIN_ROOT, org);
    if (!existsSync(orgDir)) continue;
    for (const pl of readdirSync(orgDir)) {
      const plDir = join(orgDir, pl);
      if (!existsSync(plDir)) continue;
      for (const ver of readdirSync(plDir)) {
        const a = join(plDir, ver, "agents");
        if (existsSync(a)) dirs.push(a);
        // skill-creator nests its agent under skills/<sk>/agents
        const skRoot = join(plDir, ver, "skills");
        if (existsSync(skRoot)) {
          for (const sk of readdirSync(skRoot)) {
            const a2 = join(skRoot, sk, "agents");
            if (existsSync(a2)) dirs.push(a2);
          }
        }
      }
    }
  }
  return dirs;
}

function scanAgents() {
  const names = new Set();
  const withMeta = [];
  const seen = new Set();
  const collect = (dir) => {
    if (!existsSync(dir)) return;
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.name.endsWith(".md")) continue;
      if (e.name === "README.md") continue;
      const full = join(dir, e.name);
      // accept real files and symlinked .md (some installs symlink agents)
      if (!(e.isFile() || e.isSymbolicLink())) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      const name = extractName(full, e.name.replace(/\.md$/, ""));
      names.add(name);
      withMeta.push({ name, path: full });
    }
  };
  collect(AGENTS_ROOT);           // user agents: top-level *.md
  for (const d of pluginAgentDirs()) collect(d); // plugin agents: <plugin>/<ver>/agents/*.md
  return { names, withMeta };
}

function scanMcps() {
  try {
    const cfg = JSON.parse(readFileSync(CFG_FILE, "utf8"));
    const m = cfg.mcp?.servers || cfg.mcpServers?.servers || cfg.mcpServers || {};
    const names = new Set();
    const walk = (o) => {
      if (!o || typeof o !== "object") return;
      for (const k of Object.keys(o)) {
        if (typeof o[k] === "object" && (o[k].command || o[k].url)) names.add(k);
        else if (typeof o[k] === "object") walk(o[k]);
      }
    };
    walk(m);
    return names;
  } catch { return new Set(); }
}

function detectCodegraph() {
  if (env.ZCAP_NO_CODEGRAPH === "1") return false;
  if (existsSync(join(ROOT, ".codegraph"))) return true;
  if (existsSync(join(HOME, ".codegraph"))) return true;
  try {
    const r = spawnSync("codegraph", ["--version"], { encoding: "utf8" });
    if (r.status === 0 || r.error === undefined) return true;
  } catch { /* ignore */ }
  return false;
}

// Build the full inventory lock object.
function buildInventoryLock() {
  const skills = scanSkills();
  const agents = scanAgents();
  const mcps = scanMcps();
  const codegraph = detectCodegraph();
  return {
    generated_at: new Date().toISOString(),
    skills: Array.from(skills.names).sort(),
    agents: Array.from(agents.names).sort(),
    mcps: Array.from(mcps).sort(),
    codegraph,
    sources: {
      skills_roots: [SKILLS_ROOT, AGENTS_SKILLS_ROOT, `${PLUGIN_ROOT}/<org>/<plugin>/<ver>`],
      agents_root: AGENTS_ROOT,
      mcps_source: CFG_FILE,
    },
  };
}

// ---------------------------------------------------------------------------
// Legacy reconciliation (preserved verbatim in behavior)
// ---------------------------------------------------------------------------

// --- gather the live MCP inventory from the config (kept for the reconcile path) ---
function liveMcps() {
  try {
    const cfg = JSON.parse(readFileSync(CFG_FILE, "utf8"));
    const m = cfg.mcp?.servers || cfg.mcpServers?.servers || cfg.mcpServers || {};
    const names = new Set();
    const walk = (o) => { if (!o || typeof o !== "object") return; for (const k of Object.keys(o)) { if (typeof o[k] === "object" && (o[k].command || o[k].url)) names.add(k); else if (typeof o[k] === "object") walk(o[k]); } };
    walk(m);
    return names;
  } catch { return new Set(); }
}
// --- gather the live skill inventory on disk (reconcile path keeps the original shallow scan) ---
function liveSkills() {
  if (!existsSync(SKILLS_ROOT)) return new Set();
  return new Set(readdirSync(SKILLS_ROOT).filter((d) => existsSync(join(SKILLS_ROOT, d, "SKILL.md"))));
}

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

function reconcile() {
  const mcps = liveMcps();
  const agentFiles = existsSync(AGENTS_ROOT) ? readdirSync(AGENTS_ROOT).filter((f) => f.endsWith(".md") && f !== "README.md") : [];
  const selected = oneAgent ? [`${oneAgent}.md`] : agentFiles;

  const routedAndGranted = {};
  const routedButNotGranted = {};
  const presentButUnrouted = { mcps: [], skills: [] };

  for (const f of selected) {
    const name = f.replace(/\.md$/, "");
    const a = parseAgent(join(AGENTS_ROOT, f));
    if (!a) continue;
    routedAndGranted[name] = [];
    routedButNotGranted[name] = [];
    for (const ref of a.referenced) {
      const grantedHit = [...a.granted].some((g) => ref.startsWith("mcp__") ? g.startsWith(ref) : g === ref);
      if (grantedHit) routedAndGranted[name].push(ref);
      else if (ref.startsWith("mcp__")) routedButNotGranted[name].push(ref);
    }
  }

  const allReferenced = new Set();
  for (const name of Object.keys(routedAndGranted)) {
    const a = parseAgent(join(AGENTS_ROOT, `${name}.md`));
    if (a) for (const r of a.referenced) allReferenced.add(r);
  }
  for (const m of mcps) {
    const tok = `mcp__${m}__`;
    if (![...allReferenced].some((r) => r.startsWith(tok))) presentButUnrouted.mcps.push(m);
  }

  const hardErrors = Object.values(routedButNotGranted).some((arr) => arr.length > 0);
  return { routedAndGranted, routedButNotGranted, presentButUnrouted, hardErrors, selected };
}

// ---------------------------------------------------------------------------
// Drift check (lock vs capabilities.md)
// ---------------------------------------------------------------------------

// Keyword → domain bucket. Two skills in the same bucket = duplicate-domain drift candidate.
// Keywords are deliberately SPECIFIC (product/proper names), because bare words like "video" or
// "design" appear in unrelated descriptions (e.g. prompt-master mentions "video AI") and would
// manufacture false duplicate-domains.
const DOMAIN_KEYWORDS = [
  ["ui-design", ["ui-ux", "ui/ux", "frontend interface", "design intelligence", "visual hierarchy"]],
  ["seo", ["search engine", "backlink", "link prospecting", "keyword clustering"]],
  ["aws", ["amazon web services", "cloudformation", "aws cdk", "aws billing"]],
  ["higgsfield", ["higgsfield"]],
];

function classifyDomain(text) {
  const t = (text || "").toLowerCase();
  const hits = [];
  for (const [dom, kws] of DOMAIN_KEYWORDS) {
    if (kws.some((k) => t.includes(k))) hits.push(dom);
  }
  return hits;
}

// Common English words that the `<name> MCP` prose regex picks up from capabilities.md
// ("the MCP", "each MCP", "an MCP", ...). These are never real server names.
const MCP_STOPWORDS = new Set([
  "the", "an", "a", "each", "every", "any", "all", "no", "some", "this", "that",
  "unrouted", "routed", "installed", "configured", "enabled", "disabled", "given",
  "matching", "domain", "specific", "newest", "first", "second", "third",
]);

// Parse the names capabilities.md ROUTES, in three forms:
//   skill: <name>     -> skills
//   Task: <name>      -> agents
//   <name> MCP        -> mcps
// Returns {skills:Set, agents:Set, mcps:Set}.
function parseCapsMdRoutes(mdText) {
  const skills = new Set();
  const agents = new Set();
  const mcps = new Set();
  for (const m of mdText.matchAll(/skill:\s*([a-z0-9][a-z0-9:-]*)/gi)) skills.add(m[1]);
  // Task: is CASE-SENSITIVE (the dispatch token is always capitalized). A lowercase "task:"
  // appears in prose ("current task: architectural decisions") and would otherwise be matched.
  for (const m of mdText.matchAll(/Task:\s*([a-z0-9][a-z0-9-]*)/g)) agents.add(m[1]);
  // <name> MCP — the name may be wrapped in backticks/quotes ("the `codegraph` MCP"). Allow an
  // optional closing quote/backtick + whitespace between the identifier and "MCP".
  for (const m of mdText.matchAll(/\b([a-z][a-z0-9-]*)[`'"]?\s+MCP\b/gi)) {
    const name = m[1];
    if (MCP_STOPWORDS.has(name)) continue;        // prose ("the MCP", "each MCP")
    if (!name.includes("-") && name.length <= 4) continue; // bare short words are prose
    mcps.add(name);
  }
  return { skills, agents, mcps };
}

function readDescription(filePath) {
  try {
    const txt = readFileSync(filePath, "utf8");
    const m = txt.match(/^---\n([\s\S]*?)\n---/);
    if (m) {
      const dl = m[1].split("\n").find((l) => /^description:/.test(l));
      if (dl) return dl.replace(/^description:\s*/, "").replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
  return "";
}

function runDriftCheck(inventory, capsMdPath) {
  const report = { stale_routes: { skills: [], agents: [], mcps: [] }, unrouted_present: { skills: [], agents: [], mcps: [] }, duplicate_domain: [] };
  let drift = false;

  let mdText = "";
  try { mdText = readFileSync(capsMdPath, "utf8"); }
  catch { report.caps_md_missing = capsMdPath; drift = true; return { report, drift }; }

  const routes = parseCapsMdRoutes(mdText);
  const lockSkills = new Set(inventory.skills);
  const lockAgents = new Set(inventory.agents);
  const lockMcps = new Set(inventory.mcps);

  // (1) stale routes: routed but NOT installed
  for (const s of routes.skills) if (!lockSkills.has(s)) { report.stale_routes.skills.push(s); drift = true; }
  for (const a of routes.agents) if (!lockAgents.has(a)) { report.stale_routes.agents.push(a); drift = true; }
  for (const m of routes.mcps) if (!lockMcps.has(m)) { report.stale_routes.mcps.push(m); drift = true; }

  // (2) unrouted present: installed but NOT routed anywhere in capabilities.md
  for (const s of inventory.skills) if (!routes.skills.has(s)) { report.unrouted_present.skills.push(s); drift = true; }
  for (const a of inventory.agents) if (!routes.agents.has(a)) { report.unrouted_present.agents.push(a); drift = true; }
  for (const m of inventory.mcps) if (!routes.mcps.has(m)) { report.unrouted_present.mcps.push(m); drift = true; }

  // (3) duplicate-domain: two installed skills in the same domain where exactly one is routed.
  //     Names BOTH in the report — the orphan + its routed twin.
  const skillMeta = scanSkills().withMeta;
  const byDomain = new Map();
  for (const sm of skillMeta) {
    const desc = readDescription(sm.path);
    const doms = classifyDomain(`${sm.name} ${desc}`);
    for (const d of doms) {
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d).push(sm.name);
    }
  }
  for (const [dom, names] of byDomain) {
    const uniq = Array.from(new Set(names));
    if (uniq.length < 2) continue;
    const routed = uniq.filter((n) => routes.skills.has(n));
    const orphaned = uniq.filter((n) => !routes.skills.has(n));
    if (routed.length >= 1 && orphaned.length >= 1) {
      for (const o of orphaned) for (const r of routed) {
        report.duplicate_domain.push({ domain: dom, orphaned: o, routed_twin: r });
        drift = true;
      }
    }
  }

  return { report, drift };
}

function formatDriftReport(report) {
  const lines = ["resolve-capabilities: DRIFT between capabilities.md and the installed inventory."];
  const s = (n) => n === 1 ? "" : "s";
  if (report.stale_routes.skills.length || report.stale_routes.agents.length || report.stale_routes.mcps.length) {
    lines.push("  stale route" + s(report.stale_routes.skills.length + report.stale_routes.agents.length + report.stale_routes.mcps.length) + " (named in capabilities.md but NOT installed):");
    for (const x of report.stale_routes.skills) lines.push(`    skill: ${x}`);
    for (const x of report.stale_routes.agents) lines.push(`    Task:  ${x}`);
    for (const x of report.stale_routes.mcps) lines.push(`    mcp:   ${x}`);
  }
  if (report.unrouted_present.skills.length || report.unrouted_present.agents.length || report.unrouted_present.mcps.length) {
    lines.push("  orphaned install(s) (installed but NOT routed in capabilities.md):");
    for (const x of report.unrouted_present.skills) lines.push(`    skill: ${x}`);
    for (const x of report.unrouted_present.agents) lines.push(`    Task:  ${x}`);
    for (const x of report.unrouted_present.mcps) lines.push(`    mcp:   ${x}`);
  }
  if (report.duplicate_domain.length) {
    lines.push("  duplicate-domain skill(s) (two installed skills, same domain, only one routed):");
    for (const d of report.duplicate_domain) lines.push(`    [${d.domain}] orphaned=${d.orphaned} routed_twin=${d.routed_twin}`);
  }
  if (report.caps_md_missing) lines.push(`  capabilities.md not found at ${report.caps_md_missing}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (driftCheck) {
  // Drift check: build the inventory lock (do NOT require writing it), compare to capabilities.md.
  const inventory = buildInventoryLock();
  const { report, drift } = runDriftCheck(inventory, CAPS_MD_PATH);
  if (drift) {
    console.error(formatDriftReport(report));
    console.error("\nresolve-capabilities: drift detected. Report-only — fix capabilities.md by hand.");
    exit(6);
  }
  console.log("resolve-capabilities: no drift — capabilities.md matches the installed inventory.");
  exit(0);
}

// Default / --check / --agent: build inventory, run reconciliation, write lock (unless --check).
const inventory = buildInventoryLock();
const rec = reconcile();

const lock = {
  generated_at: inventory.generated_at,
  skills: inventory.skills,
  agents: inventory.agents,
  mcps: inventory.mcps,
  codegraph: inventory.codegraph,
  sources: inventory.sources,
  reconciliation: {
    agents: Object.fromEntries(rec.selected.map((f) => {
      const n = f.replace(/\.md$/, "");
      return [n, { granted: rec.routedAndGranted[n] || [], routed_but_not_granted: rec.routedButNotGranted[n] || [] }];
    })),
    present_but_unrouted: rec.presentButUnrouted,
    note: "routed_but_not_granted = HARD ERROR (agent told to use a capability its tools: deny). present_but_unrouted = installed capability no agent routes to (context cost).",
  },
};

if (!checkOnly) writeFileSync(LOCK_OUT, JSON.stringify(lock, null, 2) + "\n");
console.log(JSON.stringify(lock, null, 2));
if (rec.hardErrors) {
  console.error("\nresolve-capabilities: HARD ERRORS — agents reference capabilities their tools: deny. Fix the frontmatter or remove the reference.");
  exit(6);
}
exit(0);
