#!/usr/bin/env node
// parse-plan.mjs — parse a ZOdyssey plan file into structured todos.
// Shared foundation: the executor, Momus, and the parallelism hook all call this.
//
// Grammar (the contract from DESIGN.md §4):
//   Top-level rows under `## Todos` of the form  `- [ ] N. <title>`  (N = positive decimal)
//   and  `- [ ] F<n>. <title>`  under `## Final verification wave`  are the only rows
//   counted as work. Prose bullets and headings are ignored — same rule omo's
//   plan-checklist.ts uses, so a looser grammar can't make the executor hallucinate tasks.
//
// Each todo carries optional nested bullet metadata:
//   - What to do: / - Must NOT do: / - Files: [a, b] / - Wave: 1 /
//   - Blocked by: [2, 3] / - References: … / - Acceptance criteria: / - QA scenarios:
//
// Usage:
//   parse-plan.mjs <plan.md>                 # emit full JSON
//   parse-plan.mjs <plan.md> --files         # emit just the union of Files: across todos
//   parse-plan.mjs <plan.md> --waves         # emit {wave: [todo ids]}
//   parse-plan.mjs <plan.md> --todo 3        # emit one todo by id
//   exit codes: 0 ok (parsed, maybe empty) · 2 bad args · 3 file unreadable

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { argv, exit } from "node:process";
import { scanText } from "./lint-untrusted.mjs";

const args = argv.slice(2);
if (args.length === 0) {
  console.error("usage: parse-plan.mjs <plan.md> [--files|--waves|--todo N]");
  exit(2);
}
const planPath = args[0];
const mode = args[1] || "all"; // all | --files | --waves | --todo
const todoArg = args[2];

let text;
try {
  text = readFileSync(planPath, "utf8");
} catch (e) {
  console.error("cannot read plan: " + e.message);
  exit(3);
}

// Split frontmatter from body (frontmatter is for state; parser only needs the body).
const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
let body = fmMatch ? fmMatch[2] : text;

// Strip HTML comments BEFORE parsing (audit gap #6a): the scaffold.mjs template's illustrative
// `- [ ] 1. Add /healthz endpoint` example lives inside a `<!-- ... -->` block under `## Todos`.
// Without this strip, that EXAMPLE parses as a real todo the executor implements. Comments have
// no semantic role in a plan, so removing them entirely is safe.
body = body.replace(/<!--[\s\S]*?-->/g, "");

// Find section bodies by header. Headers are line-anchored and case-sensitive.
function section(name) {
  const re = new RegExp(`^## ${name}\\s*$`, "m");
  const start = body.search(re);
  if (start === -1) return "";
  const after = body.slice(start + body.slice(start).indexOf("\n") + 1);
  // next top-level (## ) header ends this section
  const next = after.search(/^## /m);
  return (next === -1 ? after : after.slice(0, next)).trim();
}

const todosSection = section("Todos");
const finalSection = section("Final verification wave");

// A top-level work row, ANCHORED TO COLUMN 0 (audit gap #6b): the old `^\s*` let indented
// nested bullets like `  - What to do: ...` open a phantom todo if they happened to match the
// shape. Column-0 anchoring means only real top-level `- [ ] N.` rows count as work.
// Capture: checked, id (digits, optionally F-prefixed for final-wave rows), title.
const ROW_TOP = /^- \[( |x|X)\] (F?\d+)\.\s+(.+?)\s*$/;

function parseRows(block, isFinal) {
  const out = [];
  if (!block) return out;
  const lines = block.split("\n");
  let current = null;
  // sub-list mode: when we see "Acceptance criteria:" or "QA scenarios:", subsequent
  // deeper-indented `- ` lines are collected into the matching array until the next field.
  let mode = null; // "acceptance" | "qa" | null

  for (const line of lines) {
    // A top-level work row (column 0, no indentation).
    const m = line.match(ROW_TOP);
    if (m) {
      const checked = m[1].toLowerCase() === "x";
      const id = m[2]; // "1" or "F1"
      current = {
        id,
        title: m[3],
        done: checked,
        final: isFinal,
        what_to_do: "",
        must_not_do: "",
        files: [],
        wave: null,
        blocked_by: [],
        references: [],
        acceptance: [],
        qa: [],
      };
      mode = null;
      out.push(current);
      continue;
    }
    if (!current) continue;

    // A nested metadata bullet (indented `- `).
    const nested = line.match(/^(\s+)- (.*)$/);
    if (!nested) {
      // A blank line or non-bullet prose: doesn't reset mode (allows wrapping), but a new
      // non-indented header would (handled by section() splitting upstream).
      continue;
    }
    const indent = nested[1].length;
    const kvRaw = nested[2];

    // Sub-list continuation: if we're in acceptance/qa mode AND this bullet is deeper than
    // the field's own indent, it's an item of that list.
    if (mode && indent >= 4) {
      // Strip backticks around command spans (audit gap #6c): the plan grammar wraps commands
      // in backticks. A whole-line span (`` `cmd` ``) → "cmd"; a leading span + prose
      // (`` `cmd` returns 200 ``) → "cmd returns 200"; no span → verbatim.
      let item = kvRaw.trim();
      item = item.replace(/`([^`]+)`/g, "$1");
      if (mode === "acceptance") current.acceptance.push(item);
      else current.qa.push(item);
      continue;
    }

    // Field headers reset/switch mode.
    mode = null;
    const kv = kvRaw;
    const fm = kv.match(/^Files:\s*\[([^\]]*)\]/i);
    if (fm) {
      current.files = fm[1].split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    const wm = kv.match(/^Wave:\s*(\d+)/i);
    if (wm) {
      current.wave = parseInt(wm[1], 10);
      continue;
    }
    const bm = kv.match(/^Blocked by:\s*\[([^\]]*)\]/i);
    if (bm) {
      current.blocked_by = bm[1].split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    const rm = kv.match(/^References:\s*(.+)$/i);
    if (rm) {
      current.references = rm[1].split(",").map((s) => s.trim()).filter(Boolean);
      continue;
    }
    if (/^What to do:/i.test(kv)) current.what_to_do = kv.replace(/^What to do:\s*/i, "");
    else if (/^Must NOT do:/i.test(kv)) current.must_not_do = kv.replace(/^Must NOT do:\s*/i, "");
    else if (/^Acceptance criteria:/i.test(kv)) mode = "acceptance";
    else if (/^QA scenarios:/i.test(kv)) mode = "qa";
    // unknown fields are ignored (forward-compat)
  }
  return out;
}

const todos = [...parseRows(todosSection, false), ...parseRows(finalSection, true)];

// Todo 15 (toolchain-aware lint): find <repo>/.zcode/toolchain.json by walking up from the plan
// path to the nearest ancestor that contains a `.zcode` directory. A ZOdyssey plan always lives at
// <repo>/.zcode/plans/<slug>.md, so the .zcode dir is guaranteed to be an ancestor. Returns null
// when no toolchain.json exists (the graceful no-op path — lint must not regress for bare repos).
function loadToolchain(startPath) {
  let dir = startPath;
  try { dir = realpathSync(startPath); } catch { /* fall through with raw path */ }
  // Walk up; resolve the parent of `dir` so we never loop forever on root.
  let cur = dir;
  for (let i = 0; i < 32; i++) {
    const parent = dirname(cur);
    const zcode = join(parent, ".zcode");
    if (existsSync(zcode)) {
      const tcPath = join(zcode, "toolchain.json");
      if (!existsSync(tcPath)) return null; // .zcode exists but no toolchain.json → no-op
      try {
        return JSON.parse(readFileSync(tcPath, "utf8"));
      } catch {
        return null; // unreadable/unparseable → don't punish the plan
      }
    }
    if (parent === cur) break; // reached filesystem root
    cur = parent;
  }
  return null;
}

// Todo 15: map a referenced runner token to the test_runner value toolchain.json uses.
// `go test` references runner "go"; bare `jest`/`pytest`/`mocha`/`vitest` map to themselves.
// `node` and `npx` are deliberately NOT here — node is always present, npx just dispatches.
function runnerForToken(tok) {
  switch (tok) {
    case "jest": return "jest";
    case "vitest": return "vitest";
    case "mocha": return "mocha";
    case "pytest": return "pytest";
    case "go": return "go"; // matched only on the `go test` bigram
    default: return null;
  }
}

// Todo 15: scan each non-final todo's acceptance criteria for runner references that the repo's
// toolchain doesn't support. Returns an array of { todo, criterion_index, issue } problems.
// toolchain is the parsed <repo>/.zcode/toolchain.json; if null the check is a no-op.
function lintToolchainRefs(planPath, nonFinalTodos) {
  const toolchain = loadToolchain(planPath);
  if (!toolchain) return []; // graceful no-op
  const problems = [];
  const declaredRunner = toolchain.test_runner;
  const isBare = toolchain.bare === true && !toolchain.package_manager;
  for (const t of nonFinalTodos) {
    for (let i = 0; i < t.acceptance.length; i++) {
      const c = t.acceptance[i];
      // `npm run <script>` requires a package manager / package.json. A bare repo (no lockfile)
      // has none, so any `npm run` is invalid. (pnpm/yarn run handled symmetrically below.)
      // node/npx references are NEVER flagged here — node is always present.
      const npmRun = c.match(/\b(?:npm|pnpm|yarn)\s+run\s+\S+/i);
      if (npmRun && isBare) {
        problems.push({
          todo: t.id,
          criterion_index: i + 1,
          issue: `criterion references "${npmRun[0]}" but toolchain.json says package_manager is null and bare=true (no package.json) — this repo has no npm scripts to run`,
        });
        continue; // already failed for this criterion; don't double-report
      }
      // `go test` bigram → runner "go". (The bare token "go" is too noisy; require the test form.)
      if (/\bgo\s+test\b/.test(c) && declaredRunner !== "go") {
        problems.push({
          todo: t.id,
          criterion_index: i + 1,
          issue: `criterion references "go test" but toolchain.json says test_runner is ${declaredRunner}`,
        });
        continue;
      }
      // Other runners: word-boundary match on the bare token (jest/pytest/mocha/vitest are
      // unambiguous command verbs — a stray "jest" in prose is rare and worth flagging).
      const runnerTok = c.match(/\b(jest|vitest|mocha|pytest)\b/);
      if (runnerTok) {
        const ref = runnerForToken(runnerTok[1]);
        if (ref && declaredRunner !== ref) {
          problems.push({
            todo: t.id,
            criterion_index: i + 1,
            issue: `criterion references ${ref} but toolchain.json says test_runner is ${declaredRunner}`,
          });
        }
      }
    }
  }
  return problems;
}

// CRIT-3 (operational-consult): --lint mode. Mechanical acceptance-criteria check that momus's
// judgment call can't enforce. Fails (exit 6) if:
//   (a) any NON-FINAL todo has zero acceptance criteria (nothing to verify against → phase 5 is a no-op)
//   (b) any criterion is not a backticked shell command (prometheus's zero-user-intervention rule)
//   (c) any criterion matches /user (manually )?(verifies|confirms|checks)/ (the slop pattern)
// record-review.mjs gates OKAY on a clean lint (--lint-pass), so a plan that says "user manually
// verifies" cannot pass the hard-enforced review gate.
if (mode === "--lint") {
  const NON_FINAL = todos.filter((t) => !t.final);
  const problems = [];
  // SEC-M11 (external audit #13): a plan with NO non-final todos passed lint vacuously (the loop
  // body never ran → problems stayed empty → pass:true). That removed the last mechanical check
  // between a content-free plan and an OKAY. Now refuse explicitly.
  if (NON_FINAL.length === 0) {
    problems.push({ todo: "-", issue: "plan declares no todos — a content-free plan cannot be reviewed. Add at least one todo with executable acceptance criteria." });
  }
  const USER_VERIFIES_RE = /\buser\s+(?:manually\s+)?(?:verifies|confirms|checks|tests?)\b/i;
  for (const t of NON_FINAL) {
    if (t.acceptance.length === 0) {
      problems.push({ todo: t.id, issue: "no acceptance criteria — phase 5 has nothing to run" });
      continue;
    }
    for (let i = 0; i < t.acceptance.length; i++) {
      const c = t.acceptance[i];
      // criterion should look like a runnable shell command: has a verb + plausible shape
      // (we already stripped backticks in parsing; here we check it's not prose-only)
      if (USER_VERIFIES_RE.test(c)) {
        problems.push({ todo: t.id, criterion_index: i + 1, issue: `criterion delegates to the user: "${c.slice(0, 80)}"` });
      }
      // require at least one shell-runnable token: a known command verb, a path, or a pipe/redirect
      else if (!/\b(?:npm|pnpm|yarn|node|python|pytest|jest|curl|git|make|cargo|go|bash|sh|tsx|ts-node|npx)\b|[\/.]|[\|>]/.test(c)) {
        problems.push({ todo: t.id, criterion_index: i + 1, issue: `criterion is not an executable command: "${c.slice(0, 80)}"` });
      }
    }
    // F1-grammar check: Files: should contain clean path-shaped entries, not prose descriptions.
    // If a todo's files contain spaces (after backtick stripping), the plan grammar is garbled and
    // F1's set-difference will fail to match. (Found on the real iqraa-library.net run 2026-08-02.)
    for (const f of t.files) {
      if (/\s/.test(f) || f.length > 200) {
        problems.push({ todo: t.id, issue: `Files: entry is not a clean path (contains spaces or is too long): "${f.slice(0, 80)}..." — F1 scope-fidelity will fail to match this. Use comma-separated backtick-wrapped paths.` });
      }
    }
    // Empty-Files check (2026-08-02): a non-final todo with NO Files: entries means the executor
    // has nothing in-scope, and the pre-tool.mjs hook now fails CLOSED on an empty declared set
    // (every product-code Write would be blocked). Catch this at plan time so the planner fixes
    // it before review, instead of the run deadlocking at execute. A todo that genuinely edits no
    // files should be rare; if it arises, the plan author can declare Files: [] explicitly with a
    // note, but that will still block edits — by design.
    if (t.files.length === 0) {
      problems.push({ todo: t.id, issue: `no Files: declared — the scope-isolation hook will BLOCK every product-code edit for this todo (empty declared set = fail-closed). Add a Files: [\`path/to/file\`] list, or split the todo.` });
    }
  }
  // Todo 14 (injection hardening): EXTEND the existing lint with an untrusted-content scan.
  // Plans + notepads are agent-written and flow into dispatch prompts; an injected "ignore
  // previous instructions" in prose could drive ungated Bash now that the Bash gate is removed
  // (pre-tool.mjs:707). scanText masks exempt zones (backticked spans, fenced blocks, indented
  // acceptance/QA items) and flags only directive patterns in PROSE — so legit `rm -rf` in a
  // backticked acceptance criterion is NOT flagged. See lint-untrusted.mjs.
  const injectionFindings = scanText(body);
  for (const f of injectionFindings) {
    problems.push({ todo: "-", issue: `untrusted-content injection (line ${f.line}, ${f.label}): matched "${f.pattern}" — ${f.snippet}` });
  }
  // Todo 15 (toolchain-aware lint): EXTEND the existing lint with a static check that
  // acceptance-criteria runner references match what toolchain.json says the repo actually
  // has. This kills the empirically-observed class where a plan referenced `jest` but the
  // repo used node --test (caught only by the external consult, not the in-session wave).
  //
  // Graceful no-op if toolchain.json is absent: many repos won't have one yet, and lint must
  // never regress for them. We locate toolchain.json by walking up from the plan path to the
  // nearest ancestor containing a `.zcode` dir (the plan itself lives at <repo>/.zcode/plans/).
  // STATIC ONLY: this never executes the referenced runner.
  const toolchainProblems = lintToolchainRefs(planPath, NON_FINAL);
  for (const p of toolchainProblems) problems.push(p);
  const result = { pass: problems.length === 0, problems, todos_checked: NON_FINAL.length };
  console.log(JSON.stringify(result, null, 2));
  exit(problems.length === 0 ? 0 : 6);
}

if (mode === "--files") {
  const files = new Set();
  for (const t of todos) for (const f of t.files) files.add(f);
  console.log(JSON.stringify([...files].sort(), null, 2));
  exit(0);
}
if (mode === "--waves") {
  const waves = {};
  for (const t of todos) {
    const w = t.wave ?? (t.final ? "final" : "unspecified");
    waves[w] = waves[w] || [];
    waves[w].push(t.id);
  }
  console.log(JSON.stringify(waves, null, 2));
  exit(0);
}
if (mode === "--todo") {
  console.log(JSON.stringify(todos.find((t) => t.id === todoArg) ?? null, null, 2));
  exit(0);
}
console.log(JSON.stringify({ todos }, null, 2));
