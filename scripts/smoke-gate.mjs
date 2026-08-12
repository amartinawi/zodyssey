#!/usr/bin/env node
// smoke-gate.mjs — the release gate that answers "is enforcement actually live?"
//
// WHY THIS EXISTS: v0.3.0 shipped with the entire enforcement chain offline. Every file was
// correct; the hooks were registered at a path the marketplace install never populated, so every
// hook spawn resolved an empty path and failed silently. `install.mjs --verify` reported green
// because it checked files, paths, and registration — not whether the gate FIRES.
//
// That is the fourth instance of one pattern in this repo: a check that cannot detect the class
// of failure it exists for. (--verify checked paths not liveness; three external audits checked
// diffs not standing invariants; harness.mjs --list checked a sentinel string that never matched
// the seeds; v0.3.0-verdict.json was 0 bytes and still read as "audited".)
//
// So this script draws a hard line between two kinds of claim:
//
//   AUTOMATED (below) — everything decidable without a live harness, including the one check
//   --verify still lacks: that the CACHED hook bytes are the REPO's hook bytes. A stale cache is
//   invisible from the repo side and is exactly how a verified-good hook stops being the hook
//   that runs.
//
//   MANUAL (printed at the end) — that ZCode actually INVOKES the hook. No amount of file
//   reading can establish this. It is the single link that broke in v0.3.0, and the only proof
//   is a live session attempting a pre-OKAY edit and being refused.
//
// Usage:
//   node scripts/smoke-gate.mjs           # run automated checks + scaffold the live fixture
//   node scripts/smoke-gate.mjs --clean   # remove the fixture
//
// Exit: 0 all automated checks passed (manual step still required) · 1 something failed.

import {
  readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync,
} from "node:fs";
import { join, resolve as pathResolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const REPO = pathResolve(new URL("..", import.meta.url).pathname);
const HOME = homedir();
const FIXTURE = join(tmpdir(), "zodyssey-gate-smoke");
const HOOK_NAMES = ["pre-tool.mjs", "post-tool.mjs", "stop.mjs", "user-prompt-submit.mjs"];

let failed = 0;
const ok = (m, d = "") => console.log(`  ✓ ${m}${d ? ` — ${d}` : ""}`);
const bad = (m, d = "") => { console.log(`  ✗ ${m}${d ? ` — ${d}` : ""}`); failed++; };
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

// --- --clean ------------------------------------------------------------------
if (process.argv.includes("--clean")) {
  rmSync(FIXTURE, { recursive: true, force: true });
  console.log(`removed ${FIXTURE}`);
  process.exit(0);
}

console.log("ZOdyssey enforcement smoke gate\n");

// --- 1. Is the plugin registered, and where? ----------------------------------
console.log("1. Registration");
let installPath = null, registeredVersion = null;
const installedPath = join(HOME, ".zcode", "cli", "plugins", "installed_plugins.json");
try {
  const reg = JSON.parse(readFileSync(installedPath, "utf8"));
  const entry = (reg.plugins || []).find((p) => (p.name === "zodyssey") || String(p.id || "").startsWith("zodyssey@"));
  if (!entry) bad("zodyssey registered", "no entry in installed_plugins.json — install via marketplace");
  else {
    installPath = entry.installPath;
    registeredVersion = entry.version;
    existsSync(installPath)
      ? ok("zodyssey registered", `${entry.id} @ ${entry.version}`)
      : bad("install path exists", `registered at ${installPath} which does not exist — THIS IS THE v0.3.0 BUG`);
  }
} catch (e) {
  bad("installed_plugins.json readable", e.code || e.message);
}

// Repo version should match what is actually deployed, or you are testing the wrong thing.
try {
  const repoVersion = JSON.parse(readFileSync(join(REPO, ".zcode-plugin", "plugin.json"), "utf8")).version;
  if (registeredVersion && repoVersion !== registeredVersion) {
    bad("deployed version matches repo", `repo ${repoVersion} vs deployed ${registeredVersion} — run install.mjs then Update in Plugin Management`);
  } else if (registeredVersion) ok("deployed version matches repo", repoVersion);
} catch (e) { bad("repo plugin.json readable", e.code || e.message); }

// --- 2. Does the CACHED manifest declare the hooks? ---------------------------
console.log("\n2. Manifest-declared hooks (cached copy, not the repo's)");
if (installPath && existsSync(installPath)) {
  try {
    const man = JSON.parse(readFileSync(join(installPath, ".zcode-plugin", "plugin.json"), "utf8"));
    const hooks = man.hooks || {};
    for (const ev of ["PreToolUse", "PostToolUse", "Stop", "UserPromptSubmit"]) {
      hooks[ev] ? ok(`declares ${ev}`) : bad(`declares ${ev}`, "missing from cached manifest — hook will never fire");
    }
    // Every declared command must use the template var. A literal path is the v0.3.0 failure.
    const commands = JSON.stringify(hooks);
    const literalHome = commands.includes(HOME) || /"[^"]*\/cache\/[^"]*\.mjs"/.test(commands);
    literalHome
      ? bad("hook paths use ${CLAUDE_PLUGIN_ROOT}", "a literal cache path is baked in — it will go stale on the next version bump")
      : ok("hook paths use ${CLAUDE_PLUGIN_ROOT}");
  } catch (e) { bad("cached manifest parses", e.code || e.message); }
} else {
  bad("cached manifest", "skipped — no install path");
}

// --- 3. Cached hooks: exist, parse, AND are byte-identical to the repo --------
console.log("\n3. Cached hook integrity (the check --verify still lacks)");
if (installPath && existsSync(installPath)) {
  for (const name of HOOK_NAMES) {
    const cached = join(installPath, "skills", "odyssey", "hooks", name);
    const repo = join(REPO, "skills", "odyssey", "hooks", name);
    if (!existsSync(cached)) { bad(`${name} present in cache`, "missing — hook spawn resolves nothing"); continue; }
    const parse = spawnSync(process.execPath, ["--check", cached], { encoding: "utf8" });
    if (parse.status !== 0) { bad(`${name} parses`, (parse.stderr || "").split("\n")[0]); continue; }
    if (!existsSync(repo)) { bad(`${name} present in repo`, "cached hook has no repo counterpart"); continue; }
    sha(cached) === sha(repo)
      ? ok(`${name} cached == repo`)
      : bad(`${name} cached == repo`,
          "DRIFT: the deployed hook is not your source. Fix: node scripts/install.mjs --sync-cache " +
          "(a plain install.mjs run does NOT refresh the cache — it never has).");
  }
} else {
  bad("cached hooks", "skipped — no install path");
}

// --- 4. Orphaned config.json hook refs (the v0.3.1 migration) ----------------
console.log("\n4. Orphaned hooks in config.json");
const configPath = join(HOME, ".zcode", "cli", "config.json");
try {
  if (!existsSync(configPath)) ok("config.json absent", "nothing to orphan");
  else {
    const raw = readFileSync(configPath, "utf8");
    const hooksBlob = JSON.stringify(JSON.parse(raw).hooks || {});
    const orphans = /odyssey|zodyssey/i.test(hooksBlob);
    orphans
      ? bad("no ZOdyssey hooks in config.json", "orphan refs remain — they fire and fail alongside the manifest hooks. Run install.mjs")
      : ok("no ZOdyssey hooks in config.json", "manifest-driven only");
  }
} catch (e) { bad("config.json parses", e.code || e.message); }

// --- 5. Direct-invoke proof: the deployed hook blocks when it is run ---------
// This proves the hook's LOGIC works at the deployed path, including self-relative SCRIPTS_DIR
// resolution through the plugin cache. It does NOT prove ZCode invokes it — see the manual step.
console.log("\n5. Deployed hook enforces when invoked");
if (installPath && existsSync(installPath)) {
  const hook = join(installPath, "skills", "odyssey", "hooks", "pre-tool.mjs");
  const probe = join(tmpdir(), "zodyssey-gate-probe");
  try {
    rmSync(probe, { recursive: true, force: true });
    mkdirSync(join(probe, ".zcode", "state"), { recursive: true });
    mkdirSync(join(probe, ".zcode", "plans"), { recursive: true });
    mkdirSync(join(probe, "src"), { recursive: true });
    writeFileSync(join(probe, "src", "foo.js"), "// probe\n");
    const planText = "# probe\n\n## Todos\n\n- [ ] 1. x\n  Files: [`src/foo.js`]\n";
    writeFileSync(join(probe, ".zcode", "plans", "probe.md"), planText);
    writeFileSync(join(probe, ".zcode", "state", "probe.json"), JSON.stringify({
      slug: "probe", phase: "execute", updated_at: new Date().toISOString(),
      plan_path: join(probe, ".zcode", "plans", "probe.md"),
      review: { verdict: "REJECT", round: 1, max_rounds: 3 },
    }));
    const call = (input, env = {}) => spawnSync(process.execPath, [hook], {
      input: JSON.stringify(input), encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: probe, ZODYSSEY_UNGATE_BASH: "", ...env },
    }).status;

    call({ tool_name: "Edit", tool_input: { file_path: join(probe, "src", "foo.js") } }) === 2
      ? ok("blocks Edit pre-OKAY") : bad("blocks Edit pre-OKAY", "ENFORCEMENT IS NOT WORKING");
    call({ tool_name: "Bash", tool_input: { command: "sed -i 's/a/b/' src/foo.js" } }) === 2
      ? ok("blocks write-capable Bash pre-OKAY") : bad("blocks write-capable Bash pre-OKAY", "the Bash gate is off");
    call({ tool_name: "Bash", tool_input: { command: "ls -la" } }) === 0
      ? ok("allows read-only Bash") : bad("allows read-only Bash", "false positive — the gate is too aggressive to use");
  } catch (e) {
    bad("direct-invoke probe", e.message);
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
} else {
  bad("direct-invoke probe", "skipped — no install path");
}

// --- 6. Scaffold the live fixture --------------------------------------------
rmSync(FIXTURE, { recursive: true, force: true });
mkdirSync(join(FIXTURE, ".zcode", "state"), { recursive: true });
mkdirSync(join(FIXTURE, ".zcode", "plans"), { recursive: true });
mkdirSync(join(FIXTURE, "src"), { recursive: true });
writeFileSync(join(FIXTURE, "src", "foo.js"), "// Try to edit me from a live ZCode session.\n// Expected: BLOCKED (review verdict is REJECT).\n");
writeFileSync(join(FIXTURE, "src", "out-of-scope.js"), "// Not in the plan's Files:. Expected: BLOCKED even after OKAY.\n");
const planText = "# smoke\n\n## Todos\n\n- [ ] 1. smoke check\n  Files: [`src/foo.js`]\n";
writeFileSync(join(FIXTURE, ".zcode", "plans", "smoke.md"), planText);
writeFileSync(join(FIXTURE, ".zcode", "state", "smoke.json"), JSON.stringify({
  slug: "smoke", phase: "execute", updated_at: new Date().toISOString(),
  plan_path: join(FIXTURE, ".zcode", "plans", "smoke.md"),
  review: { verdict: "REJECT", round: 1, max_rounds: 3 },
}, null, 2));

console.log(`\n${failed === 0 ? "AUTOMATED CHECKS PASSED" : `AUTOMATED CHECKS FAILED (${failed})`}`);
console.log(`
──────────────────────────────────────────────────────────────────────────
THE MANUAL STEP — this is the one that matters, and the one no script can do
──────────────────────────────────────────────────────────────────────────

Everything above proves the hook WORKS WHEN RUN. It does not prove ZCode RUNS
it. That distinction is the whole v0.3.0 regression: correct code, dead
invocation, green verify.

  1. Open a NEW ZCode session in:   ${FIXTURE}
  2. Ask it to edit  src/foo.js
  3. EXPECTED: refused, citing the review gate (verdict is REJECT, round 1/3).

  If the edit SUCCEEDS, enforcement is offline — the v0.3.0 regression is back
  and no other result on this page matters.

  Control (guards against a false pass): ask it to run  ls -la
  That must be ALLOWED. If everything is blocked, the hook is erroring rather
  than enforcing, which looks identical to working from the outside.

Clean up:  node scripts/smoke-gate.mjs --clean
`);

process.exit(failed === 0 ? 0 : 1);
