#!/usr/bin/env node
// set-phase.mjs — the TRUSTED writer for state.phase (audit re-audit gap G1).
//
// Companion to record-review.mjs. The orchestrator calls this to transition phases
// (plan→review→execute→verify→final→done→audited) since direct Write to state.json is gated.
//
// Usage:
//   set-phase.mjs <repo> <slug> <phase> [--note <text>]
//     phase: plan|consult|review|execute|verify|final|done|audited|abandoned|blocked|remediate
//   exit: 0 ok · 2 bad args · 3 no state file
//
// Atomic write under O_EXCL lockfile with stale-lock reaping.

import { readFileSync, writeFileSync, appendFileSync, existsSync, openSync, closeSync, unlinkSync, renameSync, statSync, mkdirSync, realpathSync } from "node:fs";
import { join, basename } from "node:path";
import { argv, exit, env } from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// PERF (memory fix 3b): rolling cap for the cross-run eval ledgers. Keeps the most recent `max`
// non-empty lines; rewrites atomically via tmp+rename. Best-effort (advisory) — never lets a cap
// failure abort the phase transition that triggered the append.
function capJsonl(path, max) {
  try {
    const raw = readFileSync(path, "utf8");
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length <= max) return;
    const keep = lines.slice(lines.length - max).join("\n") + "\n";
    const tmp = path + ".tmp." + process.pid;
    writeFileSync(tmp, keep);
    renameSync(tmp, path);
  } catch { /* advisory */ }
}

const [repo, slug, phase, ...rest] = argv.slice(2);
if (!repo || !slug || !phase) {
  console.error("usage: set-phase.mjs <repo> <slug> <phase> [--note <text>] [--accept-waivers]");
  exit(2);
}
const VALID = new Set(["plan", "consult", "review", "execute", "verify", "final", "done", "audited", "abandoned", "blocked", "remediate"]);
if (!VALID.has(phase)) {
  console.error("phase must be one of: " + [...VALID].join(", "));
  exit(2);
}
let note;
for (let i = 0; i < rest.length; i++) if (rest[i] === "--note") note = rest[++i];
// AUDIT-3 FINDING 4: acknowledges a final wave that passed only because F2/F4 were waived.
const acceptWaivers = rest.includes("--accept-waivers");

const statePath = join(repo, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) {
  console.error("no state file: " + statePath);
  exit(3);
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
  const now = new Date().toISOString();
  st.phase = phase;
  st.updated_at = now;
  st.checkpoints = Array.isArray(st.checkpoints) ? st.checkpoints : [];
  st.checkpoints.push({ at: now, phase, note: note || `phase set to ${phase}` });
  return st;
}

// T2-#6 (security + operational residual): phase-transition DAG. set-phase used to accept ANY
// transition, so `set-phase done` disarmed every hook — a master bypass. Now transitions are
// gated by an allowed map + preconditions. Escape hatches (blocked/abandoned) are always allowed
// (a stuck run must be able to terminate) but require --force for terminal destinations.
// SEC-M13 (external audit #6 + in-session F9): abandoned/blocked had NO re-entry edges, so a run
// that hit them could only be revived by hand-editing state.json — the catch-22 encoded in the
// DAG. They now re-enter plan/review/execute (the destination's precondition still applies, and
// --force is allowed for these recovery targets per SEC-3's FORCEABLE set).
const TRANSITIONS = {
  plan: ["review", "consult", "blocked", "abandoned"],
  consult: ["plan", "review", "blocked", "abandoned"],
  review: ["plan", "execute", "blocked", "abandoned"],
  execute: ["verify", "final", "blocked", "abandoned"],
  verify: ["execute", "final", "blocked", "abandoned"],
  final: ["done", "verify", "blocked", "abandoned"],
  remediate: ["done", "audited", "blocked", "abandoned"],
  done: ["audited", "remediate"],
  audited: ["remediate"],
  blocked: ["plan", "review", "execute", "abandoned"],
  abandoned: ["plan", "review", "execute", "blocked"],
};
// preconditions for entering a phase (read from the CURRENT state before mutation)
function checkPrecondition(st, target, acceptWaivers = false) {
  if (target === "execute") {
    if (st.review?.verdict !== "OKAY") return "execute requires review.verdict === OKAY";
  }
  if (target === "done") {
    if (st.review?.verdict !== "OKAY") return "done requires review.verdict === OKAY";
    if (!st.final || st.final.verdict !== "pass") return "done requires final.verdict === pass (run record-final-wave.mjs first)";
    // AUDIT-3 FINDING 4: `--skip F2,F4` produced a clean `pass`, so waiving code review and the
    // scope-fidelity review reached `done` in a single argv flag — cheaper than forging a verdict.
    // record-final-wave now records what was waived; `done` requires that to be acknowledged
    // separately. This is not authorization (any agent can pass either flag) — it is the removal
    // of the SILENT path: two deliberate, separately-recorded actions instead of one.
    const waived = (st.final && Array.isArray(st.final.waived)) ? st.final.waived : [];
    const securityWaived = waived.filter((w) => w === "F2" || w === "F4");
    if (securityWaived.length && !acceptWaivers) {
      return `done blocked: the final wave PASSED WITH WAIVERS — ${securityWaived.join(" and ")} ` +
        `(${securityWaived.includes("F2") ? "code review" : ""}` +
        `${securityWaived.length === 2 ? ", " : ""}` +
        `${securityWaived.includes("F4") ? "scope-fidelity review" : ""}) ` +
        `${securityWaived.length === 1 ? "was" : "were"} skipped, reason: ` +
        `"${st.final.waived_reason || "(none recorded)"}". Dispatch the reviewer(s) and re-run ` +
        `record-final-wave without --skip, or pass --accept-waivers to record that you are ` +
        `finishing without them.`;
    }
    // B8: a recorded regression blocks `done`. "inert" (no test command) and "no-baseline" still
    // pass, so this can never wedge a repo the gate cannot meaningfully evaluate.
    //
    // AUDIT-3 FINDING 5: the check was `status === "regressed"` alone, so the gate refused at the
    // SOURCE and failed open at the CONSUMER. `toolchain-drift` is regression-gate.mjs refusing to
    // compare because .zcode/toolchain.json changed since the baseline — which is exactly how the
    // gate would be neutered, and it sailed through to `done`. A refusal is not a pass.
    if (st.regression && st.regression.status === "regressed") {
      const nf = (st.regression.new_failures || []).slice(0, 5);
      return "done blocked: the test suite passed before this run and fails now" +
        (nf.length ? ` (newly failing: ${nf.join(", ")})` : "") +
        ". Fix the regression and re-run regression-gate.mjs --check.";
    }
    if (st.regression && st.regression.status === "toolchain-drift") {
      return "done blocked: regression-gate refused to compare — .zcode/toolchain.json changed " +
        "since the baseline was taken, so the before/after comparison is meaningless. Restore the " +
        "toolchain, or re-baseline deliberately with `regression-gate.mjs --snapshot --resnapshot` " +
        "and re-run `--check`. (A gate that refused is not a gate that passed.)";
    }
    // 02 (wire-zero-caller-checks): the CONSUMER half of the import check. The invoke is at
    // verify entry (below), the record is state.imports, and this clause is what makes the
    // wiring two-sided — an invoke whose recorded state nothing consumes is the half-wiring the
    // regression gate shipped with. Only `unresolved` refuses: `inert` (capability absent,
    // timeout, crash) and a missing lane entirely (run predates the wiring) pass, so this can
    // never wedge a repo the check cannot meaningfully evaluate.
    if (st.imports && st.imports.status === "unresolved") {
      const nf = (st.imports.findings || []).slice(0, 5).map(
        (f) => f.file && f.spec ? `${f.file}: \`${f.spec}\`` : String(f.raw || f));
      return "done blocked: check-imports recorded unresolved import(s) at verify entry" +
        (nf.length ? ` (${nf.join(", ")})` : "") +
        ". Either the package name is hallucinated, or the dependency is undeclared — fix the " +
        "import or declare it, then re-enter verify (verify → execute → verify re-records). " +
        "There is deliberately no flag that skips this record.";
    }
  }
  return null; // no precondition
}

// --- 02 (wire-zero-caller-checks): the zero-caller checks, wired as mechanism ---------------
//
// check-imports / coverage-delta / resolve-capabilities each shipped with a passing suite and
// no code caller — "run it during verify" prose addressed to a conductor, which is the
// prompt-convention "enforcement" this project exists to replace (see the B8 comment below).
// Gate-vs-inert, per check:
//   · check-imports GATES on findings (exit 9 → the done clause above refuses). Exit 9 is only
//     reachable in a repo that HAS a manifest, so the failure is real and this-run-scoped.
//   · coverage-delta NEVER gates ("evidence, NOT a gate" per its own header) — its single
//     stdout line is recorded verbatim as state.coverage.
//   · resolve-capabilities NEVER gates — its violation classes describe the operator's ENTIRE
//     installation (any agent on disk, any unrouted skill), not this run; blocking every run
//     in every repo on cross-repo environment drift is a new failure of the over-blocking
//     class. Violations are recorded and surfaced on stderr only.
// All lanes are OPTIONAL (read via `?.`/`|| {}` everywhere) so in-flight runs on the old
// schema keep loading. Invokes run AFTER the phase write and OUTSIDE the state lock (the B8
// shape; LOCK_STALE_MS is 60s — never hold the lock across a scan), with a hard timeout that
// degrades to `inert` rather than wedging the transition.
const CHECK_IMPORTS = fileURLToPath(new URL("./check-imports.mjs", import.meta.url));
const COVERAGE_DELTA = fileURLToPath(new URL("./coverage-delta.mjs", import.meta.url));
const RESOLVE_CAPS = fileURLToPath(new URL("./resolve-capabilities.mjs", import.meta.url));
const CHECK_TIMEOUT_MS = 60 * 1000;

// Record a lane into state with the same atomic tmp+rename write the phase write uses. Runs
// after the lock is released; best-effort by design — a check that cannot record degrades to
// lane-absence, which never triggers a precondition.
function recordLane(mut) {
  try {
    const st = JSON.parse(readFileSync(statePath, "utf8"));
    mut(st);
    st.updated_at = new Date().toISOString();
    const tmp = statePath + ".tmp." + process.pid;
    writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
    renameSync(tmp, statePath);
  } catch (e) {
    process.stderr.write(`ZOdyssey: WARNING — could not record check lane (${(e.message || "").slice(0, 120)}). The check degrades to unrecorded; it will not block.\n`);
  }
}

// The finding lines check-imports prints on exit 9: "  <file>: `<spec>` — <reason>".
function parseImportFindings(stderr) {
  const out = [];
  for (const line of String(stderr || "").split("\n")) {
    const m = line.match(/^  (.+?): `([^`]+)`/);
    if (m) out.push({ file: m[1], spec: m[2] });
  }
  if (!out.length) {
    const raw = String(stderr || "").trim();
    if (raw) out.push({ raw: raw.slice(0, 400) });
  }
  return out;
}

function checkErrReason(e) {
  if (e && (e.code === "ETIMEDOUT" || e.signal === "SIGTERM")) return "check timed out";
  if (e && e.code === "ENOENT") return "check could not be launched";
  return ((e && e.message) || "unknown error").slice(0, 200);
}

// git output as a clean file list (-z: NUL-separated, no path quoting/escaping).
function gitLines(repo, args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 10 * 1000 })
      .split("\0").map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

// The run's changed set: tracked files modified since the baseline sha, plus files CREATED
// since execute entry (untracked now, not in st.checks.untracked_at_start). Plain
// `git diff --name-only <sha>` — what the check's own --since mode uses — is blind to
// untracked files, and a hallucinated import usually lands in a file the run just created;
// deriving the set here and passing --files closes that without touching check-imports.mjs
// (whose exit-code contract is frozen). Inherited breakage stays invisible: files that
// already existed untracked at execute entry are excluded, the untracked twin of the
// regression gate's "an already-red suite is not this run's fault".
function changedSince(repo, st) {
  const files = new Set();
  const baseline = st.checks && typeof st.checks.baseline_sha === "string" ? st.checks.baseline_sha : null;
  if (!baseline) return [];
  for (const f of gitLines(repo, ["diff", "--name-only", "-z", baseline])) files.add(f);
  const atStart = st.checks && !st.checks.untracked_truncated && Array.isArray(st.checks.untracked_at_start)
    ? new Set(st.checks.untracked_at_start) : null;
  for (const f of gitLines(repo, ["ls-files", "--others", "--exclude-standard", "-z"])) {
    if (!atStart || !atStart.has(f)) files.add(f);
  }
  return [...files];
}

// The baseline "before" markers for the run: HEAD at (first) execute entry, plus the untracked
// set at that moment. IDEMPOTENT for the same reason regression-gate's snapshot is — a
// verify→execute re-entry must not redefine "before" as "after". Non-git records null and the
// verify-entry check records `inert`. NOTE: record-review.mjs ALSO captures this on its own
// OKAY→execute advance, because that is the entry a real run actually takes (see its B8
// comment); this block covers explicit and re-entry transitions. Captured BEFORE the (possibly
// minutes-long) suite snapshot so a slow suite cannot delay it.
function captureBaseline() {
  let sha = null;
  try {
    sha = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10 * 1000 }).trim() || null;
  } catch { sha = null; } // not a git repo, or no commits yet — verify entry records `inert`
  const untracked = gitLines(repo, ["ls-files", "--others", "--exclude-standard", "-z"]);
  recordLane((st) => {
    if (st.checks && typeof st.checks.baseline_sha !== "undefined") return; // first entry wins
    st.checks = {
      ...(st.checks || {}),
      baseline_sha: sha,
      untracked_at_start: untracked.slice(0, 2000),
      untracked_truncated: untracked.length > 2000,
      baseline_at: new Date().toISOString(),
    };
  });
}
{
  // read current phase under the lock-free path first for validation (re-read inside lock below)
  let cur;
  try { cur = JSON.parse(readFileSync(statePath, "utf8")); } catch { cur = {}; }
  const from = cur.phase || "plan";
  const allowed = TRANSITIONS[from] || [];
  // terminal escapes always permitted
  if (!allowed.includes(phase) && !["blocked", "abandoned"].includes(phase)) {
    console.error(`set-phase.mjs: illegal transition ${from} → ${phase}. Allowed from ${from}: ${allowed.join(", ")}`);
    console.error(`  (Use a trusted-writer path if this is a legitimate override; the DAG prevents the 'set-phase done' master-bypass.)`);
    exit(6);
  }
  // check preconditions for the destination
  const pc = checkPrecondition(cur, phase, acceptWaivers);
  const forcing = rest.includes("--force");
  // SEC-3 (external audit 2026-08-04): --force bypassed BOTH preconditions (execute needs OKAY;
  // done needs final.verdict===pass), and done∈TERMINAL disarms every hook — a master bypass
  // reachable in 4 commands without touching the review lane. --force is now scoped to the
  // documented recovery targets (blocked/abandoned) ONLY. It can never target execute or done,
  // so the gate cannot be skipped via the sanctioned escape hatch. Operator recovery from a
  // stuck run still works (set-phase <repo> <slug> blocked --force, then resume).
  const FORCEABLE = new Set(["blocked", "abandoned"]);
  if (pc) {
    if (!forcing) {
      console.error(`set-phase.mjs: precondition failed for ${from} → ${phase}: ${pc}`);
      console.error(`  (Pass --force to override, e.g. for an abandoned run. Do NOT --force to skip the gate.)`);
      exit(6);
    }
    if (forcing && !FORCEABLE.has(phase)) {
      console.error(`set-phase.mjs: --force cannot target ${phase} — it would skip the review/final gate. --force is restricted to recovery targets: ${[...FORCEABLE].join(", ")}.`);
      console.error(`  (To recover a stuck run: set-phase <repo> <slug> blocked --force, fix the issue, then transition forward through the gate normally.)`);
      exit(6);
    }
  }
}

const lockFd = acquireLock();
if (lockFd === null) {
  // T2-1 (audit 2026-08-14): this fell back to a NON-ATOMIC, UNLOCKED writeFileSync, silently
  // clobbering whatever the lock holder was writing. record-todo already refused; five writers did
  // not. Losing a write loudly beats corrupting state quietly.
  console.error("set-phase.mjs: could not acquire the state lock (real contention or a stuck lock). Refusing to write non-atomically — nothing was written. The phase was NOT changed.");
  exit(6);
}
try {
  const st = apply(JSON.parse(readFileSync(statePath, "utf8")));
  const tmp = statePath + ".tmp." + process.pid;
  writeFileSync(tmp, JSON.stringify(st, null, 2) + "\n");
  renameSync(tmp, statePath);
} finally {
  try { closeSync(lockFd); unlinkSync(lockPath); } catch {}
}

// B8: snapshot the pre-existing test suite as we enter EXECUTE — the last moment before any
// product code changes, which is the only point a truthful "before" reading exists.
//
// Wired here rather than as a SKILL.md instruction on purpose: an instruction to a conductor is
// the prompt-convention "enforcement" this project exists to replace, and the baseline has to be
// taken at exactly one moment to mean anything. Best-effort — a repo whose suite cannot be run
// records `inert` and the gate stays quiet rather than blocking the run.
if (phase === "execute") {
  // 02: the import-check baseline (HEAD + untracked set) BEFORE the possibly-minutes-long suite
  // snapshot below — both define "before" for their respective gates at the same moment.
  try { captureBaseline(); } catch { /* best-effort; verify entry records `inert` */ }
  try {
    execFileSync("node", [new URL("./regression-gate.mjs", import.meta.url).pathname, repo, slug, "--snapshot"],
      { stdio: "inherit", timeout: 15 * 60 * 1000 });
  } catch { /* baseline is best-effort; --check degrades to "no-baseline" and stays inert */ }
}

// 02: the import check fires at EVERY execute→verify edge and records state.imports; the done
// precondition above consumes it. Wired here rather than as a SKILL.md instruction for the same
// reason as the B8 snapshot. Recovery is fix-then-re-enter (verify → execute → verify), so the
// check re-fires and re-records on each edge — the record always describes the CURRENT tree.
if (phase === "verify") {
  let cur = null;
  try { cur = JSON.parse(readFileSync(statePath, "utf8")); } catch { cur = {}; }
  const now = () => new Date().toISOString();
  const baselineKnown = cur.checks && typeof cur.checks.baseline_sha !== "undefined";
  const manifest = ["package.json", "requirements.txt", "requirements-dev.txt", "pyproject.toml", "setup.py", "Pipfile"]
    .some((f) => existsSync(join(repo, f)));
  if (!baselineKnown) {
    // A run that predates the wiring (no st.checks at all) or whose capture was never taken.
    recordLane((st) => {
      st.imports = { status: "inert", reason: "no baseline recorded (run predates the check wiring)", at: now() };
    });
  } else if (cur.checks.baseline_sha === null) {
    // Capability absent: not a git repo (or no commits) at execute entry — exit 9 is not
    // reachable here, so record `inert` WITHOUT invoking. Never a block.
    recordLane((st) => {
      st.imports = { status: "inert", reason: "no git work-tree at execute entry", at: now() };
    });
  } else if (!manifest) {
    // Capability absent: nothing to resolve imports against. Never a block.
    recordLane((st) => {
      st.imports = { status: "inert", reason: "no package.json or Python manifest", at: now() };
    });
  } else {
    try {
      const files = changedSince(repo, cur);
      execFileSync("node", [CHECK_IMPORTS, repo, "--files", files.join(",")],
        { encoding: "utf8", timeout: CHECK_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 });
      recordLane((st) => { st.imports = { status: "clean", exit_code: 0, findings: [], at: now() }; });
    } catch (e) {
      if (e.status === 9) {
        const findings = parseImportFindings(e.stderr);
        process.stderr.write(`ZOdyssey: check-imports found ${findings.length} unresolved import(s); \`done\` will refuse until fixed.\n`);
        recordLane((st) => { st.imports = { status: "unresolved", exit_code: 9, findings, at: now() }; });
      } else {
        // Timeout, crash, bad exit — B8's own posture: a check that cannot run degrades.
        recordLane((st) => {
          st.imports = { status: "inert", exit_code: typeof e.status === "number" ? e.status : -1, reason: checkErrReason(e), at: now() };
        });
      }
    }
  }
}

// 02: entering final records the two EVIDENCE lanes (see the gate-vs-inert notes above —
// neither ever gates). The changed set is the same one the import check used, so the lanes
// describe the same set of files.
if (phase === "final") {
  const now = () => new Date().toISOString();
  let cur = null;
  try { cur = JSON.parse(readFileSync(statePath, "utf8")); } catch { cur = {}; }
  const changed = changedSince(repo, cur);
  try {
    const line = execFileSync("node", [COVERAGE_DELTA, repo, ...changed],
      { encoding: "utf8", timeout: CHECK_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 });
    recordLane((st) => { st.coverage = { line: String(line || "").trim(), at: now() }; });
  } catch (e) {
    recordLane((st) => { st.coverage = { line: "", reason: checkErrReason(e), at: now() }; });
  }
  try {
    // --check = reconcile only, no lock write. Scans the OPERATOR's installation
    // (~sub-second typically; the timeout degrades to `inert` rather than wedging final).
    // Lane name: NOT st.capabilities — that key is the hook-witnessed observed-capability
    // array F5 cross-checks (post-tool.mjs writes it); clobbering it would fail every run's
    // routing check. The brief named the lane st.capabilities; the existing consumer wins.
    execFileSync("node", [RESOLVE_CAPS, "--check"],
      { encoding: "utf8", timeout: CHECK_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 });
    recordLane((st) => { st.capabilities_check = { status: "clean", at: now() }; });
  } catch (e) {
    if (e.status === 6) {
      process.stderr.write(`ZOdyssey: WARNING — resolve-capabilities reports violations in the operator installation (not this run; recorded, not blocking): ${(String(e.stderr || "").trim().slice(0, 300))}\n`);
      recordLane((st) => { st.capabilities_check = { status: "violations", exit_code: 6, at: now() }; });
    } else {
      recordLane((st) => { st.capabilities_check = { status: "inert", reason: checkErrReason(e), at: now() }; });
    }
  }

  // Item 11 (compaction-phase-wiring): entering final auto-compacts the run's notepads once they
  // pass the threshold — compact.mjs shipped with zero callers, its only wiring a prose "you may
  // run this". Compaction is a context-economy step and NEVER gates this transition: the invoke
  // runs after the phase write and outside the state lock (the B8 shape), every failure mode
  // (no notepad dir → exit 3, timeout, crash, nonzero exit) degrades to ONE stderr warning, and
  // ZODYSSEY_NO_AUTO_COMPACT=1 skips the invocation entirely. stdio: "inherit" surfaces compact's
  // brief-path print on the transition's stdout — the conductor's signal to point F1–F4 at the
  // brief. The additive invariant (every source notepad byte-identical) is asserted by
  // compact.test.mjs, not promised by compact's header. Re-entering final via the verify edge
  // (legal per TRANSITIONS) re-derives the brief idempotently. The 10s timeout is headroom, not
  // latency budget — compact is pure synchronous fs work (reads + one brief write, sub-second
  // typically) — and exists so a wedged fs can never hang the transition.
  const AUTO_COMPACT_MIN_LINES = 400; // aggregate non-empty notepad lines (compact.mjs's counting unit)
  if (env.ZODYSSEY_NO_AUTO_COMPACT !== "1") {
    try {
      execFileSync(process.execPath, [
        fileURLToPath(new URL("./compact.mjs", import.meta.url)), repo, slug,
        "--min-lines", String(AUTO_COMPACT_MIN_LINES),
      ], { timeout: 10_000, stdio: "inherit" });
    } catch (e) {
      process.stderr.write(`ZOdyssey: WARNING — auto-compaction for ${slug} did not complete (${checkErrReason(e)}); the final transition is unaffected.\n`);
    }
  }
}

// CRIT-4a (operational-consult): when a run reaches a terminal phase (done|audited), auto-append
// its run-report to the eval trend log. This is why results.jsonl was empty before — run-report's
// footer told the operator to append manually (`>> results.jsonl`), which nobody remembered.
// Now NO run can complete unmeasured. Best-effort: never fail the phase transition on a report error.
if (phase === "done" || phase === "audited") {
  try {
    const report = execFileSync("node", [
      // v0.3.0 portability: resolve the sibling run-report.mjs relative to this script's own
      // location so it is found from the plugin cache install, not the legacy ~/.zcode path.
      fileURLToPath(new URL("./run-report.mjs", import.meta.url)),
      repo, slug, "--json",
    ], { encoding: "utf8", shell: false });
    // Item 05 (metrics-corpus-decontamination): a run that DECLARES itself synthetic at source —
    // ZODYSSEY_EVAL_LANE=synthetic, exact match, set by the spawning fixture/harness process —
    // appends to a separate lane file so the operator's trend log holds real runs only. The lane
    // is a write destination, never a gate: unset, misspelled, or wrong-case values mean operator
    // lane, and telemetry stays best-effort — a typo'd lane must never fail a phase transition.
    const evalDir = join(env.HOME || "", ".zcode", "orchestration", "eval");
    // Fresh machine / hermetic HOME: the eval dir must not need to pre-exist, or this degrades
    // to the catch-and-warn below, silently masking the append (the exact defect item 05 found).
    mkdirSync(evalDir, { recursive: true });
    const lanePath = env.ZODYSSEY_EVAL_LANE === "synthetic"
      ? join(evalDir, "results.synthetic.jsonl")
      : join(evalDir, "results.jsonl");
    appendFileSync(lanePath, report.trim() + "\n");
    // PERF (memory fix 3b): rolling cap so the cross-run ledger can't grow unbounded across eval sweeps.
    capJsonl(lanePath, 1000);
    process.stderr.write(`ZOdyssey: run ${slug} reached ${phase} — scorecard appended to ${lanePath}\n`);
  } catch (e) {
    process.stderr.write(`ZOdyssey: WARNING — could not auto-append run-report for ${slug} (${(e.message || "").slice(0, 120)}). Run record manually.\n`);
  }
}

// INTEG-#3 (integration-consult): write a structured memory entry on EVERY terminal transition
// (done, audited, abandoned, blocked). The memory MCP itself isn't script-callable (it's an
// in-process tool), so we write a structured file under .zcode/memory/ that the orchestrator
// loads into the MCP at session start + that phase-1 metis/premortem can read. The highest-value
// entries are blocked/failed (the lessons that leak today). Namespacing: <repo-basename>:<topic>.
if (["done", "audited", "abandoned", "blocked"].includes(phase)) {
  try {
    const repoBase = basename(realpathSync(repo));
    const memDir = join(repo, ".zcode", "memory");
    mkdirSync(memDir, { recursive: true });
    const entry = {
      name: `${repoBase}:${slug}:${phase}`,
      entity_type: "run_outcome",
      observations: [
        `run ${slug} reached ${phase} at ${new Date().toISOString()}`,
        note ? `note: ${note}` : `transition: ${phase}`,
      ],
      created_at: new Date().toISOString(),
    };
    appendFileSync(join(memDir, "outcomes.jsonl"), JSON.stringify(entry) + "\n");
  } catch {}
}
exit(0);
