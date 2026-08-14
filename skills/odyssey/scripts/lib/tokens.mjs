// tokens.mjs — per-run token accounting from ZCode's own telemetry.
//
// WHY: run-report.mjs has carried `const tokensPerTodo = null; // populated when ZCode exposes
// per-run token counts` since it was written. ZCode does expose them — every model request is
// recorded — so the field was waiting on plumbing, not on a platform feature.
//
// WHERE THE DATA LIVES (and where it does NOT):
//   ~/.zcode/cli/rollout/model-io-sess_*.jsonl is EPHEMERAL — ZCode deletes it when the session
//   ends, so a tool built on it finds nothing for any finished run. (Confirmed by watching a 38MB
//   rollout file disappear mid-read.) The durable source is the SQLite DB below, whose totals were
//   verified byte-identical to the rollout numbers for the same session.
//
// THREE ARITHMETIC RULES, each of which silently corrupts a total if ignored:
//   1. inputTokens ALREADY INCLUDES cacheReadTokens. Summing input + cache_read double-charges the
//      cached portion. Bill (input - cache_read) at full rate and cache_read at the cache rate.
//   2. model_usage and turn_usage are the SAME data at different granularity. Summing both triples
//      the count. Use model_usage only.
//   3. retry_count is folded into a row; it is not extra requests. Do not sum it as such.
//
// ATTRIBUTION is repo-exact but run-heuristic: sessions record their directory, not the ZOdyssey
// slug, so a run is identified by (repo, time-window). Two concurrent runs in one repo cannot be
// separated. Reported honestly as confidence:"estimate" — stamping the harness session id into
// state would make it exact, which is the follow-up.
//
// COST is opt-in. The provider here (builtin:zai-coding-plan, GLM-*) is a FLAT-RATE subscription
// whose local catalog lists cost:0 for these models, so a dollar figure would be a shadow price
// against published per-token rates rather than a bill. Tokens are the honest unit; pass `rates`
// to add a cost column when you have real numbers.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { repoAliases } from "./repo-path.mjs";

const DEFAULT_DB = join(homedir(), ".zcode", "cli", "db", "db.sqlite");

const blank = () => ({
  requests: 0, input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0,
  billable_input: 0, total: 0,
});
function fold(acc, r) {
  const input = r.input_tokens || 0;
  const cacheRead = r.cache_read_input_tokens || 0;
  acc.requests++;
  acc.input += input;
  acc.output += r.output_tokens || 0;
  acc.cache_read += cacheRead;
  acc.cache_write += r.cache_creation_input_tokens || 0;
  acc.reasoning += r.reasoning_tokens || 0;
  // Rule 1: the uncached remainder is what bills at full input rate.
  acc.billable_input += Math.max(0, input - cacheRead);
  acc.total += input + (r.output_tokens || 0);
  return acc;
}
const cost = (a, rate) => rate
  ? (a.billable_input * (rate.input || 0) + a.cache_read * (rate.cache_read || 0)
    + a.cache_write * (rate.cache_write || 0) + a.output * (rate.output || 0)) / 1e6
  : null;

/**
 * Collect token usage for one run. Returns null (never throws) when the DB is missing, locked, or
 * the node:sqlite binding is unavailable — run-report must not fail because telemetry is absent.
 *
 * @param {{repoRoot: string, startMs: number, endMs: number, rates?: object, dbPath?: string}} o
 */
export function collectRunTokens({ repoRoot, startMs, endMs, rates = null, dbPath = DEFAULT_DB } = {}) {
  if (!repoRoot || !Number.isFinite(startMs)) return null;
  if (!existsSync(dbPath)) return null;

  let DatabaseSync;
  try { ({ DatabaseSync } = require$sqlite()); } catch { return null; }
  if (!DatabaseSync) return null;

  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch { return null; }
  try {
    const aliases = repoAliases(repoRoot);
    if (aliases.length === 0) return null;
    const end = Number.isFinite(endMs) ? endMs : Date.now();
    const placeholders = aliases.map(() => "?").join(",");
    // status='completed' drops error/cancelled rows, which carry 0 tokens anyway.
    // Rule 2: model_usage ONLY — turn_usage is the same data rolled up per turn.
    const rows = db.prepare(
      `SELECT mu.model_id, mu.provider_id, mu.agent, mu.query_source, mu.session_id,
              mu.input_tokens, mu.output_tokens, mu.reasoning_tokens,
              mu.cache_read_input_tokens, mu.cache_creation_input_tokens
         FROM model_usage mu
         JOIN session s ON s.id = mu.session_id
        WHERE s.directory IN (${placeholders})
          AND mu.started_at >= ? AND mu.started_at <= ?
          AND mu.status = 'completed'`
    ).all(...aliases, startMs, end);

    if (!rows || rows.length === 0) return null;

    const totals = blank();
    const byModel = {}, byAgent = {}, byRole = { orchestrator: blank(), subagent: blank() };
    const sessions = new Set(), subSessions = new Set();
    for (const r of rows) {
      fold(totals, r);
      const m = r.model_id || "unknown";
      fold((byModel[m] ||= blank()), r);
      const a = r.agent || "unknown";
      fold((byAgent[a] ||= blank()), r);
      // The harness records the role directly, so the orchestrator/sub-agent split needs no joins.
      const isSub = String(r.query_source || "").includes("subagent") || String(r.agent || "").includes(":");
      fold(byRole[isSub ? "subagent" : "orchestrator"], r);
      sessions.add(r.session_id);
      if (isSub) subSessions.add(r.session_id);
    }

    const withCost = (a) => ({ ...a, cost_usd: cost(a, rates && (rates.default || null)) });
    return {
      source: "zcode-db",
      attribution: "time-window",
      confidence: "estimate", // exact once the harness session id is stamped into run state
      window: { start_ms: startMs, end_ms: end },
      sessions: { total: sessions.size, subagent: subSessions.size },
      totals: withCost(totals),
      by_model: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, { ...v, cost_usd: cost(v, rates && (rates[k] || rates.default)) }])),
      by_role: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, withCost(v)])),
      by_agent: Object.fromEntries(Object.entries(byAgent).map(([k, v]) => [k, withCost(v)])),
      cache_hit_ratio: totals.input > 0 ? totals.cache_read / totals.input : 0,
      rates_source: rates ? "user" : null,
    };
  } catch {
    return null;
  } finally {
    try { db.close(); } catch {}
  }
}

// node:sqlite is only present on newer Node; isolate the import so an older runtime degrades to
// "no telemetry" rather than crashing the caller.
function require$sqlite() {
  // eslint-disable-next-line no-undef
  return globalThis.__zodysseySqlite || (globalThis.__zodysseySqlite = loadSqlite());
}
function loadSqlite() {
  try {
    const { createRequire } = globalThis.__zodysseyCreateRequire || {};
    void createRequire;
  } catch { /* ignore */ }
  try {
    // Synchronous access to a built-in module without a top-level await.
    return process.getBuiltinModule ? process.getBuiltinModule("node:sqlite") : null;
  } catch {
    return null;
  }
}
