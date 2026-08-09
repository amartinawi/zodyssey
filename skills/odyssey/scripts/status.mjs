#!/usr/bin/env node
// status.mjs — print one ZOdyssey run's current status (phase, review verdict, todo counts).
//
// Read-only inspection utility for operators. The counterpart to run-report.mjs (which emits a
// full scorecard); this is the quick "where is this run right now?" glance.
//
// Usage:
//   status.mjs <repo> <slug>          # human-readable status line
//   status.mjs <repo> <slug> --json   # machine-readable
//   exit: 0 ok · 2 bad args · 3 no state file

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";

const [repo, slug, ...rest] = argv.slice(2);
if (!repo || !slug) {
  console.error("usage: status.mjs <repo> <slug> [--json]");
  exit(2);
}
const asJson = rest.includes("--json");

const statePath = join(repo, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) {
  console.error(`no state file: ${statePath}`);
  exit(3);
}

let st;
try {
  st = JSON.parse(readFileSync(statePath, "utf8"));
} catch (e) {
  console.error(`cannot parse state file: ${e.message}`);
  exit(3);
}

const todos = (st.todos && typeof st.todos === "object") ? st.todos : {};
const counts = { pending: 0, in_flight: 0, done: 0, failed: 0, blocked: 0, other: 0 };
for (const t of Object.values(todos)) {
  if (t && typeof t === "object" && counts.hasOwnProperty(t.status)) counts[t.status]++;
  else counts.other++;
}
const total = Object.keys(todos).length;
const review = st.review || {};
const verdict = review.verdict ?? "none";

if (asJson) {
  console.log(JSON.stringify({
    slug: st.slug,
    phase: st.phase,
    intent: st.intent,
    review_verdict: verdict,
    review_round: review.round ?? 0,
    todos_total: total,
    todos: counts,
    updated_at: st.updated_at,
  }));
  exit(0);
}

const r = (n) => (typeof n === "number" ? n : 0);
console.log(`\n  ${st.slug}  ·  phase=${st.phase}  ·  verdict=${verdict} (round ${r(review.round)}/${r(review.max_rounds)})`);
console.log(`  todos: ${counts.done}/${total} done · ${counts.in_flight} in-flight · ${counts.failed} failed · ${counts.blocked} blocked · ${counts.pending} pending`);
if (counts.failed > 0) console.log(`  ⚠ ${counts.failed} failed todo(s) — check state.todos for details`);
console.log(`  updated ${st.updated_at || "?"}\n`);
