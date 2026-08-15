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
import { enumerateDeployed } from "./lib/deploy-surface.mjs";

// Run-state authenticity marker (v0.5.0+). The fixtures below hand-write state files, and an
// UNMARKED state file is not a run — the hook finds nothing and no-ops, so every gate probe reads
// as "allowed". That is indistinguishable from enforcement being offline, which is the exact
// failure this whole script exists to detect, so an unstamped fixture would make the release gate
// cry wolf on a correctly-armed build. (It did, on the first post-deploy run of 0.5.0.)
//
// Loaded from the DEPLOYED plugin, not the repo: the marker must be minted by the same build whose
// hook will verify it. Null on pre-0.5.0 deploys, which have no marker and need none.
// Lazy: installPath is resolved in section 1, below this import block.
let _stampMarker;
async function stamp(st, slug) {
  if (_stampMarker === undefined) {
    _stampMarker = null;
    const cands = [
      installPath ? join(installPath, "skills/odyssey/scripts/lib/state-auth.mjs") : null,
      join(REPO, "skills/odyssey/scripts/lib/state-auth.mjs"),
    ];
    for (const cand of cands) {
      if (!cand || !existsSync(cand)) continue;
      try { ({ stampMarker: _stampMarker } = await import(cand)); break; } catch { /* next */ }
    }
  }
  return _stampMarker ? _stampMarker(st, slug) : st;
}

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
    bad("deployed version matches repo",
      `repo ${repoVersion} vs deployed ${registeredVersion}. A VERSION BUMP needs a marketplace Update ` +
      `(Settings → Plugin Management → Discover → Update on zodyssey) — the marketplace owns the ` +
      `versioned cache dir and the registry. --sync-cache refreshes content within a version; it ` +
      `cannot move the install to a new one.`);
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
    // SEC (audit H2): the capability-observation hooks only fire for tools the matcher selects. F5
    // (the routing-default gate) depends on the hook WITNESSING Skill / mcp__* calls; a matcher that
    // omits them silently makes F5 unreachable for skill/mcp routing — the exact class of failure that
    // shipped in v0.4.0 (matcher blind spot, invisible to a "hooks declared?" check). Assert coverage.
    for (const ev of ["PreToolUse", "PostToolUse"]) {
      const matchers = (hooks[ev] || []).map((h) => h.matcher || "").join("|");
      (/Skill/.test(matchers) && /mcp__/.test(matchers))
        ? ok(`${ev} matcher covers Skill + mcp__`)
        : bad(`${ev} matcher covers Skill + mcp__`, `matcher "${matchers}" omits Skill or mcp__ — F5 capability observations would never be recorded`);
    }
  } catch (e) { bad("cached manifest parses", e.code || e.message); }
} else {
  bad("cached manifest", "skipped — no install path");
}

// --- 3. Cached PLUGIN integrity: exists, parses, byte-identical to the repo ---
//
// This compared the 4 hooks only. That was a blind spot of exactly the kind this file exists to
// close: on 2026-08-12 it reported ALL GREEN while consult.mjs, scaffold.mjs and two test files in
// the running cache were behind the repo — the last commits happened to touch scripts, not hooks.
//
// The scripts are not less load-bearing. record-todo.mjs holds the verify transition guard,
// record-final-wave.mjs holds F1-F4, record-verify.mjs executes the criteria, consult.mjs is the
// external audit. A drifted script runs OLD enforcement just as silently as a drifted hook.
console.log("\n3. Cached plugin integrity (the check --verify still lacks)");
if (installPath && existsSync(installPath)) {
  // T4-4: --sync-cache deploys 6 trees; drift detection covered 3. A stale agents/*.md runs an
  // old reviewer prompt with both gates green — prompts are enforcement.
  //
  // Enumeration is recursive and shared with the deployer (lib/deploy-surface.mjs). A flat list
  // fell behind twice — most recently missing hooks/lib/find-run.mjs, which authenticates run
  // discovery. A stale copy there re-opens the v0.5.0 CRITICAL with this gate reporting green.
  const drifted = [], missing = [], unparsed = [];
  let compared = 0;
  for (const rel of enumerateDeployed(REPO)) {
    const cachedFile = join(installPath, rel);
    compared++;
    if (!existsSync(cachedFile)) { missing.push(rel); continue; }
    if (rel.endsWith(".mjs")) {
      const parse = spawnSync(process.execPath, ["--check", cachedFile], { encoding: "utf8" });
      if (parse.status !== 0) { unparsed.push(rel); continue; }
    }
    if (sha(cachedFile) !== sha(join(REPO, rel))) drifted.push(rel);
  }
  if (drifted.length + missing.length + unparsed.length === 0) {
    ok(`all ${compared} plugin code+prompt files cached == repo`);
  } else {
    const detail = [
      drifted.length ? `${drifted.length} drifted (${drifted.slice(0, 4).join(", ")}${drifted.length > 4 ? ", …" : ""})` : "",
      missing.length ? `${missing.length} missing from cache` : "",
      unparsed.length ? `${unparsed.length} fail to parse` : "",
    ].filter(Boolean).join("; ");
    bad(`all ${compared} plugin code+prompt files cached == repo`,
      `${detail}. The deployed plugin is not your source — it runs OLD enforcement. ` +
      `Fix: node scripts/install.mjs --sync-cache (a plain install.mjs run does NOT refresh the cache).`);
  }
} else {
  bad("cached plugin integrity", "skipped — no install path");
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
    writeFileSync(join(probe, ".zcode", "state", "probe.json"),
      JSON.stringify(await stamp({
        slug: "probe", phase: "execute", updated_at: new Date().toISOString(),
        started_at: "2026-08-15T00:00:00Z", run_start_sha: "smoke",
        plan_path: join(probe, ".zcode", "plans", "probe.md"),
        review: { verdict: "REJECT", round: 1, max_rounds: 3 },
      }, "probe")));
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
writeFileSync(join(FIXTURE, ".zcode", "state", "smoke.json"), JSON.stringify(await stamp({
  slug: "smoke", phase: "execute", updated_at: new Date().toISOString(),
  started_at: "2026-08-15T00:00:00Z", run_start_sha: "smoke",
  plan_path: join(FIXTURE, ".zcode", "plans", "smoke.md"),
  review: { verdict: "REJECT", round: 1, max_rounds: 3 },
}, "smoke"), null, 2));

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
