// deploy-surface.mjs — ONE definition of "what gets deployed", shared by the deployer and both
// drift gates.
//
// WHY THIS FILE EXISTS: install.mjs (--verify) and smoke-gate.mjs each carried their OWN
// hard-coded list of directories to compare against the cache, while --sync-cache deployed whole
// trees recursively. Two independent lists, one recursive copy — so the lists fell behind, twice:
//
//   · The v0.4.1 audit (T4-4) found both gates comparing 3 directories while 6 were deployed.
//     A drifted agents/momus.md ran a STALE REVIEWER PROMPT with both gates reporting green.
//   · Widening those lists to 6 STILL missed skills/odyssey/hooks/lib/find-run.mjs, because the
//     lists were flat and that file is one level down. find-run.mjs is where run-state marker
//     verification lives — a stale copy there silently un-authenticates run discovery, which is
//     the v0.5.0 CRITICAL fix, and both gates would still report green.
//
// The root cause was never the list's contents; it was that a list had to be maintained at all.
// SYNC_TREES below is what --sync-cache copies AND what the gates walk, recursively. Deploy a new
// subdirectory and it is compared automatically. There is nothing left to forget to update.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The trees --sync-cache copies into the plugin cache. Adding one here extends deployment AND
// drift detection together, which is the entire point.
export const SYNC_TREES = ["skills", "agents", "commands", ".zcode-plugin", "scripts", "docs"];

// Extensions worth comparing. .mjs is executable enforcement; .md is prompt enforcement — momus.md
// decides what counts as a blocker, so a drifted prompt changes behavior as surely as drifted code.
const COMPARED_EXT = [".mjs", ".md"];

// Directories that legitimately differ between repo and cache, or are noise.
const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__"]);

/**
 * Every deployed file worth comparing, as paths relative to the repo root.
 * Walks recursively, so it cannot fall behind what --sync-cache copies.
 */
export function enumerateDeployed(repoRoot, trees = SYNC_TREES) {
  const out = [];
  const walk = (rel) => {
    const abs = join(repoRoot, rel);
    let entries;
    try {
      if (!existsSync(abs) || !statSync(abs).isDirectory()) return;
      entries = readdirSync(abs);
    } catch { return; }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const childRel = join(rel, name);
      let st;
      try { st = statSync(join(repoRoot, childRel)); } catch { continue; }
      if (st.isDirectory()) walk(childRel);
      else if (COMPARED_EXT.some((e) => name.endsWith(e))) out.push(childRel);
    }
  };
  for (const t of trees) walk(t);
  return out.sort();
}
