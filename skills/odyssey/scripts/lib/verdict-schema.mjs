// verdict-schema.mjs — the shared schema for ZOdyssey's verdict lanes.
//
// ZOdyssey carries four verdict "lanes" that previously lived as scattered
// inline literals with no shared definition:
//   1. review  — the momus gate (OKAY / REJECT), written by record-review.mjs.
//   2. consult — the external auditor lane (ACCEPT / REJECT), written by
//                consult.mjs.
//   3. final   — the F1-F4 final wave (pass / fail), written by
//                record-final-wave.mjs.
//   4. judge   — a numeric eval score (out of scope here; eval-lane, not a gate).
//
// Two of these lanes shared the SAME default object literal in TWO files
// (scaffold.mjs:191 seed + record-review.mjs:194 fallback) — a drift hazard.
// This module is the single source of truth for:
//   · the per-lane wire-value enums (so readers can validate without hardcoding),
//   · makeReviewDefault() — the fresh-each-call seed/fallback shape,
//   · validateReviewVerdict() — accepts OKAY | REJECT,
//   · normalizeConsultVerdict() — ports consult.mjs:384-397 fail-closed normalizer
//     so the security-relevant "NOT ACCEPTABLE" cannot sneak through.
//
// Wire values are FROZEN (OKAY/REJECT/ACCEPT/pass/fail) — many readers depend on
// them. This module documents them; it does not change them.

// ---------------------------------------------------------------------------
// Lane value enums.
// ---------------------------------------------------------------------------

/** The review-gate (momus) verdict values. */
export const REVIEW_VALUES = ["OKAY", "REJECT"];

/** The external-audit (consult) verdict values. */
export const CONSULT_VALUES = ["ACCEPT", "REJECT"];

/** The F1-F4 final-wave verdict values. */
export const FINAL_VALUES = ["pass", "fail"];

// ---------------------------------------------------------------------------
// Review lane: default shape + verdict validation.
// ---------------------------------------------------------------------------

/**
 * makeReviewDefault() → object
 * Returns a FRESH review-lane seed object each call:
 *   { round: 0, max_rounds: 3, verdict: null, history: [] }
 *
 * A new object (and a new history array) MUST be produced on every call so
 * callers never share a reference — the duplicate literal this replaces was
 * inlined precisely because two callers needed independent objects. This is
 * the single source of truth for both scaffold.mjs (the seed) and
 * record-review.mjs (the fallback when state.review is missing/garbage).
 */
export function makeReviewDefault() {
  return { round: 0, max_rounds: 3, verdict: null, history: [] };
}

/**
 * validateReviewVerdict(v) → boolean
 * True iff `v` is exactly "OKAY" or "REJECT" (case-sensitive — these are the
 * wire values record-review.mjs uppercases before writing). Anything else
 * (lowercase, typos, "ACCEPT", non-strings) is rejected.
 */
export function validateReviewVerdict(v) {
  return v === "OKAY" || v === "REJECT";
}

// ---------------------------------------------------------------------------
// Consult lane: fail-closed normalizer.
//
// Ports consult.mjs:384-397 EXACTLY. SECURITY (audit 2026-08-01 gap #8):
// the previous `.includes("ACCEPT")` matched "NOT ACCEPTABLE" / "DO NOT ACCEPT"
// and turned them into ACCEPT, and an ACCEPT carrying a non-empty gaps[] passed
// through — terminating the uncapped remediation loop unremediated.
//
// Fail-CLOSED: ACCEPT only on an exact "ACCEPT" string AND an empty gaps array;
// everything else is REJECT.
// ---------------------------------------------------------------------------

/**
 * normalizeConsultVerdict(raw) → { verdict, summary, gaps, advisories, raw }
 *
 * Takes a parsed auditor-verdict object and returns the normalized lane write.
 * `verdict` is ACCEPT only iff the raw verdict string is exactly "ACCEPT"
 * (after trim+uppercase) AND `gaps` is empty; otherwise REJECT.
 *
 * The `.includes("ACCEPT")` bug it replaces matched "NOT ACCEPTABLE" — the
 * exact-string check below is the fix. This function MUST stay fail-closed.
 */
export function normalizeConsultVerdict(raw) {
  const verdict = raw && typeof raw === "object" ? raw : {};
  const v = String(verdict.verdict || "").trim().toUpperCase();
  const gapsArr = Array.isArray(verdict.gaps) ? verdict.gaps : [];
  // SECURITY (audit 2026-08-01 gap #8): fail-CLOSED. The previous
  // `.includes("ACCEPT")` turned "NOT ACCEPTABLE" / "DO NOT ACCEPT" into ACCEPT,
  // and an ACCEPT carrying a non-empty gaps[] passed through — terminating the
  // uncapped remediation loop unremediated. Now: ACCEPT only on an exact
  // "ACCEPT" string AND an empty gaps array; everything else is REJECT.
  const isAccept = v === "ACCEPT" && gapsArr.length === 0;
  return {
    verdict: isAccept ? "ACCEPT" : "REJECT",
    summary: String(verdict.summary || "").slice(0, 500),
    gaps: gapsArr,
    advisories: Array.isArray(verdict.advisories) ? verdict.advisories : [],
    raw: verdict,
  };
}
