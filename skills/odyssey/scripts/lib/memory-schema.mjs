// memory-schema.mjs — the shared schema that couples the two memory stores.
//
// ZOdyssey keeps TWO memory stores that previously shared no schema:
//   1. The MCP knowledge-graph store at ~/.zcode/orchestration/memory.json (JSONL),
//      holding the memory-MCP entity/relation graph (memory.json MCP format).
//   2. The per-repo outcomes store at <repo>/.zcode/memory/outcomes.jsonl (JSONL),
//      written by set-phase.mjs on every terminal transition and read by
//      recall-outcomes.mjs (T2-#5 / INTEG#3).
//
// This module is the script-side bridge: it defines the shape of each store's
// records, lets readers validate lines instead of trusting them, and provides
// outcomeToGraphEntity() to map an outcomes entry into the knowledge-graph
// entity format so the two stores can be coupled (used by todo 20's
// multi-auditor consult to recall prior auditor disagreements).
//
// The memory MCP itself is doc-only / in-process, so this module is the only
// script-callable handle on the graph format.

// ---------------------------------------------------------------------------
// Outcomes store shape — derived from set-phase.mjs:187-195 (the WRITE side):
//   const entry = {
//     name: `${repoBase}:${slug}:${phase}`,
//     entity_type: "run_outcome",
//     observations: [ ...string... ],
//     created_at: new Date().toISOString(),
//   };
// ---------------------------------------------------------------------------

const isNonEmptyString = (v) => typeof v === "string" && v.length > 0;
const isStringArray = (v) =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * validateOutcome(obj) → boolean
 * True iff `obj` matches the outcomes.jsonl entry shape written by
 * set-phase.mjs on terminal transitions. Required fields:
 *   - name        : non-empty string (namespace key "<repoBase>:<slug>:<phase>")
 *   - entity_type : non-empty string (set-phase writes "run_outcome")
 *   - observations: array of strings (may be empty; typically has >=1)
 *   - created_at  : non-empty string (ISO timestamp)
 * We treat observations and created_at as required (set-phase always writes
 * them) but do not over-constrain the timestamp format — a non-empty string
 * is enough to be structurally an outcome.
 */
export function validateOutcome(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (!isNonEmptyString(obj.name)) return false;
  if (!isNonEmptyString(obj.entity_type)) return false;
  if (!isStringArray(obj.observations)) return false;
  if (!isNonEmptyString(obj.created_at)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Knowledge-graph shape — derived from ~/.zcode/orchestration/memory.json.
// The store holds two record kinds, distinguished by `type`:
//   entity:   { type:"entity", name, entityType, observations: string[] }
//   relation: { type:"relation", from, to, relationType }
// validateGraphEntity accepts EITHER kind so the full graph (79 lines) passes.
// ---------------------------------------------------------------------------

/**
 * validateGraphEntity(obj) → boolean
 * True iff `obj` is a structurally-valid memory.json graph record — either a
 * knowledge-graph entity or a knowledge-graph relation. Returns false for
 * anything missing required fields or carrying the wrong `type`.
 */
export function validateGraphEntity(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (obj.type === "entity") {
    return (
      isNonEmptyString(obj.name) &&
      isNonEmptyString(obj.entityType) &&
      isStringArray(obj.observations)
    );
  }
  if (obj.type === "relation") {
    return (
      isNonEmptyString(obj.from) &&
      isNonEmptyString(obj.to) &&
      isNonEmptyString(obj.relationType)
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Bridge: map an outcomes.jsonl entry into a memory.json graph entity.
// Used by multi-auditor consult (todo 20) to fold prior run outcomes into the
// knowledge graph so auditor disagreements can be recalled across runs.
// ---------------------------------------------------------------------------

/**
 * outcomeToGraphEntity(outcome) → object
 * Maps a validated outcomes entry to a knowledge-graph ENTITY record (the
 * memory.json entity shape). The outcome's `entity_type` becomes the graph
 * `entityType`, its observations are preserved verbatim, and its `name` is
 * carried over as the entity name. The result always passes
 * validateGraphEntity(); returns null if the input is not a valid outcome.
 */
export function outcomeToGraphEntity(outcome) {
  if (!validateOutcome(outcome)) return null;
  return {
    type: "entity",
    name: outcome.name,
    entityType: outcome.entity_type,
    observations: outcome.observations.slice(),
  };
}
