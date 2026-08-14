// state-auth.mjs — authenticity marker for run-state files.
//
// WHY THIS EXISTS (audit 2026-08-14, CRITICAL T1-1/T1-7): `findActiveRun` did
// `readdirSync` -> `JSON.parse` -> newest `updated_at`, with no authenticity check whatsoever.
// ANY parseable `.json` dropped into a `.zcode/state/` dir became the governing run. Chained with
// a write primitive the Bash gate missed (`sort -o`, `touch` — both absent from WRITE_PATTERNS),
// a prompt-injected executor could drop `decoy.json` carrying `review.verdict: "OKAY"` and a plan
// path of its choosing, and that forged run then governed the review gate, the scope gate, and the
// plan-tamper guard simultaneously. Reproduced end-to-end by the auditor (step E, exit 0).
//
// WHAT THIS DOES AND DOES NOT BUY YOU — read before trusting it.
//
// It makes a *dropped or copied* state file inert: the marker is an HMAC over the run's identity
// fields keyed by a per-install secret, so hand-writing a state file is no longer enough. That is
// exactly the documented attack chain, and it is now closed.
//
// It is NOT a cryptographic guarantee against an attacker who already has arbitrary read+write as
// this user. The key lives on the same filesystem; anything that can read it can mint a marker.
// In a single-user trust model that is unavoidable, and claiming otherwise would repeat this
// project's recurring failure — a check that cannot detect the class of failure it exists for.
//
// The DURABLE control is that `.zcode/state/` has no sanctioned write path except the trusted
// scripts (enforced separately: `isState` on the Edit path, the Bash target loop, and the
// non-native/MCP guard). This marker is the second layer that catches whatever those miss.

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export const MARKER_FIELD = "run_auth";
const KEY_PATH = process.env.ZODYSSEY_RUN_KEY_PATH || join(homedir(), ".zcode", ".zodyssey-run-key");

// Per-install secret, created 0600 on first use. Not in the repo: a key inside `.zcode/` would
// travel with a copied repo and be trivially readable by anything already reading run state.
export function loadOrCreateKey(keyPath = KEY_PATH) {
  try {
    if (existsSync(keyPath)) {
      const k = readFileSync(keyPath, "utf8").trim();
      if (k.length >= 32) return k;
    }
  } catch { /* fall through to mint */ }
  const key = randomBytes(32).toString("hex");
  try {
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, key + "\n", { mode: 0o600 });
    chmodSync(keyPath, 0o600);
  } catch { /* unwritable home: fall back to an in-memory key (marker won't verify across procs) */ }
  return key;
}

// The identity a marker commits to. Deliberately the fields that a forged run would have to lie
// about — slug, when it started, and the commit it started from. NOT `phase`, `updated_at`, or
// `review`, because legitimate writers change those on every write and re-signing on each mutation
// would mean every trusted script needs the key (widening exposure for no gain).
function identityOf(state, slug) {
  return JSON.stringify({
    slug: String(state?.slug ?? slug ?? ""),
    started_at: String(state?.started_at ?? ""),
    run_start_sha: String(state?.run_start_sha ?? ""),
  });
}

export function computeMarker(state, slug, keyPath = KEY_PATH) {
  return createHmac("sha256", loadOrCreateKey(keyPath)).update(identityOf(state, slug)).digest("hex");
}

// Stamp a state object in place. Called by scaffold at creation and by the adopt path.
export function stampMarker(state, slug, keyPath = KEY_PATH) {
  state[MARKER_FIELD] = computeMarker(state, slug, keyPath);
  return state;
}

// Verify. Returns { ok, reason } — never throws, because the hook must not crash on malformed
// input (a thrown hook is an outage, and an outage is a bypass).
export function verifyMarker(state, slug, keyPath = KEY_PATH) {
  if (!state || typeof state !== "object") return { ok: false, reason: "unparseable state" };
  const present = state[MARKER_FIELD];
  if (typeof present !== "string" || present.length === 0) {
    return { ok: false, reason: "unmarked" };
  }
  let expected;
  try { expected = computeMarker(state, slug, keyPath); } catch { return { ok: false, reason: "key unavailable" }; }
  if (present.length !== expected.length) return { ok: false, reason: "marker mismatch" };
  // Constant-time-ish compare; the value is not secret but avoid an early-exit oracle by habit.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= present.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { ok: true, reason: null } : { ok: false, reason: "marker mismatch" };
}

// Human-facing text the hook and scripts print when a state file is rejected, so an operator whose
// legitimate pre-v0.5.0 run stopped being discovered knows the one command that fixes it.
export const adoptHint = (repo, slug) =>
  `run state for "${slug}" has no valid ${MARKER_FIELD} marker, so it is not treated as an active run ` +
  `(v0.5.0 authenticates run discovery — an unmarked state file could previously be dropped in to ` +
  `hijack the review gate). If this is a legitimate run created before v0.5.0, adopt it once with: ` +
  `node <plugin>/skills/odyssey/scripts/scaffold.mjs ${repo} ${slug} --adopt`;
