// gap-ledger.mjs — the gap lifecycle ledger (row 32, hyperresearch/OCR adaptation).
//
// Deterministic finding identity for consult gaps, so the remediation loop's convergence
// becomes measurable: a RE-RAISED ground (same category + same whitespace-collapsed issue)
// matches across audit rounds even though each round is a fresh judge, and the run report
// can say new/persisting/resolved instead of a bare round count.
//
// Mechanism transplanted from alibaba/open-code-review's internal/session/compare.go
// (findingKey + Compare buckets), adapted: ZOdyssey gaps carry no line numbers, so the
// OCR line-drift concern maps to REWORDING — a fully reworded finding reads as
// resolved+new. That limitation is deliberate and documented (gap-ledger.test.mjs asserts
// it as expected behavior); the alternative (fuzzy matching) is an opinion layer this
// project's non-goals exclude.
//
// CONTRACT (pure functions; zero LLM, zero subprocess, zero network):
//   gapKey(gap)            → "category|collapsed-issue" (fallback: collapsed fix when the
//                             issue is empty; 300-char cap; malformed gaps → "|")
//   compareGaps(before, after) → { new, persisting, resolved } — multiset MIN-matching on
//                             gapKey (min(N,M) persisting, remainder to the longer side),
//                             every bucket a SORTED array of keys (category, then key) so
//                             JSON output is diffable run-to-run
//   scanRecurredGaps(repoRoot, slug, keys) → { count: DISTINCT recurring keys, slugs:
//                             prior runs (≤5) holding any of them } — cross-run recurrence
//                             of the FINAL kept gaps against sibling state files
//                             (*.inflight.json and the run itself are never scanned);
//                             advisory evidence only, never a gate
//
// Consumers: consult.mjs (gap_delta on history pushes), run-report.mjs
// (consult_gap_lifecycle + recurred_gaps_from_prior_runs). Nothing here EVER enters the
// next auditor's prompt — round independence is load-bearing (row 29).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KEY_CAP = 300;

/** Collapse every whitespace run to a single space (OCR's normalizeSnippet). */
function collapse(s) {
  return String(s ?? "").split(/\s+/).filter(Boolean).join(" ");
}

/** The identity of a finding: what it is about, not how it is worded. */
export function gapKey(gap) {
  const g = gap && typeof gap === "object" ? gap : {};
  const category = collapse(g.category).toLowerCase();
  const body = collapse(g.issue) || collapse(g.fix);
  return (category + "|" + body).slice(0, KEY_CAP);
}

/** Multiset min-match on gapKey, OCR compare.go's discipline. */
export function compareGaps(before, after) {
  const pool = new Map(); // key → remaining after-side count
  for (const g of Array.isArray(after) ? after : []) {
    const k = gapKey(g);
    pool.set(k, (pool.get(k) || 0) + 1);
  }
  const persisting = [];
  const resolved = [];
  for (const g of Array.isArray(before) ? before : []) {
    const k = gapKey(g);
    const left = pool.get(k) || 0;
    if (left > 0) {
      persisting.push(k);
      pool.set(k, left - 1);
    } else {
      resolved.push(k);
    }
  }
  const fresh = [];
  for (const [k, n] of pool) for (let i = 0; i < n; i++) fresh.push(k);
  const sortKeys = (arr) => arr.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { new: sortKeys(fresh), persisting: sortKeys(persisting), resolved: sortKeys(resolved) };
}

/**
 * Cross-run recurrence: which of THIS run's final kept-gap keys also appear in a PRIOR
 * run's final kept gaps? Reads <repoRoot>/.zcode/state/*.json (inflight + self skipped,
 * the mine-corrections idiom); unparseable files are skipped, never thrown. Returns
 * { count, slugs }: count = the DISTINCT wanted keys found in ANY prior run (audit r4 gap 1
 * — a key seen in five runs still counts once), slugs = the prior runs holding any (≤5) —
 * the per-finding twin of item 25's class-level recurrence; mine-corrections stays 25's.
 */
export function scanRecurredGaps(repoRoot, slug, keys) {
  const wanted = new Set(Array.isArray(keys) ? keys.filter((k) => typeof k === "string" && k) : []);
  const out = { count: 0, slugs: [] };
  if (wanted.size === 0) return out;
  const recurred = new Set(); // distinct wanted keys found in any prior run
  let names = [];
  try {
    names = readdirSync(join(repoRoot, ".zcode", "state"));
  } catch {
    return out; // no state dir — nothing recurred
  }
  for (const name of names) {
    if (!name.endsWith(".json") || name.endsWith(".inflight.json")) continue;
    const other = name.slice(0, -".json".length);
    if (other === slug) continue;
    let st;
    try {
      st = JSON.parse(readFileSync(join(repoRoot, ".zcode", "state", name), "utf8"));
    } catch {
      continue;
    }
    const finalGaps = st?.consult?.last_gaps;
    if (!Array.isArray(finalGaps)) continue;
    const hitKeys = finalGaps.map((g) => gapKey(g)).filter((k) => wanted.has(k));
    if (hitKeys.length > 0) {
      for (const k of hitKeys) recurred.add(k);
      out.slugs.push(other);
    }
  }
  out.count = recurred.size;
  out.slugs = out.slugs.sort().slice(0, 5);
  return out;
}
