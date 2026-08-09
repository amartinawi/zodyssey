#!/usr/bin/env node
// record-momus-artifact.mjs — the TRUSTED writer for momus verdict artifacts (W6-2).
//
// record-review.mjs requires the artifact under .zcode/reviews/ (a gated dir an agent can't
// Write to directly). This script is the sanctioned way to place it: momus's verdict JSON is
// read from stdin (or --from <file>) and written to <repo>/.zcode/reviews/<slug>-r<round>.json,
// stamped with the writer's session id so record-review can verify provenance.
//
// Usage:
//   record-momus-artifact.mjs <repo> <slug> <round> [--momus-session S] [--from <file>]
//   (verdict JSON on stdin if no --from)
//   exit: 0 ok · 2 bad args · 3 no state file · 6 invalid verdict JSON
//
// Atomic write under O_EXCL lockfile with stale-lock reaping.

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, stdin } from "node:process";
import { createHash } from "node:crypto";

const [repo, slug, roundStr, ...rest] = argv.slice(2);
if (!repo || !slug || !roundStr) {
  console.error("usage: record-momus-artifact.mjs <repo> <slug> <round> [--momus-session S] [--from <file>]");
  exit(2);
}
const round = parseInt(roundStr, 10);
if (!Number.isInteger(round) || round < 1) { console.error("round must be a positive integer"); exit(2); }
let momusSession, fromFile, nonceArg;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--momus-session") momusSession = rest[++i];
  else if (rest[i] === "--from") fromFile = rest[++i];
  else if (rest[i] === "--nonce") nonceArg = rest[++i];
}

const statePath = join(repo, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) { console.error("no state file: " + statePath); exit(3); }

// W7-2: NONCE binding. The hook mints a one-time nonce into state.review.pending_nonce ONLY when
// it observes a real Task(momus) dispatch in phase=review. Require --nonce <nonce> to match and
// consume it (so it can't be reused). Without this, an agent could forge the artifact from Bash.
if (!nonceArg) { console.error("record-momus-artifact.mjs: --nonce <nonce> is required (issued by the hook when momus was dispatched)"); exit(6); }

let raw;
if (fromFile) {
  // SEC-6 (external audit 2026-08-04, partial mitigation): the nonce proves a Task(momus) was
  // dispatched, but the artifact's CONTENT comes from this file — so a caller can pipe any verdict.
  // The full fix needs the harness to hand momus's transcript hash to the hook (a design change).
  // As a partial mitigation, refuse --from paths under agent-writable bookkeeping dirs
  // (.zcode/notepads/, .zcode/plans/), which are the cheapest place to pre-stage a forged verdict.
  // Stdin and non-bookkeeping --from paths are still allowed (the legit orchestrator path).
  try {
    const fromAbs = realpathSync(fromFile);
    const zcode = join(repo, ".zcode");
    if (fromAbs.startsWith(join(zcode, "notepads") + "/") || fromAbs.startsWith(join(zcode, "plans") + "/")) {
      console.error(`record-momus-artifact.mjs: --from <file> under agent-writable bookkeeping (${fromAbs}) refused — pipe the verdict via stdin or use a non-bookkeeping path. (SEC-6: the artifact content must not be pre-staged where an agent can write it.)`);
      exit(6);
    }
  } catch (e) {
    // Only swallow fs errors (ENOENT/EACCES — let readFileSync below give the real message).
    // A non-fs error here (e.g. a bug in the check) must NOT be swallowed — that would silently
    // disable SEC-6. Re-throw anything that isn't a known fs failure.
    if (!e || typeof e.code !== "string" || !/^(ENOENT|EACCES|ELOOP|ENOTDIR|ENOMEM)$/.test(e.code)) throw e;
  }
  try { raw = readFileSync(fromFile, "utf8"); } catch { console.error("cannot read --from file"); exit(6); }
} else {
  // read stdin synchronously
  try {
    // readFileSync(0) reads all of stdin for a pipe/heredoc; guard against TTY (no data).
    raw = readFileSync(0, "utf8");
  } catch { raw = ""; }
  if (!raw || !raw.trim()) { console.error("no verdict on stdin and no --from <file>; pipe the momus JSON or use --from"); exit(6); }
}
let verdict;
try { verdict = JSON.parse(raw); } catch { console.error("momus verdict is not valid JSON"); exit(6); }

const reviewsDir = join(repo, ".zcode", "reviews");
mkdirSync(reviewsDir, { recursive: true });
const artifactPath = join(reviewsDir, `${slug}-r${round}.json`);
const stamped = JSON.stringify({
  ...verdict,
  _provenance: { slug, round, nonce: nonceArg, momus_session: momusSession || null, recorded_at: new Date().toISOString() },
}, null, 2);

// atomic write
const onDisk = stamped + "\n"; // exact bytes that land on disk (SEC-1: hash THIS, not `stamped`)
const tmp = artifactPath + ".tmp." + process.pid;
writeFileSync(tmp, onDisk);
try { renameSync(tmp, artifactPath); } catch { try { unlinkSync(tmp); } catch {} }

// W7-2: consume the nonce — verify it matches state.review.pending_nonce.nonce, then clear it
// (one-time use). Atomic under the state lockfile.
{
  const lockPath = statePath + ".lock";
  const LOCK_STALE_MS = 60 * 1000;
  function acquireLock() {
    try { return openSync(lockPath, "wx"); } catch {
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
          try { return openSync(lockPath, "wx"); } catch { return null; }
        }
      } catch {}
      return null;
    }
  }
  const lockFd = acquireLock();
  if (lockFd === null) {
    // W7-2 robustness: if we can't consume the nonce, the artifact must NOT survive (otherwise
    // record-review could pass on an artifact whose nonce was never verified/consumed).
    try { unlinkSync(artifactPath); } catch {}
    console.error("record-momus-artifact.mjs: could not acquire state lock to consume nonce; artifact rolled back");
    exit(6);
  }
  try {
    const st = JSON.parse(readFileSync(statePath, "utf8"));
    const pending = st.review && st.review.pending_nonce;
    if (!pending || pending.nonce !== nonceArg) {
      console.error(`record-momus-artifact.mjs: nonce mismatch. The hook only mints a nonce for a real Task(momus) dispatch in phase=review.`);
      try { unlinkSync(artifactPath); } catch {} // roll back the artifact write
      exit(6);
    }
    delete st.review.pending_nonce;
    // SEC-1: record WHAT this nonce was consumed against, so record-review.mjs can prove the
    // verdict artifact is the exact file produced by this call (not a forged JSON an agent later
    // dropped into reviews/). Bind nonce → {artifact abs path, sha256 of stamped content, round}.
    // This is what closes the external-audit CRITICAL hole: record-review no longer trusts a bare
    // nonce field; it checks the nonce was consumed against THIS artifact's hash at THIS round.
    const artifactSha = createHash("sha256").update(onDisk).digest("hex");
    if (!st.review.consumed_nonces) st.review.consumed_nonces = {};
    st.review.consumed_nonces[nonceArg] = {
      artifact: artifactPath, sha256: artifactSha, round, at: new Date().toISOString(),
    };
    st.updated_at = new Date().toISOString();
    const stmp = statePath + ".tmp." + process.pid;
    writeFileSync(stmp, JSON.stringify(st, null, 2) + "\n");
    renameSync(stmp, statePath);
  } finally {
    try { closeSync(lockFd); unlinkSync(lockPath); } catch {}
  }
}
console.log(artifactPath);
exit(0);
