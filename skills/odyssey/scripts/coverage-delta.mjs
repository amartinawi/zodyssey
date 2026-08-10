#!/usr/bin/env node
// coverage-delta.mjs — derive the coverage tool from <repo>/.zcode/toolchain.json
// (written by probe-toolchain.mjs, todo 4) and report the coverage % for the
// changed files. The verify phase records this as evidence so a reviewer can see
// whether changed-file coverage dropped (evidence, NOT a gate — exit 0 always).
//
// Design (mirrors codegraph-impact.mjs's offline-first posture):
//   - toolchain.json is the single source of truth for which test runner a repo
//     uses. We DERIVE the coverage tool + report location from `test_runner`,
//     because probe-toolchain.mjs intentionally does NOT record a coverage_cmd
//     (it probes config files, never executes anything).
//   - We do NOT run jest/pytest/go/etc. here by default. The verify phase runs
//     tests via record-verify.mjs; we PARSE a pre-existing coverage report at
//     the standard location for that runner. This keeps the script fast, offline,
//     and free of side effects — and it is what makes the fixture tests possible
//     without installing a single coverage tool.
//   - When toolchain.json is absent, or `bare: true`, or no recognizable report
//     exists for the changed file, we emit a graceful no-op line and exit 0.
//     Most repos (and ~/.zcode itself, which is bare) have no coverage tool —
//     coverage delta is evidence for the repos that do, not a blocker for the
//     repos that don't.
//
// Coverage-tool derivation table (test_runner → tool + report path + parser):
//   jest     → jest --coverage          → coverage/coverage-summary.json  (json-summary reporter)
//   vitest   → vitest --coverage        → coverage/coverage-summary.json  (same shape as jest)
//   node-test→ c8 --reporter=json-summary → coverage/coverage-summary.json (c8 mirrors istanbul)
//   mocha    → nyc --reporter=json-summary → coverage/coverage-summary.json (nyc emits istanbul)
//   pytest   → pytest --cov --cov-report=json → coverage.json  (coverage.py JSON, different shape)
//   go       → go test -coverprofile=  → coverage.out  + go tool cover text parser (best-effort)
//   bare     → none → no-op
//
// Usage:
//   coverage-delta.mjs <repo> [<changed-file>...] [--baseline <pct>]
//     <repo>: repo root (argv[2], first positional)
//     <changed-file>...: zero or more changed files to report per-file coverage for
//     --baseline <pct>: optional numeric baseline; if any file's coverage is below
//         it the JSON output carries dropped:true (still exit 0 — flag, not gate)
//   exit: ALWAYS 0 (coverage is evidence, not a gate per MUST NOT). 2 only on bad argv.
//
// Output contract:
//   - no-op (no toolchain / bare / no report): a single stdout line containing
//     "no toolchain" or "skipping", exit 0.
//   - report parsed: a single JSON line on stdout:
//       {"repo":"...","tool":"jest","files":[{"file":"src/a.js","coverage_pct":92.5,
//        "found":true,"evidence":"coverage/coverage-summary.json#src/a.js"}],
//        "dropped":false,"baseline":null,"report":"coverage/coverage-summary.json"}
//     `coverage_pct` is null when the file is absent from the report (found:false).

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, isAbsolute, relative, resolve } from "node:path";
import { argv, exit } from "node:process";

// --- argv parsing: repo is mandatory; changed-files variadic; --baseline optional ---
const positional = [];
let baseline = null;
for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--baseline") {
    const v = argv[++i];
    if (v === undefined) { console.error("coverage-delta.mjs: --baseline requires a number"); exit(2); }
    const n = Number(v);
    if (Number.isNaN(n)) { console.error("coverage-delta.mjs: --baseline value is not a number: " + v); exit(2); }
    baseline = n;
  } else if (a === "--") {
    for (let j = i + 1; j < argv.length; j++) positional.push(argv[j]);
    break;
  } else {
    positional.push(a);
  }
}
const repo = positional[0];
const changedFiles = positional.slice(1);
if (!repo) {
  console.error("usage: coverage-delta.mjs <repo> [<changed-file>...] [--baseline <pct>]");
  exit(2);
}

// Resolve the repo to an absolute path; realpath only if it exists (a missing repo
// is the graceful-no-op case — /tmp/no-such-repo — and must NOT throw).
const repoAbs = (() => { try { return realpathSync(repo); } catch { return resolve(repo); } })();

// --- read toolchain.json defensively ---
const toolchainPath = join(repoAbs, ".zcode", "toolchain.json");
function readToolchain() {
  if (!existsSync(toolchainPath)) return null;
  try { return JSON.parse(readFileSync(toolchainPath, "utf8")); } catch { return null; }
}
const toolchain = readToolchain();

// GRACEFUL NO-OP #1: no toolchain.json (and not even a recognizable file path).
// The bare repo / not-yet-probed case. Exit 0 — coverage delta is opt-in evidence.
if (!toolchain) {
  console.log(`no toolchain coverage tool at ${repo}; skipping coverage delta`);
  exit(0);
}

// GRACEFUL NO-OP #2: bare:true means probe-toolchain found no package.json at all
// (the ~/.zcode case itself). There is no coverage tool to derive.
if (toolchain.bare === true) {
  console.log(`no toolchain coverage tool at ${repo} (bare repo); skipping coverage delta`);
  exit(0);
}

// --- coverage-tool derivation: test_runner → { tool, reportPath, parse(file) } ---
// Returns null when the runner has no recognized coverage report convention.
function deriveCoverageTool(tc, root) {
  const runner = tc.test_runner;
  // istanbul-json-summary shape is shared by jest, vitest, c8 (node-test), nyc (mocha).
  // coverage-summary.json: { "src/a.js": { lines: { total, covered, pct }, ... }, "total": {...} }
  const istanbul = (rootRel) => ({
    tool: tc.test_runner === "node-test" ? "c8" : tc.test_runner === "mocha" ? "nyc" : tc.test_runner,
    reportPath: join(root, rootRel),
    parse(raw, file) {
      let data;
      try { data = JSON.parse(raw); } catch { return { found: false, pct: null, evidence: null }; }
      // istanbul keys are repo-relative POSIX paths; the same file may appear under
      // multiple keys (e.g. "./src/a.js" and "src/a.js"). Match on basename + suffix
      // so a changed-file given as "src/a.js" or "/abs/repo/src/a.js" both resolve.
      const target = normalizeForMatch(repoAbs, file);
      for (const key of Object.keys(data)) {
        if (key === "total") continue;
        if (normalizeForMatchKey(key) === target) {
          const lines = data[key].lines || {};
          return { found: true, pct: typeof lines.pct === "number" ? lines.pct : null, evidence: `${rootRel}#${key}` };
        }
      }
      return { found: false, pct: null, evidence: null };
    },
  });

  switch (runner) {
    case "jest":
    case "vitest":
      return istanbul("coverage/coverage-summary.json");
    case "node-test":
      // c8 is the canonical node --test coverage tool; its json-summary reporter
      // writes the same istanbul shape. nyc is the older sibling (same shape).
      return istanbul("coverage/coverage-summary.json");
    case "mocha":
      // nyc is the canonical mocha coverage tool; same istanbul shape.
      return istanbul("coverage/coverage-summary.json");
    case "pytest": {
      // coverage.py JSON (--cov-report=json) shape: { "files": { "src/a.py": {
      //   "summary": { "percent_covered": 92.5, ... }, ... } }, "totals": {...} }
      return {
        tool: "coverage.py",
        reportPath: join(root, "coverage.json"),
        parse(raw, file) {
          let data;
          try { data = JSON.parse(raw); } catch { return { found: false, pct: null, evidence: null }; }
          const files = data.files || {};
          const target = normalizeForMatch(repoAbs, file);
          for (const key of Object.keys(files)) {
            if (normalizeForMatchKey(key) === target) {
              const pct = files[key].summary && files[key].summary.percent_covered;
              return { found: true, pct: typeof pct === "number" ? pct : null, evidence: `coverage.json#${key}` };
            }
          }
          return { found: false, pct: null, evidence: null };
        },
      };
    }
    case "go": {
      // go cover text format (coverprofile): each line "mode: set/count" then
      // "<pkg>/<file>.go:N.N,M.N N statements". We sum covered/total statements
      // for the matching .go file. Best-effort — go coverage is line-range based,
      // not the clean % of istanbul, but this gives a usable signal.
      return {
        tool: "go cover",
        reportPath: join(root, "coverage.out"),
        parse(raw, file) {
          const targetBasename = file.split("/").pop().split("\\").pop();
          let covered = 0, total = 0;
          for (const line of raw.split(/\r?\n/)) {
            // skip the "mode:" header and blank lines
            if (!line || line.startsWith("mode:")) continue;
            const m = line.match(/^(.*?):/);
            if (!m) continue;
            const filePart = m[1] || "";
            const rest = line.slice(m[0].length); // "start.col,end.col numStatements count"
            // Real Go coverprofile format: <file>:<range> <numStatements> <count>
            // count is 0 or 1 in mode:set; the number of executions in mode:count.
            const numMatch = rest.match(/\s([\d.]+)\s+([\d.]+)\s*$/);
            if (!numMatch) continue;
            const stmts = parseInt(numMatch[1], 10); // FIRST = numStatements
            const count = parseFloat(numMatch[2]);     // SECOND = count
            // filePart looks like "example.com/pkg/foo.go" — match on basename
            if (filePart.endsWith(targetBasename)) {
              total += stmts;
              if (count > 0) covered += stmts;
            }
          }
          if (total === 0) return { found: false, pct: null, evidence: null };
          return { found: true, pct: (covered / total) * 100, evidence: `coverage.out#${targetBasename}` };
        },
      };
    }
    default:
      return null; // unknown runner — no recognized coverage convention
  }
}

// Normalize a changed-file path (may be absolute or repo-relative) and a coverage-
// report key to a common form for comparison: repo-relative, POSIX, no leading "./".
function normalizeForMatch(root, file) {
  let p = isAbsolute(file) ? relative(root, file) : file;
  p = p.replace(/^\.\//, "").replace(/\\/g, "/");
  return p;
}
function normalizeForMatchKey(key) {
  return key.replace(/^\.\//, "").replace(/\\/g, "/");
}

const covTool = deriveCoverageTool(toolchain, repoAbs);

// GRACEFUL NO-OP #3: test_runner has no recognized coverage convention.
if (!covTool) {
  console.log(`no toolchain coverage tool at ${repo} (test_runner=${toolchain.test_runner}); skipping coverage delta`);
  exit(0);
}

// GRACEFUL NO-OP #4: no changed files requested → nothing to report a delta for.
// Still exit 0 — the verify phase may call this to confirm the tool is present.
if (changedFiles.length === 0) {
  console.log(`no toolchain coverage delta requested for ${repo}; skipping coverage delta`);
  exit(0);
}

// --- parse the coverage report (if present) ---
if (!existsSync(covTool.reportPath)) {
  // Report absent: the verify phase may not have run coverage yet, or the report
  // was written elsewhere. Graceful no-op, NOT an error.
  console.log(`no coverage report at ${covTool.reportPath}; skipping coverage delta`);
  exit(0);
}

let reportRaw;
try { reportRaw = readFileSync(covTool.reportPath, "utf8"); }
catch {
  console.log(`no coverage report at ${covTool.reportPath}; skipping coverage delta`);
  exit(0);
}

// --- per-file coverage extraction + dropped-flag ---
const files = changedFiles.map((f) => {
  const r = covTool.parse(reportRaw, f);
  return {
    file: f,
    found: r.found,
    coverage_pct: r.pct,
    evidence: r.evidence,
  };
});

// "dropped" means coverage on any changed file is strictly below the baseline.
// Coverage delta is evidence per MUST NOT ("flag, do not fail") — dropped is a
// boolean in the JSON, never a non-zero exit. A file with found:false / pct:null
// does NOT count as dropped (we don't have a number to compare).
let dropped = false;
if (baseline !== null) {
  for (const f of files) {
    if (f.found && typeof f.coverage_pct === "number" && f.coverage_pct < baseline) {
      dropped = true;
      break;
    }
  }
}

const result = {
  repo: repoAbs,
  tool: covTool.tool,
  files,
  dropped,
  baseline,
  report: relative(repoAbs, covTool.reportPath) || covTool.reportPath,
};
console.log(JSON.stringify(result));
exit(0);
