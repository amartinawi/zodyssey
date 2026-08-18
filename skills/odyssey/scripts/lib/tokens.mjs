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
// ATTRIBUTION has two modes. Default is repo-exact but run-heuristic: sessions record their
// directory, not the ZOdyssey slug, so a run is identified by (repo, time-window) — two concurrent
// runs in one repo cannot be separated, reported honestly as confidence:"estimate". When the
// caller passes the run's witnessed session id, the scope narrows to that session and its children
// (s.id = sid OR s.parent_id = sid): confidence:"exact", concurrent unlinked sessions excluded.
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

// Degraded arms return a STAMPED inert, never a bare null: a null hid "the DB was locked" behind
// the same value as "nothing was measured", and the trend log could not tell them apart. The
// reason set is closed on purpose (bad-args | db-missing | binding-unavailable | db-unreachable |
// no-usage-in-window) so records partition without parsing free-form text.
const inert = (reason) => ({ inert: true, reason, node_version: process.version, at: new Date().toISOString() });

// The binding arm names its floor because the absence is EXPECTED on the engines floor, not an
// anomaly: node:sqlite requires Node >= 22.5 while this package supports >= 18, so a Node-18
// machine closes runs and records exactly why telemetry is absent.
const BINDING_UNAVAILABLE = "binding-unavailable: node:sqlite requires Node >= 22.5; the engines floor is >= 18";

/**
 * Collect token usage for one run. Returns a reason-stamped inert object (never null, never
 * throws) when the DB is missing, locked, the node:sqlite binding is unavailable, or no usage
 * falls in the window — run-report must not fail because telemetry is absent, but it must be able
 * to say WHY the numbers are absent.
 *
 * @param {{repoRoot: string, startMs: number, endMs: number, rates?: object, dbPath?: string,
 *          sessionId?: string}} o  sessionId, when a non-empty string, scopes usage to that
 *          session and its children (attribution "session", confidence "exact"); absent falls
 *          back to the (repo, time-window) heuristic (confidence "estimate").
 */
export function collectRunTokens({ repoRoot, startMs, endMs, rates = null, dbPath = DEFAULT_DB, sessionId = null } = {}) {
  if (!repoRoot || !Number.isFinite(startMs)) return inert("bad-args");
  if (!existsSync(dbPath)) return inert("db-missing");

  let DatabaseSync;
  try { ({ DatabaseSync } = require$sqlite()); } catch { return inert(BINDING_UNAVAILABLE); }
  if (!DatabaseSync) return inert(BINDING_UNAVAILABLE);

  let db;
  try { db = new DatabaseSync(dbPath, { readOnly: true }); } catch { return inert("db-unreachable"); }
  const sid = typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
  try {
    const aliases = repoAliases(repoRoot);
    if (aliases.length === 0) return inert("bad-args");
    const end = Number.isFinite(endMs) ? endMs : Date.now();
    const placeholders = aliases.map(() => "?").join(",");
    // Session mode: the run's own session plus its sub-agent children (parent_id linkage) —
    // concurrent sessions in the same repo are excluded. The window stays as a sanity bound in
    // both modes: it can only narrow, never widen, what the lineage already scopes.
    const sessionPredicate = sid ? " AND (s.id = ? OR s.parent_id = ?)" : "";
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
          AND mu.status = 'completed'${sessionPredicate}`
    ).all(...aliases, startMs, end, ...(sid ? [sid, sid] : []));

    if (!rows || rows.length === 0) return inert("no-usage-in-window");

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
      attribution: sid ? "session" : "time-window",
      // Session mode echoes its third scoping key (the sid the lineage is anchored to); the
      // heuristic mode adds nothing, so its shape stays byte-comparable to the pre-session output.
      ...(sid ? { session_id: sid } : {}),
      // The scoping keys, echoed back. Attribution is (repo x window), or (repo x window x
      // session lineage) when a sid was supplied, so a figure quoted without all of them is not
      // reproducible — two readers comparing "the audit run" landed on 10.8M and 24.3M and
      // neither was wrong. repo is the normalized path actually matched.
      repo: aliases[0],
      repo_aliases: aliases,
      // Exact only under session scoping — every counted row's session IS the run or its child.
      // The heuristic mode can say no more than "this repo, this window".
      confidence: sid ? "exact" : "estimate",
      window: { start_ms: startMs, end_ms: end },
      sessions: { total: sessions.size, subagent: subSessions.size },
      totals: withCost(totals),
      by_model: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, { ...v, cost_usd: cost(v, rates && (rates[k] || rates.default)) }])),
      by_role: Object.fromEntries(Object.entries(byRole).map(([k, v]) => [k, withCost(v)])),
      by_agent: Object.fromEntries(Object.entries(byAgent).map(([k, v]) => [k, withCost(v)])),
      cache_hit_ratio: totals.input > 0 ? totals.cache_read / totals.input : 0,
      // Shares, with the DENOMINATOR NAMED. Two readers independently summarised the same run as
      // "orchestrator 90.7%" and "orchestrator 50.7%" and both were right — one meant share of
      // input+output, the other share of input. A bare percentage in a report is unfalsifiable
      // without its denominator, and these numbers are also window-sensitive, so `window` above
      // is part of the claim, not context. Quote a share WITH its key or not at all.
      shares: {
        orchestrator_of_total: totals.total > 0 ? (byRole.orchestrator?.total || 0) / totals.total : 0,
        orchestrator_of_input: totals.input > 0 ? (byRole.orchestrator?.input || 0) / totals.input : 0,
        subagent_of_total: totals.total > 0 ? (byRole.subagent?.total || 0) / totals.total : 0,
        cache_read_of_input: totals.input > 0 ? totals.cache_read / totals.input : 0,
        billable_input_of_input: totals.input > 0 ? totals.billable_input / totals.input : 0,
      },
      rates_source: rates ? "user" : null,
    };
  } catch {
    // Query/bind failure incl. a locked DB — reachable is not the same as readable.
    return inert("db-unreachable");
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
