// memory-schema.test.mjs — tests for the shared memory schema + bridge.
// Run: node skills/odyssey/scripts/lib/memory-schema.test.mjs
// Exits 0 on success, non-zero on any failure.

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  validateOutcome,
  validateGraphEntity,
  outcomeToGraphEntity,
} from "./memory-schema.mjs";

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

// --- a) a valid outcome passes validateOutcome --------------------------------
test("valid outcome passes validateOutcome", () => {
  // Exactly the shape set-phase.mjs:187-195 writes.
  const valid = {
    name: "ims-li:enhance-zodyssey-backlog:done",
    entity_type: "run_outcome",
    observations: ["run reached done at 2026-08-10T00:00:00.000Z", "transition: done"],
    created_at: "2026-08-10T00:00:00.000Z",
  };
  assert.equal(validateOutcome(valid), true);
});

// --- b) an invalid outcome (missing required field) fails ----------------------
test("outcome missing required field fails validateOutcome", () => {
  const missingCreatedAt = {
    name: "r:s:blocked",
    entity_type: "run_outcome",
    observations: ["x"],
    // created_at omitted
  };
  assert.equal(validateOutcome(missingCreatedAt), false);

  const missingName = {
    entity_type: "run_outcome",
    observations: ["x"],
    created_at: "2026-08-10T00:00:00.000Z",
  };
  assert.equal(validateOutcome(missingName), false);

  const missingEntityType = {
    name: "r:s:blocked",
    observations: ["x"],
    created_at: "2026-08-10T00:00:00.000Z",
  };
  assert.equal(validateOutcome(missingEntityType), false);

  const missingObservations = {
    name: "r:s:blocked",
    entity_type: "run_outcome",
    created_at: "2026-08-10T00:00:00.000Z",
  };
  assert.equal(validateOutcome(missingObservations), false);

  // Non-object inputs.
  assert.equal(validateOutcome(null), false);
  assert.equal(validateOutcome("string"), false);
  assert.equal(validateOutcome([]), false);
});

// --- c) outcomeToGraphEntity produces a validateGraphEntity-passing result ----
test("outcomeToGraphEntity yields a valid graph entity", () => {
  const outcome = {
    name: "ims-li:enhance-zodyssey-backlog:done",
    entity_type: "run_outcome",
    observations: ["run reached done at 2026-08-10T00:00:00.000Z"],
    created_at: "2026-08-10T00:00:00.000Z",
  };
  const entity = outcomeToGraphEntity(outcome);
  assert.ok(entity, "expected an entity, got null");
  assert.equal(validateGraphEntity(entity), true);
  assert.equal(entity.type, "entity");
  assert.equal(entity.name, outcome.name);
  assert.equal(entity.entityType, "run_outcome");
  assert.deepEqual(entity.observations, outcome.observations);
  // bridge must not mutate the source
  assert.ok(entity.observations !== outcome.observations, "observations should be a copy");

  // invalid outcome → null (no half-mapping)
  assert.equal(outcomeToGraphEntity({ name: "x" }), null);
});

// --- d) every line of memory.json validates (live store; skipped if absent) ---
test("all lines of ~/.zcode/orchestration/memory.json validate", () => {
  const memPath = join(homedir(), ".zcode", "orchestration", "memory.json");
  if (!existsSync(memPath)) {
    console.log("ok - memory.json absent on this machine; skipping live-store validation");
    return;
  }
  const lines = readFileSync(memPath, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  assert.ok(lines.length > 0, "memory.json is empty — nothing to validate");
  lines.forEach((line, idx) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      assert.fail(`line ${idx + 1} is not valid JSON: ${e.message}`);
    }
    assert.equal(
      validateGraphEntity(parsed),
      true,
      `line ${idx + 1} failed validateGraphEntity (type=${parsed && parsed.type})`,
    );
  });
});

// --- extras: relation shape + entity shape both validate ----------------------
test("graph entity shape validates, wrong-type does not", () => {
  assert.equal(
    validateGraphEntity({ type: "entity", name: "n", entityType: "product", observations: [] }),
    true,
  );
  assert.equal(
    validateGraphEntity({ type: "relation", from: "a", to: "b", relationType: "protects" }),
    true,
  );
  assert.equal(
    validateGraphEntity({ type: "entity", name: "n", entityType: "", observations: [] }),
    false,
  );
  assert.equal(validateGraphEntity({ type: "blob", name: "x" }), false);
  assert.equal(validateGraphEntity(null), false);
});

// --- summary ------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
}
console.log("\nall memory-schema tests passed");
process.exit(0);
