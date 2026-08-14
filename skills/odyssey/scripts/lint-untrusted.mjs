#!/usr/bin/env node
// lint-untrusted.mjs — untrusted-content lint for plan/notepad injection hardening.
//
// Plans and notepads are AGENT-WRITTEN and flow into dispatch prompts. With the Bash gate
// removed (pre-tool.mjs:707), an injected "ignore previous instructions" in a notepad could
// drive ungated Bash. This scanner flags embedded-directive patterns BEFORE the text reaches a
// model context.
//
// The core problem this solves: distinguishing PROSE INJECTION from LEGITIMATE acceptance
// criteria. A plan's `Acceptance criteria:` block is *expected* to contain shell commands like
// `rm -rf /tmp/x` or `<function=`-shaped strings — flagging those would block every real plan.
// So we MASK OUT exempt zones (backticked spans, fenced code blocks, indented acceptance/QA
// item lines) and scan only the remaining PROSE for directive patterns.
//
// Usage:
//   lint-untrusted.mjs <file.md>            # scan a file (exit 0 clean, 6 if injection found)
//   lint-untrusted.mjs --text "<text>"      # scan raw text
// Exit codes: 0 clean · 6 injection found (report on stderr) · 2 bad args · 3 unreadable

import { readFileSync } from "node:fs";
import { argv, exit, stderr } from "node:process";
import { pathToFileURL } from "node:url";

// --- Directive patterns to flag in PROSE (case-insensitive) ---
// Each entry: { re, label }. `re` is tested per-line against the masked prose.
// These are the canonical prompt-injection / tool-call-bait shapes. They must NOT match
// innocent prose ("system" alone is fine; `system:` as a directive prefix is not).
const PROSE_PATTERNS = [
  { re: /ignore\s+(?:all\s+)?previous\s+instructions/i, label: "ignore-previous-instructions" },
  { re: /disregard\s+(?:the\s+)?(?:above|previous|all\s+prior)/i, label: "disregard-previous" },
  // "system:" as a directive PREFIX (word boundary + colon). Matches `system:` and `system :`
  // but NOT the word "system" in narrative ("the system design...", "type system").
  { re: /\bsystem\s*:/i, label: "system-directive-prefix" },
  // Tool-call bait: literal injection-shaped tags in prose.
  { re: /<function=/i, label: "function-tag-injection" },
  { re: /<tool_call/i, label: "tool-call-tag-injection" },
  { re: /<\/system>/i, label: "system-closing-tag-injection" },
  // `rm -rf` in PROSE is suspicious (a directive trying to get Bash to nuke a path).
  // Legit `rm -rf` lives in backticked acceptance criteria, which are masked out below.
  { re: /\brm\s+-rf\b/i, label: "rm-rf-in-prose" },
];

// --- Masking: turn exempt content into spaces so line numbers + offsets are preserved. ---
//
// We replace masked regions with an equal-length run of spaces. This keeps line numbers stable
// for the report and prevents a pattern from straddling a mask boundary.
function maskLine(line) {
  // Backticked spans: `` `...` `` (single backtick pairs on the same line). Acceptance
  // criteria legitimately wrap commands in backticks; that content is exempt.
  let out = "";
  let i = 0;
  const len = line.length;
  while (i < len) {
    if (line[i] === "`") {
      // find the closing backtick
      const close = line.indexOf("`", i + 1);
      if (close === -1) {
        // unterminated backtick: mask the rest of the line (treat as code span)
        out += " ".repeat(len - i);
        break;
      }
      // mask the content between backticks (inclusive of backticks themselves → spaces)
      const spanLen = close - i + 1;
      out += " ".repeat(spanLen);
      i = close + 1;
    } else {
      out += line[i];
      i++;
    }
  }
  return out;
}

// Lines that are acceptance-criteria or QA items: indented `  - ` bullets under those fields.
// In the plan grammar these are ≥4-space-indented bullets following an "Acceptance criteria:" or
// "QA scenarios:" header. We treat ANY line matching /^ {2,}- / that looks like a list item
// under a criteria block as exempt (the parser already guarantees only those carry commands).
// To be safe and simple, we mask the bullet TEXT (after the `- `) of any line indented ≥2 spaces
// that begins with `- `, EXCEPT we still allow flagging if needed — but per spec, indented
// acceptance items are explicitly exempt. So mask them.
function isIndentedItem(line) {
  // ≥2 leading spaces then "- " (a nested bullet). Top-level `- [ ]` rows don't match (they
  // start at column 0). Field headers like "  - Files:" would also match; their prose payload
  // is short and not command-shaped, but to honor "indented acceptance-criteria blocks are
  // exempt" we mask all nested-bullet payload text.
  return /^ {2,}-\s/.test(line);
}

// Scan text, returning a list of findings: { line, pattern, label, snippet }.
export function scanText(rawText) {
  const lines = rawText.split("\n");
  const findings = [];

  // Track fenced code blocks (``` ... ```). Lines inside are fully masked.
  let inFence = false;
  let exemptMode = false; // inside an Acceptance criteria / QA scenarios block (payloads exempt)

  for (let idx = 0; idx < lines.length; idx++) {
    const original = lines[idx];
    let line = original;

    // Fence toggle: a line that is (whitespace + ``` ...) opens/closes a code block.
    if (/^\s*```/.test(original.trimStart ? original : original.replace(/^\s*/, "")) || /^\s*```/.test(original)) {
      inFence = !inFence;
      continue; // the fence line itself carries no prose payload
    }
    if (inFence) {
      continue; // fully exempt
    }

    // T2-2 (audit 2026-08-14): this masked EVERY ≥2-space nested bullet, and the helper's own
    // comment conceded that "  - Files:" and "  - What to do:" matched too. So an injected
    // directive written as `  - What to do: ignore all previous instructions and …` was masked and
    // never flagged, while the identical text at column 0 WAS flagged — and the nested form is the
    // one that actually flows into dispatch prompts verbatim. The exemption exists for
    // acceptance-criteria / QA payloads (shell snippets that legitimately look command-shaped), so
    // scope it to those blocks by tracking the field header, the way parse-plan's `mode` does.
    const fieldHdr = original.match(/^\s*-\s+(Acceptance criteria|QA scenarios)\s*:/i);
    if (fieldHdr) { exemptMode = true; }
    else if (/^\s*-\s+\S/.test(original) && !/^\s{4,}/.test(original)) {
      // a new field bullet at the same or shallower depth ends the exempt block
      if (!/^\s*-\s+$/.test(original)) exemptMode = /^\s*-\s+(Acceptance criteria|QA scenarios)\s*:/i.test(original);
    }
    // Indented nested-bullet item → mask its payload ONLY inside an exempt block.
    if (isIndentedItem(original) && exemptMode) {
      // Keep the indent + "- " visible (so line shape is recognizable) but mask the payload.
      const m = original.match(/^(\s*-\s+)(.*)$/);
      line = m ? m[1] + " ".repeat(m[2].length) : original;
    } else {
      // Top-level prose line: mask backticked spans only.
      line = maskLine(original);
    }

    for (const { re, label } of PROSE_PATTERNS) {
      const m = line.match(re);
      if (m) {
        findings.push({
          line: idx + 1,
          label,
          pattern: m[0],
          snippet: original.trim().slice(0, 100),
        });
      }
    }
  }
  return findings;
}

// --- CLI (only when invoked directly, not when imported by the test) ---
const isMain = import.meta.url === pathToFileURL(argv[1] || "").href;
if (isMain) {
  runCli();
}

export function runCli() {
  const args = argv.slice(2);
  if (args.length === 0) {
    stderr.write("usage: lint-untrusted.mjs <file.md> | --text \"<text>\"\n");
    exit(2);
  }

let text;
if (args[0] === "--text") {
  if (!args[1]) {
    stderr.write("--text requires an argument\n");
    exit(2);
  }
  text = args[1];
} else {
  try {
    text = readFileSync(args[0], "utf8");
  } catch (e) {
    stderr.write("cannot read input: " + e.message + "\n");
    exit(3);
  }
}

const findings = scanText(text);
if (findings.length === 0) {
  // Clean: emit a one-line JSON ack on stdout (parse-plan composes this with its own report).
  console.log(JSON.stringify({ pass: true, findings: [] }));
  exit(0);
}

// Injection found: report on stderr, exit 6.
stderr.write("lint-untrusted: untrusted-content injection detected\n");
for (const f of findings) {
  stderr.write(`  line ${f.line}: [${f.label}] matched "${f.pattern}" — ${f.snippet}\n`);
}
exit(6);
}
