// state-auth.test.mjs — the marker must make a dropped/copied state file inert.
// Run: node skills/odyssey/scripts/lib/state-auth.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKER_FIELD, stampMarker, verifyMarker, computeMarker, loadOrCreateKey } from "./state-auth.mjs";

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.error(`FAIL - ${name}: ${e.message}`); }
};

const dir = mkdtempSync(join(tmpdir(), "state-auth-"));
const keyPath = join(dir, "key");
const mkState = (over = {}) => ({
  slug: "t", phase: "execute", started_at: "2026-08-14T10:00:00Z",
  run_start_sha: "abc123", review: { verdict: "REJECT" }, ...over,
});

test("a stamped state verifies", () => {
  const s = stampMarker(mkState(), "t", keyPath);
  assert.equal(verifyMarker(s, "t", keyPath).ok, true);
});

// THE ATTACK: hand-write a state file with verdict OKAY and drop it in.
test("a hand-written state file is REJECTED (the forged-run drop)", () => {
  const forged = mkState({ slug: "decoy", review: { verdict: "OKAY" } });
  const r = verifyMarker(forged, "decoy", keyPath);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unmarked");
});

test("a forged marker value is REJECTED", () => {
  const forged = mkState({ slug: "decoy", [MARKER_FIELD]: "0".repeat(64) });
  assert.equal(verifyMarker(forged, "decoy", keyPath).ok, false);
});

// Copying a legitimate marker onto a different run must not work — the marker commits to identity.
test("a marker copied from another run does NOT validate (identity-bound)", () => {
  const good = stampMarker(mkState(), "t", keyPath);
  const stolen = mkState({ slug: "decoy", review: { verdict: "OKAY" }, [MARKER_FIELD]: good[MARKER_FIELD] });
  assert.equal(verifyMarker(stolen, "decoy", keyPath).ok, false);
});

test("editing started_at or run_start_sha invalidates the marker", () => {
  const s = stampMarker(mkState(), "t", keyPath);
  assert.equal(verifyMarker({ ...s, started_at: "2020-01-01T00:00:00Z" }, "t", keyPath).ok, false);
  assert.equal(verifyMarker({ ...s, run_start_sha: "deadbeef" }, "t", keyPath).ok, false);
});

// Legitimate writers mutate these constantly; re-stamping on every write would force every trusted
// script to hold the key, so the marker deliberately does not commit to them.
test("normal run progress does NOT invalidate the marker", () => {
  const s = stampMarker(mkState(), "t", keyPath);
  const advanced = { ...s, phase: "final", updated_at: "2026-08-14T12:00:00Z", review: { verdict: "OKAY" } };
  assert.equal(verifyMarker(advanced, "t", keyPath).ok, true);
});

test("a different install key rejects another install's markers", () => {
  const other = join(dir, "key2");
  const s = stampMarker(mkState(), "t", keyPath);
  assert.equal(verifyMarker(s, "t", other).ok, false);
});

test("the key file is created 0600 and is stable across calls", () => {
  const k1 = loadOrCreateKey(keyPath);
  const k2 = loadOrCreateKey(keyPath);
  assert.equal(k1, k2);
  assert.equal(statSync(keyPath).mode & 0o777, 0o600);
});

test("malformed input never throws", () => {
  for (const bad of [null, undefined, 42, "str", {}, { [MARKER_FIELD]: 5 }]) {
    const r = verifyMarker(bad, "t", keyPath);
    assert.equal(r.ok, false);
  }
});

test("marker survives a JSON round-trip (it is written to disk as state)", () => {
  const p = join(dir, "t.json");
  writeFileSync(p, JSON.stringify(stampMarker(mkState(), "t", keyPath), null, 2));
  assert.equal(verifyMarker(JSON.parse(readFileSync(p, "utf8")), "t", keyPath).ok, true);
});

rmSync(dir, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall state-auth tests passed");
