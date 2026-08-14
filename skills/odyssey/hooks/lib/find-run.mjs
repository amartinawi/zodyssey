// find-run.mjs — shared "discover active runs" logic (SEC-H4, external audit #3 + in-session F6).
//
// PROBLEM: findActiveRun existed in THREE copies (pre-tool/post-tool/stop). pre-tool was fixed
// (#6a nested-repo DFS + 2b cache) but post-tool/stop stayed FLAT — so nested-repo runs never
// drained the parallel-cap ledger (30-min stall) and never wrote a resume checkpoint. Three
// copies of any logic WILL drift; this is the drift. This module is the single source of truth.
//
// API:
//   findActiveRuns({ projectDir, staleMs }) → [{ state, stateDir, statePath }]
//     Discovery only: bounded DFS for every .zcode/state dir under projectDir, parse each
//     state.json, drop terminal/stale. Additive (finds nested-repo runs). Never loosens a gate.
//   selectByTarget(runs, targetPath) → run | null
//     SEC-H6 (external audit #8): when a tool targets a file, pick the run whose repo root is the
//     nearest ancestor of the target — NOT the globally most-recent run (which made a sibling
//     repo's run govern this one). Falls back to most-recent only when no targetPath.
//
// Hooks keep their own selection policy on top of discovery (pre-tool wraps this in its 2b cache).

import { readdirSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve as pathResolve, sep } from "node:path";
import { verifyMarker } from "../../scripts/lib/state-auth.mjs";

export const TERMINAL = new Set(["done", "audited", "abandoned"]);
export const STALE_MS_DEFAULT = 24 * 3600 * 1000;

const SKIP_NAMES = new Set([".git", ".codegraph", "node_modules", "vendor", "target", "dist",
  "build", ".next", ".nuxt", ".cache", ".turbo", "coverage", "__pycache__", ".venv", "venv",
  "bower_components", "jspm_packages"]);
const MAX_DEPTH = 5;

function discoverStateDirs(projectDir) {
  const stateDirs = [];
  const stack = [[projectDir, 0, false]]; // [dir, depth, isZcodeChild]
  const seen = new Set();
  while (stack.length) {
    const [dir, depth, isZcodeChild] = stack.pop();
    let real;
    try { real = realpathSync.native(dir); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    if (isZcodeChild) {
      stateDirs.push(join(dir, "state"));
      continue;
    }
    if (depth >= MAX_DEPTH) continue;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith(".") && e.name !== ".zcode") continue;
      if (SKIP_NAMES.has(e.name)) continue;
      stack.push([join(dir, e.name), depth + 1, e.name === ".zcode"]);
    }
  }
  return stateDirs;
}

// repo root = two levels above a .zcode/state dir (.../<repo>/.zcode/state)
function repoRootOf(stateDir) {
  try { return pathResolve(stateDir, "..", ".."); } catch { return null; }
}

export function findActiveRuns({ projectDir, staleMs = STALE_MS_DEFAULT }) {
  if (!existsSync(projectDir)) return [];
  const now = Date.now();
  const topLevelState = join(projectDir, ".zcode", "state");
  const stateDirs = discoverStateDirs(projectDir);
  if (!stateDirs.includes(topLevelState)) stateDirs.push(topLevelState);
  const out = [];
  for (const dir of stateDirs) {
    if (!existsSync(dir)) continue;
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith(".json")) continue;
      if (f.endsWith(".inflight.json")) continue; // parallel-cap ledger, not a run state file
      const p = join(dir, f);
      let st;
      try { st = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      // CRITICAL T1-7: same authenticity requirement as pre-tool's own discovery. This copy feeds
      // selectByTarget (edit/dispatch re-selection) and both post-tool and stop — leaving it
      // unauthenticated would let a dropped state file win by target-ancestry even after the
      // primary discovery path started rejecting it.
      if (!verifyMarker(st, st.slug || f.replace(/\.json$/, "")).ok) continue;
      if (!st.phase || TERMINAL.has(st.phase)) continue;
      const updated = st.updated_at ? new Date(st.updated_at).getTime() : 0;
      if (updated && now - updated > staleMs) continue; // stale → treat as abandoned
      out.push({ state: st, stateDir: dir, statePath: p });
    }
  }
  return out;
}

export function mostRecent(runs) {
  let best = null;
  for (const r of runs) {
    if (!best || (r.state.updated_at || "") > (best.state.updated_at || "")) best = r;
  }
  return best;
}

// SEC-H6: pick the run whose repo root is the nearest ancestor of the target path. Prevents a
// sibling repo's run from governing an edit in this repo. Falls back to mostRecent when no run
// encloses the target (e.g. dispatch tools that don't carry a single target path).
export function selectByTarget(runs, targetPath) {
  if (!targetPath || runs.length === 0) return mostRecent(runs);
  let target;
  try { target = realpathSync.native(targetPath); } catch { target = pathResolve(targetPath); }
  // prefer runs whose repo root is an ancestor of the target; among those, the deepest (nearest).
  const enclosing = [];
  for (const r of runs) {
    const root = repoRootOf(r.stateDir);
    if (!root) continue;
    const prefix = root + sep;
    if (target === root || target.startsWith(prefix)) enclosing.push({ r, root });
  }
  if (enclosing.length === 0) return mostRecent(runs); // no run encloses the target → recency
  enclosing.sort((a, b) => b.root.length - a.root.length); // deepest first
  return enclosing[0].r;
}
