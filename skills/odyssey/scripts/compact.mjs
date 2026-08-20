#!/usr/bin/env node
// compact.mjs — produce a single short brief summarizing a run's accumulated notepad findings.
//
// Borrows prime-agent primitive #8 ("summarize older turns, retain recent context, continue") and
// reshapes it into ZOdyssey's synchronous, filesystem-backed orchestration. Prime-agent compacts
// an in-process kernel's context window so the kernel survives across compactions; ZOdyssey has no
// in-process kernel, so the analog is: walk a run's notepad directory, derive a single deterministic
// structural summary (NOT an LLM call — $0, no network), and write it beside the source notepads.
// The final-wave sub-agents (F1-F4) can then be pointed at the brief instead of the full doc set,
// cutting their per-call context cost.
//
// Properties (load-bearing):
//   - DETERMINISTIC: no LLM, no network, no randomness. Same inputs → same bytes (modulo the
//     generated-at header). Determinism is the whole point — this is a structural summary, not a
//     judgment call, so it costs $0 and is reproducible.
//   - ADDITIVE: writes `<slug>/_compact-brief.md` only. NEVER reads, modifies, or deletes any
//     source notepad. Re-running overwrites only the brief (idempotent). The source notepads are
//     load-bearing working memory (see SKILL.md context-economy); this script preserves them
//     verbatim.
//   - THRESHOLD-GATED: set-phase.mjs auto-invokes this at final-phase entry with --min-lines N
//     (opt out via ZODYSSEY_NO_AUTO_COMPACT=1); direct invocation below is unchanged.
//
// Usage:
//   compact.mjs <repo> <slug> [--min-lines <N>]
//     - reads <repo>/.zcode/notepads/<slug>/*.md (excluding _compact-brief.md)
//     - writes <repo>/.zcode/notepads/<slug>/_compact-brief.md, prints the output path, exits 0
//     - --min-lines <N>: aggregate non-empty lines <= N → inert (one line out, exit 0); malformed N → exit 2
//   exit: 0 ok · 2 bad args · 3 no notepad dir · 1 other error
//
// Truncation policy: each notepad contributes its first ~40 non-empty lines under a `## <filename>`
// header. Line count, not token count — deterministic and dependency-free.

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, stderr } from "node:process";

const MAX_LINES_PER_NOTEPAD = 40;
const BRIEF_NAME = "_compact-brief.md";

const [repo, slug] = argv.slice(2);
if (!repo || !slug) {
  stderr.write("usage: compact.mjs <repo> <slug> [--min-lines <N>]\n");
  exit(2);
}

// --min-lines <N> (optional): gate compaction on the aggregate non-empty source-line count.
// Parsed BEFORE the dir check so malformed input fails closed (exit 2) ahead of any filesystem
// probing. Policy — the DEFAULT threshold — lives in set-phase.mjs (AUTO_COMPACT_MIN_LINES);
// this script stays policy-free and compacts unconditionally when the flag is absent.
let minLines = null;
const extraArgs = argv.slice(4);
if (extraArgs.length > 0) {
  if (extraArgs.length !== 2 || extraArgs[0] !== "--min-lines" || !/^\d+$/.test(extraArgs[1])) {
    stderr.write("usage: compact.mjs <repo> <slug> [--min-lines <N>]\n");
    exit(2);
  }
  minLines = Number(extraArgs[1]);
}

const notepadsDir = join(repo, ".zcode", "notepads", slug);
if (!existsSync(notepadsDir) || !statSync(notepadsDir).isDirectory()) {
  stderr.write(`no notepad dir for slug "${slug}": ${notepadsDir}\n`);
  exit(3);
}

// Gather source notepads: only *.md, exclude the brief itself, sorted for determinism.
let names;
try {
  names = readdirSync(notepadsDir)
    .filter((n) => n.endsWith(".md") && n !== BRIEF_NAME)
    .sort();
} catch (e) {
  stderr.write(`cannot read notepad dir: ${e.message}\n`);
  exit(1);
}

// Below-threshold short-circuit (only when --min-lines was supplied): when the aggregate
// non-empty source-line count — same l.trim().length > 0 unit the truncation uses — is at or
// below N, this tool is INERT: nothing written, nothing deleted (a stale brief left by a manual
// earlier run stays byte-identical), one printed line, exit 0.
if (minLines !== null) {
  let aggregate = 0;
  for (const name of names) {
    let raw;
    try {
      raw = readFileSync(join(notepadsDir, name), "utf8");
    } catch (e) {
      stderr.write(`cannot read notepad ${name}: ${e.message}\n`);
      exit(1);
    }
    aggregate += raw.split(/\r?\n/).filter((l) => l.trim().length > 0).length;
  }
  if (aggregate <= minLines) {
    console.log(`${notepadsDir}: ${aggregate} non-empty source line(s) <= --min-lines ${minLines} — below threshold, nothing written`);
    exit(0);
  }
}

const sections = [];
const index = [];
for (const name of names) {
  const full = join(notepadsDir, name);
  let raw;
  try {
    raw = readFileSync(full, "utf8");
  } catch (e) {
    stderr.write(`cannot read notepad ${name}: ${e.message}\n`);
    exit(1);
  }
  // First ~40 non-empty lines; preserve original line content verbatim (no reflow).
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, MAX_LINES_PER_NOTEPAD);
  const truncated = raw.split(/\r?\n/).filter((l) => l.trim().length > 0).length > MAX_LINES_PER_NOTEPAD;
  const body = lines.join("\n");
  const note = truncated ? " _(truncated to first 40 non-empty lines)_" : "";
  sections.push(`## ${name}${note}\n\n${body}\n`);
  index.push(`- ${name}${truncated ? " (truncated)" : ""}`);
}

const generatedAt = new Date().toISOString();
const header = [
  "# Compact brief — accumulated notepad findings",
  "",
  `_Slug:_ \`${slug}\` · _Source dir:_ \`.zcode/notepads/${slug}/\` · _Generated:_ ${generatedAt}`,
  "",
  "Structural summary produced by `scripts/compact.mjs` (deterministic, $0, additive).",
  "Borrows prime-agent primitive #8 (summarize older turns, retain recent context, continue),",
  "adapted to ZOdyssey's filesystem-backed shape: source notepads are load-bearing working memory",
  "and are NEVER modified — this brief is a derived view for final-wave context economy.",
  "",
  "## Contents",
  index.length > 0 ? index.join("\n") : "_(no source notepads found)_",
  "",
].join("\n");

const out = header + "\n" + sections.join("\n");
const outPath = join(notepadsDir, BRIEF_NAME);
try {
  writeFileSync(outPath, out, "utf8");
} catch (e) {
  stderr.write(`cannot write brief: ${e.message}\n`);
  exit(1);
}

console.log(outPath);
exit(0);
