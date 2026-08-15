// repo-path.mjs — one place that turns a caller-supplied path into something safe to COMPARE.
//
// WHY THIS EXISTS (audit 2026-08-14, Class B): guards across this plugin compared a realpath'd
// side against an as-passed side, so the predicate could never fire. Three failed OPEN:
//   · record-momus-artifact.mjs SEC-6      — `join(repo,".zcode")` (relative when repo is `.`)
//                                            vs realpathSync(fromFile) (absolute) -> never matched
//   · record-final-artifact.mjs            — byte-identical clone of the same bug
//   · pre-tool.mjs protected-dirs (v0.4.1) — realpath'd NEITHER side
// A fourth symptom was a one-time nonce burned to a deadlock: record-momus-artifact stored the
// artifact path as-passed while record-review compared an absolute realpath.
//
// The rule this module enforces: NEVER compare two paths unless both went through here.

import { realpathSync, statSync } from "node:fs";
import { resolve as pathResolve, sep } from "node:path";

// Canonical form of a path that may or may not exist yet.
// realpath resolves symlinks (the part a lexical resolve misses — /tmp -> /private/tmp on macOS,
// and plugin-cache installs are frequently symlinked). Falls back to a lexical absolute path when
// the target does not exist, which is the correct answer for a not-yet-created file.
export function resolvePath(p) {
  if (typeof p !== "string" || p === "") return "";
  try {
    return realpathSync.native(p);
  } catch {
    // Doesn't exist (or is unreadable): resolve lexically, then realpath the deepest existing
    // ancestor so a symlinked parent still normalizes.
    const abs = pathResolve(p);
    const parts = abs.split(sep);
    for (let i = parts.length - 1; i > 1; i--) {
      const head = parts.slice(0, i).join(sep) || sep;
      try {
        const realHead = realpathSync.native(head);
        return pathResolve(realHead, parts.slice(i).join(sep));
      } catch { /* keep walking up */ }
    }
    return abs;
  }
}

// The repo argument every trusted writer takes as argv[2]. Same as resolvePath, named for intent
// so call sites read as `const repoAbs = resolveRepo(repo)` at the argv boundary.
export const resolveRepo = (arg) => resolvePath(arg);

// Is `child` the same as, or inside, `parent`? Both sides are normalized here — that is the entire
// point. Returns false on empty input rather than throwing, so guards degrade to "not contained"
// (callers that need fail-closed must check emptiness themselves).
export function containedIn(child, parent) {
  const c = resolvePath(child);
  const p = resolvePath(parent);
  if (!c || !p) return false;
  return c === p || c.startsWith(p + sep);
}

// True when two paths name the same file on disk, even via different mount spellings.
// On this machine /Users/amartinawi and /home/amar are the SAME filesystem mounted twice
// (identical dev:inode), so a string compare of resolved paths is not sufficient for run
// attribution — callers that must match a repo across spellings use this.
export function sameFile(a, b) {
  const ra = resolvePath(a);
  const rb = resolvePath(b);
  if (ra && ra === rb) return true;
  try {
    const sa = statSync(ra);
    const sb = statSync(rb);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

// Every spelling of `root` that names the same directory, for querying stores (e.g. the ZCode
// session DB) that recorded whichever spelling the user happened to type. Always includes the
// canonical form first.
export function repoAliases(root, candidates = ["/Users/amartinawi", "/home/amar"]) {
  const canonical = resolvePath(root);
  if (!canonical) return [];
  const out = new Set([canonical, String(root)]);
  for (const a of candidates) {
    for (const b of candidates) {
      if (a === b) continue;
      if (canonical.startsWith(a + sep)) out.add(b + canonical.slice(a.length));
    }
  }
  return [...out].filter(Boolean);
}
