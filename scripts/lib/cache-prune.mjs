// cache-prune.mjs — ONE pure definition of "which plugin cache version dirs are stale",
// shared by install.mjs's exclusive --prune-cache mode and the default run's prune preview.
//
// WHY THIS FILE EXISTS: the marketplace subsystem only ever ADDS version dirs under
// cache/<marketplace>/<plugin>/<version>/ — Get/Update never removes the old ones, so the
// cache grows without bound. Which copy is LIVE cannot be guessed: the loader reads
// installed_plugins.json, so the registry is the only source of truth. The plan is
// therefore registry truth + arithmetic — no mtime ordering, no dir-count heuristic, no
// repo-version shortcut (wrong by construction during a version bump), nothing that
// smells like a staleness judgment.
//
// This module is PURE by contract: it reads the filesystem (including per-dir git
// provenance, by fs-read only — never a subprocess) and computes lists. It contains NO
// deletion code and no write of any kind; the consumer prints the list and — only in its
// execution wiring — deletes exactly it.
//
// Containment: the only directory ever walked is the parent of the registry-resolved
// installPath. Sibling plugins, other marketplaces, and every other tree under the cache
// base are invisible here by construction.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

// The retention window, as a count of version dirs kept at-or-below live: the live
// version plus its immediate on-disk predecessor. The predecessor is retained for TWO
// reasons, stated honestly:
//   (a) inspection — right after a botched marketplace Update, the previous release's
//       directory is what you diff against live to see what actually changed;
//   (b) rollback — in the clean-marketplace-Update case it is a coherent one-release
//       rollback target (today's version mixtures came from --sync-cache layering content
//       into the registered dir instead of moving the install).
// This is NOT an unconditional rollback guarantee — a hand-edited registry can point
// anywhere; the window only promises the immediate predecessor survives a prune.
export const CACHE_PRUNE_KEEP = 2;

// Candidate version dirs: direct children of the live parent whose names are exactly x.y.z.
const SEMVER_NAME = /^\d+\.\d+\.\d+$/;
// A git object id (SHA-1 40 hex, or 64 in a SHA-256 repo). Anything else is not a sha.
const SHA_RE = /^[0-9a-f]{40,64}$/i;

/**
 * Hand-rolled numeric x.y.z compare (zero dependencies, per the no-npm rule).
 * Returns <0 when a is older, 0 when equal, >0 when a is newer. Gapped numbering
 * compares numerically, not lexicographically: 0.6.9 < 0.6.12.
 */
export function compareSemver(a, b) {
  const seg = (v, i) => {
    const n = Number(String(v).split(".")[i]);
    return Number.isFinite(n) ? n : 0;
  };
  for (let i = 0; i < 3; i++) {
    const d = seg(a, i) - seg(b, i);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Per-dir git HEAD provenance, resolved by fs-read ONLY (never a subprocess):
 *   <dir>/.git/HEAD → "ref: refs/heads/<name>" → the loose ref file wins → else
 *   packed-refs → else HEAD holds the sha itself (detached) → else "unknown".
 * Reportage ONLY: keep/prune/skipped are computed without it — an absent or corrupt
 * .git changes nothing about the decisions (pinned by the suite's provenance family).
 */
function gitHeadOf(dir) {
  let head;
  try { head = readFileSync(join(dir, ".git", "HEAD"), "utf8").trim(); }
  catch { return "unknown"; }
  if (!head) return "unknown";
  const ref = head.match(/^ref:\s*(\S+)$/);
  if (!ref) return SHA_RE.test(head) ? head : "unknown"; // detached: HEAD holds the sha
  const name = ref[1];
  if (!name.startsWith("refs/")) return "unknown"; // refuse odd symbolic targets
  try {
    const loose = readFileSync(join(dir, ".git", name), "utf8").trim();
    if (SHA_RE.test(loose)) return loose; // the loose ref file beats a packed duplicate
  } catch { /* fall through to packed-refs */ }
  try {
    for (const line of readFileSync(join(dir, ".git", "packed-refs"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || t.startsWith("^")) continue;
      const sp = t.indexOf(" ");
      if (sp < 0) continue;
      const sha = t.slice(0, sp), refname = t.slice(sp + 1).trim();
      if (refname === name && SHA_RE.test(sha)) return sha;
    }
  } catch { /* absent or unreadable packed-refs */ }
  return "unknown";
}

/**
 * Compute the stale-cache plan for one plugin install, from the registry.
 *
 * @param {object} opts
 * @param {string} opts.pluginsJsonPath — absolute path to installed_plugins.json (the registry)
 * @param {string} [opts.pluginName="zodyssey"] — the entry to resolve (the caller's own name)
 * @returns On success: { liveVersion, keep[], prune[], skipped[], provenance{}, parentDir } —
 *          keep/prune/skipped hold plain child NAMES (never paths); keep is sorted newest →
 *          oldest, prune oldest → newest; provenance maps dir name → git HEAD sha | "unknown";
 *          parentDir is the live version's parent (the only dir the caller may touch).
 *          On ANY unverifiable shape: { error } — truthy message, no keep/prune keys. Fail
 *          closed: an unverifiable registry prunes nothing.
 */
export function planCachePrune({ pluginsJsonPath, pluginName = "zodyssey" } = {}) {
  if (typeof pluginsJsonPath !== "string" || !pluginsJsonPath) {
    return { error: "pluginsJsonPath is required" };
  }

  // --- the registry: the only source of truth for which copy is live ---
  if (!existsSync(pluginsJsonPath)) {
    return { error: `installed_plugins.json not found at ${pluginsJsonPath}` };
  }
  let data;
  try { data = JSON.parse(readFileSync(pluginsJsonPath, "utf8")); }
  catch (e) { return { error: `installed_plugins.json unparseable: ${e.message}` }; }
  if (!data || !Array.isArray(data.plugins)) {
    return { error: "installed_plugins.json has no plugins array" };
  }
  const entry = data.plugins.find((p) => p && p.name === pluginName) || null;
  if (!entry) {
    return { error: `no ${pluginName} entry in installed_plugins.json (not marketplace-installed?)` };
  }
  const liveVersion = entry.version;
  const installPath = entry.installPath;
  if (typeof liveVersion !== "string" || !liveVersion ||
      typeof installPath !== "string" || !installPath) {
    return { error: `${pluginName} entry lacks version/installPath — cannot establish live-ness` };
  }
  const install = installPath.replace(/\/+$/, "");
  if (!existsSync(install)) {
    return { error: `installPath does not exist: ${installPath}` };
  }
  // Containment: the install must live STRICTLY UNDER the cache base that sits beside the
  // registry (<plugins dir>/cache — exactly where the marketplace subsystem puts it).
  // Anything else (a marketplace source clone, a random path) is not a cache copy; and the
  // base ITSELF is refused too — installPath == cacheBase would make the walked parent the
  // plugins dir (siblings, the registry), which is never a version-dir parent. Fail closed.
  const cacheBase = join(dirname(pluginsJsonPath), "cache");
  if (!install.startsWith(cacheBase + "/")) {
    return { error: `installPath is not under the plugin cache base (${cacheBase}): ${installPath}` };
  }

  // --- the ONLY directory walked: the live version's parent ---
  const parentDir = dirname(install);
  // The live DIR's name — the basename of the registry-resolved installPath. It can
  // DISAGREE with the registry's version field (the hand-rollback shape: version 0.6.12
  // while installPath → .../0.4.0), so it is computed once, here, and carved out of the
  // removal list below: the RUNNING dir is never pruned, whatever its name.
  const liveDir = install.slice(parentDir.length + 1);
  let children;
  try { children = readdirSync(parentDir, { withFileTypes: true }); }
  catch (e) { return { error: `cannot read the live version's parent dir ${parentDir}: ${e.message}` }; }

  const names = children.map((c) => c.name).sort();
  const candidates = names.filter((n) => SEMVER_NAME.test(n));

  // Decisions — computed WITHOUT provenance (reportage never decides).
  // Retention window: the CACHE_PRUNE_KEEP newest dirs at-or-below live = live + predecessor,
  // read from disk (the highest semver dir strictly below registry-live — NOT live-minus-one
  // arithmetic; the cache is often gapped).
  const belowOrAtLive = candidates
    .filter((n) => compareSemver(n, liveVersion) <= 0)
    .sort((a, b) => compareSemver(b, a)); // newest → oldest
  const retained = belowOrAtLive.slice(0, CACHE_PRUNE_KEEP);
  const prune = belowOrAtLive.slice(CACHE_PRUNE_KEEP)
    .filter((n) => n !== liveDir) // the live DIR is never removable, whatever its name
    .sort((a, b) => compareSemver(a, b));
  // Never prune anything newer than live: a downloaded-but-unregistered update is
  // indistinguishable from an orphaned newer dir, and the registry cannot arbitrate.
  const newerThanLive = candidates
    .filter((n) => compareSemver(n, liveVersion) > 0)
    .sort((a, b) => compareSemver(b, a));
  const keep = [...newerThanLive, ...retained];
  // Catastrophic-case guard: the live DIR itself is always kept, whatever its name —
  // excluded from prune above AND reported in keep here (never in both lists: the
  // consumer iterates prune, so a live dir there would be printed and rmSync'd).
  if (SEMVER_NAME.test(liveDir) && !keep.includes(liveDir)) keep.push(liveDir);

  // Everything else in the parent (non-semver dirs, stray files): reported, never touched.
  const decided = new Set([...keep, ...prune]);
  const skipped = names.filter((n) => !decided.has(n));

  const provenance = {};
  for (const c of children) {
    if (c.isDirectory()) provenance[c.name] = gitHeadOf(join(parentDir, c.name));
  }

  return { liveVersion, keep, prune, skipped, provenance, parentDir };
}
