#!/usr/bin/env node
// pre-tool.project-isolation.test.mjs — RED-first regression suite for the project-isolation
// audit (.zcode/audits/2026-08-20-project-isolation.md, findings I1/I2/I5) plus the two
// oracle-r1 fixtures (.zcode/staging/oracle-verdict-impl-23-r1.md, blockers 1 and 2: DECOY,
// TTL). Todo 1 of run impl-23-project-isolation — the RED half of TDD: it is committed RED
// on the unmodified tree and todo 2 greens it. It drives the REAL hook via spawnSync; no
// mocks, no imported hook internals on the enforcement paths.
//
// THE TWO CASE CLASSES — read before touching:
//   Regression tags (RED on the unmodified tree, GREEN after todo 2):
//     I1  — a non-edit tool call (mcp__fs__write_file) targeting project-b's state is
//           governed by run-b, witnessed by the payload-probe destination (the probe
//           write follows the governing run; today the globally-most-recent run-a
//           governs, so the probe lands in project-a).
//     I2  — non-native writes into EITHER project's .zcode/state (+ reviews) exit 2.
//           Today the guard's protectedDirs derive from the governing run only, so a
//           write into project-b's state exits 0.
//     I5  — ungated Bash with cwd=project-b appends ONLY to b's <slug>.ungated.jsonl.
//           Today the ledger destination is the governing (foreign) run's dir.
//     TIE — two equal-depth active runs in ONE repo: the most recently updated governs.
//           Today selectByTarget sorts by root length only and JS sorts are stable, so
//           the scan-order pick wins and a recency swap changes nothing. The case runs
//           BOTH recency phases, so exactly one fails today regardless of scan order.
//     TTL — the find-active-run cache hit path is TTL-bounded: a project-b created
//           mid-window (after the cache warmed) becomes visible to protection and
//           selection once `at` ages past the bound (aged by REWRITING `at`, never by
//           sleeping). Today there is no TTL: the fingerprint stats only the cached
//           stateDirs, so the stale hit keeps allowing writes into b's state (oracle-r1
//           blocker 2: unbounded staleness).
//   Preserved-behavior tags (must NEVER fail, before OR after the fix — a failure here
//   means a held boundary regressed: block and investigate, never patch the test):
//     PARITY — single-repo/single-run selection and gate behavior unchanged (declared
//              edit passes, undeclared is scope-blocked, read-only dispatch passes,
//              own-state mcp write blocked, pre-OKAY verdict gate still blocks).
//     SYMLINK — a directory symlink from project-b into project-a is not followed by
//              discovery (the find-run.mjs:53 e.isDirectory() HELD boundary), pinned at
//              both copies: the shared module AND the real hook's own DFS.
//     FALLBACK — a target outside every discovered repo falls back to mostRecent and is
//              BLOCKED under that run's scope — never a silent exit-0 pass-through. The
//              Bash twin runs with cwd = the parent workspace, pinning the documented
//              accepted residual (parent-cwd Bash attributes to the recency winner).
//     DECOY — ONE mcp payload combining a decoy path under project-b with the write
//              target under project-a's state/reviews still exits 2, while a normal
//              file under b stays allowed. Per-call selection is steerable by the very
//              payload this guard defends against (oracle-r1 blocker 1), so protection
//              must not derive from the per-call pick — this case pins that union.
//
// HERMETICITY CONTRACT (metis risk 7): every case gets a fresh mkdtemp workspace; the
// hook runs with CLAUDE_PROJECT_DIR set to that workspace (or a subdir — SYMLINK), a
// per-workspace fixture ZODYSSEY_RUN_KEY_PATH (the operator's real ~/.zcode key is never
// read or written), ZODYSSEY_NO_FIND_CACHE=1 (sole exception: the TTL case, cache-enabled
// by design — its cache file lives inside the mkdtemp workspace), and ZODYSSEY_UNGATE_BASH
// forced to "" (the operator env carries =1; a test inheriting it would pass vacuously —
// the I5 ledger path is the live Bash behavior there). The I5 case alone sets the hatch to
// "1" deliberately: it is the case's subject. Global eval corpora are never touched.
//
// Run:  node pre-tool.project-isolation.test.mjs
// Exit: 0 = all green · 1 = at least one case failed. On the unmodified (pre-todo-2) tree
// the expected result is exit 1 with failures confined to I1/I2/I5/TIE/TTL.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, existsSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { stampMarker } from "../scripts/lib/state-auth.mjs";

const HOOK = join(new URL(".", import.meta.url).pathname, "pre-tool.mjs");
let pass = 0, fail = 0;
const cleanup = [];

// --- fixture builders ---------------------------------------------------------

// One project with a validly-marked active run whose plan declares exactly one file.
// The marker is stamped with THIS workspace's fixture key; the hook subprocess verifies
// against the same key via ZODYSSEY_RUN_KEY_PATH, so the suite never touches the real key.
function makeProject(root, slug, declared, updatedAt, key, { phase = "execute", verdict = "OKAY" } = {}) {
  mkdirSync(join(root, ".zcode", "state"), { recursive: true });
  mkdirSync(join(root, ".zcode", "plans"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", basename(declared)), "// fixture\n");
  const planPath = join(root, ".zcode", "plans", `${slug}.md`);
  const planText = `# ${slug}\n\n## Scope\n\nEdit \`${declared}\`.\n\n## Todos\n\n- [ ] 1. go\n  - Files: [\`${declared}\`]\n`;
  writeFileSync(planPath, planText);
  const statePath = join(root, ".zcode", "state", `${slug}.json`);
  writeFileSync(statePath, JSON.stringify(stampMarker({
    slug, phase, updated_at: updatedAt, plan_path: planPath,
    review: { verdict, round: 1, max_rounds: 3, plan_sha256: createHash("sha256").update(planText).digest("hex") },
  }, slug, key), null, 2));
  return { root, slug, statePath, planPath };
}

// The standard two-project workspace: project-a FRESHER than project-b (distinct
// updated_at so the recency winner is deterministic — a), both validly marked, and the
// hook sees CLAUDE_PROJECT_DIR = the PARENT. That parent-of-many layout is the only
// reachable shape for the audit's findings: one repo per PROJECT_DIR is already isolated.
function twoProjectWorkspace({ aAtMs = Date.now() - 30_000, bAtMs = Date.now() - 120_000 } = {}) {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), "zod-iso-")));
  cleanup.push(ws);
  const key = join(ws, "fixture.key");
  const a = makeProject(join(ws, "project-a"), "run-a", "src/a.js", new Date(aAtMs).toISOString(), key);
  const b = makeProject(join(ws, "project-b"), "run-b", "src/b.js", new Date(bAtMs).toISOString(), key);
  return { ws, key, a, b };
}

// Run the REAL checked-in hook. All four ZODYSSEY_* env vars are set explicitly AFTER the
// process.env spread, so ambient operator values (notably UNGATE_BASH=1) can never leak in.
function runHook({ projectDir, key, payload, cache = false, ungated = false, debug = false }) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      ZODYSSEY_RUN_KEY_PATH: key,
      ZODYSSEY_NO_FIND_CACHE: cache ? "" : "1",
      ZODYSSEY_UNGATE_BASH: ungated ? "1" : "",
      ZODYSSEY_DEBUG: debug ? "1" : "",
    },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// One named case prints exactly one `✓/✗ <TAG>: <name>` line aggregating its
// sub-assertions; the failed labels follow on indented detail lines.
function scenario(TAG, name, subs) {
  const failed = subs.filter((s) => !s.ok);
  if (failed.length === 0) { console.log(`  ✓ ${TAG}: ${name}`); pass++; return; }
  console.log(`  ✗ ${TAG}: ${name}`);
  for (const f of failed) console.log(`      - ${f.label}${f.detail ? ` [${f.detail}]` : ""}`);
  fail++;
}

// --- cases --------------------------------------------------------------------

console.log("pre-tool.mjs — project isolation (audit findings + oracle-r1 fixtures)\n");

try {
  // I1 — governance witness: the payload-probe destination follows the governing run.
  {
    const { ws, key, a, b } = twoProjectWorkspace();
    const r = runHook({
      projectDir: ws, key, debug: true,
      payload: { tool_name: "mcp__fs__write_file", tool_input: { path: join(b.root, ".zcode", "state", "run-b.json") } },
    });
    const probeInB = join(b.root, ".zcode", "state", "run-b.payload-probe.json");
    const probeInA = join(a.root, ".zcode", "state", "run-a.payload-probe.json");
    scenario("I1", "an mcp__fs__write_file targeting project-b state is governed by run-b (probe destination)", [
      { ok: existsSync(probeInB), label: "the payload-probe lands in project-b's state dir (run-b governs)", detail: `exit=${r.status}, probeB=${existsSync(probeInB)}` },
      { ok: !existsSync(probeInA), label: "no payload-probe lands in project-a's state dir", detail: `probeA=${existsSync(probeInA)}` },
    ]);
  }

  // I2 — protection witness: BOTH projects' trust-critical dirs are guarded.
  {
    const { ws, key, a, b } = twoProjectWorkspace();
    const mcp = (target) => runHook({
      projectDir: ws, key,
      payload: { tool_name: "mcp__fs__write_file", tool_input: { path: target } },
    }).status;
    scenario("I2", "non-native writes into BOTH projects' .zcode/state and reviews exit 2", [
      { ok: mcp(join(a.root, ".zcode", "state", "run-a.json")) === 2, label: "a write into project-a state is blocked" },
      { ok: mcp(join(b.root, ".zcode", "state", "run-b.json")) === 2, label: "a write into project-b state is blocked (today: exit 0 — b is undefended)" },
      { ok: mcp(join(b.root, ".zcode", "reviews", "x.json")) === 2, label: "a write into project-b reviews is blocked (today: exit 0)" },
    ]);
  }

  // I5 — attribution witness: the ungated-Bash ledger follows the per-call run.
  {
    const { ws, key, a, b } = twoProjectWorkspace();
    const r = runHook({
      projectDir: ws, key, ungated: true,
      payload: { tool_name: "Bash", tool_input: { command: `echo iso-i5 >> ${join(b.root, "src", "b.js")}` }, cwd: b.root },
    });
    const ledgerB = join(b.root, ".zcode", "state", "run-b.ungated.jsonl");
    const ledgerA = join(a.root, ".zcode", "state", "run-a.ungated.jsonl");
    scenario("I5", "ungated Bash with cwd=project-b appends ONLY to b's ungated ledger", [
      { ok: r.status === 0, label: "the hatch still passes the call (it records, it does not block)", detail: `exit=${r.status}` },
      { ok: existsSync(ledgerB), label: "the ledger line lands in project-b's state dir", detail: `ledgerB=${existsSync(ledgerB)}` },
      { ok: !existsSync(ledgerA), label: "nothing is appended to project-a's ledger", detail: `ledgerA=${existsSync(ledgerA)}` },
    ]);
  }

  // TIE — equal-depth runs in ONE repo; the most recently updated must govern. Both
  // recency phases are asserted, so today's scan-order pick fails exactly one of them
  // whichever way the directory listing happens to order the two files.
  {
    const ws = realpathSync(mkdtempSync(join(tmpdir(), "zod-tie-")));
    cleanup.push(ws);
    const key = join(ws, "fixture.key");
    const repo = join(ws, "tie-repo");
    const older = makeProject(repo, "tie-old", "src/old.js", new Date(Date.now() - 120_000).toISOString(), key);
    makeProject(repo, "tie-new", "src/new.js", new Date(Date.now() - 30_000).toISOString(), key);
    writeFileSync(join(repo, "src", "undeclared.js"), "// fixture\n");
    const governedBy = (slug) => {
      const r = runHook({
        projectDir: ws, key,
        payload: { tool_name: "Edit", tool_input: { file_path: join(repo, "src", "undeclared.js") } },
      });
      return r.status === 2 && r.stdout.includes(`slug=${slug}`);
    };
    const beforeSwap = governedBy("tie-new");
    // Swap recency in place. The marker still verifies: updated_at is deliberately
    // OUTSIDE the marker's identity (trusted writers mutate it on every write).
    const st = JSON.parse(readFileSync(older.statePath, "utf8"));
    st.updated_at = new Date(Date.now() - 5_000).toISOString();
    writeFileSync(older.statePath, JSON.stringify(st, null, 2));
    const afterSwap = governedBy("tie-old");
    scenario("TIE", "two equal-depth runs in ONE repo: the most recently updated governs the edit", [
      { ok: beforeSwap, label: "the fresher run tie-new governs (scope block names it)" },
      { ok: afterSwap, label: "after the recency swap tie-old governs (today: the scan-order pick ignores updated_at)" },
    ]);
  }

  // PARITY — the single-project case must not move while multi-project selection changes.
  {
    const ws = realpathSync(mkdtempSync(join(tmpdir(), "zod-par-")));
    cleanup.push(ws);
    const key = join(ws, "fixture.key");
    const repo = join(ws, "repo");
    makeProject(repo, "solo", "src/text.js", new Date(Date.now() - 30_000).toISOString(), key);
    writeFileSync(join(repo, "src", "unrelated.js"), "// fixture\n");
    const h = (payload) => runHook({ projectDir: ws, key, payload });
    // A second single-run fixture, pre-OKAY, for the verdict gate.
    const ws2 = realpathSync(mkdtempSync(join(tmpdir(), "zod-par2-")));
    cleanup.push(ws2);
    const key2 = join(ws2, "fixture.key");
    const repo2 = join(ws2, "repo");
    makeProject(repo2, "solo2", "src/text.js", new Date(Date.now() - 30_000).toISOString(), key2, { phase: "plan", verdict: "REJECT" });
    scenario("PARITY", "single-repo/single-run selection and gate behavior unchanged", [
      { ok: h({ tool_name: "Edit", tool_input: { file_path: join(repo, "src", "text.js") } }).status === 0, label: "the declared file is editable" },
      { ok: h({ tool_name: "Edit", tool_input: { file_path: join(repo, "src", "unrelated.js") } }).status === 2, label: "an undeclared file is scope-blocked" },
      { ok: h({ tool_name: "Task", tool_input: { subagent_type: "zodyssey:explore", prompt: "read-only research" }, cwd: repo }).status === 0, label: "a read-only dispatch under the cap passes" },
      { ok: h({ tool_name: "mcp__fs__write_file", tool_input: { path: join(repo, ".zcode", "state", "solo.json") } }).status === 2, label: "an mcp write to the run's own state is blocked" },
      { ok: runHook({ projectDir: ws2, key: key2, payload: { tool_name: "Edit", tool_input: { file_path: join(repo2, "src", "text.js") } } }).status === 2, label: "pre-OKAY product edits stay verdict-blocked" },
    ]);
  }

  // SYMLINK — the directory-symlink skip, pinned at BOTH DFS copies. The in-process
  // findActiveRuns probe never reads a state file here (discovery from b finds no .zcode
  // at all), so its default key path is never touched — the fixture key still guards
  // the hook subprocess.
  {
    const ws = realpathSync(mkdtempSync(join(tmpdir(), "zod-sym-")));
    cleanup.push(ws);
    const key = join(ws, "fixture.key");
    const a = makeProject(join(ws, "project-a"), "run-a", "src/a.js", new Date(Date.now() - 30_000).toISOString(), key);
    const bDir = join(ws, "project-b");
    mkdirSync(bDir, { recursive: true });
    symlinkSync(a.root, join(bDir, "link-to-a")); // directory symlink b -> a
    const { findActiveRuns } = await import("./lib/find-run.mjs");
    const discovered = findActiveRuns({ projectDir: bDir, staleMs: 24 * 3600 * 1000 });
    const r = runHook({
      projectDir: bDir, key, debug: true,
      payload: { tool_name: "mcp__fs__write_file", tool_input: { path: join(a.root, ".zcode", "state", "run-a.json") } },
    });
    scenario("SYMLINK", "a directory symlink from b into a is not followed by discovery", [
      { ok: discovered.length === 0, label: "findActiveRuns from b returns an empty list (shared module)", detail: `n=${discovered.length}` },
      { ok: r.status === 0 && !existsSync(join(a.root, ".zcode", "state", "run-a.payload-probe.json")), label: "the real hook no-ops from b (no run discovered through the link)", detail: `exit=${r.status}` },
    ]);
  }

  // FALLBACK — outside every discovered repo: mostRecent governs and BLOCKS. The
  // "no run encloses the target" outcome must never become a silent exit 0.
  {
    const { ws, key } = twoProjectWorkspace();
    const loose = join(ws, "loose-note.txt");
    writeFileSync(loose, "fixture\n");
    const edit = runHook({ projectDir: ws, key, payload: { tool_name: "Edit", tool_input: { file_path: loose } } });
    // cwd = the parent workspace itself: the documented accepted residual — parent-cwd
    // Bash attributes to the recency winner. Pinned so the fallback stays a fallback.
    const bash = runHook({ projectDir: ws, key, payload: { tool_name: "Bash", tool_input: { command: `echo x >> ${loose}` }, cwd: ws } });
    scenario("FALLBACK", "a target outside every discovered repo falls back to mostRecent — never a silent pass", [
      { ok: edit.status === 2, label: "the outside-repo edit is blocked", detail: `exit=${edit.status}` },
      { ok: edit.stdout.includes("slug=run-a"), label: "the most-recent run run-a governs the block" },
      { ok: bash.status === 2, label: "the Bash twin is blocked too (recency winner, accepted residual)", detail: `exit=${bash.status}` },
    ]);
  }

  // DECOY — oracle-r1 blocker 1: per-call selection is steerable by the payload, so the
  // protection set must not derive from the per-call pick. One payload carries a decoy
  // path under project-b AND the real write target under project-a.
  {
    const { ws, key, a, b } = twoProjectWorkspace();
    const decoy = join(b.root, "notes", "decoy.txt");
    const mcp = (target) => runHook({
      projectDir: ws, key,
      payload: { tool_name: "mcp__fs__write_file", tool_input: { decoy, target } },
    }).status;
    scenario("DECOY", "a decoy path steering selection cannot undefend project-a's state or reviews", [
      { ok: mcp(join(a.root, ".zcode", "state", "run-a.json")) === 2, label: "decoy(b) + write-target(a state) is still blocked" },
      { ok: mcp(join(a.root, ".zcode", "reviews", "r1.json")) === 2, label: "decoy(b) + write-target(a reviews) is still blocked" },
      { ok: mcp(join(b.root, "src", "b.js")) === 0, label: "a normal file under b stays allowed (not a blanket block)" },
    ]);
  }

  // TTL — oracle-r1 blocker 2: the cache hit path must be TTL-bounded. This is the
  // suite's ONLY cache-enabled case (hermetic: the cache file lives inside the mkdtemp
  // workspace, and aging rewrites `at` in that file — no sleep anywhere).
  {
    const ws = realpathSync(mkdtempSync(join(tmpdir(), "zod-ttl-")));
    cleanup.push(ws);
    const key = join(ws, "fixture.key");
    mkdirSync(join(ws, ".zcode", "state"), { recursive: true }); // the cache file's home
    const a = makeProject(join(ws, "project-a"), "run-a", "src/a.js", new Date(Date.now() - 30_000).toISOString(), key);
    const cachePath = join(ws, ".zcode", "state", ".find-active-run.cache");
    const h = (payload, extra = {}) => runHook({ projectDir: ws, key, cache: true, payload, ...extra });
    // Inert call: no paths, not mcp__/edit/bash — discovery runs, nothing else mutates.
    const inert = { tool_name: "Grep", tool_input: { pattern: "hermetic-warm" } };
    h(inert); // warm the cache with ONLY project-a discovered
    const warm = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : null;
    h(inert); // fresh `at` → hot path
    const afterHit = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : null;
    // Create project-b MID-WINDOW, OLDER than a (so even a full rescan today would keep
    // run-a governing — the failure stays attributable to staleness, not to recency).
    makeProject(join(ws, "project-b"), "run-b", "src/b.js", new Date(Date.now() - 90_000).toISOString(), key);
    // Age the cache past the TTL bound by rewriting `at`.
    const aged = JSON.parse(readFileSync(cachePath, "utf8"));
    aged.at = Date.now() - 61_000;
    writeFileSync(cachePath, JSON.stringify(aged));
    const p1 = h({ tool_name: "mcp__fs__write_file", tool_input: { path: join(ws, "project-b", ".zcode", "state", "run-b.json") } });
    const p2 = h({ tool_name: "Bash", tool_input: { command: "echo ttl-probe" }, cwd: join(ws, "project-b") }, { ungated: true });
    const ledgerB = join(ws, "project-b", ".zcode", "state", "run-b.ungated.jsonl");
    const ledgerA = join(a.root, ".zcode", "state", "run-a.ungated.jsonl");
    scenario("TTL", "an aged discovery cache re-scans: a mid-window project-b becomes visible to protection and selection", [
      { ok: !!warm && warm.result?.run?.slug === "run-a", label: "the cache warmed on run-a (only project-a discovered)", detail: `slug=${warm?.result?.run?.slug}` },
      { ok: JSON.stringify(warm) === JSON.stringify(afterHit), label: "a fresh-at hit stays on the hot path (cache not rewritten)" },
      { ok: p1.status === 2, label: "after aging, an mcp write into b's state is blocked (today: the stale hit allows it)", detail: `exit=${p1.status}` },
      { ok: p2.status === 0 && existsSync(ledgerB) && !existsSync(ledgerA), label: "after aging, ungated Bash cwd=b is ledgered in b only (today: in a)", detail: `exit=${p2.status}, ledgerB=${existsSync(ledgerB)}, ledgerA=${existsSync(ledgerA)}` },
    ]);
  }
} finally {
  for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
