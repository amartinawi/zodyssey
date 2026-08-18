#!/usr/bin/env node
// check-claims.mjs — the claim→assertion coverage checker (item 08).
//
// Re-verifies every row of a claims ledger (default: sibling claims-ledger.mjs) against the
// tree, mechanically: duplicate id · missing/empty required field · asserted_by is prose (.md)
// · asserted_by missing on disk · marker absent from asserted_by · unknown kind · kind "suite"
// bound to a file run-tests.mjs would never run (not *.test.mjs, or under a skip dir) ·
// documented_at file missing or line beyond EOF (anchor liveness, not content). kind
// "release-gate" rows verify file + marker only.
//
// Exit semantics — fail closed within the ledger's domain, inert when the capability is absent:
//   0  every row resolves  — one OK line per row id + a summary
//   1  any finding         — one line per finding, each naming its row id
//   0  no ledger at path   — `inert: no claims ledger at <path>` (--ledger is an input selector
//                            for fixtures, never a suppressor; there is no suppression flag)
//
// Library use: `import { checkClaims } from "./check-claims.mjs"` — takes the ledger path
// (absolute or repo-root-relative), returns { ok, rows, findings }.
//
// Run: node scripts/check-claims.mjs [--ledger <path>]

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // repo root (scripts/..)
const DEFAULT_LEDGER = fileURLToPath(new URL("./claims-ledger.mjs", import.meta.url));

// Must stay in sync with the discovery skip list in scripts/run-tests.mjs:36 — a suite under
// one of these is a suite nothing runs, i.e. a claim bound to nothing.
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".zcode", "dist", "build", "coverage", ".claude-flow", ".swarm",
]);
const KINDS = new Set(["suite", "release-gate"]);
const REQUIRED = ["id", "documented_at", "asserted_by", "kind", "marker"];

const fromRoot = (p) => (isAbsolute(p) ? p : join(ROOT, p));

// Verifies every row of the ledger at `ledgerPath` (absolute or repo-root-relative) and
// returns { ok, rows, findings }. Findings are strings, each naming its row's id.
export async function checkClaims(ledgerPath) {
  const resolvedLedger = fromRoot(ledgerPath);
  if (!existsSync(resolvedLedger)) {
    return {
      ok: false, rows: [],
      findings: [`no claims ledger at ${resolvedLedger} (direct checkClaims load is fail-closed; the CLI reports this state as inert)`],
    };
  }
  let rows;
  try {
    rows = (await import(pathToFileURL(resolvedLedger).href)).CLAIMS;
  } catch (err) {
    return { ok: false, rows: [], findings: [`ledger at ${resolvedLedger} failed to load: ${err.message}`] };
  }
  if (!Array.isArray(rows)) {
    return { ok: false, rows: [], findings: [`ledger at ${resolvedLedger} exports no CLAIMS array`] };
  }

  const findings = [];
  const seenIds = new Set();
  for (const [index, row] of rows.entries()) {
    const hasId = row && typeof row === "object" && typeof row.id === "string" && row.id !== "";
    const id = hasId ? row.id : `row #${index}`;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      findings.push(`${id}: not a claim row object`);
      continue;
    }
    if (hasId && seenIds.has(row.id)) findings.push(`${id}: duplicate row id (defined more than once)`);
    else if (hasId) seenIds.add(row.id);

    const missing = REQUIRED.filter((f) => typeof row[f] !== "string" || row[f] === "");
    if (missing.length > 0) {
      findings.push(`${id}: missing/empty required field(s): ${missing.join(", ")}`);
      continue; // the field-level checks below are meaningless without the fields
    }
    if (!KINDS.has(row.kind)) {
      findings.push(`${id}: unknown kind "${row.kind}" (known kinds: suite, release-gate)`);
    }

    // asserted_by — where the claim is PROVEN. Prose (.md) is a hard finding for every kind:
    // prose is not an assertion. release-gate rows check file + marker only (no .test.mjs shape).
    const assertedAbs = fromRoot(row.asserted_by);
    if (row.asserted_by.endsWith(".md")) {
      findings.push(`${id}: asserted_by "${row.asserted_by}" is prose (.md) — prose is not an assertion`);
    } else if (!existsSync(assertedAbs)) {
      findings.push(`${id}: asserted_by "${row.asserted_by}" is missing on disk`);
    } else {
      const source = readFileSync(assertedAbs, "utf8");
      if (!source.includes(row.marker)) {
        findings.push(`${id}: marker not found in ${row.asserted_by} — the binding is broken`);
      }
      if (row.kind === "suite") {
        if (!row.asserted_by.endsWith(".test.mjs")) {
          findings.push(`${id}: kind "suite" but asserted_by "${row.asserted_by}" is not a *.test.mjs — run-tests.mjs will never run it`);
        }
        const skipDir = assertedAbs.split(sep).find((segment) => SKIP_DIRS.has(segment));
        if (skipDir) {
          findings.push(`${id}: asserted_by sits under "${skipDir}${sep}" — a run-tests.mjs skip directory, a suite nothing runs`);
        }
      }
    }

    // documented_at — where the claim is STATED ("path:line"). Liveness only: the file must
    // exist and the line must be within EOF; drift within the file is tolerated, a deleted
    // doc is not.
    const colon = row.documented_at.lastIndexOf(":");
    const docPath = colon === -1 ? "" : row.documented_at.slice(0, colon);
    const docLine = colon === -1 ? NaN : Number(row.documented_at.slice(colon + 1));
    if (docPath === "" || !Number.isInteger(docLine)) {
      findings.push(`${id}: documented_at "${row.documented_at}" is not in path:line form`);
    } else {
      const docAbs = fromRoot(docPath);
      if (!existsSync(docAbs)) {
        findings.push(`${id}: documented_at file "${docPath}" is missing on disk`);
      } else {
        const lineCount = readFileSync(docAbs, "utf8").split("\n").length;
        if (docLine < 1 || docLine > lineCount) {
          findings.push(`${id}: documented_at line ${docLine} is beyond EOF of ${docPath} (${lineCount} lines)`);
        }
      }
    }
  }
  return { ok: findings.length === 0, rows, findings };
}

// --- CLI (runs only when this file is the Node entry point, not when imported by the suite) ---

const isEntry =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntry) {
  const argv = process.argv;
  let ledgerArg = DEFAULT_LEDGER;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--ledger" && i + 1 < argv.length) ledgerArg = argv[++i];
    else if (argv[i].startsWith("--ledger=")) ledgerArg = argv[i].slice("--ledger=".length);
  }
  const resolved = fromRoot(ledgerArg);
  if (!existsSync(resolved)) {
    console.log(`inert: no claims ledger at ${resolved}`);
    process.exit(0);
  }
  const { ok, rows, findings } = await checkClaims(resolved);
  if (ok) {
    for (const row of rows) console.log(`ok: ${row.id} -> ${row.asserted_by}`);
    console.log(`summary: ${rows.length}/${rows.length} rows resolve, ${findings.length} findings`);
    process.exit(0);
  }
  for (const finding of findings) console.log(`finding: ${finding}`);
  console.log(`summary: 0/${rows.length} rows resolve, ${findings.length} finding(s)`);
  process.exit(1);
}
