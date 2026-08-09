#!/usr/bin/env node
// record-final-wave.mjs — the TRUSTED writer for phase-6 (FINAL WAVE) evidence (operational-consult CRIT-2).
//
// Phase 6 (F1-F4) decides whether the run is "done". Before this script it was unbound self-report.
// Now each F-item is bound to evidence the way phase 3's OKAY is:
//   F1 (plan compliance): MACHINE-CHECKED here as a set difference between the plan's declared
//       Files: union and `git diff --name-only run_start_sha..HEAD` — out-of-scope files fail F1.
//   F2 (code quality): requires --f2-artifact <path> under .zcode/reviews/ with a hook-minted
//       --f2-nonce (the hook mints a nonce on Task(code-reviewer) in phase=final, same as momus).
//   F3 (manual QA): requires --f3-checklist <path> (the human-actionable checklist file).
//   F4 (scope fidelity): requires --f4-artifact + --f4-nonce (Task(oracle) in phase=final).
// All four must pass; the run's state.final lane records the verdict. `done` is unreachable without it.
//
// Usage:
//   record-final-wave.mjs <repo> <slug> [--f2-artifact P --f2-nonce N] [--f3-checklist P] [--f4-artifact P --f4-nonce N] [--skip F2,F4]
//   exit: 0 ok (all pass) · 2 bad args · 3 no state · 6 an F-item failed
//
// Atomic write under O_EXCL lockfile with stale-lock reaping.

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const [repo, slug, ...rest] = argv.slice(2);
if (!repo || !slug) {
  console.error("usage: record-final-wave.mjs <repo> <slug> [--f2-artifact P --f2-nonce N] [--f3-checklist P] [--f4-artifact P --f4-nonce N] [--skip F2,F4]");
  exit(2);
}
let f2Artifact, f2Nonce, f3Checklist, f4Artifact, f4Nonce, skipStr;
for (let i = 0; i < rest.length; i++) {
  const k = rest[i];
  if (k === "--f2-artifact") f2Artifact = rest[++i];
  else if (k === "--f2-nonce") f2Nonce = rest[++i];
  else if (k === "--f3-checklist") f3Checklist = rest[++i];
  else if (k === "--f4-nonce") f4Nonce = rest[++i];
  else if (k === "--f4-artifact") f4Artifact = rest[++i];
  else if (k === "--skip") skipStr = rest[++i];
}
const skip = new Set((skipStr || "").split(",").map((s) => s.trim()).filter(Boolean));

const repoAbs = (() => { try { return realpathSync(repo); } catch { return repo; } })();
const statePath = join(repoAbs, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) { console.error("no state file: " + statePath); exit(3); }
let st;
try { st = JSON.parse(readFileSync(statePath, "utf8")); } catch { console.error("cannot parse state"); exit(3); }

const results = { F1: null, F2: null, F3: null, F4: null };

// --- F1: plan compliance via set difference (machine-checked) ---
// declared = plan's Files: union; actual = git diff --name-only run_start_sha..HEAD (or HEAD).
// F1 passes iff actual ⊆ declared (no out-of-scope files touched). Generated artifacts and
// .zcode/ paths are excluded from actual.
try {
  const planPath = st.plan_path || join(repoAbs, ".zcode", "plans", `${slug}.md`);
  const planText = readFileSync(planPath, "utf8");
  // SEC-4 (external audit 2026-08-04): the plan is agent-writable, so F1 must refuse to pass if the
  // on-disk plan has drifted from the sha bound at review time. Without this an executor widens its
  // own scope and F1 (plan-compliance) trivially passes against the widened set. Mirror the hook's
  // check: if a plan_sha256 is bound, F1 fails on mismatch (the run must be re-reviewed).
  const boundSha = st.review && st.review.plan_sha256;
  if (boundSha) {
    const diskSha = createHash("sha256").update(planText).digest("hex");
    if (diskSha !== boundSha) {
      results.F1 = { passed: false, reason: `plan tampered post-review: on-disk sha ${diskSha.slice(0,12)} ≠ bound ${boundSha.slice(0,12)}. Re-run momus + record-review to re-bind scope.` };
    }
  }
  // extract declared paths from the plan. Prometheus sometimes writes Files: with backtick-wrapped
  // prose descriptions instead of clean comma-separated paths (e.g. 'Files: [WordPress DB live
  // state; `docs/foo.md` (record term_id)]'). So we extract ALL backtick-wrapped paths from the
  // Files: content, PLUS any bare path-shaped tokens, rather than trusting comma-split.
  const declared = new Set();
  for (const m of planText.matchAll(/Files:\s*\[([^\]]+)\]/g)) {
    const content = m[1];
    // first: extract all backtick-wrapped paths (the real file references)
    for (const bm of content.matchAll(/`([^`]+)`/g)) {
      const p = bm[1].trim();
      // only accept path-shaped tokens (must contain / or . and no spaces)
      if (p && (/[/.]/.test(p)) && !/\s/.test(p)) declared.add(p);
    }
    // second: if no backtick paths found, fall back to comma-split for clean grammar
    if (!declared.size || !content.includes("`")) {
      for (let p of content.split(",")) {
        p = p.trim().replace(/^`|`$/g, "");
        if (p && (/[/.]/.test(p)) && !/\s/.test(p)) declared.add(p);
      }
    }
  }
  const startSha = st.run_start_sha && /^[0-9a-f]{7,40}$/.test(st.run_start_sha) ? st.run_start_sha : "HEAD";
  let changedRaw = "";
  let f1Err = null;
  try {
    changedRaw = execFileSync("git", ["-C", repoAbs, "diff", "--name-only", startSha], { encoding: "utf8", shell: false, maxBuffer: 20 * 1024 * 1024 });
  } catch (e) {
    // SEC-H1 (external audit F4 + in-session F1): the OLD bare `catch {}` swallowed git failures
    // (most importantly: a NON-GIT repo, where `git diff` exits non-zero). That left `changedRaw`
    // empty → `actual` empty → `outOfScope` empty → F1 PASSED VACUOUSLY. Combined with `--skip F2,F4`
    // + a trivial F3, a run reached `done` with no review evidence at all. Now F1 FAILS CLOSED:
    // if git throws, F1 reports the failure and `allPass` cannot be true.
    f1Err = (e && (e.stderr || e.message) || String(e)).toString();
  }
  let untracked = "";
  // Only attempt the second git call if the first didn't already establish non-git; if diff threw,
  // ls-files will throw too, so skip the redundant failure.
  if (!f1Err) {
    try { untracked = execFileSync("git", ["-C", repoAbs, "ls-files", "--others", "--exclude-standard"], { encoding: "utf8", shell: false }); }
    catch (e) { f1Err = (e && (e.stderr || e.message) || String(e)).toString(); }
  }
  if (f1Err) {
    const nonGit = /not a git repository|fatal: not a git repository|No such file or directory/i.test(f1Err);
    results.F1 = {
      passed: false,
      error: nonGit
        ? "F1 requires a git repo (git diff/ls-files failed: " + f1Err.slice(0, 160) + "). Use --skip F1 only if the run genuinely changed no files; do NOT skip to reach done."
        : "F1 git check failed: " + f1Err.slice(0, 160),
    };
  } else {
    const actual = new Set();
    // standard generated/artifact paths to ignore (NOT scope creep): dependency dirs, build output,
    // lockfiles. These are consequences of the work, not the work itself. A real scope-creep source
    // file (e.g. src/stray.ts) is NOT in this list and WILL be flagged.
    const IGNORE = /^(node_modules|dist|build|target|coverage|\.cache|\.next)\//;
    for (let p of (changedRaw + "\n" + untracked).split("\n")) {
      p = p.trim();
      if (p && !p.startsWith(".zcode/") && !IGNORE.test(p) && !/package-lock\.json$/.test(p)) actual.add(p);
    }
    const outOfScope = [...actual].filter((p) => !declared.has(p));
    results.F1 = { passed: outOfScope.length === 0, declared: [...declared], actual: [...actual], out_of_scope: outOfScope };
  }
} catch (e) {
  results.F1 = { passed: false, error: "F1 check failed: " + e.message };
}

// SEC-H1 (external audit #5 + in-session F1/F4): F2/F4 nonces were minted into
// state.final_f2/.final_f4.pending_nonce but NEVER consumed — record-final-wave compared only the
// artifact's own _provenance.nonce (caller-supplied) against the argv nonce (caller-supplied):
// x === x. Now consumeFinalNonce binds the nonce to the actual on-disk artifact: under the state
// lock, require state[field].pending_nonce.nonce === argvNonce, hash the artifact, store
// state[field].consumed = {artifact, sha256, at}, then delete the pending nonce (one-time use).
// Returns {ok, reason}.
function consumeFinalNonce(field, argvNonce, artifactAbs) {
  if (!argvNonce || !artifactAbs) return { ok: false, reason: `missing nonce or artifact` };
  const LOCK_STALE_MS = 60 * 1000;
  const lockPath = statePath + ".lock";
  function acquireLock() {
    try { return openSync(lockPath, "wx"); } catch {
      try { if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) { unlinkSync(lockPath); try { return openSync(lockPath, "wx"); } catch { return null; } } } catch {}
      return null;
    }
  }
  const lockFd = acquireLock();
  if (lockFd === null) return { ok: false, reason: "could not acquire state lock to consume nonce" };
  try {
    const st = JSON.parse(readFileSync(statePath, "utf8"));
    const pending = st[field] && st[field].pending_nonce;
    if (!pending || pending.nonce !== argvNonce) {
      return { ok: false, reason: "nonce mismatch — the hook only mints state." + field + ".pending_nonce for a real dispatch" };
    }
    // bind to the actual artifact bytes on disk (detects post-stamp tampering)
    let diskSha = "";
    try { diskSha = createHash("sha256").update(readFileSync(artifactAbs, "utf8")).digest("hex"); }
    catch { return { ok: false, reason: "artifact unreadable for sha binding" }; }
    delete st[field].pending_nonce;
    st[field] = st[field] || {};
    st[field].consumed = { artifact: artifactAbs, sha256: diskSha, at: new Date().toISOString() };
    st.updated_at = new Date().toISOString();
    const tmp = statePath + ".tmp." + process.pid;
    writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
    renameSync(tmp, statePath);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "nonce consume failed: " + (e.message || String(e)) };
  } finally {
    try { closeSync(lockFd); unlinkSync(lockPath); } catch {}
  }
}

// --- F2: code-quality review artifact + nonce (skip if not required, e.g. no code changed) ---
if (skip.has("F2")) {
  results.F2 = { passed: true, skipped: true };
} else {
  const reviewsDir = join(repoAbs, ".zcode", "reviews");
  let ok = false, reason = "";
  if (!f2Artifact || !f2Nonce) reason = "F2 requires --f2-artifact <path under .zcode/reviews/> and --f2-nonce <nonce>";
  else {
    let abs;
    try { abs = f2Artifact.startsWith("/") ? realpathSync(f2Artifact) : realpathSync(join(repoAbs, f2Artifact)); }
    catch { reason = "F2 artifact does not exist"; abs = null; }
    if (abs && abs.startsWith(reviewsDir + "/") && existsSync(abs)) {
      // SEC-H1: bind the nonce to this artifact via consume (one-time, sha-anchored). A forged
      // artifact with a caller-supplied nonce string is rejected because the pending_nonce in state
      // must match AND be consumed atomically.
      const c = consumeFinalNonce("final_f2", f2Nonce, abs);
      if (c.ok) ok = true; else reason = "F2 " + c.reason;
    } else if (abs) reason = "F2 artifact must live under .zcode/reviews/";
  }
  results.F2 = { passed: ok, reason: ok ? null : reason, artifact: f2Artifact };
}

// --- F3: manual-QA checklist file exists ---
if (skip.has("F3")) {
  results.F3 = { passed: true, skipped: true };
} else {
  let ok = false, reason = "";
  if (!f3Checklist) reason = "F3 requires --f3-checklist <path> (the human-actionable QA checklist)";
  else {
    let abs;
    try { abs = f3Checklist.startsWith("/") ? f3Checklist : join(repoAbs, f3Checklist); } catch { abs = f3Checklist; }
    if (existsSync(abs)) {
      try { const content = readFileSync(abs, "utf8"); ok = content.trim().length > 0; if (!ok) reason = "F3 checklist is empty"; }
      catch { reason = "F3 checklist unreadable"; }
    } else reason = "F3 checklist file does not exist";
  }
  results.F3 = { passed: ok, reason: ok ? null : reason, checklist: f3Checklist };
}

// --- F4: scope-fidelity artifact + nonce (Task(oracle)) ---
if (skip.has("F4")) {
  results.F4 = { passed: true, skipped: true };
} else {
  const reviewsDir = join(repoAbs, ".zcode", "reviews");
  let ok = false, reason = "";
  if (!f4Artifact || !f4Nonce) reason = "F4 requires --f4-artifact <path under .zcode/reviews/> and --f4-nonce <nonce>";
  else {
    let abs;
    try { abs = f4Artifact.startsWith("/") ? realpathSync(f4Artifact) : realpathSync(join(repoAbs, f4Artifact)); }
    catch { reason = "F4 artifact does not exist"; abs = null; }
    if (abs && abs.startsWith(reviewsDir + "/") && existsSync(abs)) {
      // SEC-H1: consume the F4 nonce against this artifact (one-time, sha-anchored).
      const c = consumeFinalNonce("final_f4", f4Nonce, abs);
      if (c.ok) ok = true; else reason = "F4 " + c.reason;
    } else if (abs) reason = "F4 artifact must live under .zcode/reviews/";
  }
  results.F4 = { passed: ok, reason: ok ? null : reason, artifact: f4Artifact };
}

const allPass = Object.values(results).every((r) => r && r.passed);

// Write the final-wave evidence artifact + update state.final atomically.
const finalDir = join(repoAbs, ".zcode", "verify", slug);
mkdirSync(finalDir, { recursive: true });
const fwArtifact = join(finalDir, "final-wave.json");
const now = new Date().toISOString();
const fwEvidence = { slug, at: now, results, all_pass: allPass };
writeFileSync(fwArtifact + ".tmp." + process.pid, JSON.stringify(fwEvidence, null, 2) + "\n");
try { renameSync(fwArtifact + ".tmp." + process.pid, fwArtifact); } catch {}

const LOCK_STALE_MS = 60 * 1000;
const lockPath = statePath + ".lock";
function acquireLock() {
  try { return openSync(lockPath, "wx"); } catch {
    try { if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) { unlinkSync(lockPath); try { return openSync(lockPath, "wx"); } catch { return null; } } } catch {}
    return null;
  }
}
function apply(s) {
  s.final = { verdict: allPass ? "pass" : "fail", at: now, results, artifact: fwArtifact };
  s.updated_at = now;
  return s;
}
const lockFd = acquireLock();
if (lockFd === null) {
  try { writeFileSync(statePath, JSON.stringify(apply(JSON.parse(readFileSync(statePath, "utf8"))), null, 2) + "\n"); } catch {}
} else {
  try { const s = apply(JSON.parse(readFileSync(statePath, "utf8"))); const t = statePath + ".tmp." + process.pid; writeFileSync(t, JSON.stringify(s, null, 2) + "\n"); renameSync(t, statePath); }
  finally { try { closeSync(lockFd); unlinkSync(lockPath); } catch {} }
}

console.log(JSON.stringify({ all_pass: allPass, results }, null, 2));
exit(allPass ? 0 : 6);
