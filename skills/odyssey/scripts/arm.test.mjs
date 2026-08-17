#!/usr/bin/env node
// arm.test.mjs — direct-import tests for lib/arm.mjs.
//
// WHY THIS EXISTS: judge.mjs hardcoded `arm: "zodyssey"` into every judged record, mislabeling
// baseline runs (real data: slug "std-01-baseline", arm "zodyssey" — dashboard.mjs re-derives the
// arm from the slug suffix precisely because the field was unreliable). The derivation moved to
// lib/arm.mjs so judge.mjs, dashboard.mjs, and the narrator trust registry (queue row 19) share
// one definition. Direct ESM import, not a subprocess — the precedent is the evidence-integrity
// suite importing lib/state-auth.mjs; subprocess black-box testing is for scripts with argv, and
// this lib has no argv.
//
// The paired probe for the consumer side is behavioral: with judge.mjs reverted to the hardcoded
// literal, the judged-record arm for a `-baseline` slug is wrong — that direction was live in the
// real corpus until this change (judged.jsonl, 2026-08-01 records).
//
// Run:  node arm.test.mjs   (exit 0 = pass, 1 = fail)

import { armFromSlug } from "./lib/arm.mjs";
import { exit } from "node:process";

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

console.log("lib/arm.mjs — arm derivation from slug suffix\n");

check('-baseline suffix → "baseline"', armFromSlug("std-01-baseline") === "baseline");
check('-zodyssey suffix → "zodyssey"', armFromSlug("std-01-zodyssey") === "zodyssey");
check("bare seed id → \"zodyssey\"", armFromSlug("std-01") === "zodyssey");
check("non-string (null) → \"zodyssey\", no throw", armFromSlug(null) === "zodyssey");
check("non-string (undefined) → \"zodyssey\", no throw", armFromSlug(undefined) === "zodyssey");
check("empty string → \"zodyssey\"", armFromSlug("") === "zodyssey");
check("baseline-substring but wrong position (std-baseline-01) → \"zodyssey\"",
  armFromSlug("std-baseline-01") === "zodyssey");
check("seed id containing 'baseline' mid-slug only counts at the end (a-baseline-baseline → baseline)",
  armFromSlug("a-baseline-baseline") === "baseline");

// consumer wiring: both importers actually call the lib, not a private copy
import { readFileSync } from "node:fs";
import { join } from "node:path";
const HERE = new URL(".", import.meta.url).pathname;
const judgeSrc = readFileSync(join(HERE, "judge.mjs"), "utf8");
const dashSrc = readFileSync(join(HERE, "dashboard.mjs"), "utf8");
check("judge.mjs imports the lib", /from "\.\/lib\/arm\.mjs"/.test(judgeSrc));
check("judge.mjs passes the slug (no hardcoded arm literal remains)",
  /arm: armFromSlug\(slug\)/.test(judgeSrc) && !/arm: "zodyssey"/.test(judgeSrc));
check("dashboard.mjs imports the lib (private copy removed)",
  /from "\.\/lib\/arm\.mjs"/.test(dashSrc) && !/function armFromSlug/.test(dashSrc));

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
