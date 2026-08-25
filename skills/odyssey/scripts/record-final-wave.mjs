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
//   record-final-wave.mjs <repo> <slug> [--f2-artifact P --f2-nonce N] [--f3-checklist P] [--f4-artifact P --f4-nonce N] [--skip F1,F2,F3,F4,F5 --skip-reason "why"]
//   exit: 0 ok (all pass) · 2 bad args · 3 no state · 6 an F-item failed · 9 plan_path isolation violation
//
// Atomic write under O_EXCL lockfile with stale-lock reaping.

import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { matchesCapability } from "./lib/capability-name.mjs";
import { verdictFromProse } from "./lib/verdict-schema.mjs";
import { resolvePlanPath } from "./lib/plan-path.mjs";

const [repo, slug, ...rest] = argv.slice(2);
if (!repo || !slug) {
  console.error("usage: record-final-wave.mjs <repo> <slug> [--f2-artifact P --f2-nonce N] [--f3-checklist P] [--f4-artifact P --f4-nonce N] [--skip F1,F2,F3,F4,F5 --skip-reason <why>]");
  exit(2);
}
let f2Artifact, f2Nonce, f3Checklist, f4Artifact, f4Nonce, skipStr, skipReason, allowUntouched = false;
for (let i = 0; i < rest.length; i++) {
  const k = rest[i];
  if (k === "--f2-artifact") f2Artifact = rest[++i];
  else if (k === "--f2-nonce") f2Nonce = rest[++i];
  else if (k === "--f3-checklist") f3Checklist = rest[++i];
  else if (k === "--f4-nonce") f4Nonce = rest[++i];
  else if (k === "--f4-artifact") f4Artifact = rest[++i];
  else if (k === "--skip") skipStr = rest[++i];
  else if (k === "--skip-reason") skipReason = rest[++i];
  // SEC (audit M6): explicit waiver for declared-but-untouched files (e.g. a file listed for
  // context that legitimately needed no edit). Recorded in the F1 result for audit.
  else if (k === "--allow-untouched") allowUntouched = true;
}
const skip = new Set((skipStr || "").split(",").map((s) => s.trim()).filter(Boolean));

// AUDIT-3 FINDING 4: `--skip F2,F4,F5` was an ungated waiver that produced `all_pass: true` and
// `final.verdict: "pass"` — which is exactly what `set-phase done` requires. An executor could
// finish a run with no code review, no oracle and no routing check, never touching the nonce
// apparatus at all. That route is cheaper than forging a verdict.
//
// What is enforceable here, honestly: not authorization. Every script under scripts/ is invocable
// by any agent via the trusted-script allowlist, so no argv flag authenticates anyone. What CAN be
// enforced is that a waiver is never SILENT and never laundered into a clean pass:
//   · skipping a security item requires a stated reason;
//   · the waiver is recorded in state.final.waived, naming each item and its reason;
//   · `set-phase done` refuses on a waived F2/F4 unless separately acknowledged.
// Two explicit, separately-recorded actions instead of one flag.
// (audit H3+M2, 2026-08-25) F1 and F3 joined the set: a waived F1 was unreachable (dead flag,
// see the F1 block) and a waived F3 was silent — `--skip F3` passed with no reason and no
// state.final.waived entry, which set-phase done never sees. F1/F3/F5 waivers are recorded and
// reasoned but NOT done-blocking; only F2/F4 require --accept-waivers at done (set-phase.mjs
// filters on exactly those two).
const SECURITY_ITEMS = ["F1", "F2", "F3", "F4", "F5"];
const ITEM_LABELS = {
  F1: "the plan-compliance diff", F2: "code review", F3: "the manual-QA checklist",
  F4: "scope-fidelity review", F5: "the routing check",
};
const waivedItems = SECURITY_ITEMS.filter((i) => skip.has(i));
if (waivedItems.length && !skipReason) {
  console.error(
    `record-final-wave.mjs: --skip ${waivedItems.join(",")} requires --skip-reason "<why>". ` +
    `Skipping ${waivedItems.join("/")} waives ${waivedItems.map((i) => ITEM_LABELS[i]).join(", ")} ` +
    `— the reason is recorded in state.final.waived` +
    `${waivedItems.some((i) => i === "F2" || i === "F4") ? ", and a waived F2/F4 additionally requires --accept-waivers at set-phase done" : ""}. ` +
    `Re-run without --skip if the reviewers simply have not been dispatched yet.`
  );
  exit(2);
}
// Recorded in state.final so a resuming orchestrator (and any human reading the evidence) can see
// WHAT the reviewer said, not merely that one was summoned.
let f2Verdict = null, f4Verdict = null;

const repoAbs = (() => { try { return realpathSync(repo); } catch { return repo; } })();
const statePath = join(repoAbs, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) { console.error("no state file: " + statePath); exit(3); }
let st;
try { st = JSON.parse(readFileSync(statePath, "utf8")); } catch { console.error("cannot parse state"); exit(3); }

const results = { F1: null, F2: null, F3: null, F4: null, F5: null };

// ---------------------------------------------------------------------------
// classifyVerdict — read what the reviewer ACTUALLY SAID.
//
// Until 2026-08-11, F2 and F4 never opened the artifact. They confirmed the path was under
// .zcode/reviews/, that the file existed, and that the hook-minted nonce consumed — then set
// passed:true. An artifact reading {"verdict":"REJECT","blockers":["completely broken"]} passed
// both. The nonce proves a reviewer was DISPATCHED; it says nothing about the answer.
//
// Returns "approve" | "reject" | "missing". AMBIGUITY RESOLVES TO "missing", NEVER "approve":
// an artifact asserting both, or neither, is an artifact whose verdict we do not know, and an
// unknown verdict must not be able to close a gate. Same fail-closed posture the scope boundary
// already takes on an unreadable plan.
function classifyVerdict(text) {
  if (typeof text !== "string" || !text.trim()) return "missing";

  // Structured artifacts win: an explicit field beats prose that merely mentions the words.
  try {
    const obj = JSON.parse(text);
    const raw = obj && (obj.verdict ?? obj.overall ?? obj.status);
    if (typeof raw === "string") {
      const v = raw.trim().toUpperCase();
      if (/^(APPROVE|APPROVED|OKAY|OK|PASS|PASSED|ACCEPT|ACCEPTED)$/.test(v)) return "approve";
      if (/^(REJECT|REJECTED|FAIL|FAILED|BLOCK|BLOCKED)$/.test(v)) return "reject";
      return "missing"; // a verdict field we don't recognize is not an approval
    }
  } catch { /* not JSON — fall through to the prose scan */ }

  // Prose artifacts must carry an explicit `VERDICT: X` line. Deliberately NOT a bare keyword
  // search: "this would REJECT under the old rules" is discussion, not a verdict, and a reviewer
  // narrating its reasoning must never accidentally close the gate.
  //
  // T3-2: this parser now lives in lib/verdict-schema.mjs because record-momus-artifact needs the
  // identical rule (its prompt documents the same VERDICT: block). Two copies of a verdict parser
  // is exactly the drift this release exists to stop.
  return verdictFromProse(text);
}

// Test-file detection for the integrity guard. Conservative by design: a false positive here
// blocks a legitimate edit, so the patterns target unambiguous test-file conventions only.
const TEST_PATH = /(^|\/)(tests?|spec|__tests__)\/|(^|\/)test_[^/]+\.py$|[._-](test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb)$|Test[s]?\.(java|kt|cs)$/;
const isTestPath = (p) => TEST_PATH.test(p);

// Markers that silently neuter a test without deleting it.
const SKIP_MARKER = /\b(?:it|test|describe|context)\s*\.\s*(?:skip|todo|only)\b|\bx(?:it|describe)\s*\(|@(?:unittest\.)?skip\b|@pytest\.mark\.(?:skip|xfail)|\bt\.Skip\(|\[Ignore\]|\.only\s*\(/;

// --- F1: plan compliance via set difference (machine-checked) ---
// declared = plan's Files: union; actual = git diff --name-only run_start_sha..HEAD (or HEAD).
// F1 passes iff actual ⊆ declared (no out-of-scope files touched). Generated artifacts and
// .zcode/ paths are excluded from actual.
// I3 (audit 2026-08-20): F1 must never harvest scope from another repo's plan — refuse with
// the named reason before a single plan byte is read.
const { planPath, violation } = resolvePlanPath(st, repoAbs);
if (violation) { console.error(`record-final-wave.mjs: ${violation} (state: ${statePath})`); exit(9); }
// (audit H3, 2026-08-25) --skip F1 was a DEAD FLAG: the skip set was parsed but the F1 block had
// no skip branch, so a non-git run failed closed (SEC-H1, correct) and then wedged PERMANENTLY —
// while F1's own error message told the operator to use the flag that did nothing. The skip now
// exists and is a SECURITY_ITEM: it requires --skip-reason and is recorded in state.final.waived.
// It stays non-done-blocking in set-phase (only F2/F4 waivers require --accept-waivers) — F1 has
// its own machine check when not skipped.
if (skip.has("F1")) {
  results.F1 = { passed: true, skipped: true };
} else
try {
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
    // INHERITED DIRTY STATE: files already modified/untracked when the run started are not this
    // run's doing. scaffold.mjs records them in state.dirty_at_start.
    //
    // Subtracted ONLY from the scope-violation calculation, deliberately. They stay in `actual`,
    // so `declared_untouched`, the empty-diff check, and the test-integrity scan all keep their
    // current meaning — a run cannot hide a deleted test by having left it dirty beforehand. The
    // single thing this changes is that inherited mess can no longer be reported as scope creep.
    //
    // Round 2 could not reach `done` because of this: a stale uncommitted pair from the previous
    // run failed F1, and every sanctioned way to clean it was blocked by the scope gate, because
    // those files were (correctly) out of scope. The gate and F1 between them made the run
    // unfinishable through any legitimate path.
    const inheritedDirty = new Set(Array.isArray(st.dirty_at_start) ? st.dirty_at_start : []);
    const outOfScope = [...actual].filter((p) => !declared.has(p) && !inheritedDirty.has(p));
    const ignoredInherited = [...actual].filter((p) => !declared.has(p) && inheritedDirty.has(p));

    // B4 — THE CONVERSE. F1 only ever computed `actual \ declared` (scope creep). It never asked
    // whether the declared work HAPPENED. With an empty diff, `actual` is empty, so `outOfScope`
    // is empty, so F1 passed — the vacuous pass this file's own SEC-H1 comment above concedes.
    // Combined with --skip F2,F4 that was a clean path to `done` having changed nothing at all.
    const untouched = [...declared].filter((p) => !actual.has(p));
    // ORCH-1: `--allow-untouched` waived SOME declared files being untouched but never ALL of
    // them, so a run whose diff is legitimately empty — an audit or review that produces a report
    // and changes no declared file — had no way to reach `done` at all. That asymmetry is
    // arbitrary: didNothing is just the degenerate case of untouched. The guard exists to stop a
    // SILENT vacuous pass, and an explicit operator waiver is not silent; it is recorded in the
    // artifact below either way.
    const didNothing = declared.size > 0 && actual.size === 0 && !allowUntouched;
    const didNothingWaived = declared.size > 0 && actual.size === 0 && allowUntouched;

    // B3 — TEST-INTEGRITY GUARD. Nothing in the ecosystem implements this (verified against omo,
    // prime-agent, spec-kit, SWE-agent, Cline/Roo, claude-flow). It matters because the cheapest
    // way to make a failing acceptance criterion pass is to weaken the test — and a test file
    // listed in the plan's Files: is IN SCOPE, so F1 waves it through while `npm test` goes green
    // against a suite that no longer checks anything. Measured exploitation rates for exactly this
    // behaviour: 76% (GPT-5) / 46% (Claude Opus 4.1) on ImpossibleBench.
    const testIntegrity = { deleted: [], weakened: [], skip_markers: [] };
    if (!f1Err) {
      try {
        const deletedRaw = execFileSync("git", ["-C", repoAbs, "diff", "--diff-filter=D", "--name-only", startSha],
          { encoding: "utf8", shell: false });
        for (let p of deletedRaw.split("\n")) { p = p.trim(); if (p && isTestPath(p)) testIntegrity.deleted.push(p); }

        // --numstat gives "<added>\t<deleted>\t<path>"; a net-negative test file lost assertions.
        const numstatRaw = execFileSync("git", ["-C", repoAbs, "diff", "--numstat", startSha],
          { encoding: "utf8", shell: false, maxBuffer: 20 * 1024 * 1024 });
        for (const line of numstatRaw.split("\n")) {
          const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
          if (!m) continue;
          const [, addS, delS, path] = m;
          if (addS === "-" || delS === "-") continue; // binary
          if (!isTestPath(path)) continue;
          const net = parseInt(addS, 10) - parseInt(delS, 10);
          if (net < 0) testIntegrity.weakened.push({ file: path, net });
        }

        // Added lines that disable a test without removing it.
        const patchRaw = execFileSync("git", ["-C", repoAbs, "diff", "-U0", startSha],
          { encoding: "utf8", shell: false, maxBuffer: 20 * 1024 * 1024 });
        let cur = null;
        for (const line of patchRaw.split("\n")) {
          const fm = line.match(/^\+\+\+ b\/(.+)$/);
          if (fm) { cur = fm[1]; continue; }
          if (!cur || !isTestPath(cur)) continue;
          if (line.startsWith("+") && !line.startsWith("+++") && SKIP_MARKER.test(line)) {
            testIntegrity.skip_markers.push({ file: cur, line: line.slice(1).trim().slice(0, 120) });
          }
        }
      } catch (e) {
        // Fail closed: an unverifiable test suite is not a passing one.
        testIntegrity.error = (e && (e.stderr || e.message) || String(e)).toString().slice(0, 160);
      }
    }
    const testsIntact = !testIntegrity.error && testIntegrity.deleted.length === 0 &&
      testIntegrity.weakened.length === 0 && testIntegrity.skip_markers.length === 0;

    // SEC (audit M6): partial completion is not completion. F1 computed `untouched` but never
    // gated on it, so declaring Files:[A,B,C] and touching only A reached `done` with B,C never
    // written. Require every declared file to be touched — unless the operator waives specific
    // context-only files with --allow-untouched (recorded here for audit).
    const untouchedBlocks = untouched.length > 0 && !allowUntouched;
    results.F1 = {
      passed: outOfScope.length === 0 && !didNothing && testsIntact && !untouchedBlocks,
      declared: [...declared],
      actual: [...actual],
      out_of_scope: outOfScope,
      ...(ignoredInherited.length ? { inherited_dirty_ignored: ignoredInherited } : {}),
      declared_untouched: untouched,
      ...(untouched.length && allowUntouched ? { untouched_waived: true } : {}),
      test_integrity: testIntegrity,
      ...(didNothing ? { error: "F1: the plan declares files but the diff is EMPTY — nothing was done. This is the vacuous pass; it is not a completed run. If the run is legitimately read-only (an audit or review that changes no declared file), pass --allow-untouched to waive this explicitly." } : {}),
      ...(didNothingWaived ? { empty_diff_waived: true } : {}),
      ...(untouchedBlocks ? { untouched_error: `F1: ${untouched.length} declared file(s) were never touched: ${untouched.slice(0, 8).join(", ")}. The plan's work is incomplete. Finish them, remove them from the plan's Files:, or pass --allow-untouched if they were context-only.` } : {}),
      ...(testsIntact ? {} : { test_integrity_error: testIntegrity.error
        ? "F1: test-integrity check could not run: " + testIntegrity.error
        : "F1: tests were weakened — " +
          [testIntegrity.deleted.length && `${testIntegrity.deleted.length} test file(s) DELETED`,
           testIntegrity.weakened.length && `${testIntegrity.weakened.length} test file(s) net-negative`,
           testIntegrity.skip_markers.length && `${testIntegrity.skip_markers.length} skip/only marker(s) added`,
          ].filter(Boolean).join(", ") + ". Restore them, or justify in the plan and re-review." }),
    };
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
      return { ok: false, reason: "nonce mismatch — the hook mints state." + field + ".pending_nonce only when it observes a real Task(" + (field === "final_f2" ? "code-reviewer" : "oracle") + ") dispatch in phase=final. Dispatching a different reviewer (momus, say) mints nothing, which is the usual cause of this. Dispatch " + (field === "final_f2" ? "code-reviewer for F2" : "oracle for F4") + ", then pass the nonce it mints." };
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

// NONCE ECONOMY (2026-08-12, from the first end-to-end shakedown run): F2/F4 nonces are ONE-TIME.
// consumeFinalNonce burns them the moment it validates an artifact — even when F1 has already
// failed and the run cannot pass regardless. The observed cost: a run whose F1 tripped on stray
// untracked files (an MCP tool's session state) burned both nonces, so fixing the trivial F1
// problem then required RE-DISPATCHING both reviewers purely to mint replacements.
//
// The nonces exist to prove a reviewer was dispatched. Spending them on a call that cannot
// possibly reach `pass` proves nothing and costs two agent dispatches. So when F1 has already
// failed, F2/F4 are reported as not-evaluated and their nonces are left intact for the retry.
//
// Deliberately NOT a weakening: nothing becomes passable that was not before. `allPass` requires
// every item to be `passed`, and `not_evaluated` is not `passed`, so this call still fails — it
// just fails without setting fire to the evidence chain on the way out.
const f1AlreadyFailed = results.F1 && results.F1.passed === false;
if (f1AlreadyFailed) {
  for (const [k, need] of [["F2", !skip.has("F2")], ["F4", !skip.has("F4")]]) {
    if (need) {
      results[k] = {
        passed: false,
        not_evaluated: true,
        reason: `${k} not evaluated — F1 failed first, so the ${k} nonce was left unconsumed for the retry. Fix F1 and re-run; the same artifact and nonce remain valid.`,
      };
    }
  }
}

// --- F2: code-quality review artifact + nonce (skip if not required, e.g. no code changed) ---
if (f1AlreadyFailed && !skip.has("F2")) {
  // already recorded as not_evaluated above
} else if (skip.has("F2")) {
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
      if (!c.ok) reason = "F2 " + c.reason;
      else {
        // B1: the nonce proves the reviewer was dispatched. Now read what it SAID.
        let verdict = "missing";
        try { verdict = classifyVerdict(readFileSync(abs, "utf8")); } catch { verdict = "missing"; }
        if (verdict === "approve") ok = true;
        else reason = verdict === "reject"
          ? "F2 review REJECTED the code (artifact verdict: REJECT). Fix the findings and re-review."
          : "F2 artifact has no unambiguous verdict. It must be JSON with a \"verdict\" field, or contain a line `VERDICT: APPROVE` / `VERDICT: REJECT`. Ambiguous or absent verdicts fail closed.";
        f2Verdict = verdict;
      }
    } else if (abs) reason = "F2 artifact must live under .zcode/reviews/";
  }
  results.F2 = { passed: ok, reason: ok ? null : reason, artifact: f2Artifact, verdict: f2Verdict };
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
if (f1AlreadyFailed && !skip.has("F4")) {
  // already recorded as not_evaluated above — nonce left intact for the retry
} else if (skip.has("F4")) {
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
      if (!c.ok) reason = "F4 " + c.reason;
      else {
        let verdict = "missing";
        try { verdict = classifyVerdict(readFileSync(abs, "utf8")); } catch { verdict = "missing"; }
        if (verdict === "approve") ok = true;
        else reason = verdict === "reject"
          ? "F4 scope-fidelity review REJECTED (artifact verdict: REJECT). The change does not match the plan's declared scope."
          : "F4 artifact has no unambiguous verdict. It must be JSON with a \"verdict\" field, or contain a line `VERDICT: APPROVE` / `VERDICT: REJECT`. Ambiguous or absent verdicts fail closed.";
        f4Verdict = verdict;
      }
    } else if (abs) reason = "F4 artifact must live under .zcode/reviews/";
  }
  results.F4 = { passed: ok, reason: ok ? null : reason, artifact: f4Artifact, verdict: f4Verdict };
}

// --- F5 (v0.4.0 routing-default gate): behavioral cross-check of the routing declaration ---
// The plan's `## Capability routing` tri-state (presence-gated at review by parse-plan --lint)
// is cross-checked here against state.capabilities[] — the hook-witnessed log of real Skill /
// mcp__* invocations (pre-tool.mjs records {capability, phase, observed:true} for each). This is
// what closes the false-compliance hole: a plan can DECLARE `routed: skill:aws-serverless`, but
// unless the conductor actually loaded it in the parent thread (sub-agents can't — trust anchor),
// there is no observed entry and F5 fails. Rules:
//   routed: skill:<name>   ⇒ observed `skill:<name>` entry required
//   routed: mcp:<server>   ⇒ observed `mcp__<server>`-prefixed entry required (records keep the
//                            full tool name, e.g. mcp__codegraph__explore)
//   routed: agent:<name>   ⇒ observed `agent:<name>` dispatch required (post-tool.mjs records each
//                            Task dispatch on completion; the `zodyssey:` prefix is normalized) — M4
//   discovered: <anything> ⇒ observed `skill:find-skills` entry required (discovery was attempted)
//   generic:   <reason>    ⇒ observed `skill:find-skills` entry required (generic is valid only
//                            AFTER discovery; the review lint already required the token, this
//                            requires the attempt)
// Known residual (Phase B): this proves the find-skills SKILL was loaded, not that the actual
// `npx skills find` search ran — that needs pre-tool.mjs Bash-branch recording (tracked follow-up).
if (skip.has("F5")) {
  results.F5 = { passed: true, skipped: true };
} else {
  const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
  // SEC (audit M5): an observation from BEFORE the plan existed cannot be honoring the plan's
  // routing declaration. The relevant boundary is the run's own lifecycle: a run is scaffolded at
  // `plan`, and `consult` (Metis's premortem, where the tri-state is DECIDED) precedes it — so a
  // routed capability loaded at consult predates the declaration it would satisfy.
  //   NOTE: `prime`/`triage` are NOT state phases (set-phase's VALID set has neither), so filtering
  //   on those names is a no-op — `consult` is the only real pre-plan phase. This was caught by
  //   post-remediation verification; the first attempt filtered the non-existent names.
  // Discovery is the deliberate exception: `find-skills` legitimately runs during consult, so the
  // `discovered:` / `generic:` branches accept the full observation set.
  const PRE_PLAN_PHASES = new Set(["consult"]);
  const observedAll = (Array.isArray(st.capabilities) ? st.capabilities : [])
    .filter((c) => c && c.observed === true && typeof c.capability === "string");
  const observedPostPlan = observedAll.filter((c) => !PRE_PLAN_PHASES.has(c.phase));
  const hasObserved = (pred, pool = observedPostPlan) => pool.some((c) => pred(norm(c.capability)));
  // Re-read the plan and parse the routing token (same grammar as parse-plan.mjs).
  let routing = null;
  // I3: the routing token must come from THIS run's plan — a foreign plan_path is a hard
  // refusal, not a "no valid routing declaration" F5 failure (which would misreport the cause).
  const { planPath: f5PlanPath, violation: f5Violation } = resolvePlanPath(st, repoAbs);
  if (f5Violation) { console.error(`record-final-wave.mjs: ${f5Violation} (state: ${statePath})`); exit(9); }
  try {
    const planTextF5 = readFileSync(f5PlanPath, "utf8")
      .replace(/<!--[\s\S]*?-->/g, "");
    const sec = (() => {
      const start = planTextF5.search(/^## Capability routing\s*$/m);
      if (start === -1) return "";
      const after = planTextF5.slice(start + planTextF5.slice(start).indexOf("\n") + 1);
      const next = after.search(/^## /m);
      return (next === -1 ? after : after.slice(0, next)).trim();
    })();
    for (const ln of sec.split("\n")) {
      const m = ln.match(/^\s*[-*]?\s*`?(routed|discovered|generic)`?\s*:\s*(.+?)\s*$/i);
      if (!m) continue;
      const value = m[2].replace(/`/g, "").trim();
      if (!value || value.startsWith("<") || /choose one/i.test(value)) continue;
      routing = { token: m[1].toLowerCase(), value };
      break;
    }
  } catch { routing = null; }

  if (!routing) {
    results.F5 = { passed: false, reason: "F5 routing: the plan has no valid `## Capability routing` tri-state declaration (missing section or placeholder-only). The review lint should have caught this; re-declare the routing decision and re-review." };
  } else if (routing.token === "routed" && norm(routing.value).startsWith("agent:")) {
    // M4: agent routing is behaviorally verified — post-tool records `agent:<subagent_type>` when a
    // Task dispatch completes. Class C fix (audit 2026-08-14): this branch stripped ONLY
    // `agent:zodyssey:`, so a declared `agent:code-reviewer` never matched the observed
    // `agent:feature-dev:code-reviewer`. matchesCapability is segment-tolerant for any namespace.
    const need = routing.value;
    const ok = hasObserved((c) => matchesCapability(need, c));
    results.F5 = ok
      ? { passed: true, reason: null, routing, evidence: `observed dispatch of ${routing.value} in state.capabilities[]` }
      : { passed: false, reason: `F5 routing: declaration says \`routed: ${routing.value}\` but there is NO observed dispatch of \`${routing.value}\` in state.capabilities[]. post-tool records every Task dispatch — if that agent was never dispatched, the routing was declared but not honored. Dispatch it (or re-declare honestly) and re-run the final wave.`, routing };
  } else {
    const val = norm(routing.value);
    // Class C fix (audit 2026-08-14): all three of these matched by raw string equality, and all
    // three were wrong for real installs.
    //   skill:     `skill:test-driven-development` (what capabilities.md lists and plans declare)
    //              never matched the observed `skill:superpowers:test-driven-development`. 34 of
    //              the installed skills are plugin-namespaced — this is the live F5 failure.
    //   mcp:       tolerated a tool-name SUFFIX but not a plugin PREFIX, so `mcp:socraticode`
    //              missed `mcp__plugin_socraticode_socraticode__codebase_search`.
    //   discovery: hard-coded the literal `skill:find-skills` and DISCARDED the declared value, so
    //              on a host where find-skills is namespaced the branch was UNSATISFIABLE — worse
    //              than the skill branch, because no per-plan workaround existed at all.
    // matchesCapability handles all three uniformly: exact wins, else final-segment match.
    const isDiscovery = routing.token !== "routed";
    const need = isDiscovery ? "skill:find-skills" : routing.value;
    // M5: a routed capability must be observed at/after the plan exists (post-plan pool); discovery
    // legitimately happens during consult, so discovered:/generic: search the full pool.
    const ok = hasObserved(
      (c) => matchesCapability(need, c),
      isDiscovery ? observedAll : observedPostPlan,
    );
    results.F5 = ok
      ? { passed: true, reason: null, routing, evidence: `observed ${need} in state.capabilities[]` }
      : { passed: false, reason: `F5 routing: declaration says \`${routing.token}: ${routing.value}\` but there is NO observed \`${need}\` entry in state.capabilities[]. The hook records every Skill/mcp__* call made in the parent thread — if the routed capability was never loaded there, the routing was declared but not honored. Load \`${need}\` (or re-declare honestly) and re-run the final wave.`, routing };
  }
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
  s.final = { verdict: allPass ? "pass" : "fail", at: now, results, artifact: fwArtifact,
    ...(waivedItems.length ? { waived: waivedItems, waived_reason: skipReason } : {}) };
  s.updated_at = now;
  return s;
}
const lockFd = acquireLock();
if (lockFd === null) {
  // T2-1: was a non-atomic unlocked write that silently clobbered the lock holder. Refuse instead.
  console.error("record-final-wave.mjs: could not acquire the state lock (real contention or a stuck lock). Refusing to write non-atomically — nothing was written. The final-wave verdict was NOT recorded.");
  exit(6);
} else {
  try { const s = apply(JSON.parse(readFileSync(statePath, "utf8"))); const t = statePath + ".tmp." + process.pid; writeFileSync(t, JSON.stringify(s, null, 2) + "\n"); renameSync(t, statePath); }
  finally { try { closeSync(lockFd); unlinkSync(lockPath); } catch {} }
}

console.log(JSON.stringify({ all_pass: allPass, results }, null, 2));
exit(allPass ? 0 : 6);
