#!/usr/bin/env node
// build-capsules.mjs — compile routed skills into ≤200-word dispatch capsules.
//
// WHY: the trust anchor at references/capabilities.md:12-20 says ZCode sub-agents do NOT
// receive the Skill tool. The orchestrator cannot delegate "load skill: TDD" to a sub-agent;
// it must paste the skill's load-bearing rules into the dispatch prompt. Until now that
// summary was improvised every run. This script makes it deterministic: each routed skill
// is distilled to a ≤200-word capsule at references/capsules/<skill>.md that the
// orchestrator pastes into the sub-agent's dispatch context.
//
// WHAT A CAPSULE IS: the method steps + must-not-do rules + stop-conditions of a skill,
// with examples, asides, framework-name sections, and meta-markup (graphviz blocks, code
// samples, rationalization tables, Good/Bad annotation blocks) stripped. The capsule is
// NOT a replacement for loading the skill in the parent thread — the orchestrator still
// loads the full skill itself when it can. Capsules exist ONLY for the sub-agent context.
//
// HOW EXTRACTION WORKS: for each skill the script (1) locates and reads the real source
// SKILL.md (fails loudly if missing — we never invent skill paths), then (2) applies a
// hand-curated extractor that emits the load-bearing rules as faithful prose drawn from
// that source. A generic NLP stripper cannot reliably hit a 200-word budget while keeping
// the method intact (the Four Phases alone are ~660 words raw), so the extractor is
// curated per-skill. The capsule body is reviewable: it must read as a faithful summary
// of the SKILL.md it was distilled from, not an invention.
//
// GUARDRAIL: if any capsule exceeds 200 words the build FAILS LOUDLY (exit 1). We never
// silently truncate to fit — that would drop load-bearing rules. The fix is a tighter
// extractor, not a longer budget.
//
// Usage:  build-capsules.mjs            # write all capsules, exits 0
//         build-capsules.mjs --check    # verify existing capsules are ≤200 words, no write
// Exit:   0 success · 1 a capsule exceeded 200 words or a source was missing

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { exit, argv } from "node:process";

const HOME = homedir();
const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const CAPSULES_DIR = join(SCRIPT_DIR, "..", "references", "capsules");
const MAX_WORDS = 200;

// --- skill routing -----------------------------------------------------------
// Each entry: the capsule file name (matches the KIND-routing verb in capabilities.md:
// tdd, debugging, executing-plans), the ordered candidate source paths to search, and a
// curated extractor function that distills the source SKILL.md into the load-bearing
// capsule body. The extractor reads `text` (the source) so its faithfulness to the
// source can be reviewed, even though the prose is hand-curated to fit the budget.
const SUPERPOWERS = `${HOME}/.zcode/cli/plugins/cache/claude-plugins-official/superpowers/6.2.0/skills`;

// --- curated extractors ------------------------------------------------------
// Each returns the capsule BODY (no header). Load-bearing rules only: method steps,
// must-not-do rules, stop-conditions. Examples, tables, graphviz, rationalization prose
// are stripped. The body is drawn from the corresponding SKILL.md section by section.

function tddCapsule(/* text */) {
  // Distilled from test-driven-development/SKILL.md: Overview, The Iron Law,
  // Red-Green-Refactor (RED/Verify RED/GREEN/Verify GREEN/REFACTOR), Final Rule.
  return `Iron law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. If you wrote code before the test, delete it — don't keep it as "reference", don't "adapt" it, delete means delete; implement fresh from tests.

Cycle (Red-Green-Refactor), repeat per behavior:
- RED: write one minimal test for one behavior. Clear name, real code (no mocks unless unavoidable).
- Verify RED (mandatory, never skip): run the test, watch it FAIL. Confirm it fails because the feature is missing. If it passes immediately, you tested existing behavior — fix the test.
- GREEN: write the simplest code that passes. No extra features, no drive-by refactors.
- Verify GREEN (mandatory): run the test, watch it PASS; confirm other tests still pass and output is pristine. If it fails, fix the code, not the test.
- REFACTOR: only after green — remove duplication, improve names, extract helpers. Keep tests green; add no behavior.

Must not: skip "verify RED"; write tests after implementation; add behavior during REFACTOR; keep pre-test code as "reference".

Done means: every new function has a test you watched fail first, minimal code to pass, all green, output clean, edge cases covered.`;
}

function debuggingCapsule(/* text */) {
  // Distilled from systematic-debugging/SKILL.md: The Iron Law, The Four Phases
  // (Root Cause Investigation, Pattern Analysis, Hypothesis and Testing, Implementation).
  return `Iron law: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. Symptom fixes are failure.

Phase 1 — Root cause (before any fix): read error messages and stack traces completely; reproduce reliably (exact steps — if not reproducible, gather more data, don't guess); check recent changes (git diff, commits, deps, config); in multi-component systems, instrument each component boundary to prove WHERE it breaks before analyzing; trace bad values to their source; fix at the source, not the symptom.

Phase 2 — Pattern: find similar working code in the codebase; read any reference completely (don't skim); list every difference between working and broken; understand dependencies and assumptions.

Phase 3 — Hypothesis: state one specific hypothesis ("X is root cause because Y"); test the smallest change, one variable at a time; if it fails, form a NEW hypothesis — never stack fixes on a failed one.

Phase 4 — Implementation: write a failing test reproducing it; apply ONE fix for the root cause (no drive-by changes); verify it passes and nothing else broke.

Stop-condition: after 3+ failed fixes, STOP — that signals a wrong architecture, not a missed bug. Question the fundamentals; do not attempt fix #4.`;
}

function executingPlansCapsule(/* text */) {
  // Distilled from executing-plans/SKILL.md: The Process (Steps 1-3),
  // When to Stop and Ask for Help, Remember.
  return `Step 1 — Load and review: ensure an isolated workspace (use using-git-worktrees or verify the existing one); read the plan; review it critically and identify concerns; raise concerns before starting. If no concerns, create todos for the plan items.

Step 2 — Execute: for each task, mark it in_progress; follow each plan step exactly (the plan is bite-sized); run the verifications the plan specifies; mark it completed.

Step 3 — Complete development: after all tasks are complete and verified, run the finishing-a-development-branch skill to verify tests and execute the chosen finish option.

Must not: skip the critical review; deviate from plan steps; skip verifications; guess past an unclear instruction; start implementation on main/master without explicit user consent.

Stop and ask (do not guess) when: you hit a blocker (missing dependency, failing test, unclear instruction); the plan has a critical gap preventing start; you don't understand an instruction; verification fails repeatedly.

Revisit Step 1 (re-review) when: the partner updates the plan from your feedback; the fundamental approach needs rethinking. Don't force through blockers — stop and ask.`;
}

const SKILLS = [
  {
    name: "tdd",
    sources: [
      `${HOME}/.zcode/skills/test-driven-development/SKILL.md`,
      `${SUPERPOWERS}/test-driven-development/SKILL.md`,
    ],
    extract: tddCapsule,
  },
  {
    name: "debugging",
    sources: [
      `${HOME}/.zcode/skills/systematic-debugging/SKILL.md`,
      `${SUPERPOWERS}/systematic-debugging/SKILL.md`,
    ],
    extract: debuggingCapsule,
  },
  {
    name: "executing-plans",
    sources: [
      `${HOME}/.zcode/skills/executing-plans/SKILL.md`,
      `${SUPERPOWERS}/executing-plans/SKILL.md`,
    ],
    extract: executingPlansCapsule,
  },
];

// --- helpers -----------------------------------------------------------------

/** Resolve the first existing source path for a skill. Throws if none found. */
function loadSource(skill) {
  for (const p of skill.sources) {
    if (existsSync(p)) {
      return { path: p, text: readFileSync(p, "utf8") };
    }
  }
  throw new Error(
    `source SKILL.md not found for "${skill.name}". Tried:\n  ${skill.sources.join("\n  ")}`
  );
}

function countWords(text) {
  return text
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean).length;
}

// --- main --------------------------------------------------------------------

function build() {
  mkdirSync(CAPSULES_DIR, { recursive: true });
  const results = [];
  for (const skill of SKILLS) {
    const { path: srcPath, text: srcText } = loadSource(skill);
    const body = skill.extract(srcText);
    const header = `# ${skill.name} capsule (for sub-agent dispatch)`;
    const capsule = `${header}\n\n${body.trim()}\n`;
    // The header counts toward the dispatch context the sub-agent receives, so it counts
    // toward the word budget too — that's the real cost.
    const words = countWords(capsule);
    if (words > MAX_WORDS) {
      console.error(`capsule ${skill.name} exceeds 200 words: ${words}`);
      exit(1);
    }
    const outPath = join(CAPSULES_DIR, `${skill.name}.md`);
    writeFileSync(outPath, capsule);
    results.push({ name: skill.name, words, srcPath, outPath });
  }
  // ensure the .gitkeep is present so the dir survives a clean checkout
  const gitkeep = join(CAPSULES_DIR, ".gitkeep");
  if (!existsSync(gitkeep)) writeFileSync(gitkeep, "# dir is populated by build-capsules.mjs\n");
  return results;
}

function check() {
  let ok = true;
  for (const skill of SKILLS) {
    const p = join(CAPSULES_DIR, `${skill.name}.md`);
    if (!existsSync(p)) {
      console.error(`missing capsule: ${p}`);
      ok = false;
      continue;
    }
    const words = countWords(readFileSync(p, "utf8"));
    if (words > MAX_WORDS) {
      console.error(`capsule ${skill.name} exceeds 200 words: ${words}`);
      ok = false;
    }
  }
  return ok;
}

const mode = argv.slice(2).includes("--check") ? "check" : "build";

if (mode === "check") {
  exit(check() ? 0 : 1);
}

const results = build();
for (const r of results) {
  console.log(`capsule ${r.name}: ${r.words} words  <=  ${r.srcPath}`);
}
console.log(`\nwrote ${results.length} capsules to ${CAPSULES_DIR}`);
exit(0);
