#!/usr/bin/env node
// judge-rubric.test.mjs — the judge's scoring rubric must contain no stylistic dimension.
//
// WHY THIS EXISTS: MEASUREMENT.md §2 defines the quality rubric as five dimensions — correctness,
// scope fidelity, verification rigor, code quality, efficiency — none of which score HOW the
// output is written. That is deliberate: the ISNAD-engine study (2026-08-17) ported its R8
// (FASAHA / fluency-exclusion) rule onto this repo — "no stylistic, fluency, length, or
// verbosity feature may enter trust scoring or judge prompts" — because style-correlated
// confidence is exactly how a fluent-but-wrong diff grades itself upward. LLM-judge bias is a
// measured failure mode (ROADMAP §2), and the cheapest entry for that bias is a future rubric
// edit that adds a "clarity"/"readability"/"polish" dimension that reads well and proves nothing.
// Today the rubric is clean by accident — nothing compares it to the documented claim. A claim
// duplicated between MEASUREMENT.md and judge.mjs with nothing comparing them is the exact class
// this repo keeps being bitten by (version-consistency.test.mjs is the template). This is the
// check.
//
// Scope note: the denylist applies ONLY to the rubric segment of the judge prompt (between
// "## Scoring rubric" and the next "##" heading), not the whole file — the surrounding prose
// legitimately discusses summaries and output; a whole-file denylist would false-positive on
// unrelated wording and get disabled within a week. The auditor prompt legitimately CONTAINS the
// word "style" in its prohibition, so that defense is pinned by asserting the clause exists.
//
// Paired probe (prove-it-fails discipline): adding `Clarity of prose (0.1)` as a sixth rubric
// line makes assertions 2 and 3 fail; deleting "Do NOT reject for style preferences" from
// references/auditor-prompt.md makes assertion 5 fail. Verified both directions on 2026-08-17.
//
// Run:  node judge-rubric.test.mjs   (exit 0 = pass, 1 = fail)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exit } from "node:process";

const HERE = new URL(".", import.meta.url).pathname;
const JUDGE = join(HERE, "judge.mjs");
const AUDITOR_PROMPT = join(HERE, "..", "references", "auditor-prompt.md");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

const judgeSrc = readFileSync(JUDGE, "utf8");
const auditorSrc = readFileSync(AUDITOR_PROMPT, "utf8");

// The documented claim (MEASUREMENT.md §2 / judge.mjs:105-112): exactly five dimensions.
const EXPECTED_DIMENSIONS = ["code_quality", "correctness", "efficiency", "scope_fidelity", "verification_rigor"];
// ISNAD R8: features that must never appear as scoring dimensions.
const STYLE_DENYLIST = /style|fluency|verbos|eloquen|polish|\btone\b|readability|wording|clarity/i;

console.log("judge.mjs rubric — fluency exclusion (ISNAD R8)\n");

// --- 1. the rubric segment exists -------------------------------------------
const rubricStart = judgeSrc.indexOf("## Scoring rubric");
const rubricEnd = judgeSrc.indexOf("## The task", rubricStart);
check("judge prompt contains a '## Scoring rubric' section followed by the task section",
  rubricStart !== -1 && rubricEnd !== -1);
const rubric = rubricStart !== -1 && rubricEnd !== -1 ? judgeSrc.slice(rubricStart, rubricEnd) : "";

// --- 2. the five documented dimensions, with their documented weights --------
if (rubric) {
  check("correctness weighted 0.4", /correctness[^(\n]*\(weight 0\.4\)/i.test(rubric));
  check("scope fidelity weighted 0.2", /scope fidelity \(0\.2\)/i.test(rubric));
  check("verification rigor weighted 0.2", /verification rigor \(0\.2\)/i.test(rubric));
  check("code quality weighted 0.1", /code quality \(0\.1\)/i.test(rubric));
  check("efficiency weighted 0.1", /efficiency \(0\.1\)/i.test(rubric));
  const weights = [...rubric.matchAll(/\((?:weight )?(0\.\d)\)/g)].map((m) => parseFloat(m[1]));
  check("rubric weights sum to 1.0", Math.abs(weights.reduce((s, w) => s + w, 0) - 1) < 1e-9,
    `got [${weights}]`);
}

// --- 3. the output-contract dimensions literal has exactly the five keys -----
{
  const litIdx = judgeSrc.indexOf('"dimensions": {');
  check("output contract has a dimensions literal", litIdx !== -1);
  if (litIdx !== -1) {
    const lit = judgeSrc.slice(judgeSrc.indexOf("{", litIdx), judgeSrc.indexOf("}", litIdx));
    const keys = [...lit.matchAll(/"([a-z_]+)":/g)].map((m) => m[1]).sort();
    check("dimensions literal keys are exactly the five documented dimensions",
      JSON.stringify(keys) === JSON.stringify(EXPECTED_DIMENSIONS), `got [${keys}]`);
  }
}

// --- 4. no stylistic feature enters the rubric ------------------------------
check("no style/fluency/verbosity term appears in the rubric segment",
  rubric && !STYLE_DENYLIST.test(rubric), STYLE_DENYLIST.test(rubric) ? "denylist matched — a stylistic dimension crept in" : "");

// --- 5. the auditor's existing anti-style defense stays pinned --------------
check("auditor prompt keeps the 'Do NOT reject for style preferences' clause",
  /Do NOT reject for style preferences/.test(auditorSrc));

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
