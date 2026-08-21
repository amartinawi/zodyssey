#!/usr/bin/env node
// find-run.pin.test.mjs — the I6 unified-source pin (project-isolation audit 2026-08-20, todo 2
// of run impl-23-project-isolation).
//
// WHY THIS FILE EXISTS: the bounded DFS that discovers `.zcode/state` dirs lived in TWO copies —
// find-run.mjs's (with the Class-B realpath fix at the isZcodeChild push) and pre-tool.mjs's
// private twin (still pushing the as-passed `dir`). Two copies of any boundary WILL drift; these
// already had. pre-tool.mjs now imports the exported discoverStateDirs and the private twin is
// deleted — and this file pins that unification against regression: it drives the REAL hook
// (subprocess, real stdin payload) and the shared module (in-process) against ONE shared tree and
// asserts they agree on the governing slug and on RUN_STATE_DIR itself. If anyone reintroduces a
// private DFS (or edits one copy without the other), the agreement breaks HERE, not two releases
// later.
//
// RUN_STATE_DIR is witnessed without reading hook internals: under ZODYSSEY_DEBUG=1 the hook
// writes its one-time payload probe to `<RUN_STATE_DIR>/<slug>.payload-probe.json`, so the
// probe's location IS the hook's RUN_STATE_DIR.
//
// HERMETICITY: fresh mkdtemp tree per case, fixture ZODYSSEY_RUN_KEY_PATH (never the operator's
// real key), ZODYSSEY_NO_FIND_CACHE=1, ZODYSSEY_UNGATE_BASH forced off. The env var is set
// BEFORE the zodyssey modules are dynamically imported, because state-auth.mjs resolves the key
// path at module load — a static import would bind the default key first (ESM caches modules).
//
// Run:  node find-run.pin.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";

const HOOK = join(new URL("..", import.meta.url).pathname, "pre-tool.mjs");
const STALE_MS = 24 * 3600 * 1000;
let pass = 0, fail = 0;
const cleanup = [];
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name} ${detail}`); fail++; }
}

// One project with a validly-marked active run whose plan declares exactly one file (same shape
// as the project-isolation suite's builder).
function makeProject(root, slug, declared, updatedAt, key, { phase = "execute", verdict = "OKAY" } = {}) {
  mkdirSync(join(root, ".zcode", "state"), { recursive: true });
  mkdirSync(join(root, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", basename(declared)), "// fixture\n");
  const planPath = join(root, ".zcode", "plans", `${slug}.md`);
  const planText = `# ${slug}\n\n## Scope\n\nEdit \`${declared}\`.\n\n## Todos\n\n- [ ] 1. go\n  - Files: [\`${declared}\`]\n`;
  writeFileSync(planPath, planText);
  const statePath = join(root, ".zcode", "state", `${slug}.json`);
  // The run_auth marker is stamped by the CALLER after the dynamic import of state-auth (see
  // header) — an unmarked state file would be correctly ignored by discovery.
  writeFileSync(statePath, JSON.stringify({
    slug, phase, updated_at: updatedAt, plan_path: planPath,
    review: { verdict, round: 1, max_rounds: 3, plan_sha256: createHash("sha256").update(planText).digest("hex") },
  }, null, 2));
  return { root, slug, statePath, planPath };
}

function runHook({ projectDir, key, payload, debug = false }) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      ZODYSSEY_RUN_KEY_PATH: key,
      ZODYSSEY_NO_FIND_CACHE: "1",
      ZODYSSEY_UNGATE_BASH: "",
      ZODYSSEY_DEBUG: debug ? "1" : "",
    },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

console.log("find-run.pin — real hook and shared module agree on discovery (I6)\n");

// ONE fixture key for the whole run: state-auth resolves the key path at module load, and ESM
// caches modules — a per-case key would leave the in-process verifyMarker bound to case 1's key
// while case 2 stamps with another. Set into the env BEFORE the first zodyssey import below.
const keyHome = realpathSync(mkdtempSync(join(tmpdir(), "zod-pinkey-")));
cleanup.push(keyHome);
const KEY = join(keyHome, "fixture.key");
writeFileSync(KEY, randomBytes(32).toString("hex") + "\n", { mode: 0o600 });
process.env.ZODYSSEY_RUN_KEY_PATH = KEY;

try {
  // CASE 1 — the pilot-herdr nested-repo shape: PROJECT_DIR is a workspace, the run lives two
  // levels down. The private DFS twin this pin guards against was exactly the kind of copy that
  // silently missed or mis-pathed a nested run.
  {
    const ws = realpathSync(mkdtempSync(join(tmpdir(), "zod-pin1-")));
    cleanup.push(ws);
    const repo = join(ws, "work", "app");
    makeProject(repo, "pin-run", "src/ok.js", new Date(Date.now() - 30_000).toISOString(), KEY);
    const { stampMarker } = await import("../../scripts/lib/state-auth.mjs");
    const { findActiveRuns } = await import("./find-run.mjs");
    // The state file needs its marker; makeProject cannot call stampMarker (not imported at its
    // definition), so restamp in place — identityOf excludes updated_at, so this is stable.
    const p = join(repo, ".zcode", "state", "pin-run.json");
    const st = JSON.parse(readFileSync(p, "utf8"));
    writeFileSync(p, JSON.stringify(stampMarker(st, "pin-run", KEY), null, 2));

    const shared = findActiveRuns({ projectDir: ws, staleMs: STALE_MS });
    check("shared module discovers the nested run", shared.length === 1 && shared[0].state.slug === "pin-run",
      `n=${shared.length}, slugs=${JSON.stringify(shared.map((r) => r.state.slug))}`);
    check("shared stateDir is the realpath'd nested dir (Class-B push)",
      shared[0] && shared[0].stateDir === join(repo, ".zcode", "state"), shared[0] && shared[0].stateDir);

    // Real hook, inert call with DEBUG on: the probe lands in the hook's RUN_STATE_DIR.
    const inert = runHook({ projectDir: ws, key: KEY, debug: true, payload: { tool_name: "Grep", tool_input: { pattern: "pin" } } });
    check("hook exits 0 on an inert call", inert.status === 0, `exit=${inert.status}`);
    check("hook's RUN_STATE_DIR equals the shared module's stateDir (probe destination)",
      existsSync(join(shared[0].stateDir, "pin-run.payload-probe.json")),
      `probe=${join(shared[0].stateDir, "pin-run.payload-probe.json")}`);

    // Governing slug agreement, witnessed through a scope block naming the run.
    writeFileSync(join(repo, "src", "undeclared.js"), "// fixture\n");
    const ed = runHook({ projectDir: ws, key: KEY, payload: { tool_name: "Edit", tool_input: { file_path: join(repo, "src", "undeclared.js") } } });
    check("hook and shared module agree on the governing slug (nested tree)",
      ed.status === 2 && ed.stdout.includes("slug=pin-run"), `exit=${ed.status}`);
  }

  // CASE 2 — two projects under one workspace: the hook's per-call selection for a target in
  // project-b must be the same run the shared selectByTarget(findActiveRuns(...)) picks, even
  // though project-a is the recency winner (the I1 fix riding on the unified source).
  {
    const ws2 = realpathSync(mkdtempSync(join(tmpdir(), "zod-pin2-")));
    cleanup.push(ws2);
    makeProject(join(ws2, "project-a"), "pin-a", "src/a.js", new Date(Date.now() - 30_000).toISOString(), KEY);
    makeProject(join(ws2, "project-b"), "pin-b", "src/b.js", new Date(Date.now() - 120_000).toISOString(), KEY);
    const { stampMarker } = await import("../../scripts/lib/state-auth.mjs");
    const { findActiveRuns, selectByTarget } = await import("./find-run.mjs");
    for (const slug of ["pin-a", "pin-b"]) {
      const p = join(ws2, `project-${slug.endsWith("a") ? "a" : "b"}`, ".zcode", "state", `${slug}.json`);
      const st = JSON.parse(readFileSync(p, "utf8"));
      writeFileSync(p, JSON.stringify(stampMarker(st, slug, KEY), null, 2));
    }
    const shared2 = findActiveRuns({ projectDir: ws2, staleMs: STALE_MS });
    check("shared module discovers both projects' runs", shared2.length === 2,
      `n=${shared2.length}`);
    const target = join(ws2, "project-b", "src", "x.js");
    const want = selectByTarget(shared2, target);
    check("selectByTarget picks pin-b for a project-b target (recency winner is pin-a)",
      want && want.state.slug === "pin-b", want && want.state.slug);
    const ed2 = runHook({ projectDir: ws2, key: KEY, payload: { tool_name: "Edit", tool_input: { file_path: target } } });
    check("the real hook names the same slug for the same target",
      ed2.status === 2 && ed2.stdout.includes("slug=pin-b"), `exit=${ed2.status}`);
  }
} finally {
  for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
