#!/usr/bin/env node
// gap-ledger.test.mjs — unit tests for the gap lifecycle ledger (row 32).
// gapKey = deterministic finding identity (category + whitespace-collapsed issue, fallback
// fix); compareGaps = OCR-compare-derived multiset buckets (new/persisting/resolved);
// scanRecurredGaps = cross-run recurrence over sibling state files. Hermetic fixtures only.
// Run:  node gap-ledger.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";

import { gapKey, compareGaps, scanRecurredGaps } from "./gap-ledger.mjs";

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name} ${detail}`); fail++; }
}

console.log("gap-ledger.mjs unit tests\n");

// --- gapKey: identity survives whitespace collapse + category case ----------------------
{
  const a = gapKey({ category: "Bug", issue: "consult.mjs  leaks   state when\n\nthe lock is held" });
  const b = gapKey({ category: "bug", issue: "consult.mjs leaks state when the lock is held" });
  check("gapKey: whitespace-collapsed issue + case-insensitive category match", a === b, `(${a} vs ${b})`);
  check("gapKey: key contains the category lowercase", a.startsWith("bug|"), a);
  check("gapKey: caps at 300 chars", gapKey({ category: "bug", issue: "x".repeat(500) }).length <= 300);
  check("gapKey: empty issue falls back to fix", gapKey({ category: "bug", issue: "", fix: "close the lock" }) === gapKey({ category: "bug", issue: "", fix: "close the  lock" }));
  check("gapKey: different issues differ", gapKey({ category: "bug", issue: "alpha" }) !== gapKey({ category: "bug", issue: "beta" }));
}

// --- compareGaps: multiset min-matching + deterministic order ---------------------------
{
  const g = (category, issue) => ({ category, severity: "major", issue, fix: "f" });
  const before = [g("bug", "alpha"), g("bug", "alpha"), g("quality", "beta"), g("compliance", "gamma")];
  const after = [g("bug", "alpha"), g("security", "delta")];
  const r = compareGaps(before, after);
  check("compareGaps: multiset min — 2×alpha before, 1×after → 1 persisting, 1 alpha + beta + gamma resolved",
    r.persisting.length === 1 && r.resolved.length === 3 &&
    r.resolved.filter((k) => k.includes("alpha")).length === 1 && r.resolved.some((k) => k.includes("beta")) && r.resolved.some((k) => k.includes("gamma")),
    JSON.stringify(r));
  check("compareGaps: new bucket holds the after-side remainder", r.new.length === 1 && r.new[0].includes("delta"), JSON.stringify(r.new));
  check("compareGaps: buckets are sorted deterministically",
    JSON.stringify(compareGaps([g("z", "z1"), g("a", "a1")], [g("z", "z1"), g("a", "a1")]).persisting) ===
    JSON.stringify(compareGaps([g("a", "a1"), g("z", "z1")], [g("a", "a1"), g("z", "z1")]).persisting));
  // The documented limitation, asserted as EXPECTED behavior: a fully reworded finding
  // reads as resolved+new (no line numbers exist on gaps; rewording breaks identity).
  const r2 = compareGaps([g("bug", "the timer overflows")], [g("bug", "the clock overruns")]);
  check("compareGaps: reworded finding → resolved+new (documented limitation)", r2.resolved.length === 1 && r2.new.length === 1 && r2.persisting.length === 0);
  check("compareGaps: empty inputs → empty buckets, never null", JSON.stringify(compareGaps([], [])) === JSON.stringify({ new: [], persisting: [], resolved: [] }));
  check("compareGaps: malformed gaps do not throw", compareGaps([null, {}, { category: 3, issue: null }], [{ category: "bug", issue: "x" }]).new.length === 1);
}

// --- scanRecurredGaps: cross-run recurrence over sibling state files ---------------------
{
  const repo = mkdtempSync(join(tmpdir(), "zod-gapledger-"));
  try {
    mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
    const key = gapKey({ category: "bug", issue: "the verifier double-counts N+1 criteria" });
    writeFileSync(join(repo, ".zcode", "state", "prior-run.json"), JSON.stringify({
      phase: "done", consult: { rounds: 2, verdict: "REJECT", last_gaps: [{ category: "bug", severity: "major", issue: "the verifier double-counts N+1 criteria", fix: "f" }] },
    }));
    writeFileSync(join(repo, ".zcode", "state", "prior-run.inflight.json"), JSON.stringify({
      phase: "execute", consult: { rounds: 9, verdict: "REJECT", last_gaps: [{ category: "bug", issue: "inflight noise must never count" }] },
    }));
    writeFileSync(join(repo, ".zcode", "state", "this-run.json"), JSON.stringify({
      phase: "done", consult: { rounds: 1, verdict: "REJECT", last_gaps: [{ category: "bug", issue: "the verifier double-counts N+1 criteria" }] },
    }));
    const r = scanRecurredGaps(repo, "this-run", [key]);
    check("scanRecurredGaps: recurring final gap counted, prior slug named", r.count === 1 && r.slugs.includes("prior-run"), JSON.stringify(r));
    check("scanRecurredGaps: *.inflight.json and self are never scanned",
      !r.slugs.includes("this-run") && !r.slugs.some((s) => s.includes("inflight")));
    const r2 = scanRecurredGaps(repo, "this-run", [gapKey({ category: "bug", issue: "never seen before" })]);
    check("scanRecurredGaps: novel key → zero recurrence", r2.count === 0 && r2.slugs.length === 0, JSON.stringify(r2));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
