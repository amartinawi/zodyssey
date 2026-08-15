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

// ---------------------------------------------------------------------------
// T3-2: parse a verdict out of a PROSE artifact.
//
// momus-prompt.md documents the reviewer's output as a text block headed
// `VERDICT: OKAY | REJECT`, while record-momus-artifact.mjs accepted strict
// JSON only — so a reviewer following her own prompt got exit 6 and the run
// deadlocked at the review gate. record-final-wave already had a hardened
// version of this parser; duplicating it is how the two would drift, which is
// the mistake this release exists to stop repeating. One definition, two
// callers.
//
// Deliberately NOT a bare keyword search. "this would REJECT under the old
// rules" is discussion, not a verdict, and a reviewer narrating its reasoning
// must never accidentally close (or open) the gate. Requires an explicit
// line-anchored `VERDICT:` token; says-both and says-neither both fail closed.
const VERDICT_APPROVE =
  /^\s*(?:\*\*)?VERDICT(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*(APPROVE[D]?|OKAY|OK|PASS(?:ED)?|ACCEPT(?:ED)?)\b/im;
const VERDICT_REJECT =
  /^\s*(?:\*\*)?VERDICT(?:\*\*)?\s*[:=]\s*(?:\*\*)?\s*(REJECT(?:ED)?|FAIL(?:ED)?|BLOCK(?:ED)?)\b/im;

// -> "approve" | "reject" | "missing"
export function verdictFromProse(text) {
  const s = String(text || "");
  const approve = VERDICT_APPROVE.test(s);
  const reject = VERDICT_REJECT.test(s);
  if (approve && reject) return "missing";   // says both -> we don't know -> fail closed
  if (approve) return "approve";
  if (reject) return "reject";
  return "missing";
}

// Blockers from the documented `BLOCKERS:` block: subsequent `- ` bullets until
// a blank line or the next ALL-CAPS section header. Capped at 5, matching the
// prompt's own limit.
export function blockersFromProse(text) {
  const lines = String(text || "").split("\n");
  const i = lines.findIndex((l) => /^\s*(?:\*\*)?BLOCKERS(?:\*\*)?\s*:/i.test(l));
  if (i === -1) return [];
  const out = [];
  for (const line of lines.slice(i + 1)) {
    if (/^\s*$/.test(line)) { if (out.length) break; continue; }
    if (/^\s*(?:\*\*)?[A-Z][A-Z -]{2,}(?:\*\*)?\s*:/.test(line)) break;   // next section
    const m = line.match(/^\s*[-*]\s+(.*\S)\s*$/);
    if (m) out.push(m[1].replace(/`/g, ""));
    else if (out.length) break;
  }
  return out.slice(0, 5);
}
