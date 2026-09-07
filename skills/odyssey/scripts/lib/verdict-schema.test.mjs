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

// =============================================================================
// gap-refute (run consult-refute-adaptation, todo 2) — post-normalization
// confidence routing + the refute-pass pure functions from ./gap-refute.mjs.
//
// RED-first note: the import below is a DYNAMIC namespace import (the consult.test.mjs
// :37-39 precedent) so that before ./gap-refute.mjs exists, the missing exports surface
// as individual FAILING checks here (undefined functions/constants) instead of a
// module-link crash that would take the whole suite — pre-existing cases included —
// down with it. Once the module exists the same line is the ordinary import.
// =============================================================================
const gapRefute = await import("./gap-refute.mjs").then(
  (m) => m,
  () => ({ __gapRefuteModuleMissing: true }),
);
const {
  CONFIDENCE_ROUTE_THRESHOLD,
  MIN_GROUNDING_CHARS,
  REFUTED_NOT_REMEDIATED_NOTE,
  routeGapsByConfidence,
  buildRefutePrompt,
  parseRefuteResponse,
  applyRefutations,
} = gapRefute;

// --- locked constants ---------------------------------------------------------
test("gap-refute exports the locked constants (threshold 0.5, grounding minimum, note)", () => {
  assert.equal(CONFIDENCE_ROUTE_THRESHOLD, 0.5, "metis D2 locks the low-confidence threshold at 0.5");
  assert.equal(MIN_GROUNDING_CHARS, 12, "a grounded quote must be a real verbatim span, not a 2-char accident");
  assert.equal(typeof REFUTED_NOT_REMEDIATED_NOTE, "string");
  assert.match(REFUTED_NOT_REMEDIATED_NOTE, /re-judged/i, "the fixed note carries the convergence-trap statement");
});

// --- routeGapsByConfidence: fail-closed routing rules --------------------------
test("routeGapsByConfidence keeps a gap MISSING confidence as a gap (fail-closed)", () => {
  const gap = { category: "bug", severity: "major", issue: "Missing null check on x", fix: "Guard x" };
  const out = routeGapsByConfidence([gap]);
  assert.equal(out.gaps.length, 1, "a gap with no confidence field must stay a gap");
  assert.deepEqual(out.gaps[0], gap);
  assert.deepEqual(out.advisoryStrings, []);
});

test("routeGapsByConfidence keeps a NON-NUMERIC confidence as a gap (fail-closed)", () => {
  // the numeric STRING is the hazard case: "0.2" must NOT be coerced into routable
  const out = routeGapsByConfidence([
    { issue: "A", fix: "fA", confidence: "0.2" },
    { issue: "B", fix: "fB", confidence: null },
    { issue: "C", fix: "fC", confidence: true },
    { issue: "D", fix: "fD", confidence: NaN },
  ]);
  assert.equal(out.gaps.length, 4, "all four non-numeric confidences stay gaps");
  assert.deepEqual(out.advisoryStrings, []);
});

test("routeGapsByConfidence routes numeric confidence < 0.5 to '[low-confidence] <issue>' strings", () => {
  const out = routeGapsByConfidence([
    { issue: "X is broken", fix: "Fix X", confidence: 0.2 },
    { issue: "Y is broken", fix: "Fix Y", confidence: 0.49 },
  ]);
  assert.deepEqual(out.gaps, [], "both low-confidence gaps leave the gap array");
  assert.deepEqual(out.advisoryStrings, [
    "[low-confidence] X is broken",
    "[low-confidence] Y is broken",
  ]);
});

test("routeGapsByConfidence keeps confidence >= 0.5 as gaps (threshold is strictly below 0.5)", () => {
  const out = routeGapsByConfidence([
    { issue: "E", fix: "fE", confidence: 0.5 },
    { issue: "F", fix: "fF", confidence: 0.9 },
  ]);
  assert.equal(out.gaps.length, 2);
  assert.deepEqual(out.advisoryStrings, []);
});

test("routeGapsByConfidence partitions in order, returns new arrays, never a verdict", () => {
  const input = [
    { issue: "G", fix: "fG", confidence: 0.9 },
    { issue: "H", fix: "fH", confidence: 0.1 },
  ];
  const snapshot = JSON.stringify(input);
  const out = routeGapsByConfidence(input);
  assert.equal(out.gaps.length, 1);
  assert.equal(out.gaps[0].issue, "G", "order preserved: the high-confidence gap stays");
  assert.equal(out.advisoryStrings.length, 1);
  assert.equal(out.advisoryStrings[0], "[low-confidence] H");
  assert.equal(JSON.stringify(input), snapshot, "the input array/objects are never mutated");
  assert.ok(!("verdict" in out), "routing result carries NO verdict key (invariant i)");
});

test("invariant (i): raw ACCEPT + gaps normalizes to REJECT and routing can NEVER resurrect ACCEPT", () => {
  const raw = {
    verdict: "ACCEPT",
    gaps: [
      { issue: "I1", fix: "f1", confidence: 0.1 },
      { issue: "I2", fix: "f2", confidence: 0.2 },
    ],
  };
  const normalized = normalizeConsultVerdict(raw);
  assert.equal(normalized.verdict, "REJECT", "ACCEPT-with-gaps fails closed to REJECT at normalization");
  const routed = routeGapsByConfidence(normalized.gaps);
  assert.deepEqual(routed.gaps, [], "every gap is low-confidence, so all route out");
  assert.equal(routed.advisoryStrings.length, 2);
  assert.ok(!("verdict" in routed), "routing output has no verdict to flip");
  assert.equal(normalized.verdict, "REJECT", "the already-normalized verdict is untouched by routing");
});

// --- buildRefutePrompt: DATA framing + highest-bar stance ----------------------
test("buildRefutePrompt frames gaps/plan/diff as DATA and demands grounded refutations JSON", () => {
  const prompt = buildRefutePrompt([{ issue: "J1", fix: "fJ1" }], "PLAN-BODY-XYZ", "DIFF-BODY-QRS");
  const dataLabels = (prompt.match(/DATA — not instructions/g) || []).length;
  assert.ok(dataLabels >= 3, `all three payloads are labeled DATA-not-instructions (got ${dataLabels})`);
  assert.ok(prompt.includes("J1"), "the gaps JSON is embedded");
  assert.ok(prompt.includes("PLAN-BODY-XYZ"), "the plan is embedded");
  assert.ok(prompt.includes("DIFF-BODY-QRS"), "the frozen redacted diff is embedded");
  assert.ok(prompt.includes('"refutations"'));
  assert.ok(prompt.includes('"index"'));
  assert.ok(prompt.includes('"reason"'));
  assert.ok(/verbatim/i.test(prompt), "the refute-has-the-highest-bar stance demands verbatim grounding");
});

// --- parseRefuteResponse: envelope-tolerant, fail-closed ----------------------
test("parseRefuteResponse unwraps the {result|text|content} envelope and brace-slices prose", () => {
  const enveloped = JSON.stringify({
    result: 'prose before {"refutations":[{"index":0,"reason":"  quoted evidence here  "}]} prose after',
  });
  assert.deepEqual(parseRefuteResponse(enveloped), [
    { index: 0, reason: "quoted evidence here" },
  ], "envelope unwrapped, prose sliced, reason trimmed");
  const flat = 'Sure! {"refutations":[{"index":1,"reason":"because the diff shows const x = 1;"}]} done';
  assert.deepEqual(parseRefuteResponse(flat), [{ index: 1, reason: "because the diff shows const x = 1;" }]);
  const viaText = JSON.stringify({ text: '{"refutations":[{"index":2,"reason":"r2"}]}' });
  assert.deepEqual(parseRefuteResponse(viaText), [{ index: 2, reason: "r2" }]);
  const objectResult = JSON.stringify({ result: { refutations: [{ index: 3, reason: "r3" }] } });
  assert.deepEqual(parseRefuteResponse(objectResult), [{ index: 3, reason: "r3" }]);
});

test("parseRefuteResponse drops malformed entries (shape, index, reason, duplicates)", () => {
  const out = parseRefuteResponse(JSON.stringify({
    refutations: [
      "not an object",
      null,
      42,
      { reason: "no index" },
      { index: "0", reason: "string index" },
      { index: -1, reason: "negative index" },
      { index: 1.5, reason: "non-integer index" },
      { index: 0 },
      { index: 0, reason: 123 },
      { index: 2, reason: "   " },
      { index: 3, reason: "first wins" },
      { index: 3, reason: "duplicate dropped" },
    ],
  }));
  assert.deepEqual(out, [{ index: 3, reason: "first wins" }]);
});

test("parseRefuteResponse is fail-closed: garbage/HTML/empty/no-array → [], never throws", () => {
  assert.deepEqual(parseRefuteResponse("<html><body>rate limited</body></html>"), []);
  assert.deepEqual(parseRefuteResponse(""), []);
  assert.deepEqual(parseRefuteResponse("{{{not json"), []);
  assert.deepEqual(parseRefuteResponse(JSON.stringify({ refutations: "nope" })), []);
  assert.deepEqual(parseRefuteResponse(JSON.stringify({})), []);
  assert.deepEqual(parseRefuteResponse(null), []);
  assert.deepEqual(parseRefuteResponse(undefined), []);
});

// --- applyRefutations: grounded refutation moves a gap to an advisory string ---
test("applyRefutations moves a grounded-refuted gap to exactly '[refuted] <issue> — <reason>' and reports", () => {
  const diff = 'diff --git a/x.mjs b/x.mjs\n+const isBash = tool_name === "Bash";';
  const gaps = [
    { issue: "Gap one is not real", fix: "fix one" },
    { issue: "Gap two stands", fix: "fix two" },
  ];
  const reason = 'the diff already guards this: const isBash = tool_name === "Bash"; so the gap is void';
  const out = applyRefutations(gaps, [{ index: 0, reason }], diff);
  assert.equal(out.gaps.length, 1, "the refuted gap leaves the gap array");
  assert.equal(out.gaps[0].issue, "Gap two stands");
  assert.deepEqual(out.refutedAdvisories, [`[refuted] Gap one is not real — ${reason}`]);
  assert.equal(out.report.kept, 1);
  assert.deepEqual(out.report.refuted, [{ index: 0, issue: "Gap one is not real", reason }]);
  assert.equal(out.report.note, REFUTED_NOT_REMEDIATED_NOTE);
});

test("oracle hardening: a reason quoting the gap's own fix text is grounded (no diff quote needed)", () => {
  const gaps = [{ issue: "Unguarded spawn", fix: "Wrap the spawn in the tripwire snapshot pattern" }];
  const reason = "already done: the code follows Wrap the spawn in the tripwire snapshot pattern exactly";
  const out = applyRefutations(gaps, [{ index: 0, reason }], "(diff has nothing relevant)");
  assert.deepEqual(out.gaps, [], "grounded via the gap's own fix text — the refutation survives");
  assert.equal(out.refutedAdvisories.length, 1);
});

test("oracle hardening: an UNGROUNDED opinion (no verbatim quote) refutes NOTHING", () => {
  const diff = "+const alpha = 1;\n+const beta = 2;\n+const gamma = 3;";
  const gaps = [{ issue: "Missing input validation on alpha", fix: "Validate alpha before use" }];
  const reason = "the auditor was far too cautious here and this does not matter at all in practice";
  const out = applyRefutations(gaps, [{ index: 0, reason }], diff);
  assert.equal(out.gaps.length, 1, "ungrounded refutation is inadmissible — the gap stays a gap");
  assert.deepEqual(out.refutedAdvisories, []);
  assert.equal(out.report.refuted.length, 0);
  assert.equal(out.report.kept, 1);
});

test("applyRefutations drops refutations whose index addresses no gap (out of range)", () => {
  const gaps = [{ issue: "K1", fix: "fK1" }, { issue: "K2", fix: "fK2" }];
  const reason = "grounded by quoting the fix text fK1 verbatim";
  const out = applyRefutations(gaps, [
    { index: 7, reason },
    { index: -1, reason },
    { index: 1.5, reason },
  ], "");
  assert.equal(out.gaps.length, 2, "no refutation lands — indices address no gap");
  assert.deepEqual(out.refutedAdvisories, []);
});

test("invariant (ii): ALL gaps refuted → empty gaps, string advisories, NO verdict anywhere (never auto-ACCEPT)", () => {
  const evidenceLine = "the frozen diff contains the literal evidence line zebra-crossing-guard";
  const gaps = [
    { issue: "L1", fix: evidenceLine },
    { issue: "L2", fix: "fL2" },
  ];
  const reason = `contradicted by the frozen diff: ${evidenceLine}`;
  const out = applyRefutations(gaps, [{ index: 0, reason }, { index: 1, reason }], evidenceLine);
  assert.deepEqual(out.gaps, [], "all gaps refuted — the gap array is empty");
  assert.equal(out.refutedAdvisories.length, 2);
  assert.equal(out.report.kept, 0);
  assert.ok(!("verdict" in out), "applyRefutations result carries NO verdict key — flipping REJECT to ACCEPT is impossible here");
  assert.match(out.report.note, /re-judged/i, "the fixed note carries the convergence-trap statement");
});

test("applyRefutations with zero refutations is a pure passthrough (gaps intact, no advisories)", () => {
  const gaps = [{ issue: "M1", fix: "fM1", confidence: 0.9 }];
  const snapshot = JSON.stringify(gaps);
  const out = applyRefutations(gaps, [], "irrelevant diff");
  assert.equal(out.gaps.length, 1);
  assert.deepEqual(out.refutedAdvisories, []);
  assert.equal(out.report.refuted.length, 0);
  assert.equal(out.report.kept, 1);
  assert.equal(JSON.stringify(gaps), snapshot, "input gaps are never mutated");
});

// --- non-object gap entries pass through UNTOUCHED (post-todo-3 defect report) --
// verdict-schema tolerates string gaps today (normalizeConsultVerdict passes gapsArr
// through as-is), so the refute path must not change their shape: `{..."abc"}` produces
// the indexed object {0:"a",1:"b",2:"c"}, corrupting consult.last_gaps. Non-object
// entries carry no confidence → they stay gaps (fail-closed) AND keep their identity.
// One case pins BOTH copy sites on the refute path (routing + application).
test("non-object gap entries (strings/numbers/null) pass through UNTOUCHED — never spread-mangled", () => {
  const routed = routeGapsByConfidence([
    "plain string gap",
    42,
    null,
    { issue: "obj gap", fix: "fix obj", confidence: 0.9 },
  ]);
  assert.equal(routed.gaps.length, 4, "all four entries stay gaps (none carries a routable confidence)");
  assert.equal(routed.gaps[0], "plain string gap", "a string gap stays the identical string");
  assert.equal(routed.gaps[1], 42, "a number gap stays the number");
  assert.equal(routed.gaps[2], null, "a null gap stays null");
  assert.deepEqual(routed.advisoryStrings, [], "non-object entries are never routed — fail-closed");
  // The refute APPLICATION pass has the same kept-gaps copy: string gaps survive it too.
  const applied = applyRefutations(["string gap stands", { issue: "obj2", fix: "fix two text" }], [], "");
  assert.equal(applied.gaps.length, 2);
  assert.equal(applied.gaps[0], "string gap stands", "applyRefutations keeps a string gap a string");
});

// =============================================================================
// remediation-plan extractor (row 29, todo 1) — RED-first.
//
// extractRemediationPlan does not exist in ./verdict-schema.mjs yet (todo 3 /
// wave 2 appends it at EOF). The namespace read below follows the dynamic-import
// precedent at the top of the gap-refute block above (:144-150): a MISSING named
// export read off a module namespace is `undefined`, so each call site below
// fails as an individual FAIL check ("not a function") while every pre-existing
// case keeps running; a STATIC named import instead would be a link-time
// SyntaxError that kills the whole file. The static import list at :6-13 stays
// untouched. Every test name in this block carries "remediation" so the RED
// output is identifiable line by line.
// =============================================================================
const vsm = await import("./verdict-schema.mjs");
const { extractRemediationPlan } = vsm;

// --- extractRemediationPlan: shape contract ------------------------------------
test("remediation plan extractor: a valid plan array returns VERBATIM (the same reference, no copy)", () => {
  const plan = [
    { gaps: [0, 1], note: "fix the extractor before the callers" },
    { gaps: [2], note: "independent single-gap step" },
  ];
  const raw = {
    verdict: "REJECT",
    gaps: [
      { category: "bug", severity: "major", issue: "A", fix: "fA" },
      { category: "bug", severity: "minor", issue: "B", fix: "fB" },
      { category: "test", severity: "major", issue: "C", fix: "fC" },
    ],
    remediation_plan: plan,
  };
  const out = extractRemediationPlan(raw);
  assert.equal(out, plan, "verbatim passthrough — the SAME array reference, never a copy");
  assert.deepEqual(out, [
    { gaps: [0, 1], note: "fix the extractor before the callers" },
    { gaps: [2], note: "independent single-gap step" },
  ]);
});

test("remediation plan extractor: a string plan → [] (fail-to-absence)", () => {
  assert.deepEqual(
    extractRemediationPlan({ verdict: "REJECT", gaps: [], remediation_plan: "fix everything" }),
    [],
  );
});

test("remediation plan extractor: a plain-object plan → [] (fail-to-absence)", () => {
  assert.deepEqual(
    extractRemediationPlan({ verdict: "REJECT", gaps: [], remediation_plan: { gaps: [0], note: "not an array" } }),
    [],
  );
});

test("remediation plan extractor: null plan → [] (fail-to-absence)", () => {
  assert.deepEqual(
    extractRemediationPlan({ verdict: "REJECT", gaps: [], remediation_plan: null }),
    [],
  );
});

test("remediation plan extractor: malformed plan values (number/boolean) → [] (fail-to-absence)", () => {
  assert.deepEqual(extractRemediationPlan({ verdict: "REJECT", gaps: [], remediation_plan: 42 }), []);
  assert.deepEqual(extractRemediationPlan({ verdict: "REJECT", gaps: [], remediation_plan: true }), []);
});

test("remediation plan extractor: absent plan (no key at all) → []", () => {
  assert.deepEqual(extractRemediationPlan({ verdict: "REJECT", gaps: [] }), []);
});

test("remediation plan extractor: non-object raw (null/undefined/string) → []", () => {
  assert.deepEqual(extractRemediationPlan(null), []);
  assert.deepEqual(extractRemediationPlan(undefined), []);
  assert.deepEqual(extractRemediationPlan("REJECT"), []);
});

test("remediation plan extractor: an ARRAY is valid regardless of entry shape — malformed STEPS ride verbatim", () => {
  // Array-ness is the extractor's ONLY validation (todo 3 contract): step-level
  // sanitization (integer indices, in-range clamping, dropped steps) is the
  // caller's positional remap in consult.mjs, never the extractor's job.
  const plan = [{ gaps: [0], note: "well-formed step" }, "garbage step", null, 42];
  const out = extractRemediationPlan({
    verdict: "REJECT",
    gaps: [{ issue: "A", fix: "fA" }],
    remediation_plan: plan,
  });
  assert.deepEqual(out, [{ gaps: [0], note: "well-formed step" }, "garbage step", null, 42]);
});

test("remediation plan extractor: ACCEPT with a stray plan → [] (fail-to-absence)", () => {
  const raw = { verdict: "ACCEPT", gaps: [], remediation_plan: [{ gaps: [0], note: "stray" }] };
  assert.deepEqual(
    extractRemediationPlan(raw),
    [],
    "an ACCEPT never carries a remediation plan, even when one strays into the raw verdict",
  );
});

test("remediation plan extractor: ACCEPT with a stray plan — the verdict stays ACCEPT (never a verdict change)", () => {
  const raw = { verdict: "ACCEPT", gaps: [], remediation_plan: [{ gaps: [0], note: "stray" }] };
  assert.deepEqual(extractRemediationPlan(raw), [], "extraction is fail-to-absence");
  assert.equal(
    normalizeConsultVerdict(raw).verdict,
    "ACCEPT",
    "a stray plan must never flip the verdict — the clean ACCEPT stays ACCEPT",
  );
});

// --- per-gap verify rides the existing pass-through untouched -------------------
test("remediation verify: per-gap verify strings ride gaps untouched through normalizeConsultVerdict", () => {
  const raw = {
    verdict: "REJECT",
    gaps: [
      {
        category: "bug",
        severity: "major",
        issue: "extractor missing",
        fix: "append extractRemediationPlan",
        verify: "node --check skills/odyssey/scripts/consult.mjs",
      },
    ],
  };
  const out = normalizeConsultVerdict(raw);
  assert.equal(out.verdict, "REJECT");
  assert.equal(out.gaps.length, 1);
  assert.equal(
    out.gaps[0].verify,
    "node --check skills/odyssey/scripts/consult.mjs",
    "the verify string rides the gap untouched — the normalizer never strips gap fields",
  );
});

test("remediation verify-tolerance: verify survives routeGapsByConfidence and applyRefutations shallow copies and reaches buildRefutePrompt", () => {
  const verifyCmd = "node --check skills/odyssey/scripts/consult.mjs";
  const gap = { issue: "gap with verify", fix: "fix it", verify: verifyCmd, confidence: 0.9 };
  // (a) confidence 0.9 (>= the 0.5 threshold) survives routing — shallow-copied with verify intact
  const routed = routeGapsByConfidence([gap]);
  assert.equal(routed.gaps.length, 1, "confidence 0.9 stays a gap");
  assert.equal(routed.gaps[0].verify, verifyCmd, "the routing shallow copy keeps verify");
  // (b) a no-refutation applyRefutations pass shallow-copies it again — verify still intact
  const applied = applyRefutations(routed.gaps, [], "(empty diff)");
  assert.equal(applied.gaps.length, 1);
  assert.equal(applied.gaps[0].verify, verifyCmd, "the application shallow copy keeps verify");
  // (c) the refute prompt JSON-embeds the gaps — the verify string is IN the prompt
  const prompt = buildRefutePrompt(applied.gaps, "PLAN-BODY", "DIFF-BODY");
  assert.ok(
    prompt.includes(verifyCmd),
    "buildRefutePrompt output CONTAINS the verify string (the gaps JSON rides whole)",
  );
});

// --- summary ------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nall verdict-schema tests passed");
process.exit(0);
