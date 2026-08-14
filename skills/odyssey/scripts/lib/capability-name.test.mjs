// capability-name.test.mjs — the namespaced cases no F5 fixture exercised.
// Run: node skills/odyssey/scripts/lib/capability-name.test.mjs   (exit 0 = pass)
//
// Every existing F5 fixture uses bare names on BOTH sides, and the one namespaced fixture
// (`agent:zodyssey:oracle` vs `agent:zodyssey:oracle`) compares identical strings — so it passes
// even with the namespace stripper deleted. These cases are asymmetric on purpose.

import assert from "node:assert/strict";
import { matchesCapability, matchesMcpServer, sameName, lastSegment, isFindSkills } from "./capability-name.mjs";

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.error(`FAIL - ${name}: ${e.message}`); }
};

// --- the live failure -------------------------------------------------------
test("bare declaration matches a namespaced skill observation (the live F5 failure)", () => {
  assert.equal(matchesCapability("skill:test-driven-development", "skill:superpowers:test-driven-development"), true);
});
test("namespaced declaration matches a bare observation (the reverse)", () => {
  assert.equal(matchesCapability("skill:superpowers:test-driven-development", "skill:test-driven-development"), true);
});
test("exact match still works", () => {
  assert.equal(matchesCapability("skill:prompt-master", "skill:prompt-master"), true);
});
test("a genuinely different skill still FAILS", () => {
  assert.equal(matchesCapability("skill:aws-serverless", "skill:prompt-master"), false);
  assert.equal(matchesCapability("skill:tdd", "skill:superpowers:test-driven-development"), false);
});
test("kind prefixes do not cross-match", () => {
  assert.equal(matchesCapability("skill:oracle", "agent:oracle"), false);
  assert.equal(matchesCapability("agent:oracle", "skill:oracle"), false);
});

// --- agent branch: previously stripped only `zodyssey:` ---------------------
test("agent: bare vs zodyssey-namespaced (previously handled)", () => {
  assert.equal(matchesCapability("agent:oracle", "agent:zodyssey:oracle"), true);
});
test("agent: bare vs feature-dev-namespaced (previously MISSED)", () => {
  assert.equal(matchesCapability("agent:code-reviewer", "agent:feature-dev:code-reviewer"), true);
});

// --- mcp branch: suffix tolerated, plugin prefix previously missed ----------
test("mcp: server matches plain tool name", () => {
  assert.equal(matchesCapability("mcp:codegraph", "mcp__codegraph__explore"), true);
});
test("mcp: server matches a PLUGIN-hosted tool name (previously MISSED)", () => {
  assert.equal(matchesCapability("mcp:socraticode", "mcp__plugin_socraticode_socraticode__codebase_search"), true);
  assert.equal(matchesCapability("mcp:awsiac", "mcp__plugin_deploy-on-aws_awsiac__validate_cloudformation_template"), true);
});
test("mcp: a different server still FAILS", () => {
  assert.equal(matchesMcpServer("github", "mcp__codegraph__explore"), false);
});
test("mcp: non-mcp observation is not matched", () => {
  assert.equal(matchesCapability("mcp:codegraph", "skill:codegraph"), false);
});

// --- discovery branch: previously unsatisfiable when namespaced -------------
test("discovery accepts a namespaced find-skills (previously UNSATISFIABLE)", () => {
  assert.equal(isFindSkills("skill:superpowers:find-skills"), true);
  assert.equal(isFindSkills("skill:find-skills"), true);
});
test("discovery rejects an unrelated skill", () => {
  assert.equal(isFindSkills("skill:test-driven-development"), false);
});

// --- normalization ----------------------------------------------------------
test("case and internal spacing are normalized", () => {
  assert.equal(matchesCapability("skill: Test-Driven-Development", "skill:test-driven-development"), true);
});
test("lastSegment / sameName helpers", () => {
  assert.equal(lastSegment("superpowers:test-driven-development"), "test-driven-development");
  assert.equal(sameName("code-reviewer", "feature-dev:code-reviewer"), true);
  assert.equal(sameName("", "x"), false);
});
test("empty and malformed input never throws and never matches", () => {
  assert.equal(matchesCapability("", "skill:x"), false);
  assert.equal(matchesCapability("skill:x", ""), false);
  assert.equal(matchesCapability("no-kind-prefix", "skill:x"), false);
});

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall capability-name tests passed");
