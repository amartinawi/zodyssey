#!/usr/bin/env node
// state-auth.project-binding.test.mjs — I4: the run marker commits to the project it belongs
// to, additively and backward compatibly (todo 4 of run impl-23-project-isolation,
// .zcode/audits/2026-08-20-project-isolation.md finding I4; metis consult risk 3).
//
// THE FIVE NAMED CHECKS (the plan's acceptance vocabulary):
//   OLD        — a v0.6.15-shape state (no `project_dir`) stamps and verifies BYTE-IDENTICALLY
//                to the pre-v0.6.16 identity, is discovered by the shared module, and still
//                arms the real hook end-to-end (the load-compat case — the 49 real state files
//                under .zcode/state are all this shape and must all keep loading).
//   BIND       — a state carrying `project_dir` verifies in the repo it names, the marker
//                DIFFERS from the old identity (the field is actually committed), and normal
//                run progress (phase/updated_at mutations by trusted writers, no re-stamp)
//                does not invalidate it (identity still excludes mutable fields).
//   WRONG-REPO — a bound state discovered under a DIFFERENT repo root is rejected by the
//                shared discovery module AND by the real hook (no active run → no-op exit 0,
//                debug line names the binding mismatch), while the byte-identical fixture
//                re-bound to the right repo governs (exit 2) and the same state WITHOUT the
//                field is discovered anywhere (rejection fires ONLY when the field is present
//                — the backward-compat contract).
//   STRIP      — deleting `project_dir` from a bound state BREAKS its marker (the downgrade
//                case: a pre-0.6.16 edit of the state disarms the run), and so does pointing
//                the field at a different repo without re-stamping.
//   ADOPT      — `scaffold.mjs <repo> <slug> --adopt` re-stamps: an unmarked legacy state
//                gains project_dir = the adopt repo, and a RELOCATED bound run (valid marker,
//                binding naming the old path) re-binds to the new repo; both verify and are
//                discovered afterwards.
//
// PRESERVED-BEHAVIOR CLASS: OLD (and the absent-field twin inside WRONG-REPO) must NEVER fail,
// before or after the change — they are the backward-compat boundary itself. RED on the
// unmodified tree is expected exactly on BIND/WRONG-REPO/STRIP/ADOPT.
//
// HERMETICITY CONTRACT (metis risk 7): fresh mkdtemp workspaces; a fixture key the suite
// writes itself (the operator's real ~/.zcode key is never read or written); the hook runs
// with CLAUDE_PROJECT_DIR + ZODYSSEY_RUN_KEY_PATH + ZODYSSEY_NO_FIND_CACHE=1 +
// ZODYSSEY_UNGATE_BASH:"" set explicitly after the process.env spread. state-auth binds
// KEY_PATH at module load, so BOTH state-auth and find-run are imported DYNAMICICALLY after
// ZODYSSEY_RUN_KEY_PATH is set (the lib/find-run.pin.test.mjs lesson — a static import would
// cache the module with the ambient key path and desync in-process stamping from verifying).
//
// Run:  node skills/odyssey/scripts/state-auth.project-binding.test.mjs
// Exit: 0 = all green · 1 = at least one case failed.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { exit } from "node:process";

const SCRIPTS_DIR = realpathSync(new URL(".", import.meta.url).pathname);
const SCAFFOLD = join(SCRIPTS_DIR, "scaffold.mjs");
const HOOK = join(SCRIPTS_DIR, "..", "hooks", "pre-tool.mjs");

let pass = 0, fail = 0;
function scenario(TAG, name, subs) {
  const failed = subs.filter((s) => !s.ok);
  if (failed.length === 0) { console.log(`  ✓ ${TAG}: ${name}`); pass++; return; }
  console.log(`  ✗ ${TAG}: ${name}`);
  for (const f of failed) console.log(`      - ${f.label}${f.detail ? ` [${f.detail}]` : ""}`);
  fail++;
}

// A deterministic fixture key, written by the suite: 64 hex chars satisfies loadOrCreateKey's
// >=32 rule, and knowing the exact bytes lets the OLD case pin the pre-v0.6.16 identity format
// byte-for-byte with an independently computed HMAC.
const ws0 = realpathSync(mkdtempSync(join(tmpdir(), "zod-bind-key-")));
const KEY_PATH = join(ws0, "fixture.key");
const KEY_HEX = "11".repeat(32); // 64 hex chars — the exact key bytes every HMAC below uses
writeFileSync(KEY_PATH, KEY_HEX + "\n");
process.env.ZODYSSEY_RUN_KEY_PATH = KEY_PATH; // BEFORE the dynamic imports below (header note)

const { stampMarker, verifyMarker, MARKER_FIELD } = await import("./lib/state-auth.mjs");
const { findActiveRuns } = await import("../hooks/lib/find-run.mjs");

// The pre-v0.6.16 identity, computed independently of state-auth.mjs on purpose: this is the
// format pin. If identityOf ever changes for field-ABSENT states, OLD goes red.
const oldIdentityHmac = (st) =>
  createHmac("sha256", KEY_HEX)
    .update(JSON.stringify({
      slug: String(st.slug ?? ""),
      started_at: String(st.started_at ?? ""),
      run_start_sha: String(st.run_start_sha ?? ""),
    }))
    .digest("hex");

// --- fixture builders ----------------------------------------------------------

const NOW = new Date().toISOString();
const LATER = new Date(Date.now() + 60_000).toISOString();

// A minimal v0.6.15/16-shaped run state. `projectDir` (when given) becomes the binding.
function mkState(slug, { projectDir = null, updatedAt = NOW, phase = "execute" } = {}) {
  const st = {
    slug, phase,
    started_at: "2026-08-21T00:00:00.000Z",
    updated_at: updatedAt,
    run_start_sha: "beefcafe",
    review: { verdict: "OKAY", round: 1, max_rounds: 3, plan_sha256: null },
  };
  if (projectDir) st.project_dir = projectDir;
  return st;
}

function writeState(root, st) {
  mkdirSync(join(root, ".zcode", "state"), { recursive: true });
  const p = join(root, ".zcode", "state", `${st.slug}.json`);
  writeFileSync(p, JSON.stringify(stampMarker(st, st.slug), null, 2) + "\n");
  return p;
}

const discoveredSlugs = (projectDir) =>
  findActiveRuns({ projectDir }).map((r) => r.state.slug);

// Run the REAL checked-in hook. All ZODYSSEY_* vars are set explicitly AFTER the process.env
// spread so ambient operator values (notably UNGATE_BASH=1) can never leak in (isolation-suite
// harness contract).
function runHook({ projectDir, payload, debug = false }) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: projectDir,
      ZODYSSEY_RUN_KEY_PATH: KEY_PATH,
      ZODYSSEY_NO_FIND_CACHE: "1",
      ZODYSSEY_UNGATE_BASH: "",
      ZODYSSEY_DEBUG: debug ? "1" : "",
    },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// An mcp__fs__write_file payload aimed at `target` — the non-native class whose union guard
// (exit 2) proves a run was discovered, and whose free pass (exit 0) proves none was.
const mcpWrite = (target) => ({ tool_name: "mcp__fs__write_file", tool_input: { path: target } });

const cleanup = [];
const mkws = (tag) => { const ws = realpathSync(mkdtempSync(join(tmpdir(), tag))); cleanup.push(ws); return ws; };

console.log("state-auth.mjs — project binding in the run marker (I4, additive + backward compatible)\n");

try {
  // OLD — the backward-compat boundary: pre-v0.6.16 states verify byte-identically and load.
  {
    const ws = mkws("zod-bind-old-");
    const a = join(ws, "project-a"); mkdirSync(a, { recursive: true });
    const old = mkState("old-run"); // NO project_dir — the v0.6.15 shape
    const stamped = stampMarker(old, "old-run");
    const statePath = writeState(a, stamped);
    const r = runHook({ projectDir: ws, payload: mcpWrite(statePath) });
    scenario("OLD", "a field-absent state verifies byte-identically to the v0.6.15 identity and still loads everywhere", [
      { ok: stamped[MARKER_FIELD] === oldIdentityHmac(old),
        label: `the marker equals the HMAC over the pre-v0.6.16 identity {slug,started_at,run_start_sha}`,
        detail: `got ${stamped[MARKER_FIELD]?.slice(0, 12)}… want ${oldIdentityHmac(old).slice(0, 12)}…` },
      { ok: verifyMarker(old, "old-run").ok === true, label: "verifyMarker ok on the old-shape state" },
      { ok: discoveredSlugs(ws).includes("old-run"),
        label: "the shared discovery module (findActiveRuns) still discovers it" },
      { ok: r.status === 2, label: "the real hook still arms end-to-end (mcp write into its state → block)",
        detail: `exit=${r.status}` },
    ]);
  }

  // BIND — the new field is committed into the marker without touching mutable fields.
  {
    const ws = mkws("zod-bind-bind-");
    const a = join(ws, "project-a"); mkdirSync(a, { recursive: true });
    const bound = stampMarker(mkState("bound-run", { projectDir: a }), "bound-run");
    writeState(a, bound);
    const progressed = { ...bound, phase: "verify", updated_at: LATER, review: { ...bound.review, verdict: "REJECT" } };
    scenario("BIND", "a project_dir-carrying state verifies in the repo it names; the marker commits to the field", [
      { ok: verifyMarker(bound, "bound-run").ok === true, label: "verifyMarker ok for the bound state" },
      { ok: bound[MARKER_FIELD] !== oldIdentityHmac(bound),
        label: "the marker DIFFERS from the old identity (project_dir is inside the HMAC, not decorative)" },
      { ok: discoveredSlugs(ws).includes("bound-run"),
        label: "discovered by findActiveRuns when the binding names the repo it sits in" },
      { ok: verifyMarker(progressed, "bound-run").ok === true,
        label: "trusted-writer progress (phase/updated_at/review mutation, no re-stamp) does not invalidate it" },
    ]);
  }

  // WRONG-REPO — the discovery-side half of the binding, at BOTH consumers.
  {
    const ws = mkws("zod-bind-wrong-");
    const a = join(ws, "project-a"); mkdirSync(a, { recursive: true });
    const b = join(ws, "project-b"); mkdirSync(b, { recursive: true });
    // The state is BOUND to project-a but sits (alone) in project-b: the copied-run shape.
    const statePath = writeState(b, stampMarker(mkState("run-x", { projectDir: a }), "run-x"));
    // Observe the mis-bound discovery BEFORE the positive control overwrites run-x.json below —
    // the scenario() sub-assertions run at call time, after every fixture write in this block.
    const misBoundDiscovered = discoveredSlugs(ws).includes("run-x");
    const r = runHook({ projectDir: ws, payload: mcpWrite(join(b, ".zcode", "state", "zzz.json")), debug: true });
    const probe = join(b, ".zcode", "state", "run-x.payload-probe.json");
    // Positive control: the byte-identical fixture, re-bound to b, must govern (exit 2) —
    // proving the only difference is the binding, not anything else about the fixture.
    const rebound = writeState(b, stampMarker(mkState("run-x", { projectDir: b }), "run-x"));
    const rControl = runHook({ projectDir: ws, payload: mcpWrite(join(b, ".zcode", "state", "zzz2.json")) });
    // The absent-field twin: same fixture, binding removed, marker re-stamped — MUST be
    // discovered (rejection fires ONLY when the field is present; preserved-behavior class).
    const unbound = writeState(b, stampMarker(mkState("run-y"), "run-y"));
    scenario("WRONG-REPO", "a bound state in the wrong repo is rejected by both consumers; absent field → no rejection", [
      { ok: !misBoundDiscovered,
        label: "findActiveRuns (shared source) does not discover the mis-bound state" },
      { ok: r.status === 0, label: "the real hook treats it as no active run (mcp write → no-op exit 0)",
        detail: `exit=${r.status}` },
      { ok: !existsSync(probe), label: "no payload-probe was written anywhere (nothing governed the call)" },
      { ok: /project binding mismatch/i.test(r.stderr),
        label: "ZODYSSEY_DEBUG names the binding mismatch for the operator",
        detail: `stderr=${r.stderr.split("\n").filter((l) => l.includes("ignoring run state")).join(" | ").slice(0, 120)}` },
      { ok: rControl.status === 2, label: "positive control: the same fixture re-bound to b governs (exit 2)",
        detail: `exit=${rControl.status}` },
      { ok: discoveredSlugs(ws).includes("run-y"),
        label: "the field-absent twin IS discovered (rejection only fires when project_dir is present)" },
    ]);
  }

  // STRIP — the downgrade case: removing the field from a BOUND state breaks its marker.
  {
    const ws = mkws("zod-bind-strip-");
    const a = join(ws, "project-a"); mkdirSync(a, { recursive: true });
    const b = join(ws, "project-b"); mkdirSync(b, { recursive: true });
    const bound = stampMarker(mkState("strip-run", { projectDir: a }), "strip-run");
    const stripped = { ...bound }; delete stripped.project_dir;
    const tampered = { ...bound, project_dir: b }; // repointed WITHOUT re-stamping
    // RAW write — writeState() would re-stamp and heal the very break this case asserts on.
    // The file must carry the stripped object byte-for-byte, bound marker and no field.
    const strippedPath = join(a, ".zcode", "state", "strip-run.json");
    mkdirSync(join(a, ".zcode", "state"), { recursive: true });
    writeFileSync(strippedPath, JSON.stringify(stripped, null, 2) + "\n");
    scenario("STRIP", "stripping (or repointing) project_dir from a bound state breaks its marker", [
      { ok: verifyMarker(stripped, "strip-run").ok === false,
        label: "verifyMarker FAILS after the field is deleted (a silent verify would recreate project-blindness)" },
      { ok: verifyMarker(stripped, "strip-run").reason === "marker mismatch", label: "the failure reason is the marker mismatch" },
      { ok: verifyMarker(tampered, "strip-run").ok === false,
        label: "repointing the field at another repo without re-stamping also fails" },
      { ok: !discoveredSlugs(ws).includes("strip-run"),
        label: "the stripped state on disk is not discovered (the downgrade mechanics: the run silently disappears)",
        detail: `statePath=${strippedPath}` },
    ]);
  }

  // ADOPT — scaffold --adopt re-stamps, binding the run to the adopt repo.
  {
    const ws = mkws("zod-bind-adopt-");
    const a = join(ws, "project-a"); mkdirSync(a, { recursive: true });
    const b = join(ws, "project-b"); mkdirSync(b, { recursive: true });

    // (1) legacy v0.5.0-era shape: unmarked, no project_dir — adopt mints both.
    const legacyPath = join(a, ".zcode", "state", "legacy-run.json");
    mkdirSync(join(a, ".zcode", "state"), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify(mkState("legacy-run"), null, 2) + "\n");

    // (2) relocated run: VALID marker bound to a, sitting in b — invisible until re-adopted.
    const movedPath = writeState(b, stampMarker(mkState("moved-run", { projectDir: a }), "moved-run"));

    const adopt = (repo, slug) => spawnSync(process.execPath, [SCAFFOLD, repo, slug, "--adopt"], {
      encoding: "utf8", env: { ...process.env, ZODYSSEY_RUN_KEY_PATH: KEY_PATH },
    });
    const r1 = adopt(a, "legacy-run");
    const r2 = adopt(b, "moved-run");
    const adopted1 = JSON.parse(readFileSync(legacyPath, "utf8"));
    const adopted2 = JSON.parse(readFileSync(movedPath, "utf8"));
    scenario("ADOPT", "scaffold --adopt re-stamps legacy and relocated runs, bound to the adopt repo", [
      { ok: r1.status === 0, label: "--adopt on the unmarked legacy state exits 0", detail: `exit=${r1.status}` },
      { ok: adopted1.project_dir === a && verifyMarker(adopted1, "legacy-run").ok === true,
        label: "the legacy state now carries project_dir = the adopt repo and verifies",
        detail: `project_dir=${adopted1.project_dir}` },
      { ok: r2.status === 0, label: "--adopt on the relocated (valid-marker, wrong-repo) run exits 0", detail: `exit=${r2.status}` },
      { ok: adopted2.project_dir === b && verifyMarker(adopted2, "moved-run").ok === true,
        label: "the relocated run re-binds to the NEW repo path and verifies",
        detail: `project_dir=${adopted2.project_dir}` },
      { ok: discoveredSlugs(ws).includes("legacy-run") && discoveredSlugs(ws).includes("moved-run"),
        label: "both adopted runs are discovered afterwards" },
    ]);
  }
} finally {
  for (const ws of cleanup) { try { rmSync(ws, { recursive: true, force: true }); } catch { /* best effort */ } }
  try { rmSync(ws0, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
