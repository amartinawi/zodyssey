#!/usr/bin/env node
// codegraph-impact.test.mjs — unit tests for codegraph-impact.mjs.
//
// Tests three branches:
//   (a) NO `.codegraph/` → graceful no-op: stdout contains "no .codegraph", exit 0.
//       This is the AC3 path and the live `~/.zcode` state.
//   (b) `.codegraph/` EXISTS, binary PRESENT → JSON with impacted_files from a real
//       indexed fixture repo (we run `codegraph init` to build a genuine index, then
//       assert the script unions the right filePaths).
//   (c) `.codegraph/` EXISTS, binary ABSENT → clear stderr error mentioning the
//       install command, non-zero exit. We simulate a missing binary by mangling
//       PATH so `codegraph` is unresolvable.
//
// Run:  node codegraph-impact.test.mjs   (exit 0 = pass, 1 = fail)
//
// Fixtures: each test builds a tmp dir with mkdtempSync, tears it down with rmSync.
// We NEVER touch `~/.zcode` itself (no `.codegraph` there — directive 13).

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { exit, env } from "node:process";

// Resolve node's own path once (ESM-safe). The "binary absent" test builds a PATH
// that has node but NOT codegraph — tricky because on this box both live in
// /usr/bin, so we copy node into a clean temp dir and point PATH there.
const NODE_BIN = execFileSync("which", ["node"], { encoding: "utf8" }).trim();

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const SCRIPT = join(SCRIPT_DIR, "codegraph-impact.mjs");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  \u2713 ${name}`); pass++; }
  else { console.log(`  \u2717 ${name} ${detail}`); fail++; }
}

// Run the script in a child process so we can capture stdout/stderr/exit
// independently and mangle PATH for the "binary absent" case without poisoning
// the test runner's own environment.
function run(repo, symbols, opts = {}) {
  const res = spawnSync("node", [SCRIPT, repo, ...symbols], {
    encoding: "utf8",
    env: opts.env || { ...env },
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    stdout: res.stdout || "",
    stderr: res.stderr || "",
    status: res.status,
    error: res.error,
  };
}

console.log("codegraph-impact.mjs unit tests\n");

// --- detect whether codegraph is installed so branch (b) can adapt ---
const codegraphPresent = (() => {
  try {
    const r = spawnSync("codegraph", ["--version"], { encoding: "utf8" });
    return r.status === 0;
  } catch { return false; }
})();
console.log(`  (env: codegraph ${codegraphPresent ? "present" : "ABSENT"} — branch (b) adapts)\n`);

// ============================================================
// (a) NO `.codegraph/` → graceful no-op. This is AC3 and the
//     ~/.zcode state. Output must contain "no .codegraph", exit 0.
// ============================================================
{
  const dir = mkdtempSync(join(tmpdir(), "zod-cg-noindex-"));
  try {
    const { stdout, status } = run(dir, ["symbolX"]);
    check("no .codegraph → exit 0", status === 0, `(got ${status})`);
    check("no .codegraph → stdout contains 'no .codegraph'",
      stdout.includes("no .codegraph"), `(stdout=${JSON.stringify(stdout.trim())})`);
    check("no .codegraph → stdout does NOT look like impact JSON",
      !stdout.trim().startsWith("{"), `(stdout=${JSON.stringify(stdout.trim())})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- (a.2) AC3 verbatim: nonexistent repo path → still the no-.codegraph branch ---
// A repo path that doesn't exist at all must take the same graceful no-op (the
// `.codegraph/` check is existsSync-based and returns false for a missing parent).
{
  const { stdout, status } = run("/tmp/no-such-repo-zodyssey-16", ["symbolX"]);
  check("missing repo dir → exit 0", status === 0, `(got ${status})`);
  check("missing repo dir → stdout contains 'no .codegraph'",
    stdout.includes("no .codegraph"), `(stdout=${JSON.stringify(stdout.trim())})`);
}

// ============================================================
// (b) `.codegraph/` EXISTS, binary PRESENT → real indexed fixture.
//     Build a tiny repo, `codegraph init` it, then assert the script
//     emits JSON with the correct union of impacted files.
//     SKIPPED (not failed) if codegraph is absent in this environment.
// ============================================================
if (!codegraphPresent) {
  console.log("  (skip) branch (b) — codegraph not installed; fixtures still cover (a)+(c)\n");
} else {
  const dir = mkdtempSync(join(tmpdir(), "zod-cg-indexed-"));
  try {
    // Two files, a calls b, so impact(b) should reach both callers of b.
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.js"),
      "export function alpha() { return beta(); }\n");
    writeFileSync(join(dir, "src", "b.js"),
      "export function beta() { return 42; }\n");
    writeFileSync(join(dir, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", type: "module" }));

    // Build a real index. `codegraph init` writes `.codegraph/codegraph.db`.
    const initRes = spawnSync("codegraph", ["init", dir], { encoding: "utf8" });
    check("fixture: `codegraph init` succeeds", initRes.status === 0,
      `(stderr=${(initRes.stderr || "").trim().slice(0, 200)})`);

    if (initRes.status === 0) {
      // impact(beta) → affected should include both b.js (def) and a.js (caller).
      const { stdout, stderr, status } = run(dir, ["beta"]);
      check("indexed repo → exit 0", status === 0,
        `(stderr=${stderr.trim().slice(0, 200)})`);

      let parsed = null;
      try { parsed = JSON.parse(stdout.trim()); } catch (e) {}
      check("indexed repo → stdout is valid JSON", parsed !== null,
        `(stdout=${stdout.trim().slice(0, 200)})`);

      if (parsed) {
        check("indexed repo → repo field matches fixture dir",
          parsed.repo === dir, `(got ${parsed.repo})`);
        check("indexed repo → symbols echoed back",
          JSON.stringify(parsed.symbols) === JSON.stringify(["beta"]),
          `(got ${JSON.stringify(parsed.symbols)})`);
        check("indexed repo → impacted_files is an array",
          Array.isArray(parsed.impacted_files));
        check("indexed repo → impact(beta) includes src/b.js (definition)",
          parsed.impacted_files.includes("src/b.js"),
          `(got ${JSON.stringify(parsed.impacted_files)})`);
        check("indexed repo → impact(beta) includes src/a.js (caller)",
          parsed.impacted_files.includes("src/a.js"),
          `(got ${JSON.stringify(parsed.impacted_files)})`);
      }

      // --- (b.2) nonexistent symbol: 0 impacted, recorded in missing_symbols ---
      const r2 = run(dir, ["doesNotExist"]);
      check("nonexistent symbol → exit 0", r2.status === 0);
      let p2 = null;
      try { p2 = JSON.parse(r2.stdout.trim()); } catch {}
      check("nonexistent symbol → valid JSON", p2 !== null);
      if (p2) {
        check("nonexistent symbol → impacted_files empty",
          Array.isArray(p2.impacted_files) && p2.impacted_files.length === 0,
          `(got ${JSON.stringify(p2.impacted_files)})`);
        check("nonexistent symbol → recorded in missing_symbols",
          Array.isArray(p2.missing_symbols) && p2.missing_symbols.includes("doesNotExist"),
          `(got ${JSON.stringify(p2.missing_symbols)})`);
      }

      // --- (b.3) multi-symbol union: beta + doesNotExist → only beta's files ---
      const r3 = run(dir, ["beta", "doesNotExist"]);
      let p3 = null;
      try { p3 = JSON.parse(r3.stdout.trim()); } catch {}
      check("multi-symbol → valid JSON", p3 !== null);
      if (p3) {
        check("multi-symbol → union has both src/a.js and src/b.js",
          p3.impacted_files.includes("src/a.js") && p3.impacted_files.includes("src/b.js"),
          `(got ${JSON.stringify(p3.impacted_files)})`);
        check("multi-symbol → doesNotExist in missing_symbols",
          p3.missing_symbols.includes("doesNotExist"),
          `(got ${JSON.stringify(p3.missing_symbols)})`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================
// (c) `.codegraph/` EXISTS, binary ABSENT → clear stderr error,
//     non-zero exit. We build a PATH containing node (copied into a
//     clean temp dir) but NOT codegraph, so the script's whichSync
//     throws and the hard-error branch fires.
//     The .codegraph dir is synthetic (empty) — enough to take the
//     "exists" branch; the script never reaches codegraph before the
//     binary check fails.
// ============================================================
{
  const dir = mkdtempSync(join(tmpdir(), "zod-cg-nobin-"));
  // Separate temp dir holding ONLY a node copy — keeps codegraph unresolvable.
  const binDir = mkdtempSync(join(tmpdir(), "zod-cg-nobin-bin-"));
  try {
    // Synthetic .codegraph (empty dir) — we do NOT run `codegraph init` here.
    mkdirSync(join(dir, ".codegraph"));

    // Copy node into binDir; point PATH at binDir alone. The child process can run
    // node (our script) but cannot resolve `codegraph` — exactly the condition we
    // need to exercise. (On this box node and codegraph share /usr/bin, so a bare
    // PATH=NODE_DIR would still find codegraph — hence the isolated copy.)
    copyFileSync(NODE_BIN, join(binDir, "node"));
    const strippedEnv = { ...env, PATH: binDir };

    const { stdout, stderr, status } = run(dir, ["alpha"], { env: strippedEnv });
    check("binary absent → non-zero exit", status !== null && status !== 0,
      `(got status=${status})`);
    check("binary absent → stderr mentions install command",
      stderr.includes("npm i -g @colbymchenry/codegraph"),
      `(stderr=${stderr.trim().slice(0, 200)})`);
    check("binary absent → stderr mentions 'codegraph binary not found'",
      stderr.includes("codegraph binary not found"),
      `(stderr=${stderr.trim().slice(0, 200)})`);
    check("binary absent → stdout is NOT impact JSON",
      !stdout.trim().startsWith("{"),
      `(stdout=${stdout.trim().slice(0, 200)})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  }
}

// --- (d) bad args: no symbols → exit 2 ---
{
  const dir = mkdtempSync(join(tmpdir(), "zod-cg-noargs-"));
  try {
    const { status, stderr } = run(dir, []);
    check("no symbols → exit 2", status === 2, `(got ${status})`);
    check("no symbols → stderr has usage", stderr.includes("usage"),
      `(stderr=${stderr.trim().slice(0, 120)})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
