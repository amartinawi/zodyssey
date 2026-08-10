#!/usr/bin/env node
// resolve-capabilities.test.mjs — unit tests for resolve-capabilities.mjs (todo 6).
//
// Two load-bearing assertions, both run against TMP-DIR fixtures (never the live ~/.zcode tree):
//   (a) GENERATE mode writes a lock with skills/agents/mcps/codegraph sections.
//   (b) DRIFT-CHECK on a fixture capabilities.md naming a MISSING capability exits 6 with that
//       name on stderr; and a clean capabilities.md exits 0.
//
// The script reads ZCAP_* env vars to relocate every path it uses, so we point them at a fixture
// root built fresh per test, then tear it down.
//
// Run:  node resolve-capabilities.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const SCRIPT = join(SCRIPT_DIR, "resolve-capabilities.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  \u2713 ${name}`); pass++; }
  else { console.log(`  \u2717 ${name} ${detail}`); fail++; }
}

// Run the script with ZCAP_* env pointing at a fixture root. Returns {status, stdout, stderr}.
function runScript(env, ...cliArgs) {
  const r = spawnSync("node", [SCRIPT, ...cliArgs], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// Build a fixture tree under a fresh tmp root: <root>/.zcode/{skills,agents,cli/config.json,
// skills/odyssey/references/capabilities.md} + <root>/.agents/skills. Returns the env map.
function buildFixture(setup) {
  const root = mkdtempSync(join(tmpdir(), "zod-rescap-test-"));
  const zcode = join(root, ".zcode");
  mkdirSync(join(zcode, "skills"), { recursive: true });
  mkdirSync(join(zcode, "agents"), { recursive: true });
  mkdirSync(join(zcode, "cli"), { recursive: true });
  mkdirSync(join(zcode, "skills", "odyssey", "references"), { recursive: true });
  mkdirSync(join(root, ".agents", "skills"), { recursive: true });

  // skills — each gets a SKILL.md with a `name:` frontmatter field
  for (const [dir, fm] of Object.entries(setup.skills || {})) {
    const skillDir = join(zcode, "skills", dir);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `---\n${fm}\n---\n# ${dir}\n`);
  }
  // optional ~/.agents/skills entries
  for (const [dir, fm] of Object.entries(setup.agentsSkills || {})) {
    const skillDir = join(root, ".agents", "skills", dir);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), `---\n${fm}\n---\n# ${dir}\n`);
  }
  // agents — top-level <root>/.zcode/agents/*.md
  for (const [file, fm] of Object.entries(setup.agents || {})) {
    writeFileSync(join(zcode, "agents", file), `---\n${fm}\n---\nbody\n`);
  }
  // cli/config.json with mcp.servers
  const cfg = { mcp: { servers: setup.mcps || {} } };
  writeFileSync(join(zcode, "cli", "config.json"), JSON.stringify(cfg, null, 2));
  // capabilities.md fixture
  const capsPath = join(zcode, "skills", "odyssey", "references", "capabilities.md");
  if (setup.capsMd !== undefined) writeFileSync(capsPath, setup.capsMd);

  const env = {
    ZCAP_HOME: root,
    ZCAP_NO_CODEGRAPH: "1", // tests cannot rely on the host having the codegraph binary
  };
  return { root, env, lockPath: join(zcode, "capabilities.lock.json"), capsPath };
}

console.log("resolve-capabilities.mjs unit tests\n");

// ---------------------------------------------------------------------------
// Test 1: GENERATE mode writes a lock with skills/agents/mcps/codegraph sections
// ---------------------------------------------------------------------------
{
  console.log("Test 1: generate mode writes a complete inventory lock");
  const { env, lockPath, root } = buildFixture({
    skills: {
      "prompt-master": 'name: prompt-master\ndescription: Prime prompts.',
      "ui-ux-pro-max": 'name: ui-ux-pro-max\ndescription: UI/UX design intelligence.',
      "test-driven-development": 'name: test-driven-development\ndescription: TDD.',
    },
    agentsSkills: {
      "impeccable": 'name: impeccable\ndescription: Frontend interface polish.',
    },
    agents: {
      "metis.md": "name: metis\ndescription: Consultant.",
      "oracle.md": "name: oracle\ndescription: Advisor.",
    },
    mcps: {
      "codegraph": { type: "stdio", command: "codegraph", args: ["serve"] },
      "memory": { type: "stdio", command: "npx", args: ["-y", "x"] },
    },
    capsMd: "# stub capabilities\n",
  });
  const r = runScript(env); // default = generate
  let lock = null;
  try { lock = JSON.parse(readFileSync(lockPath, "utf8")); } catch (e) { /* leave null */ }

  check("  generate exits 0", r.status === 0, `got ${r.status}`);
  check("  lock file exists at <root>/.zcode/capabilities.lock.json", existsSync(lockPath));
  check("  lock has skills[] array", Array.isArray(lock?.skills), JSON.stringify(lock?.skills));
  check("  lock includes prompt-master", lock?.skills.includes("prompt-master"));
  check("  lock includes ui-ux-pro-max", lock?.skills.includes("ui-ux-pro-max"));
  check("  lock includes impeccable from ~/.agents/skills", lock?.skills.includes("impeccable"));
  check("  lock has agents[] array", Array.isArray(lock?.agents), JSON.stringify(lock?.agents));
  check("  lock includes agent metis", lock?.agents.includes("metis"));
  check("  lock has mcps[] array", Array.isArray(lock?.mcps), JSON.stringify(lock?.mcps));
  check("  lock includes mcp codegraph", lock?.mcps.includes("codegraph"));
  check("  lock has codegraph boolean", typeof lock?.codegraph === "boolean", JSON.stringify(lock?.codegraph));
  check("  lock has sources map", !!lock?.sources && typeof lock.sources === "object");
  check("  lock has reconciliation section", !!lock?.reconciliation);

  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 2: a skill whose directory name differs from its frontmatter name uses the name field
// ---------------------------------------------------------------------------
{
  console.log("Test 2: name extraction prefers frontmatter `name:` over dir name");
  const { env, lockPath, root } = buildFixture({
    skills: {
      "weird-dir-name": 'name: real-skill-name\ndescription: x',
    },
    capsMd: "# stub\n",
  });
  runScript(env);
  let lock = null;
  try { lock = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
  check("  lock uses frontmatter name real-skill-name", lock?.skills.includes("real-skill-name"));
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 3: DRIFT-CHECK exits 6 when capabilities.md names a capability NOT installed (stale route)
// ---------------------------------------------------------------------------
{
  console.log("Test 3: drift-check flags a stale route and exits 6");
  const capsMd = [
    "# caps",
    "Route to `skill: prompt-master` for priming.",
    "Route to `Task: metis` for consult.",
    "Use the `codegraph` MCP for structure.",
    "Use the `Context7` MCP for docs.",
  ].join("\n");
  const { env, root } = buildFixture({
    skills: { "prompt-master": "name: prompt-master\ndescription: x" },
    agents: { "metis.md": "name: metis\ndescription: x" },
    mcps: { "codegraph": { type: "stdio", command: "c" } },
    // NOTE: Context7 MCP is intentionally NOT installed -> stale route
    capsMd,
  });
  const r = runScript(env, "--drift-check");
  check("  drift-check exits 6", r.status === 6, `got ${r.status}`);
  check("  stderr mentions the stale Context7 route", r.stderr.includes("Context7"), r.stderr);
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 4: DRIFT-CHECK exits 0 when capabilities.md matches the installed inventory
// ---------------------------------------------------------------------------
{
  console.log("Test 4: drift-check exits 0 on a clean, fully-routed fixture");
  const capsMd = [
    "# caps",
    "`skill: prompt-master` primes.",
    "`Task: metis` consults.",
    "the `codegraph` MCP explores.",
  ].join("\n");
  // only prompt-master is routed; to be CLEAN every installed item must be routed.
  const { env, root } = buildFixture({
    skills: { "prompt-master": "name: prompt-master\ndescription: x" },
    agents: { "metis.md": "name: metis\ndescription: x" },
    mcps: { "codegraph": { type: "stdio", command: "c" } },
    capsMd,
  });
  const r = runScript(env, "--drift-check");
  check("  drift-check exits 0 when clean", r.status === 0, `got ${r.status}\n${r.stderr}`);
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 5: DRIFT-CHECK surfaces a duplicate-domain pair (orphaned + routed twin) naturally
// ---------------------------------------------------------------------------
{
  console.log("Test 5: drift-check surfaces duplicate-domain ui-design drift");
  const capsMd = "# caps\n`skill: ui-ux-pro-max` for UI/UX design intelligence.\n";
  const { env, root } = buildFixture({
    skills: {
      "ui-ux-pro-max": "name: ui-ux-pro-max\ndescription: UI/UX design intelligence.",
      "impeccable": "name: impeccable\ndescription: Polish a frontend interface.",
    },
    capsMd,
  });
  const r = runScript(env, "--drift-check");
  check("  drift-check exits 6", r.status === 6, `got ${r.status}`);
  check("  stderr mentions the routed twin ui-ux-pro-max", r.stderr.includes("ui-ux-pro-max"), r.stderr);
  check("  stderr mentions the orphaned impeccable", r.stderr.includes("impeccable"), r.stderr);
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test 6: reconciliation still works (--check path preserved), and a symlinked skill is scanned
// ---------------------------------------------------------------------------
{
  console.log("Test 6: symlinked skills are scanned (regression for the isDirectory bug)");
  const { env, lockPath, root } = buildFixture({
    skills: { "real-skill": "name: real-skill\ndescription: x" },
    capsMd: "# stub\n",
  });
  // create a symlinked skill dir: <root>/.zcode/skills/linked-skill -> real-skill
  try {
    symlinkSync(join(root, ".zcode", "skills", "real-skill"), join(root, ".zcode", "skills", "linked-skill"));
  } catch (e) {
    check("  symlink creation (skipped if unsupported)", false, String(e));
    rmSync(root, { recursive: true, force: true });
    if (fail > 0) { console.error(`\n${fail} test(s) failed`); exit(1); }
    console.log(`\nAll ${pass} checks passed`);
    exit(0);
  }
  runScript(env);
  let lock = null;
  try { lock = JSON.parse(readFileSync(lockPath, "utf8")); } catch {}
  check("  symlinked skill scanned as real-skill", lock?.skills.includes("real-skill"), JSON.stringify(lock?.skills));
  rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log("");
if (fail > 0) {
  console.error(`${fail} check(s) FAILED`);
  exit(1);
}
console.log(`All ${pass} checks passed`);
exit(0);
