#!/usr/bin/env node
// recall-outcomes.mjs — the READ side of cross-run memory (T2-#5, complements INTEG-#3's writes).
//
// INTEG-#3 writes structured outcomes to <repo>/.zcode/memory/outcomes.jsonl on every terminal
// transition. This script reads them back so phase-1 metis/premortem can ground failure analysis
// in what ACTUALLY went wrong before, not guesses. Usage at consult: "recall-outcomes.mjs <repo>"
// → prints prior outcomes for this repo, newest first. Metis folds blocked/failed ones into her
// premortem's "Identified Risks".
//
// Usage:
//   recall-outcomes.mjs <repo> [--failed]   # --failed = only blocked/failed/abandoned outcomes
//   exit: 0 · 2 bad args · 3 no outcomes file yet (first run)

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { argv, exit } from "node:process";

const [repo, ...rest] = argv.slice(2);
if (!repo) { console.error("usage: recall-outcomes.mjs <repo> [--failed]"); exit(2); }
const onlyFailed = rest.includes("--failed");
const repoAbs = (() => { try { return realpathSync(repo); } catch { return repo; } })();
const repoBase = basename(repoAbs);
const outcomesPath = `${repoAbs}/.zcode/memory/outcomes.jsonl`;
if (!existsSync(outcomesPath)) {
  console.error(`(no prior outcomes at ${outcomesPath} — this is the first run for this repo)`);
  exit(3);
}
const outcomes = readFileSync(outcomesPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const filtered = onlyFailed
  ? outcomes.filter((o) => ["blocked", "abandoned"].some((p) => o.name.includes(`:${p}`)))
  : outcomes;
if (filtered.length === 0) {
  console.error(onlyFailed ? "(no prior blocked/failed outcomes)" : "(no prior outcomes)");
  exit(0);
}
// newest first
filtered.reverse();
console.log(`Prior run outcomes for ${repoBase} (${filtered.length}${onlyFailed ? " failed/blocked" : ""}):`);
for (const o of filtered) {
  console.log(`\n  ${o.name}`);
  for (const obs of o.observations) console.log(`    ${obs}`);
}
console.log(`\nMetis: fold any blocked/failed outcomes above into your premortem's Identified Risks.`);
exit(0);
