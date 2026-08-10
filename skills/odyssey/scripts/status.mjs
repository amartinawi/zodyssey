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

// Optional fields written by scaffold.mjs + record-verify.mjs (backlog #6). Pre-#6 runs lack
// them, so guard everywhere — never assume the keys exist.
const acceptance = (st.acceptance || {});
const notepadPointers = (st.notepad_pointers || {});
let verifiedCount = 0;
for (const id of Object.keys(acceptance)) {
  if (acceptance[id] && acceptance[id].pass === true) verifiedCount++;
}

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
    acceptance,
    notepad_pointers: notepadPointers,
    verified_count: verifiedCount,
  }));
  exit(0);
}

const r = (n) => (typeof n === "number" ? n : 0);
console.log(`\n  ${st.slug}  ·  phase=${st.phase}  ·  verdict=${verdict} (round ${r(review.round)}/${r(review.max_rounds)})`);
console.log(`  todos: ${counts.done}/${total} done · ${counts.in_flight} in-flight · ${counts.failed} failed · ${counts.blocked} blocked · ${counts.pending} pending`);
// Only printed when at least one acceptance or notepad_pointer entry exists, so runs created
// before backlog #6 (which lack both fields) render byte-identically to before.
if (Object.keys(acceptance).length > 0 || Object.keys(notepadPointers).length > 0) {
  console.log(`  verified: ${verifiedCount} passed  ·  ${Object.keys(notepadPointers).length} notepad(s) linked`);
}
if (counts.failed > 0) console.log(`  ⚠ ${counts.failed} failed todo(s) — check state.todos for details`);
console.log(`  updated ${st.updated_at || "?"}\n`);
