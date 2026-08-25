// redact.mjs — shared secret redaction for anything shipped to an EXTERNAL process
// (consult.mjs auditor, judge.mjs scorer, recall-corrections/outcomes surfaced to Metis).
//
// Lifted out of consult.mjs (was function-local, so judge/recall could not reuse it and shipped
// secrets unredacted — audit M1/M2/M3). Two fixes over the original:
//   1. SECRET_PATH_RE matches env/credential files by SUFFIX, not only as a dot-prefixed filename.
//      The old `(^|\/)\.env(\..+)?$` missed the ordinary `prod.env` / `staging.env` / `.envrc` /
//      `aws.credentials` names that routinely hold secrets — those leaked verbatim.
//   2. redactSecrets extracts the hunk path with a space-tolerant capture, so a path like
//      `my prod.env` is recognised instead of being truncated at the first space and passed.

// Coarse deny-glob on a filename. If a path matches, its diff body is withheld (the path stays
// visible so the auditor can flag "a secret file was touched" without seeing the secret).
export const SECRET_PATH_RE =
  /(^|\/)(\.env(\..+)?|.+\.env(\..+)?|\.envrc|.+\.key|.+\.pem|.+\.pfx|id_(rsa|ed25519|ecdsa)|credentials(\..+)?|.+\.credentials|secrets(\..+)?|.+\.secrets|\.npmrc|\.pypirc|\.netrc)$/i;

// True if a single filename/path looks secret-bearing. Consumers that build a diff by appending
// untracked-file bodies (consult, judge) should call this on each filename BEFORE appending, so a
// secret untracked file never enters the text in the first place.
export function isSecretPath(p) {
  return typeof p === "string" && p.length > 0 && SECRET_PATH_RE.test(p);
}

// Redact secret-bearing file bodies inside a git-diff string. Splits on `diff --git` file
// boundaries; for each hunk, extracts the path (space-tolerant) and, if it looks secret, drops the
// body lines while keeping a visible marker.
export function redactSecrets(diffText) {
  if (!diffText) return diffText;
  // `+++ new file: <path>` sections (untracked bodies consult/judge append after the tracked diff)
  // are split as their own hunks — otherwise they hide inside the preceding diff's segment and the
  // per-hunk path capture below never sees them.
  const files = diffText.split(/^(?=diff --git |\+\+\+ new file: )/m);
  return files
    .map((hunk) => {
      // Space-tolerant path capture: `diff --git a/<path> b/<path>` (path may contain spaces), a
      // bare `+++ b/<path>` header, or a `+++ new file: <path>` header (consult/judge untracked
      // append; the trailing `(untracked)` marker is optional). Non-greedy up to ` b/` so
      // multi-word paths are captured.
      const pathMatch = hunk.match(
        /^diff --git a\/(.+?) b\/.+$|^\+\+\+ b\/(.+)$|^\+\+\+ new file: (.+?)(?: \(untracked\))?$/m
      );
      const p = pathMatch ? (pathMatch[1] || pathMatch[2] || pathMatch[3] || "") : "";
      if (p && SECRET_PATH_RE.test(p)) {
        const isNewFileHeader = pathMatch[3] !== undefined;
        const head = isNewFileHeader
          ? hunk.slice(0, hunk.indexOf("\n") === -1 ? 200 : hunk.indexOf("\n"))
          : hunk.replace(/(^|\n)([-+@ ].*)/g, () => "").slice(0, 200);
        return head + `\n[REDACTED — secret-bearing file ${p}; content withheld from external auditor]\n`;
      }
      return hunk;
    })
    .join("");
}
