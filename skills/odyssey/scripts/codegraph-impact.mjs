#!/usr/bin/env node
// codegraph-impact.mjs — derive the impacted file set for a list of symbols by
// shelling `codegraph impact <symbol> --json -p <repo>`, unioning the filePaths.
//
// WHY: the plan's per-todo `Files:` declaration is planner guesswork today, and
// the scope hook fails closed on a wrong declaration. A planner or lint check can
// diff the declared Files against this script's impact union to catch under- or
// over-scoped todos before execute, when the fix is still cheap.
//
// WHAT IT SHELLS: `codegraph impact <symbol> --json -p <repo>` once per symbol.
// `codegraph impact` is the deterministic source — its `--json` mode emits
//   { symbol, depth, nodeCount, edgeCount, affected: [{name,kind,filePath,startLine}] }
// so the impacted files are exactly the union of `affected[].filePath` across the
// requested symbols. `codegraph explore` (text mode, file paths wrapped in
// markdown backtick-bold `**\`path\`**`) is harder to parse deterministically, so
// we rely on `impact --json` and treat a non-JSON stdout (e.g. "ℹ Symbol X not
// found") as "0 affected files for this symbol" rather than crashing.
//
// GRACEFUL NO-OP: if `<repo>/.codegraph/` does NOT exist, this prints
//   "no .codegraph at <repo>; skipping impact analysis"
// to stdout and exits 0. Impact analysis is opt-in per repo (the user decides
// whether to run `codegraph init`), so absence is normal, not an error.
//
// HARD ERROR: if `<repo>/.codegraph/` EXISTS but the `codegraph` binary is not on
// PATH, we print a clear message to stderr and exit non-zero. The user has opted
// into codegraph for this repo (the index exists), so a missing binary is a real
// environment break — we refuse to silently pass.
//
// Usage:
//   codegraph-impact.mjs <repo> <symbol1> [symbol2 ...]
//     <repo>:    repo root (argv[2]); must contain or omit `.codegraph/`
//     <symbol*>: one or more symbols (argv[3..]) to analyze
//   stdout (impact found):  one JSON line
//     {"repo":"...","symbols":[...],"impacted_files":[...],"missing_symbols":[...]}
//   stdout (no .codegraph): "no .codegraph at <repo>; skipping impact analysis"
//   exit: 0 success / no-op · 2 bad args · 1 .codegraph present but binary missing
//
// Verified against codegraph 1.5.0 (`codegraph impact --json` shape, the
// "ℹ Symbol X not found" stdout line, and exit codes from a fixture repo).

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { argv, exit, env } from "node:process";

const repo = argv[2];
const symbols = argv.slice(3);

if (!repo || symbols.length === 0) {
  console.error("usage: codegraph-impact.mjs <repo> <symbol1> [symbol2 ...]");
  exit(2);
}

const repoAbs = resolve(repo);

// --- branch 1: no .codegraph/ → graceful no-op (this is the ~/.zcode case) ---
// We check for the directory itself; the live index lives in codegraph.db inside
// it. An empty `.codegraph/` dir is enough to take the "exists" branch (a planner
// may have created it as a marker); the binary check below then gates execution.
const codegraphDir = join(repoAbs, ".codegraph");
if (!existsSync(codegraphDir) || !statSync(codegraphDir).isDirectory()) {
  console.log(`no .codegraph at ${repoAbs}; skipping impact analysis`);
  exit(0);
}

// --- branch 2: .codegraph/ present but binary missing → hard error ---
// `codegraph` is normally installed globally via `npm i -g @colbymchenry/codegraph`.
// If the user has indexed this repo, a missing binary is an environment break, not
// a normal state — fail loudly so a lint/planner caller sees it, never silently.
let codegraphBin;
try {
  codegraphBin = whichSync("codegraph");
} catch {
  console.error(
    "codegraph binary not found; install with npm i -g @colbymchenry/codegraph"
  );
  exit(1);
}

// --- branch 3: run `codegraph impact <symbol> --json -p <repo>` per symbol ---
// Per-symbol (not `codegraph explore <many>`) because:
//   - `impact --json` emits a stable, machine-parseable shape per symbol.
//   - `explore` takes many symbols but returns text; its file paths are wrapped in
//     markdown and its "blast radius" section is advisory, not a clean file set.
// Unioning per-symbol impact gives the exact set of files a change would touch.
const impacted = new Set();
const missing = [];

for (const sym of symbols) {
  let out;
  try {
    // Encoding utf8 so we can string-parse. stdio: pipe (capture), and inherit no
    // tty so codegraph's spinner/color doesn't pollute stdout. maxBuffer is generous
    // — impact output is small but a deeply-connected symbol could be sizeable.
    out = execFileSync(
      codegraphBin,
      ["impact", sym, "--json", "-p", repoAbs],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (e) {
    // Non-zero exit from codegraph itself (not "not found" — that's exit 0 on
    // stdout). Treat as "this symbol contributed 0 files" but record it as missing
    // so the caller knows impact was incomplete for it. Do NOT abort the whole run;
    // one bad symbol shouldn't zero out the others.
    missing.push(sym);
    continue;
  }

  // The "not found" case prints "ℹ Symbol \"X\" not found" to stdout and exits 0,
  // so out is non-JSON text. Try to parse; on failure, record as missing and move
  // on. (We do NOT try to parse the text form — it's advisory and we can't tell
  // "not found" from any other non-JSON line reliably.)
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    missing.push(sym);
    continue;
  }

  const affected = Array.isArray(parsed.affected) ? parsed.affected : [];
  for (const a of affected) {
    if (a && typeof a.filePath === "string" && a.filePath.length > 0) {
      impacted.add(a.filePath);
    }
  }
  if (affected.length === 0) missing.push(sym);
}

const result = {
  repo: repoAbs,
  symbols,
  impacted_files: Array.from(impacted).sort(),
  missing_symbols: missing,
};
console.log(JSON.stringify(result));
exit(0);

// --- helpers ---

// Lightweight `which` that respects PATH and PATHEXT without a dependency. Returns
// the absolute path to the binary or throws (caught above). We avoid importing a
// `which` npm module — this script must run in a bare repo (no node_modules).
function whichSync(bin) {
  const pathEnv = env.PATH || "";
  const sep = pathEnv.includes(";") && process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch { /* not here, keep scanning */ }
    }
  }
  throw new Error(`command not found: ${bin}`);
}
