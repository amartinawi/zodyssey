#!/usr/bin/env node
// tokens.test.mjs — unit tests for lib/tokens.mjs (item 06: token telemetry at run close).
//
// WHY THIS EXISTS: collectRunTokens returned a bare null for every degraded condition — five null
// sites (missing args, missing DB, unavailable binding, open/query failure, zero rows in window),
// all indistinguishable — and had no session scoping, so two concurrent runs in one repo could not
// be separated (tokens.mjs:21-23 concedes exactly this). Item 06 makes every degraded return a
// reason-stamped inert object and adds session-exact attribution. These tests were written FIRST
// (TDD red): the inert-shape and session-scoping assertions fail against the null-returning code
// and pass only after the fix; the fallback control assertions pass on BOTH builds by design.
//
// Two blocks:
//   (a) inert-shape block — probe A, both arms:
//       - dbPath pointing at a nonexistent file → {inert:true, reason:"db-missing", node_version, at}
//       - the globalThis.__zodysseySqlite = {} injection seam (tokens.mjs:152-155 reads the global
//         first by design) with an EXISTING dbPath → reason "binding-unavailable" whose text names
//         the Node >= 22.5 floor. This is how Node-18 behaviour is tested on a Node-25 machine.
//   (b) seeded-DB attribution block — probe B: a temp SQLite DB (created AND deleted inside this
//       test) holds three sessions sharing one directory — orchestrator, child (parent_id =
//       orchestrator), unlinked interloper — all with model_usage rows in the same window.
//       Session-scoped call must exclude the interloper, include the child, report attribution
//       "session" / confidence "exact". The no-session-id fallback must stay byte-comparable to
//       today's heuristic (attribution "time-window", confidence "estimate", all three sessions
//       counted, echo fields unchanged). Skipped with a printed note when the node:sqlite binding
//       is unavailable — the module's own degrade rule applies to its test too.
//
// Custom-runner style (same shape as run-report.test.mjs): own pass/fail counters, prints
// "N passed, 0 failed", exit 0/1 — satisfies both `node tokens.test.mjs` and `node --test`.
//
// Run:  node tokens.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exit } from "node:process";
import { collectRunTokens } from "./tokens.mjs";
import { repoAliases } from "./repo-path.mjs";

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

console.log("lib/tokens.mjs — inert reasons + session-exact attribution (item 06)\n");

// --- (a) inert-shape block — probe A, both arms ---------------------------------
{
  const startMs = Date.now() - 60_000, endMs = Date.now();

  // Arm 1: DB file absent → inert "db-missing" (against the unfixed code: bare null).
  {
    const r = collectRunTokens({ repoRoot: process.cwd(), startMs, endMs, dbPath: "/nonexistent/db.sqlite" });
    check("(a) db-missing arm: inert === true", r !== null && typeof r === "object" && r.inert === true, `got ${JSON.stringify(r)}`);
    check('(a) db-missing arm: reason === "db-missing"', typeof r?.reason === "string" && r.reason === "db-missing", `got ${JSON.stringify(r?.reason)}`);
    check("(a) db-missing arm: node_version stamped (=== process.version)", r?.node_version === process.version, `got ${JSON.stringify(r?.node_version)}`);
    check("(a) db-missing arm: at is an ISO timestamp", typeof r?.at === "string" && !Number.isNaN(Date.parse(r.at)), `got ${JSON.stringify(r?.at)}`);
  }

  // Arm 2: binding swapped out via the module's own seam → inert "binding-unavailable" naming the
  // Node >= 22.5 floor (against the unfixed code: bare null). dbPath must EXIST so the flow
  // reaches the binding check; an empty file suffices — the binding is tested before any open.
  {
    const seamDir = mkdtempSync(join(tmpdir(), "zod-tokens-seam-"));
    const emptyDb = join(seamDir, "exists-but-empty.sqlite");
    writeFileSync(emptyDb, "");
    const saved = globalThis.__zodysseySqlite;
    try {
      globalThis.__zodysseySqlite = {};
      const r = collectRunTokens({ repoRoot: process.cwd(), startMs, endMs, dbPath: emptyDb });
      check("(a) seam arm: inert === true", r !== null && typeof r === "object" && r.inert === true, `got ${JSON.stringify(r)}`);
      check('(a) seam arm: reason names "binding-unavailable"', typeof r?.reason === "string" && r.reason.includes("binding-unavailable"), `got ${JSON.stringify(r?.reason)}`);
      check("(a) seam arm: inert text names the Node >= 22.5 floor", r !== null && JSON.stringify(r).includes("22.5"), `got ${JSON.stringify(r)}`);
      check("(a) seam arm: node_version stamped (=== process.version)", r?.node_version === process.version, `got ${JSON.stringify(r?.node_version)}`);
      check("(a) seam arm: at is an ISO timestamp", typeof r?.at === "string" && !Number.isNaN(Date.parse(r.at)), `got ${JSON.stringify(r?.at)}`);
    } finally {
      // Restore the real (memoized) binding so later blocks and other importers are unaffected.
      if (saved === undefined) delete globalThis.__zodysseySqlite;
      else globalThis.__zodysseySqlite = saved;
      rmSync(seamDir, { recursive: true, force: true });
    }
  }
}

// --- (b) seeded-DB attribution block — probe B -----------------------------------
// Three sessions share ONE directory: orch (orchestrator), child (parent_id = orch), lurker (no
// linkage). Token values are chosen so every sum is unambiguous: orch 1100, child 550, lurker 7700.
// Session-scoped expectation: total 1650 over 2 sessions (lurker excluded). Fallback expectation:
// total 9350 over 3 sessions (today's (repo, window) heuristic, unchanged).
{
  let sqlite = null;
  try { sqlite = process.getBuiltinModule("node:sqlite"); } catch { /* Node < 22.5 */ }
  if (!sqlite || typeof sqlite.DatabaseSync !== "function") {
    console.log("  [skip] (b) seeded-DB block: node:sqlite binding unavailable — mirroring the module's own degrade rule");
  } else {
    const repo = mkdtempSync(join(tmpdir(), "zod-tokens-db-"));
    const dbPath = join(repo, "seed.sqlite");
    let db = null;
    try {
      const dir = repoAliases(repo)[0]; // canonical spelling — aliases[0] is always the canonical form
      const startMs = Date.now() - 60_000;
      const endMs = Date.now() + 60_000;

      db = new sqlite.DatabaseSync(dbPath);
      // Minimal but query-compatible schema: every column the module's SELECT touches exists.
      db.exec(`
        CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, directory TEXT);
        CREATE TABLE model_usage (
          id TEXT PRIMARY KEY, session_id TEXT, query_source TEXT, provider_id TEXT, model_id TEXT,
          agent TEXT, status TEXT, started_at INTEGER,
          input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
          cache_read_input_tokens INTEGER, cache_creation_input_tokens INTEGER
        );
      `);
      const insSession = db.prepare("INSERT INTO session (id, parent_id, directory) VALUES (?, ?, ?)");
      insSession.run("orch", null, dir);
      insSession.run("child", "orch", dir);
      insSession.run("lurker", null, dir);
      const insUsage = db.prepare(`INSERT INTO model_usage (
          id, session_id, query_source, provider_id, model_id, agent, status, started_at,
          input_tokens, output_tokens, reasoning_tokens, cache_read_input_tokens, cache_creation_input_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, 0, 0, 0)`);
      const mid = startMs + 1000;
      insUsage.run("u1", "orch", "user", "builtin", "m-orch", "main", mid, 1000, 100);
      insUsage.run("u2", "child", "subagent", "builtin", "m-sub", "zodyssey:sisyphus-junior", mid, 500, 50);
      insUsage.run("u3", "lurker", "user", "builtin", "m-lurk", "main", mid, 7000, 700);
      db.close(); db = null; // collectRunTokens opens its own read-only handle

      // Session-scoped call: sessionId supplied → interloper excluded, child included, exact.
      const ex = collectRunTokens({ repoRoot: repo, startMs, endMs, dbPath, sessionId: "orch" });
      check("(b) session-scoped call returns a populated object", ex !== null && typeof ex === "object", `got ${JSON.stringify(ex)}`);
      check('(b) attribution === "session"', ex?.attribution === "session", `got ${JSON.stringify(ex?.attribution)}`);
      check('(b) confidence === "exact"', ex?.confidence === "exact", `got ${JSON.stringify(ex?.confidence)}`);
      check("(b) child included, interloper excluded (sessions.total === 2)", ex?.sessions?.total === 2, `got ${JSON.stringify(ex?.sessions?.total)}`);
      check("(b) totals exclude the interloper (total === 1650, not 9350)", ex?.totals?.total === 1650, `got ${JSON.stringify(ex?.totals?.total)}`);
      check("(b) window stays as a sanity bound under session scoping", ex?.window?.start_ms === startMs && ex?.window?.end_ms === endMs, `got ${JSON.stringify(ex?.window)}`);

      // Fallback control: NO sessionId → today's (repo, window) heuristic, unchanged in shape.
      // These assertions pass on BOTH builds — the fallback must not move when the fix lands.
      const fb = collectRunTokens({ repoRoot: repo, startMs, endMs, dbPath });
      check("(b) fallback returns a populated object", fb !== null && typeof fb === "object", `got ${JSON.stringify(fb)}`);
      check('(b) fallback attribution === "time-window"', fb?.attribution === "time-window", `got ${JSON.stringify(fb?.attribution)}`);
      check('(b) fallback confidence === "estimate"', fb?.confidence === "estimate", `got ${JSON.stringify(fb?.confidence)}`);
      check("(b) fallback counts all three sessions (sessions.total === 3)", fb?.sessions?.total === 3, `got ${JSON.stringify(fb?.sessions?.total)}`);
      check("(b) fallback totals include the interloper (total === 9350)", fb?.totals?.total === 9350, `got ${JSON.stringify(fb?.totals?.total)}`);
      check("(b) fallback echoes repo, repo_aliases and window unchanged", fb?.repo === dir
        && JSON.stringify(fb?.repo_aliases) === JSON.stringify(repoAliases(repo))
        && fb?.window?.start_ms === startMs && fb?.window?.end_ms === endMs,
      `got ${JSON.stringify(fb?.repo)} / ${JSON.stringify(fb?.repo_aliases)} / ${JSON.stringify(fb?.window)}`);
    } finally {
      try { if (db) db.close(); } catch { /* already closed */ }
      rmSync(repo, { recursive: true, force: true }); // temp DB deleted inside the test
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
exit(fail === 0 ? 0 : 1);
