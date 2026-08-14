#!/usr/bin/env node
// record-momus-artifact.mjs — the TRUSTED writer for momus verdict artifacts (W6-2).
//
// record-review.mjs requires the artifact under .zcode/reviews/ (a gated dir an agent can't
// Write to directly). This script is the sanctioned way to place it: momus's verdict JSON is
// read from stdin (or --from <file>) and written to <repo>/.zcode/reviews/<slug>-r<round>.json,
// stamped with the writer's session id so record-review can verify provenance.
//
// Usage:
//   record-momus-artifact.mjs <repo> <slug> [<round>] [--momus-session S] [--from <file>]
//     <round> is OPTIONAL and 1-indexed; omit it and it is computed from state.review.round.
//   (verdict JSON on stdin if no --from)
//   exit: 0 ok · 2 bad args · 3 no state file · 6 invalid verdict JSON
//
// Atomic write under O_EXCL lockfile with stale-lock reaping.

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, stdin } from "node:process";
import { createHash } from "node:crypto";
import { resolveRepo, resolvePath, containedIn } from "./lib/repo-path.mjs";

const [repo, slug, ...tail] = argv.slice(2);
// <round> is optional, so the third positional may actually be the first FLAG. Only treat it as a
// round when it does not start with `--`; otherwise it belongs to rest. (Without this, omitting
// the round made `--nonce` parse as the round value.)
const roundStr = (tail[0] !== undefined && !String(tail[0]).startsWith("--")) ? tail[0] : undefined;
const rest = roundStr === undefined ? tail : tail.slice(1);
if (!repo || !slug) {
  console.error("usage: record-momus-artifact.mjs <repo> <slug> [<round>] [--momus-session S] [--from <file>]");
  exit(2);
}
// ROUND IS NOW OPTIONAL (2026-08-12). `state.review.round` counts COMPLETED rounds and starts at
// 0; this argument is the 1-indexed round being recorded. That off-by-one tripped shakedown runs 1
// and 3 — both passed the state's `round` verbatim, got "round must be a positive integer" or a
// mismatch, and had to re-dispatch momus to recover. An index convention that has to be explained
// is one the tool should just compute.
//
// Omit it and the correct round is derived. Pass it and it is checked, with an error that names
// both numbers rather than leaving you to work out which end is off by one.
let round;
{
  let completed = 0;
  try {
    const st0 = JSON.parse(readFileSync(join(repo, ".zcode", "state", `${slug}.json`), "utf8"));
    completed = Number.isInteger(st0.review && st0.review.round) ? st0.review.round : 0;
  } catch { completed = 0; }
  const computed = completed + 1;
  if (roundStr === undefined) {
    round = computed;
  } else {
    round = parseInt(roundStr, 10);
    if (!Number.isInteger(round) || round < 1) {
      console.error(`round must be a positive integer (got ${JSON.stringify(roundStr)}). It is 1-indexed, while state.review.round counts COMPLETED rounds and starts at 0 — for the first review pass ${computed}. You can omit it entirely and it will be computed.`);
      exit(2);
    }
    if (round !== computed) {
      console.error(`round ${round} does not match the expected round ${computed} (state.review.round is ${completed}, i.e. ${completed} completed round(s)). Pass ${computed}, or omit the argument and let it be computed.`);
      exit(2);
    }
  }
}
let momusSession, fromFile, nonceArg;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--momus-session") momusSession = rest[++i];
  else if (rest[i] === "--from") fromFile = rest[++i];
  else if (rest[i] === "--nonce") nonceArg = rest[++i];
}

const statePath = join(repo, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) { console.error("no state file: " + statePath); exit(3); }

// W7-2: NONCE binding. The hook mints a one-time nonce into state.review.pending_nonce ONLY when
// it observes a real Task(momus) dispatch (any phase; the hook warns if phase!="review"). Require --nonce <nonce> to match and
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
    // Class B fix (audit 2026-08-14): this guard built its prefix from the repo argument AS PASSED
    // while comparing against an absolute realpath, so with a relative repo arg (`.` — the form the
    // docs themselves used) `startsWith` could never match and SEC-6 was a no-op. Proven bypassed.
    // containedIn normalizes BOTH sides; that is the whole point of routing through it.
    const zcode = join(resolveRepo(repo), ".zcode");
    if (containedIn(fromFile, join(zcode, "notepads")) || containedIn(fromFile, join(zcode, "plans"))) {
      console.error(`record-momus-artifact.mjs: --from <file> under agent-writable bookkeeping (${resolvePath(fromFile)}) refused — SEC-6: the artifact content must not be pre-staged where an agent can write it. Stage it in .zcode/staging/ (writable pre-OKAY, and not a dir the planner writes) or pipe the verdict on stdin.`);
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

// SEC (audit H1): bind the verdict to the EXACT plan momus reviewed, not merely to whatever is on
// disk when record-review runs. Without this, an agent can get a real OKAY on a minimal plan, then
// swap in a scope-widened plan that still lints, and record-review (which only compares its --plan-sha
// argv to the current disk — both agent-controlled) would accept it. Hash the plan NOW and stamp it
// into both the provenance and the consumed-nonce record so record-review can triple-bind
// (argv === what-momus-read === disk). Fail-closed: an unreadable plan leaves the hash empty, which
// will not match record-review's real hash → OKAY refused.
let planSha256 = "";
try {
  const stForPlan = JSON.parse(readFileSync(statePath, "utf8"));
  const planPathForSha = stForPlan.plan_path || join(repo, ".zcode", "plans", `${slug}.md`);
  planSha256 = createHash("sha256").update(readFileSync(planPathForSha, "utf8")).digest("hex");
} catch {}

const stamped = JSON.stringify({
  ...verdict,
  _provenance: { slug, round, nonce: nonceArg, plan_sha256: planSha256, momus_session: momusSession || null, recorded_at: new Date().toISOString() },
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
      console.error(`record-momus-artifact.mjs: nonce mismatch. The hook mints a nonce for a real Task(momus) dispatch (minted on dispatch regardless of phase).`);
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
      artifact: artifactPath, sha256: artifactSha, round, plan_sha256: planSha256, at: new Date().toISOString(),
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
