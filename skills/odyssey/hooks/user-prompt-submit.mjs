#!/usr/bin/env node
// user-prompt-submit.mjs — ZOdyssey UserPromptSubmit hook. Trivial-gate nudge.
//
// DESIGN.md §7 (lines ~300-312) defines the trivial gate: a request that is a single-file,
// <20-line, obvious fix should NOT enter the full orchestration pipeline. omo left this
// prompt-guided; this hook turns it into a *soft* code-level signal.
//
// Behavior: WARNING-ONLY. Never hard-blocks — exit 0 always. If the prompt looks trivial AND
// the user appears to have invoked /orchestrate (or is headed that way), emit a stderr nudge
// suggesting they ask directly. If the prompt looks non-trivial, silent pass. On any parse
// error, silent pass (fail open — never block the user).
//
// Heuristic (cheap, no model call — runs synchronously before the conductor):
//   trivial when ALL hold:
//     - matches a trivial keyword/phrase class (typo / spelling / rename a single var / change a word)
//     - short prompt (<= TRIVIAL_MAX_CHARS)
//     - no file-list pattern (no glob / no comma-separated paths / no "across N files")
//   Override: an explicit marker ("force orchestrate" / "--orchestrate-force") suppresses the nudge.
//
// stdin: ZCode UserPromptSubmit hook JSON, shape { prompt: "..." }.

import { readFileSync } from "node:fs";
import { exit } from "node:process";

// Anything longer than this is not "trivial" regardless of phrasing.
const TRIVIAL_MAX_CHARS = 200;

// Override markers — if present anywhere in the prompt, never warn.
const OVERRIDE = /\b(force\s+orchestrate|orchestrate[-_ ]?force|--orchestrate-force)\b/i;

// Trivial-intent keyword/phrase class. Anchored to intent, not random occurrence: these are
// the verbs the design's "Trivial" row calls out (typo, spelling, rename a single var, change a word).
// Word-boundaried so "typo" doesn't match inside "monotype", etc.
const TRIVIAL_PHRASE = new RegExp(
  [
    "\\btypo\\b",
    "\\bspelling\\b",
    "\\bmisspell(ed|ing)?\\b",
    "\\brename\\s+(this|the|a)\\s+(var(iable)?|const|let|function|method|class|file|symbol|identifier)\\b",
    "\\brename\\s+this\\b",
    "\\bfix\\s+(this|the|a)\\s+(typo|spelling|comment)\\b",
    "\\bfix\\s+the\\s+(typo|spelling)\\b",
    "\\bchange\\s+the\\s+word\\b",
    "\\bchange\\s+this\\s+word\\b",
    "\\bcorrect\\s+the\\s+(typo|spelling)\\b",
  ].join("|"),
  "i"
);

// Signals that the prompt is NOT trivial even if a trivial word appears:
//   - an explicit list of multiple files / paths
//   - "across N files" / "in N files"
//   - a glob pattern (src/**, *.ts)
//   - a diff/code-fence chunk that looks substantive
const FILE_LIST = /(\b(?:across|in|over)\b\s+\d+\s+files?)|(\*\.[a-z0-9]+)|([A-Za-z0-9_\-./]+\.[a-z]{1,4}\s*,\s*[A-Za-z0-9_\-./]+\.[a-z]{1,4})|(\b\d+\s+files?\b)/i;

// Drain stdin. The hook is invoked with the prompt payload; we read it but must never
// crash the harness if stdin is empty or malformed.
let raw = "";
try {
  raw = readFileSync(0, "utf8");
} catch {
  exit(0); // no stdin → nothing to classify → silent pass
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  exit(0); // malformed JSON → fail open, silent pass
}

const prompt = payload && typeof payload === "object" && typeof payload.prompt === "string"
  ? payload.prompt
  : "";

if (!prompt) exit(0); // no prompt text → silent pass

// 1. Override wins — explicit user intent, never warn.
if (OVERRIDE.test(prompt)) exit(0);

// 2. Trivial only when ALL three conditions hold.
const isTrivial =
  TRIVIAL_PHRASE.test(prompt) &&
  prompt.length <= TRIVIAL_MAX_CHARS &&
  !FILE_LIST.test(prompt);

if (isTrivial) {
  // WARNING-ONLY. Write to stderr (visible to the user as a hook annotation), exit 0.
  // The word "trivial" is intentionally in the message for downstream matching.
  process.stderr.write(
    "trivial: this looks like a small one-line fix (typo / rename / spelling). " +
      "If you ran /orchestrate, consider asking directly instead — orchestration is overkill here. " +
      "To force orchestration anyway, include \"force orchestrate\" in your prompt.\n"
  );
}

exit(0);
