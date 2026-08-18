// lint-invocation.mjs — the ONE shared lint invocation both hooks call (item 07 / B10, todo 2).
//
// WHY SHARED: the pre-edit hook captures a "before" exit status and the post-edit hook
// compares a "after" exit status against it. If the two sides read toolchain.json
// differently, split the command differently, or capped at different timeouts, the
// comparison would measure two different things and the attribution would be noise.
// One module, one code path, byte-identical invocations — divergence is made
// structurally impossible.
//
// API (every entry point NEVER throws — failures are data in the returned shape):
//   lintTarget(repoRoot, target) → { spawned, status, timedOut, stderr, stdout, cmd }
//     Reads <repoRoot>/.zcode/toolchain.json (produced by probe-toolchain.mjs), takes
//     lint_cmd, whitespace-splits it into an argv array, and runs
//     [...argv, target] with cwd at repoRoot, shell:false (no interpolation → no
//     injection surface) and the 5s cap. Absent toolchain.json or a null/blank
//     lint_cmd → NOTHING is spawned and spawned:false says so. status is the exit
//     code, or null when the run never produced one (spawn failure / kill). stderr
//     and stdout are the captured error/output (strings, possibly empty — stdout
//     feeds ONLY the block reason; eslint/ruff/tsc report there). cmd is the
//     resolved lint_cmd, null when nothing spawned. Exit status is the only output
//     GRADED; per-diagnostic parsing stays a deliberately-unbuilt known limit.
//   baselineKey(repoRoot, target) → string
//     The repo-relative side-file key for a target, computed identically on both
//     sides (byte-for-byte key agreement is what makes the lookup meaningful).
//     Falls back to the resolved absolute path for targets outside the repo root.
//   baselinePath / readBaselineMap / writeBaselineMap
//     The .zcode/state/<slug>.lint-baseline.json side-file: JSON object keyed by
//     baselineKey, per-target value exactly "clean" | "failing" | "inert" (frozen at
//     first touch by the pre-side capture arm; post-side records use the separate
//     "seen:<key>" namespace so frozen values are never rewritten). Writes use the
//     atomic same-dir tmp+rename idiom (the ledger-drain pattern, post-tool.mjs:255).
//     The .lint-baseline.json suffix is explicitly skipped by find-run.mjs discovery.

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, realpathSync } from "node:fs";
import { join, resolve as pathResolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

// The 5s cap, defined once so both hooks share it by construction.
export const LINT_TIMEOUT_MS = 5000;

const INERT_RESULT = { spawned: false, status: null, timedOut: false, stderr: "", stdout: "", cmd: null };

export function lintTarget(repoRoot, target) {
  try {
    const tcPath = join(repoRoot, ".zcode", "toolchain.json");
    let tc = null;
    if (existsSync(tcPath)) {
      try { tc = JSON.parse(readFileSync(tcPath, "utf8")); } catch { tc = null; }
    }
    const cmd = tc && typeof tc.lint_cmd === "string" && tc.lint_cmd.trim()
      ? tc.lint_cmd.trim() : null;
    if (!cmd || !target) return { ...INERT_RESULT };
    const argv = cmd.split(/\s+/);
    const r = spawnSync(argv[0], [...argv.slice(1), target], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: LINT_TIMEOUT_MS,
      shell: false,
      encoding: "utf8",
    });
    const errCode = r && r.error && r.error.code;
    // A timeout kill is a capability failure of the LINT RUN, not a diagnostic of the
    // target — surfaced as timedOut:true (spawned:true, status:null). Any other spawn
    // error (ENOENT etc.) means nothing ran: spawned:false.
    const timedOut = errCode === "ETIMEDOUT" || !!(r && r.signal);
    const spawned = !r || !r.error || errCode === "ETIMEDOUT";
    return {
      spawned,
      status: r && typeof r.status === "number" ? r.status : null,
      timedOut,
      stderr: r && typeof r.stderr === "string" ? r.stderr : "",
      stdout: r && typeof r.stdout === "string" ? r.stdout : "",
      cmd,
    };
  } catch {
    return { ...INERT_RESULT };
  }
}

export function baselineKey(repoRoot, target) {
  try {
    let root;
    try { root = realpathSync.native(repoRoot); } catch { root = pathResolve(repoRoot); }
    // A Write to a not-yet-existing file cannot be realpath'd — resolve lexically
    // against the repo root instead (the pre side sees the file before it exists;
    // the post side sees it after; the two agree wherever the tree is symlink-free).
    let abs;
    try { abs = realpathSync.native(target); } catch { abs = pathResolve(root, target); }
    const prefix = root + sep;
    if (abs === root) return "";
    if (abs.startsWith(prefix)) return abs.slice(prefix.length);
    return abs; // outside the run's repo root: key on the resolved absolute path
  } catch {
    return String(target || "");
  }
}

export function baselinePath(stateDir, slug) {
  return join(stateDir, `${slug}.lint-baseline.json`);
}

export function readBaselineMap(stateDir, slug) {
  try {
    const m = JSON.parse(readFileSync(baselinePath(stateDir, slug), "utf8"));
    return (m && typeof m === "object" && !Array.isArray(m)) ? m : null;
  } catch {
    return null; // absent / unreadable / unparseable → the caller treats every entry as absent
  }
}

// Atomic same-dir tmp+rename (the ledger-drain idiom). Throws only on a genuinely
// unwritable state dir — callers wrap in try/catch and block nothing on failure.
export function writeBaselineMap(stateDir, slug, map) {
  const p = baselinePath(stateDir, slug);
  const tmp = p + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(map, null, 2) + "\n");
  try { renameSync(tmp, p); } catch { try { unlinkSync(tmp); } catch {} }
}
