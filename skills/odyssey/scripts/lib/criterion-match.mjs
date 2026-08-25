// criterion-match.mjs — the shared "is this invoked criterion one the plan declares?" matcher.
//
// WHY SHARED (audit H1, 2026-08-25): coverage used to be enforced in two places with two rules —
// record-verify.mjs matched criterion TEXT with bidirectional substring (`n.includes(c) ||
// c.includes(n)`), record-todo.mjs counted distinct criterion_index values with no text check at
// all. The substring side let a fabricated FRAGMENT count as a declared criterion ("node" is a
// substring of almost every declared criterion; `--criterion curl --trust-argv --exit-code 0`
// satisfied the numerator of the AUDIT-3 FINDING 6 coverage guard without executing anything),
// and the index side accepted whatever record-verify recorded. One rule, both call sites.
//
// The rule: EQUALITY after normalization, with the documented outcome-annotation tails stripped
// from the DECLARED side only. Plans write `` `cmd` exits 0 `` / `` `cmd` — prints N `` while the
// sanctioned invocation is the bare command (the criterion-annotation strip forms), so the bare
// command must match — but a proper fragment of a declared criterion ("node --check" vs "node
// --check src/a.js exits 0") must NOT.
//
// Fail-open rule (unchanged from both call sites): no declared criteria → everything counts; the
// denominator is unknown and punishing the numerator would block ad-hoc verification.

const NORM = (s) => String(s || "").toLowerCase().replace(/`/g, "").replace(/\s+/g, " ").trim();
// The sanctioned outcome-annotation tails a declared criterion may carry beyond the bare
// command (consult round 1 advisory): `exits N`, `— prints X`, `returns N`, `passes`. Anything
// else after the command means the invocation is NOT the declared criterion verbatim — it
// records as undeclared and does not count toward coverage.
const TAIL_RE = /(?:\s*[-–—]\s*)?\s*(?:exits?\s+\d+|prints?\s+.+|returns?\s+\d+|passes?)(?:\s+(?:ok|successfully))?\s*$/i;

export function makeCriterionMatcher(declaredCriteria) {
  const decl = Array.isArray(declaredCriteria) && declaredCriteria.length
    ? declaredCriteria.map((d) => {
        const n = NORM(d);
        return { n, stripped: n.replace(TAIL_RE, "") };
      })
    : null;
  return function isDeclared(cmd) {
    if (!decl) return true; // unknown denominator → don't punish (fail open)
    // Pre-text-matching history format: entries recorded before criteria carried text (and
    // hand-built fixtures of that shape) have NO criterion field — absent text cannot be judged
    // and must not zero out coverage. An explicitly EMPTY string is different: it is a
    // fabricated shape (spawnSync of "" exits 0), never a declared criterion.
    if (cmd === undefined || cmd === null) return true;
    const c = NORM(cmd);
    if (!c) return false;
    return decl.some((d) => d.n === c || d.stripped === c);
  };
}
