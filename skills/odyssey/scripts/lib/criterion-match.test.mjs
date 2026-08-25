// criterion-match.test.mjs — tests for the shared declared-criterion matcher (audit H1, 2026-08-25).
// Run: node skills/odyssey/scripts/lib/criterion-match.test.mjs   (exit 0 = pass, 1 = fail)

import assert from "node:assert/strict";
import { makeCriterionMatcher } from "./criterion-match.mjs";

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

const DECLARED = [
  "`node --check src/a.js` exits 0",
  "`node -e \"process.exit(0)\"` exits 0",
  "`grep -c TODO src/a.js` — prints 0",
  "`curl -s localhost:3000/healthz` returns 200",
];

// --- the sanctioned forms MUST count ------------------------------------------------
test("byte-exact full text counts", () => {
  const isDeclared = makeCriterionMatcher(DECLARED);
  assert.equal(isDeclared("node --check src/a.js"), true);
  assert.equal(isDeclared('node -e "process.exit(0)"'), true);
});

test("bare command counts when the declared text carries a tail annotation", () => {
  const isDeclared = makeCriterionMatcher(DECLARED);
  assert.equal(isDeclared("grep -c TODO src/a.js"), true, "dash+prints tail must strip");
  assert.equal(isDeclared("curl -s localhost:3000/healthz"), true, "returns-N tail must strip");
  // (consult round 1 advisory) the `passes` annotation family — substring matching used to
  // cover it for free; equality-after-strip must cover it explicitly or record-todo refuses
  // done on legitimately-annotated criteria.
  assert.equal(makeCriterionMatcher(["`npm test` passes"] )("npm test"), true, "bare `passes` tail");
  assert.equal(makeCriterionMatcher(["`npm test` passes ok"] )("npm test"), true, "`passes ok` tail");
  assert.equal(makeCriterionMatcher(["`npm test` passes"] )("npm test -- --grep x"), false, "altered command still refused");
  // (consult round 4 advisory) the tail separator must be REAL: a command merely ENDING in
  // "…pass"/"…bypass" must not strip to a truncated prefix that then counts as declared.
  assert.equal(makeCriterionMatcher(["`./check.sh --bypass` exits 0"] )("./check.sh --bypass"), true, "full text still matches");
  assert.equal(makeCriterionMatcher(["`./check.sh --bypass` exits 0"] )("./check.sh --by"), false, "zero-width tail strip refused");
  assert.equal(makeCriterionMatcher(["`grep -c pass f` exits 0"] )("grep -c"), false, "command ending in 'pass' does not self-strip");
});

test("backticks and case and whitespace collapse are normalized on both sides", () => {
  const isDeclared = makeCriterionMatcher(["`CMD`   exits 0"]);
  assert.equal(isDeclared("cmd"), true);
});

// --- the forged forms MUST NOT count (the substring hole this module closes) ----------
test("a fragment of a declared criterion does not count", () => {
  const isDeclared = makeCriterionMatcher(DECLARED);
  assert.equal(isDeclared("node"), false, "one-token substring of everything");
  assert.equal(isDeclared("node --check"), false, "truncated invoke");
  assert.equal(isDeclared("curl"), false, "the audit's original example");
  assert.equal(isDeclared("e"), false, "one character");
});

test("a SUPERSTRING of a declared criterion does not count either", () => {
  const isDeclared = makeCriterionMatcher(DECLARED);
  assert.equal(isDeclared("node --check src/a.js && echo pwned"), false);
  assert.equal(isDeclared("node --check src/a.js; rm -rf /"), false);
});

test("empty invoked text never counts (spawnSync of \"\" exits 0)", () => {
  const isDeclared = makeCriterionMatcher(DECLARED);
  assert.equal(isDeclared(""), false);
  assert.equal(isDeclared("   "), false);
});

test("ABSENT criterion field (pre-text-matching history format) fails open", () => {
  const isDeclared = makeCriterionMatcher(DECLARED);
  assert.equal(isDeclared(undefined), true, "old-format entries carry no text to judge");
  assert.equal(isDeclared(null), true);
});

// --- fail-open contract ---------------------------------------------------------------
test("no declared criteria (unknown denominator) fails open", () => {
  assert.equal(makeCriterionMatcher(null)("anything"), true);
  assert.equal(makeCriterionMatcher([])("anything"), true);
  assert.equal(makeCriterionMatcher(undefined)("anything"), true);
});

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall criterion-match tests passed");
