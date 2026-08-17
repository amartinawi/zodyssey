// lib/arm.mjs — derive the eval arm from a run slug.
//
// WHY THIS EXISTS: judge.mjs:171 hardcoded `arm: "zodyssey"` into every judged record, so baseline
// runs landed in judged.jsonl mislabeled (visible in the real data: slug "std-01-baseline" carries
// arm "zodyssey"; dashboard.mjs:20 documents the field as unreliable and re-derives it). The slug
// suffix is the authoritative source — harness.mjs constructs `${seed.id}-${arm}` — so the
// derivation is deterministic and offline. It lived as a private function in dashboard.mjs; the
// narrator trust registry (queue row 19) and judge.mjs both need the same arithmetic, so it is a
// lib now: one definition, three consumers, direct-import tests.
//
// Contract: "-baseline" suffix → "baseline"; anything else (including "-zodyssey" and
// non-strings) → "zodyssey". Closed-world two-value return; no throwing.

export function armFromSlug(slug) {
  if (typeof slug !== "string") return "zodyssey";
  return slug.endsWith("-baseline") ? "baseline" : "zodyssey";
}
