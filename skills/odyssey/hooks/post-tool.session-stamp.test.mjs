#!/usr/bin/env node
// post-tool.session-stamp.test.mjs — the session-stamp arm (item 06, todo 4).
//
// The arm stamps the orchestrator's hook-payload session_id into run state on FIRST
// witness (only-if-absent), then FALLS THROUGH so the owning later arm (Edit
// diagnostics, Skill/mcp capability observation, Task/Agent ledger drain) still runs.
// These are black-box subprocess tests in the pre-tool.scope.test.mjs pattern: a
// tmpdir repo with an authenticated (stampMarker) state fixture, the hook spawned
// with CLAUDE_PROJECT_DIR pointed at it, JSON on stdin, assertions on the exit code
// and the resulting on-disk state.
//
// Case (vi) is the one the amendment cares about most: an early exit in the stamp
// arm would strand the inflight ledger (parallel slots never free) and silence
// capability observation. A Task event with a populated ledger must BOTH drain the
// ledger AND write the stamp.
//
// Run:  node post-tool.session-stamp.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { stampMarker } from "../scripts/lib/state-auth.mjs";

const HOOK = join(new URL(".", import.meta.url).pathname, "post-tool.mjs");
let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

const cleanup = [];
// A tmpdir repo. withRun=false leaves .zcode/state empty (no active run).
// The state fixture carries the run_auth marker — without it find-run.mjs ignores
// the file (CRITICAL T1-7) and every case would degrade to "no active run".
function makeRepo({ withRun = true } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "zod-sessstamp-")));
  cleanup.push(repo);
  mkdirSync(join(repo, ".zcode", "state"), { recursive: true });
  if (withRun) {
    const st = stampMarker({ slug: "t", phase: "execute", updated_at: new Date().toISOString() }, "t");
    writeFileSync(join(repo, ".zcode", "state", "t.json"), JSON.stringify(st, null, 2) + "\n");
  }
  return repo;
}
const runHook = (repo, input) => spawnSync(process.execPath, [HOOK], {
  input, encoding: "utf8",
  env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
});
const statePath = (repo) => join(repo, ".zcode", "state", "t.json");
const readState = (repo) => JSON.parse(readFileSync(statePath(repo), "utf8"));
const rawState = (repo) => readFileSync(statePath(repo), "utf8");

console.log("post-tool.mjs — session-stamp arm (first witness, only-if-absent, pass-through)\n");

// --- (i) stamp fires: payload session_id + active run → state.session_id, exit 0
{
  const repo = makeRepo();
  const res = runHook(repo, JSON.stringify({ tool_name: "Task", tool_use_id: "tu-1", session_id: "sess-alpha" }));
  check("(i) hook exits 0", res.status === 0, `status=${res.status}`);
  check("(i) state.session_id stamped on first witness",
    readState(repo).session_id === "sess-alpha", `got ${JSON.stringify(readState(repo).session_id)}`);
}

// --- (ii) only-if-absent: a second event with a DIFFERENT session_id must not overwrite
{
  const repo = makeRepo();
  runHook(repo, JSON.stringify({ tool_name: "Task", tool_use_id: "tu-1", session_id: "sess-alpha" }));
  const afterFirst = rawState(repo);
  const res = runHook(repo, JSON.stringify({ tool_name: "Task", tool_use_id: "tu-2", session_id: "sess-beta" }));
  check("(ii) hook exits 0 on the second event", res.status === 0, `status=${res.status}`);
  check("(ii) an existing session_id is NOT overwritten",
    readState(repo).session_id === "sess-alpha", `got ${JSON.stringify(readState(repo).session_id)}`);
  // Skip-fast means NO lock acquisition and NO write at all — the file must be byte-identical
  // (nothing else in the Task path writes state when there is no ledger/capability entry).
  check("(ii) skip-fast leaves the state file byte-identical (no lock churn, no rewrite)",
    rawState(repo) === afterFirst, "file was rewritten");
}

// --- (iii) payload without session_id → no stamp, exit 0
{
  const repo = makeRepo();
  const before = rawState(repo);
  const res = runHook(repo, JSON.stringify({ tool_name: "Task", tool_use_id: "tu-3" }));
  check("(iii) hook exits 0 without session_id", res.status === 0, `status=${res.status}`);
  check("(iii) no session_id → no stamp", readState(repo).session_id === undefined,
    `got ${JSON.stringify(readState(repo).session_id)}`);
  check("(iii) state file untouched", rawState(repo) === before, "file changed");
}

// --- (iv) no active run → no-op, exit 0
{
  const repo = makeRepo({ withRun: false });
  const res = runHook(repo, JSON.stringify({ tool_name: "Task", tool_use_id: "tu-4", session_id: "sess-delta" }));
  check("(iv) hook exits 0 with no active run", res.status === 0, `status=${res.status}`);
  const left = readdirSync(join(repo, ".zcode", "state")).filter((f) => f.endsWith(".json"));
  check("(iv) no state file was created", left.length === 0, `left=${JSON.stringify(left)}`);
}

// --- (v) malformed stdin → exit 0 (the exit-0-always control)
{
  const repo = makeRepo();
  const res = runHook(repo, '{"tool_name": "Task", "session_id": ');
  check("(v) malformed stdin → hook exits 0", res.status === 0, `status=${res.status}`);
}

// --- (vi) pass-through proof: Task event + session_id + populated ledger → drain AND stamp
{
  const repo = makeRepo();
  const ledgerPath = join(repo, ".zcode", "state", "t.inflight.json");
  writeFileSync(ledgerPath, JSON.stringify([{ id: "tu-9", at: Date.now() }]));
  const res = runHook(repo, JSON.stringify({ tool_name: "Task", tool_use_id: "tu-9", session_id: "sess-gamma" }));
  check("(vi) hook exits 0 (stamp arm did not steal the event)", res.status === 0, `status=${res.status}`);
  check("(vi) stamp landed", readState(repo).session_id === "sess-gamma",
    `got ${JSON.stringify(readState(repo).session_id)}`);
  const drained = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : null;
  check("(vi) inflight ledger drained by the LATER arm (pass-through intact)",
    Array.isArray(drained) && drained.length === 0, `ledger=${JSON.stringify(drained)}`);
  // (audit F5, 2026-08-25) the drain now runs under an O_EXCL lockfile — it must never be left
  // behind (a leaked lock would make the NEXT drain wait out the 60s stale window).
  check("(vi) drain lock released (no .inflight.json.lock left behind)",
    !existsSync(ledgerPath + ".lock"));
  check("(vi) no crash output", !(res.stderr || "").includes("Error"), `stderr=${(res.stderr || "").slice(0, 200)}`);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
