#!/usr/bin/env node
// record-review.mjs — the TRUSTED writer for review-gate fields (audit re-audit gap G1).
//
// The T1 fix removed .zcode/state/ from bookkeeping so an agent can't self-authorize a verdict
// by Write-ing state.json. But that also blocked the legitimate orchestrator step that writes
// review.verdict:"OKAY" to UNLOCK the gate — a deadlock. This script is the sanctioned escape
// hatch: pre-tool.mjs recognizes it by command path and lets it write state's review lane even
// pre-OKAY. It is the ONLY way to raise review.verdict to OKAY.
//
// Usage:
//   record-review.mjs <repo> <slug> <OKAY|REJECT> --momus-artifact <path> [--blockers <file>]
//                      [--plan-sha <sha>] [--momus-session S]
//   exit: 0 ok · 2 bad args · 3 no state file · 6 verification failed (W5-H2)
//
// W5-H2 verification: the verdict is BOUND to evidence so an agent can't self-authorize:
//   · --momus-artifact <path> REQUIRED, must exist under .zcode/ (momus must have actually run)
//   · --plan-sha <sha>        if provided, must equal the current sha256 of plan_path
//                             (refuses OKAY if the plan changed since review — closes the plan-drift hole)
//   · round is computed SERVER-SIDE as (prev.round||0)+1, never trusted from argv
//   · OKAY refused if computed round > review.max_rounds (closes the "always pass round 0" defeat)
//
// Atomic write under O_EXCL lockfile with stale-lock reaping (same pattern as record-todo.mjs).

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { argv, exit, env } from "node:process";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { makeReviewDefault } from "./lib/verdict-schema.mjs";

const [repo, slug, verdict, ...rest] = argv.slice(2);
if (!repo || !slug || !verdict) {
  console.error("usage: record-review.mjs <repo> <slug> <OKAY|REJECT> --momus-artifact <path> [--blockers <file>] [--plan-sha <sha>]");
  exit(2);
}
const v = verdict.toUpperCase();
if (v !== "OKAY" && v !== "REJECT") {
  console.error("verdict must be OKAY or REJECT");
  exit(2);
}

const statePath = join(repo, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) {
  console.error("no state file: " + statePath);
  exit(3);
}

// parse flags
let momusArtifact, blockersFile, planShaArg, momusSession;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--momus-artifact") momusArtifact = rest[++i];
  else if (rest[i] === "--blockers") blockersFile = rest[++i];
  else if (rest[i] === "--plan-sha") planShaArg = rest[++i];
  else if (rest[i] === "--momus-session") momusSession = rest[++i];
}

// W6-2 verification gate (stronger than W5-H2): bind the verdict to evidence an agent CANNOT
// forge. Reads state once for validation, before lock acquisition.
let prevState;
try { prevState = JSON.parse(readFileSync(statePath, "utf8")); }
catch { console.error("cannot read state file"); exit(3); }

const repoAbs = (() => { try { return realpathSync(repo); } catch { return repo; } })();

// (1) momus artifact: REQUIRED, must exist, must live under <repo>/.zcode/reviews/ (a dir the
// edit gate does NOT classify as bookkeeping — plans/ and notepads/ are agent-writable, so an
// artifact there is forgeable in one Write; reviews/ is gated, so only a trusted writer can place it).
if (!momusArtifact) {
  console.error("record-review.mjs: --momus-artifact <path> is required (the momus verdict must exist under .zcode/reviews/)");
  exit(6);
}
const reviewsDir = join(repoAbs, ".zcode", "reviews");
const reviewsPrefix = reviewsDir + "/";
let momusAbs;
try {
  momusAbs = momusArtifact.startsWith("/") ? realpathSync(momusArtifact) : realpathSync(join(repoAbs, momusArtifact));
} catch {
  console.error(`record-review.mjs: momus artifact does not exist: ${momusArtifact}`);
  exit(6);
}
if (!momusAbs.startsWith(reviewsPrefix) || !existsSync(momusAbs)) {
  console.error(`record-review.mjs: momus artifact must exist under <repo>/.zcode/reviews/ (got ${momusArtifact}). reviews/ is not agent-writable, so the artifact is evidence momus actually ran.`);
  exit(6);
}

// (1b) W7-2 + SEC-1: parse the artifact and bind it to THIS review. The artifact must carry a
// nonce that was ACTUALLY CONSUMED by record-momus-artifact.mjs for a real Task(momus) dispatch,
// AND the consumed-nonce record must bind to THIS artifact (path + sha256 + round). This closes
// the external-audit CRITICAL hole (2026-08-04): previously record-review checked only that
// _provenance.nonce was a non-empty string, so any file an agent placed under reviews/ minted OKAY.
// Now a forged file fails because it has no consumed_nonces entry; a reused/stale entry fails
// because path+sha+round must all match.
let artifactObj = null;
try { artifactObj = JSON.parse(readFileSync(momusAbs, "utf8")); }
catch { console.error("record-review.mjs: momus artifact is not valid JSON"); exit(6); }
const prov = artifactObj._provenance || {};
const prevRound = (prevState.review && prevState.review.round) || 0;
const computedRound = prevRound + 1;
const maxRounds = (prevState.review && prevState.review.max_rounds) || 3;
if (!prov.nonce) {
  console.error("record-review.mjs: artifact lacks _provenance.nonce — it was not produced by record-momus-artifact.mjs with a hook-issued nonce");
  exit(6);
}
if (prov.slug !== slug || prov.round !== computedRound) {
  console.error(`record-review.mjs: artifact provenance mismatch (slug=${prov.slug} round=${prov.round}, expected slug=${slug} round=${computedRound})`);
  exit(6);
}
if (String(artifactObj.verdict || "").toUpperCase() !== v) {
  console.error(`record-review.mjs: artifact verdict (${artifactObj.verdict}) contradicts argv verdict (${v})`);
  exit(6);
}
// SEC-1: the consumed-nonce binding. The nonce must exist in state.review.consumed_nonces AND
// bind to exactly this artifact (abs path match + on-disk sha256 match + round match). Re-hash
// the on-disk file (not the parsed object) so post-stamp tampering is detected.
const consumed = prevState.review && prevState.review.consumed_nonces && prevState.review.consumed_nonces[prov.nonce];
if (!consumed) {
  console.error("record-review.mjs: nonce was never consumed by record-momus-artifact.mjs — no matching entry in state.review.consumed_nonces. The OKAY verdict cannot be bound to this artifact.");
  exit(6);
}
let diskSha = "";
try { diskSha = createHash("sha256").update(readFileSync(momusAbs, "utf8")).digest("hex"); } catch {}
if (consumed.artifact !== momusAbs || consumed.sha256 !== diskSha || consumed.round !== computedRound) {
  console.error(`record-review.mjs: consumed-nonce binding mismatch. The artifact at ${momusAbs} (sha=${diskSha.slice(0,12)} round=${computedRound}) does not match what nonce ${prov.nonce} was consumed against (artifact=${consumed.artifact} sha=${(consumed.sha256||"").slice(0,12)} round=${consumed.round}). Possible tampering or stale/reused artifact.`);
  exit(6);
}

// (2) plan-sha binding: MANDATORY (W6-2 — was optional, trivially defeated by omission). Must
// equal the current sha256 of plan_path. Refuses OKAY if the plan changed since review.
if (!planShaArg) {
  console.error("record-review.mjs: --plan-sha <sha> is required (binds the verdict to the exact plan momus reviewed)");
  exit(6);
}
const planPath = prevState.plan_path || join(repoAbs, ".zcode", "plans", `${slug}.md`);
let actualSha = "";
try {
  const planBody = readFileSync(planPath, "utf8");
  actualSha = createHash("sha256").update(planBody).digest("hex");
} catch {}
if (actualSha !== planShaArg) {
  console.error(`record-review.mjs: plan-sha mismatch (plan changed since review). expected ${String(planShaArg).slice(0,12)}, got ${actualSha.slice(0,12)}`);
  exit(6);
}

// (2b) CRIT-3: acceptance-criteria lint MUST pass before OKAY. Run parse-plan.mjs --lint on the
// current plan and refuse OKAY if it reports problems (todos with no executable criteria, or
// "user manually verifies" slop). This closes the hole where momus's judgment call approves a
// plan phase 5 can't actually verify. REJECT is allowed without a clean lint (a REJECT is just
// "send back to the planner" — it doesn't need executable criteria to be valid).
if (v === "OKAY") {
  // v0.3.0 portability: resolve the sibling parse-plan.mjs relative to this script's own
  // location so it is found from the plugin cache install, not the legacy ~/.zcode path.
  const parseScript = fileURLToPath(new URL("./parse-plan.mjs", import.meta.url));
  let lintPassed = false;
  try {
    const out = execFileSync("node", [parseScript, planPath, "--lint"], { encoding: "utf8", shell: false });
    const res = JSON.parse(out);
    lintPassed = !!res.pass;
    if (!lintPassed) {
      console.error(`record-review.mjs: OKAY refused — plan failed acceptance-criteria lint:`);
      for (const p of res.problems || []) console.error(`    todo ${p.todo}: ${p.issue}`);
    }
  } catch (e) {
    // If the lint script can't run (path issue), fail closed: no OKAY without a verified lint.
    console.error(`record-review.mjs: could not run acceptance-criteria lint (${(e.message || "").slice(0,120)}); OKAY refused (fail-closed).`);
    exit(6);
  }
  if (!lintPassed) exit(6);
}

// (3) round was computed server-side above (computedRound). (4) OKAY refused if it exceeds max_rounds.
if (v === "OKAY" && computedRound > maxRounds) {
  console.error(`record-review.mjs: OKAY refused — round ${computedRound} exceeds max_rounds ${maxRounds}. The plan cannot pass review; surface to the user.`);
  exit(6);
}
const round = computedRound;

let blockers = [];
if (blockersFile) {
  try { blockers = JSON.parse(readFileSync(blockersFile, "utf8")); if (!Array.isArray(blockers)) blockers = []; }
  catch { blockers = []; }
}

const LOCK_STALE_MS = 60 * 1000;
const lockPath = statePath + ".lock";
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
function apply(st) {
  st.review = st.review && typeof st.review === "object" ? st.review : makeReviewDefault();
  st.review.round = round;
  st.review.verdict = v;
  st.review.momus_session = momusSession || st.review.momus_session || null;
  st.review.momus_artifact = momusArtifact;
  if (planShaArg) st.review.plan_sha256 = planShaArg;
  st.review.blockers = v === "REJECT" ? blockers : [];
  st.review.history = Array.isArray(st.review.history) ? st.review.history : [];
  st.review.history.push({ round, at: new Date().toISOString(), verdict: v, blockers: v === "REJECT" ? blockers : [] });
  // Moving to OKAY transitions the run into execute (the gate unlocks).
  if (v === "OKAY" && (st.phase === "review" || st.phase === "plan")) st.phase = "execute";
  st.updated_at = new Date().toISOString();
  return st;
}
const lockFd = acquireLock();
if (lockFd === null) {
  // fall back to direct write rather than lose the verdict
  try { writeFileSync(statePath, JSON.stringify(apply(JSON.parse(readFileSync(statePath, "utf8"))), null, 2) + "\n"); } catch {}
  exit(0);
}
let enteredExecute = false;
try {
  const parsed = JSON.parse(readFileSync(statePath, "utf8"));
  // apply() MUTATES its argument and returns the same object, so the prior phase has to be read
  // off before the call — comparing st.phase to parsed.phase afterwards compares a value to itself.
  const phaseBefore = parsed.phase;
  const st = apply(parsed);
  enteredExecute = st.phase === "execute" && phaseBefore !== "execute";
  const tmp = statePath + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
  renameSync(tmp, statePath);
} finally {
  try { closeSync(lockFd); unlinkSync(lockPath); } catch {}
}

// B8: take the pass-to-pass baseline HERE, because this is where a real run actually enters
// execute — line ~208 sets st.phase directly rather than going through set-phase.mjs. The
// baseline was wired only into set-phase, so in the real flow it was never taken and the gate
// silently degraded to "no-baseline": present, passing, measuring nothing. Found by
// pipeline-integration.test.mjs, which is the only thing that exercises these scripts in the
// order a run actually calls them.
//
// The snapshot is idempotent (regression-gate.mjs refuses to overwrite an existing baseline), so
// having both entry points call it is safe — a later set-phase re-entry cannot redefine "before"
// as "after". Best-effort: a repo whose suite will not run records `inert` rather than blocking.
if (enteredExecute) {
  try {
    execFileSync("node", [new URL("./regression-gate.mjs", import.meta.url).pathname, repo, slug, "--snapshot"],
      { stdio: "inherit", timeout: 15 * 60 * 1000 });
  } catch { /* baseline is best-effort; --check degrades to no-baseline and stays inert */ }
}
exit(0);
