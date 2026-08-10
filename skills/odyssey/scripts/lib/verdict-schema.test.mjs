// verdict-schema.test.mjs — tests for the shared verdict-lane schema.
// Run: node skills/odyssey/scripts/lib/verdict-schema.test.mjs
// Exits 0 on success, non-zero on any failure.

import assert from "node:assert/strict";
import {
  REVIEW_VALUES,
  CONSULT_VALUES,
  FINAL_VALUES,
  makeReviewDefault,
  validateReviewVerdict,
  normalizeConsultVerdict,
} from "./verdict-schema.mjs";

let failures = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL - ${name}: ${e.message}`);
  }
};

// --- lane value enums are exported with the right wire values -----------------
test("lane value enums export the frozen wire values", () => {
  assert.deepEqual(REVIEW_VALUES, ["OKAY", "REJECT"]);
  assert.deepEqual(CONSULT_VALUES, ["ACCEPT", "REJECT"]);
  assert.deepEqual(FINAL_VALUES, ["pass", "fail"]);
});

// --- validateReviewVerdict accepts OKAY + REJECT, rejects others --------------
test("validateReviewVerdict accepts OKAY and REJECT", () => {
  assert.equal(validateReviewVerdict("OKAY"), true);
  assert.equal(validateReviewVerdict("REJECT"), true);
});

test("validateReviewVerdict rejects everything else", () => {
  // lowercase / wrong case — these are wire values, case matters
  assert.equal(validateReviewVerdict("okay"), false);
  assert.equal(validateReviewVerdict("reject"), false);
  // the consult value must NOT satisfy the review lane
  assert.equal(validateReviewVerdict("ACCEPT"), false);
  // typos and junk
  assert.equal(validateReviewVerdict("APPROVE"), false);
  assert.equal(validateReviewVerdict(""), false);
  assert.equal(validateReviewVerdict(null), false);
  assert.equal(validateReviewVerdict(undefined), false);
  assert.equal(validateReviewVerdict(123), false);
  assert.equal(validateReviewVerdict({ verdict: "OKAY" }), false);
});

// --- makeReviewDefault returns a fresh object each call -----------------------
test("makeReviewDefault returns a structurally-correct object", () => {
  const d = makeReviewDefault();
  assert.deepEqual(d, { round: 0, max_rounds: 3, verdict: null, history: [] });
});

test("makeReviewDefault returns a FRESH object each call (no shared reference)", () => {
  const a = makeReviewDefault();
  const b = makeReviewDefault();
  assert.notEqual(a, b, "top-level object must be a different reference");
  assert.notEqual(a.history, b.history, "history array must be a different reference");
  // mutating one must not bleed into the other
  a.round = 7;
  a.history.push("tainted");
  assert.equal(b.round, 0, "sibling object must not see round mutation");
  assert.equal(b.history.length, 0, "sibling object must not see history mutation");
});

// --- normalizeConsultVerdict: ACCEPT happy path -------------------------------
test("normalizeConsultVerdict returns ACCEPT for clean ACCEPT with no gaps", () => {
  const out = normalizeConsultVerdict({ verdict: "ACCEPT", gaps: [] });
  assert.equal(out.verdict, "ACCEPT");
  assert.deepEqual(out.gaps, []);
});

test("normalizeConsultVerdict returns ACCEPT for whitespace-padded lowercase accept", () => {
  // trim + uppercase must normalize " accept " → "ACCEPT"
  const out = normalizeConsultVerdict({ verdict: " accept ", gaps: [] });
  assert.equal(out.verdict, "ACCEPT");
});

// --- normalizeConsultVerdict: the fail-closed cases ---------------------------
test("normalizeConsultVerdict REJECTs ACCEPT that carries gaps", () => {
  const out = normalizeConsultVerdict({ verdict: "ACCEPT", gaps: [{ id: "G1" }] });
  assert.equal(out.verdict, "REJECT", "ACCEPT with non-empty gaps must fail-closed to REJECT");
  assert.equal(out.gaps.length, 1);
});

test("normalizeConsultVerdict REJECTs an explicit REJECT verdict", () => {
  const out = normalizeConsultVerdict({ verdict: "REJECT", gaps: [] });
  assert.equal(out.verdict, "REJECT");
});

test("normalizeConsultVerdict REJECTs the 'NOT ACCEPTABLE' original-bug case", () => {
  // The old `.includes("ACCEPT")` matched this string and turned it into ACCEPT.
  // The exact-string check must NOT — this is the security regression guard.
  const out = normalizeConsultVerdict({ verdict: "NOT ACCEPTABLE", gaps: [] });
  assert.equal(out.verdict, "REJECT", "'NOT ACCEPTABLE' must fail-closed to REJECT");
});

test("normalizeConsultVerdict REJECTs missing/empty/garbage verdicts (fail-closed)", () => {
  assert.equal(normalizeConsultVerdict({ verdict: "", gaps: [] }).verdict, "REJECT");
  assert.equal(normalizeConsultVerdict({ gaps: [] }).verdict, "REJECT");
  assert.equal(normalizeConsultVerdict({ verdict: "DO NOT ACCEPT", gaps: [] }).verdict, "REJECT");
  assert.equal(normalizeConsultVerdict({ verdict: "MAYBE", gaps: [] }).verdict, "REJECT");
});

test("normalizeConsultVerdict tolerates a non-object / null raw input by failing closed", () => {
  assert.equal(normalizeConsultVerdict(null).verdict, "REJECT");
  assert.equal(normalizeConsultVerdict(undefined).verdict, "REJECT");
  assert.equal(normalizeConsultVerdict("ACCEPT").verdict, "REJECT");
});

// --- normalizeConsultVerdict: passthrough fields are preserved/sanitized ------
test("normalizeConsultVerdict preserves summary (sliced), gaps, advisories, and raw", () => {
  const raw = {
    verdict: "REJECT",
    summary: "x".repeat(800),
    gaps: [{ id: "G1" }, { id: "G2" }],
    advisories: [{ kind: "warn" }],
    extra: "ignored",
  };
  const out = normalizeConsultVerdict(raw);
  assert.equal(out.summary.length, 500, "summary must be sliced to 500 chars");
  assert.deepEqual(out.gaps, raw.gaps);
  assert.deepEqual(out.advisories, raw.advisories);
  assert.equal(out.raw, raw);
});

test("normalizeConsultVerdict defaults summary/gaps/advisories when absent", () => {
  const out = normalizeConsultVerdict({ verdict: "REJECT" });
  assert.equal(out.summary, "");
  assert.deepEqual(out.gaps, []);
  assert.deepEqual(out.advisories, []);
});

// --- summary ------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nall verdict-schema tests passed");
process.exit(0);
