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
import { validateOutcome } from "./lib/memory-schema.mjs";

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
// Parse + validate against the shared schema (lib/memory-schema.mjs). A malformed
// line (bad JSON or missing required fields) is skipped with a stderr warning
// rather than crashing the whole recall — one bad append must not blind metis.
const rawLines = readFileSync(outcomesPath, "utf8").split("\n").filter((l) => l.trim());
const outcomes = [];
rawLines.forEach((line, idx) => {
  const lineNo = idx + 1;
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    process.stderr.write(`recall-outcomes: skipping malformed outcome at line ${lineNo}\n`);
    return;
  }
  if (!validateOutcome(parsed)) {
    process.stderr.write(`recall-outcomes: skipping malformed outcome at line ${lineNo}\n`);
    return;
  }
  outcomes.push(parsed);
});
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
