#!/usr/bin/env node
// registry-report.mjs — the narrator trust registry: cross-run agent-reliability scores (ISNAD R2,
// jarḥ/taʿdīl). Scan-and-recompute; never append-accrete.
//
// WHY THIS EXISTS: the eval loop measures and improves nothing. judge.mjs and run-report.mjs score
// every run, metis reads recall-outcomes/recall-corrections at consult — but no mechanism tracks
// whether a given AGENT CONFIGURATION's verdicts held up under independent scrutiny, and feeds that
// back into the next run's risk assessment. The ISNAD-engine study (2026-08-17, queue row 19)
// supplied the missing design: a source registry whose entries are (a) keyed on the CONFIGURATION,
// never the model name — "stochastic narrators": trust attaches to model + prompt + params, so a
// prompt edit resets identity structurally (the content hash IS the decay, no timers); (b) updated
// only by deterministic arithmetic over already-recorded outcomes — never by a new LLM opinion
// (ROADMAP §3 non-goal); (c) always displayed with their sample count n — a decimal without its n
// is how sparse data launders itself as knowledge (the ISNAD output contract).
//
// EVIDENCE (read-only inputs; this script writes only its own ledger):
//   consult lane — every <repo>/.zcode/state/<slug>.json with review.verdict OKAY and a
//     consult.history[] round (written by trusted consult.mjs under its O_EXCL lock — that lock is
//     the integrity boundary we accept; outcomes.jsonl is deliberately NOT ingested: it is an
//     unauthenticated plain append):
//       round.verdict ACCEPT            → momus config        success
//       round.verdict REJECT, gap.category "compliance"       → momus config        miss
//              (momus OKAY'd a plan that failed external compliance)
//       round.verdict REJECT, gap.category bug|quality|security → sisyphus-junior  miss
//              (output defect from the executor config; config-level attribution, per ISNAD)
//   judge lane — ~/.zcode/orchestration/eval/judged.jsonl, records whose arm derives "zodyssey"
//     (lib/arm.mjs; baseline rows are the control arm, not the system under test):
//       criterion_results[].met true/false → sisyphus-junior success/miss.
//       KNOWN ASSUMPTION: judged records predate agent hashing, so judge evidence attributes to the
//       CURRENT config key (rows carry source "judge"; JSON entries set assumed_current_config).
//
// TRUST: (s+1)/(s+m+2) — Laplace-smoothed ratio, cold-start prior 0.50 at n=0. Never a gate: the
// registry is advisory, consumed by metis at consult (prompt guidance, not enforcement — the
// repo's "enforce invariants with code; guide choices with prompts" split).
//
// IDEMPOTENCE: evidence rows carry stable ids (`<repoBase>:<slug>:consult:<round>[:g<i>]`,
// `judge:<slug>:<seed_id>:<at>:c<i>`); re-scanning a repo re-derives the same ids and appends
// nothing — within the rolling cap: rows aged out past the 1000-line capJsonl are re-appended on
// the next scan under the same ids (harmless at current volumes; the cap is the same policy the
// eval ledgers use).
//
// Usage:
//   registry-report.mjs <repo> [--json] [--min-n <k>] [--store <dir>]
//     <repo>    the run repo whose .zcode/state/*.json are scanned
//     --store   override the ledger dir (default ~/.zcode/orchestration/registry; env
//               ZODYSSEY_REGISTRY_DIR). Ledger file: <store>/narrators.jsonl
//               judged.jsonl is read from ZODYSSEY_EVAL_DIR (default ~/.zcode/orchestration/eval).
//     --min-n   filter entries with n < k from the output (data still recorded)
//   exit: 0 ok · 2 bad args · 3 no state dir

import { readFileSync, writeFileSync, existsSync, appendFileSync, readdirSync, mkdirSync, realpathSync, renameSync } from "node:fs";
import { join, basename } from "node:path";
import { argv, exit, env } from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { armFromSlug } from "./lib/arm.mjs";

const [repoArg, ...rest] = argv.slice(2);
if (!repoArg || repoArg.startsWith("--")) {
  console.error("usage: registry-report.mjs <repo> [--json] [--min-n <k>] [--store <dir>]");
  exit(2);
}
const asJson = rest.includes("--json");
const minNIdx = rest.indexOf("--min-n");
const minN = minNIdx !== -1 ? parseInt(rest[minNIdx + 1], 10) : 0;
const storeIdx = rest.indexOf("--store");
if (minNIdx !== -1 && !Number.isFinite(minN)) { console.error("registry-report.mjs: --min-n requires an integer"); exit(2); }
if (storeIdx !== -1 && !rest[storeIdx + 1]) { console.error("registry-report.mjs: --store requires a directory"); exit(2); }
// positional-only argv guard: a missing flag value would otherwise consume the NEXT flag as the
// value (e.g. `--store --json` silently creating a directory named "--json")
if (storeIdx !== -1 && /^--/.test(rest[storeIdx + 1] || "")) { console.error("registry-report.mjs: --store requires a directory (got a flag)"); exit(2); }
if (minNIdx !== -1 && /^--/.test(rest[minNIdx + 1] || "")) { console.error("registry-report.mjs: --min-n requires an integer (got a flag)"); exit(2); }

const repoAbs = (() => { try { return realpathSync(repoArg); } catch { return repoArg; } })();
const repoBase = basename(repoAbs);
const stateDir = join(repoAbs, ".zcode", "state");
if (!existsSync(stateDir)) {
  console.error(`registry-report.mjs: no state dir at ${stateDir} — nothing to scan`);
  exit(3);
}
const storeDir = storeIdx !== -1 ? rest[storeIdx + 1] : (env.ZODYSSEY_REGISTRY_DIR || join(env.HOME || "", ".zcode", "orchestration", "registry"));
const evalDir = env.ZODYSSEY_EVAL_DIR || join(env.HOME || "", ".zcode", "orchestration", "eval");
const ledgerPath = join(storeDir, "narrators.jsonl");

// --- agent-config identity (the ISNAD stochastic-narrator rule) ----------------------------
// Trust attaches to the CONFIGURATION (the deployed agents/<name>.md bytes), never the model name.
// A prompt edit changes the hash → a new key at the cold-start prior. Resolved self-relative like
// pre-tool.mjs's install root: this script lives at <root>/skills/odyssey/scripts/, agents at
// <root>/agents/. No agent file carries a version field; the content hash is the only identity.
function agentKey(name) {
  const p = fileURLToPath(new URL(`../../../agents/${name}.md`, import.meta.url));
  try {
    return `${name}@${createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12)}`;
  } catch {
    process.stderr.write(`registry-report.mjs: warning — cannot read ${p}; keying ${name}@unresolved\n`);
    return `${name}@unresolved`;
  }
}
const MOMUS_KEY = agentKey("momus");
const EXECUTOR_KEY = agentKey("sisyphus-junior");
// Gap categories normalized to lowercase; anything outside the auditor contract is skipped loudly.
const MOMUS_GAP = new Set(["compliance"]);
const EXECUTOR_GAP = new Set(["bug", "quality", "security"]);

// --- existing ledger ids (idempotence) ------------------------------------------------------
function readLedger() {
  if (!existsSync(ledgerPath)) return [];
  const out = [];
  for (const line of readFileSync(ledgerPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* one bad line must not blind the registry */ }
  }
  return out;
}
const ledger = readLedger();
const knownIds = new Set(ledger.map((r) => r.id));

// --- scan the repo's state files -------------------------------------------------------------
const newRows = [];
let scannedStates = 0, skippedMalformed = 0;
for (const f of readdirSync(stateDir).filter((f) => f.endsWith(".json")).sort()) {
  let st;
  try { st = JSON.parse(readFileSync(join(stateDir, f), "utf8")); }
  catch { skippedMalformed++; process.stderr.write(`registry-report.mjs: skipping malformed state ${f}\n`); continue; }
  scannedStates++;
  const slug = typeof st.slug === "string" ? st.slug : f.replace(/\.json$/, "");
  // Momus attribution requires that she actually approved (the run executed under her OKAY).
  if (!(st.review && st.review.verdict === "OKAY" && Array.isArray(st.consult?.history))) continue;
  for (const h of st.consult.history) {
    if (!h || typeof h.round !== "number") continue;
    const baseId = `${repoBase}:${slug}:consult:${h.round}`;
    const at = typeof h.at === "string" ? h.at : null;
    if (h.verdict === "ACCEPT") {
      if (!knownIds.has(baseId)) newRows.push({ id: baseId, key: MOMUS_KEY, agent: "momus", outcome: "success", at, source: "consult", repo: repoBase });
    } else if (h.verdict === "REJECT" && Array.isArray(h.gaps)) {
      h.gaps.forEach((g, i) => {
        const cat = String(g && g.category || "").toLowerCase();
        const key = MOMUS_GAP.has(cat) ? MOMUS_KEY : EXECUTOR_GAP.has(cat) ? EXECUTOR_KEY : null;
        if (!key) { process.stderr.write(`registry-report.mjs: skipping gap with unknown category "${cat}" in ${slug} round ${h.round}\n`); return; }
        const id = `${baseId}:g${i}`;
        if (!knownIds.has(id)) newRows.push({ id, key, agent: key === MOMUS_KEY ? "momus" : "sisyphus-junior", outcome: "miss", at, source: "consult", repo: repoBase });
      });
    }
  }
}

// --- judge lane (global file, zodyssey-arm records only) -------------------------------------
let judgeRecords = 0;
const judgedPath = join(evalDir, "judged.jsonl");
if (existsSync(judgedPath)) {
  for (const line of readFileSync(judgedPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let rec;
    try { rec = JSON.parse(t); } catch { continue; }
    if (!rec || typeof rec.slug !== "string") continue;
    if (armFromSlug(rec.slug) !== "zodyssey") continue; // baseline rows are the control arm
    if (!Array.isArray(rec.criterion_results)) continue;
    judgeRecords++;
    const baseId = `judge:${rec.slug}:${rec.seed_id}:${rec.at}`;
    rec.criterion_results.forEach((c, i) => {
      const id = `${baseId}:c${i}`;
      if (knownIds.has(id)) return;
      newRows.push({ id, key: EXECUTOR_KEY, agent: "sisyphus-junior", outcome: c && c.met === true ? "success" : "miss", at: rec.at || null, source: "judge", repo: null });
    });
  }
}

// --- write + cap (rolling 1000, same policy as the eval ledgers) -----------------------------
if (newRows.length > 0) {
  mkdirSync(storeDir, { recursive: true });
  appendFileSync(ledgerPath, newRows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  try {
    const lines = readFileSync(ledgerPath, "utf8").split("\n").filter((l) => l.trim());
    if (lines.length > 1000) {
      const tmp = ledgerPath + ".tmp." + process.pid;
      writeFileSync(tmp, lines.slice(lines.length - 1000).join("\n") + "\n");
      renameSync(tmp, ledgerPath);
    }
  } catch { /* advisory */ }
}

// --- aggregate --------------------------------------------------------------------------------
const all = newRows.length > 0 ? [...readLedger()] : ledger; // re-read only if we wrote
const agg = new Map();
for (const r of all) {
  if (!r || typeof r.key !== "string") continue;
  let e = agg.get(r.key);
  if (!e) { e = { key: r.key, agent: r.agent || r.key.split("@")[0], success: 0, miss: 0, last_at: null, sources: new Set() }; agg.set(r.key, e); }
  if (r.outcome === "success") e.success++; else if (r.outcome === "miss") e.miss++;
  if (r.at && (!e.last_at || r.at > e.last_at)) e.last_at = r.at;
  if (r.source) e.sources.add(r.source);
}
const entries = [...agg.values()]
  .map((e) => {
    const n = e.success + e.miss;
    return {
      key: e.key, agent: e.agent,
      success: e.success, miss: e.miss, n,
      trust: Math.round(((e.success + 1) / (n + 2)) * 100) / 100,
      last_at: e.last_at,
      sources: [...e.sources].sort(),
      ...(e.sources.has("judge") ? { assumed_current_config: true } : {}),
    };
  })
  .filter((e) => e.n >= minN)
  .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));

// --- output -----------------------------------------------------------------------------------
if (asJson) {
  console.log(JSON.stringify({
    scanned_repo: repoBase, states_scanned: scannedStates, states_skipped_malformed: skippedMalformed,
    judge_records: judgeRecords, evidence_rows_new: newRows.length, evidence_rows_total: all.length,
    entries,
  }, null, 2));
  exit(0);
}

console.log(`\n  narrator trust registry — ${repoBase}: ${scannedStates} state file(s) scanned, ${newRows.length} new evidence row(s), ${all.length} total`);
  console.log(`  (judge lane: ${judgeRecords} zodyssey-arm judged record(s) from ${judgedPath})`);
if (entries.length === 0) {
  console.log("  no evidence yet — every narrator config stands at the cold-start prior: trust 0.50, n=0");
}
for (const e of entries) {
  console.log(`  ${e.key.padEnd(28)} trust ${String(e.trust).padEnd(5)} n=${String(e.n).padEnd(4)} (s=${e.success} m=${e.miss})  last ${e.last_at ?? "—"}${e.assumed_current_config ? "  [judge evidence assumes current config]" : ""}`);
}
console.log(`
  attribution: consult ACCEPT after momus OKAY → momus ✓ · REJECT compliance gap → momus ✗ ·
  REJECT bug/quality/security gap → executor ✗ · judged criterion met/unmet → executor ✓/✗
  trust = (s+1)/(s+m+2) — Laplace-smoothed; n is ALWAYS the count behind the score.
  advisory only: consumed by metis at consult, never a gate. A config edit starts a new key
  (structural decay — trust attaches to the configuration, never the model name).`);
exit(0);
