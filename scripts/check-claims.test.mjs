#!/usr/bin/env node
// check-claims.test.mjs — the suite that pins the claim→assertion coverage ledger (item 08).
//
// WHY THIS EXISTS: the repo states its guarantees in prose (AGENTS.md, docs/DESIGN.md,
// docs/DEVELOPMENT.md, CHANGELOG.md) and proves them in scattered assertion files, but nothing
// connects the two. Deleting scripts/version-consistency.test.mjs today leaves every "the three
// manifests must agree" claim unbacked AND the suite green — the exact class this repo keeps
// being bitten by. The ledger binds each documented claim to the assertion that proves it; the
// checker re-verifies every binding mechanically; THIS suite pins the checker, the ledger's row
// floor, and the five incident ids, so none of the three can silently die.
//
// TDD ORDER (the prove-it-fails rule): this file is committed RED, BEFORE scripts/check-claims.mjs
// and scripts/claims-ledger.mjs exist. In that tree the two imports below are unresolvable and
// this suite exits 1 by construction — the demonstration that these assertions actually run (the
// run-tests.mjs zero-discovered lesson, one level up). The implementation lands afterwards and
// must turn every test below green WITHOUT weakening any of them.
//
// THE CONTRACT THIS SUITE IMPOSES ON THE IMPLEMENTATION:
//   scripts/check-claims.mjs exports `checkClaims(ledgerPath)` (sync or async) taking the path
//   to a ledger module (absolute or repo-root-relative), which loads the ledger's `CLAIMS`
//   array, mechanically verifies every row, and returns `{ ok, rows, findings }`:
//     · ok        — boolean, true iff findings.length === 0
//     · rows      — the loaded row objects ({ id, documented_at, asserted_by, kind, marker })
//     · findings  — array of strings, each one naming the offending row's id
//   Row file paths (asserted_by, and the file part of a "path:line" documented_at) resolve
//   repo-root-relative or absolute — the real ledger uses repo-relative paths; the fixtures
//   below use absolute paths into their own tmp dirs so only the seeded defect can fail.
//   CLI shape (pinned by test (h) and the impl doc): `node scripts/check-claims.mjs
//   [--ledger <path>]` exits 1 with one line per finding when any row fails; exit 0 with one OK
//   line per row id plus a summary when all resolve; exit 0 with an `inert:` line when the
//   ledger file itself is absent (a missing capability, never a block).
//
// Run:  node scripts/check-claims.test.mjs          (exit 0 = pass, 1 = fail)
//       node --test scripts/check-claims.test.mjs   (same)

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Unresolvable until the implementation lands — that un-resolvability IS the committed red state.
import { checkClaims } from "./check-claims.mjs";
import { CLAIMS } from "./claims-ledger.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // repo root
const CHECKER = join(ROOT, "scripts", "check-claims.mjs");
const LEDGER = join(ROOT, "scripts", "claims-ledger.mjs");

// The five incident ids the ledger must pin. Deletable only by failing test (b).
const INCIDENT_IDS = [
  "BASH-GATE-REGRESSION",
  "GATE-SURFACE-INVARIANTS",
  "VERSION-CONSISTENCY",
  "SMOKE-GATE-LIVE",
  "DEPLOY-SURFACE-COVERAGE",
];

// ---------------------------------------------------------------------------
// Hermetic fixtures: each test builds a fresh tmp dir with its own assertion
// target, doc file, and ledger module whose rows point at them by ABSOLUTE
// path. No fixture depends on repo content, so exactly the seeded defect fails.
// ---------------------------------------------------------------------------

const MARKER = "the marker that proves the binding";

function validFiles() {
  return {
    // Well-formed suite target: exists, ends .test.mjs, carries the marker on a single line.
    "target.test.mjs": `// fixture assertion file\ntest("fixture", () => { /* ${MARKER} */ });\n`,
    // Well-formed documented_at target: exists, line 1 within EOF.
    "doc.md": `# fixture doc\nThe claim this fixture row documents.\n`,
    // A NON-test target (marker carried too, so only the kind:suite shape defect can fire).
    "target.mjs": `// fixture non-test file\n// ${MARKER}\nexport const x = 1;\n`,
    // Prose (marker carried too, so only the prose-asserted_by defect can fire).
    "README.md": `# fixture readme\n${MARKER}\n`,
  };
}

// A row that is VALID by construction against validFiles(); each test overrides exactly one
// field to seed exactly one defect.
function validRow(dir, overrides = {}) {
  return {
    id: "FIXTURE-ROW",
    documented_at: `${join(dir, "doc.md")}:1`,
    asserted_by: join(dir, "target.test.mjs"),
    kind: "suite",
    marker: MARKER,
    ...overrides,
  };
}

// Write files + a fixture ledger (rows are built per-dir, hence the builder callback) into a
// fresh tmp dir. Returns { dir, ledgerPath }.
function makeFixture(files, buildRows) {
  const dir = mkdtempSync(join(tmpdir(), "check-claims-fixture-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  const ledgerPath = join(dir, "ledger.mjs");
  writeFileSync(ledgerPath, `export const CLAIMS = ${JSON.stringify(buildRows(dir), null, 2)};\n`);
  return { dir, ledgerPath };
}

const rmFixture = (dir) => rmSync(dir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// (a)–(h), the eight minimum behaviours from the item-08 acceptance criteria.
// ---------------------------------------------------------------------------

test("(a) real ledger end-to-end: zero findings over at least 8 rows", async () => {
  const { ok, rows, findings } = await checkClaims(LEDGER);
  assert.equal(findings.length, 0,
    `the real ledger must resolve clean; findings:\n  - ${findings.join("\n  - ")}`);
  assert.equal(ok, true, "ok must be true when there are no findings");
  assert.ok(
    rows.length >= 8,
    `expected >= 8 rows in the real ledger, got ${rows.length} — a green run over an emptied ` +
      "ledger is the run-tests.mjs zero-discovered bug one level up (the floor is load-bearing)"
  );
});

test("(b) the five incident ids are pinned in the ledger", () => {
  const ids = new Set(CLAIMS.map((r) => r && r.id));
  for (const id of INCIDENT_IDS) {
    assert.ok(ids.has(id),
      `claims-ledger.mjs must carry row id ${id} — removable only by failing this suite`);
  }
});

test("(c) marker absent from asserted_by -> a finding naming the row id", async () => {
  const { dir, ledgerPath } = makeFixture(validFiles(), (d) => [
    validRow(d, { id: "MARKER-ABSENT", marker: "ZZ-ABSENT-FROM-EVERY-FIXTURE-ZZ" }),
  ]);
  try {
    const { ok, findings } = await checkClaims(ledgerPath);
    assert.equal(ok, false, "a broken binding must not report ok");
    assert.equal(findings.length, 1, `expected exactly one finding, got ${JSON.stringify(findings)}`);
    assert.ok(findings[0].includes("MARKER-ABSENT"),
      `the finding must name the row id, got ${JSON.stringify(findings)}`);
  } finally {
    rmFixture(dir);
  }
});

test("(d) asserted_by is a .md -> hard finding (prose is not an assertion)", async () => {
  const { dir, ledgerPath } = makeFixture(validFiles(), (d) => [
    // release-gate + the marker IS in the README, so the only defect is the prose target.
    validRow(d, { id: "PROSE-NOT-ASSERTION", kind: "release-gate", asserted_by: join(d, "README.md") }),
  ]);
  try {
    const { ok, findings } = await checkClaims(ledgerPath);
    assert.equal(ok, false, "a prose asserted_by must not report ok");
    assert.equal(findings.length, 1, `expected exactly one finding, got ${JSON.stringify(findings)}`);
    assert.ok(findings[0].includes("PROSE-NOT-ASSERTION"),
      `the finding must name the row id, got ${JSON.stringify(findings)}`);
  } finally {
    rmFixture(dir);
  }
});

test("(e) kind:suite pointing at a non-.test.mjs file -> a finding naming the row id", async () => {
  const { dir, ledgerPath } = makeFixture(validFiles(), (d) => [
    validRow(d, { id: "SUITE-NOT-A-TEST", asserted_by: join(d, "target.mjs") }),
  ]);
  try {
    const { ok, findings } = await checkClaims(ledgerPath);
    assert.equal(ok, false, "a suite row bound to a non-test file must not report ok");
    assert.equal(findings.length, 1, `expected exactly one finding, got ${JSON.stringify(findings)}`);
    assert.ok(findings[0].includes("SUITE-NOT-A-TEST"),
      `the finding must name the row id, got ${JSON.stringify(findings)}`);
  } finally {
    rmFixture(dir);
  }
});

test("(f) duplicate row id -> a finding naming the duplicated id", async () => {
  const { dir, ledgerPath } = makeFixture(validFiles(), (d) => [
    // Two copies of the same VALID row: individually clean, jointly a duplicate id.
    validRow(d, { id: "DUP-ID" }),
    validRow(d, { id: "DUP-ID" }),
  ]);
  try {
    const { ok, findings } = await checkClaims(ledgerPath);
    assert.equal(ok, false, "a duplicate row id must not report ok");
    assert.ok(
      findings.some((f) => f.includes("DUP-ID")),
      `the findings must name the duplicated id, got ${JSON.stringify(findings)}`
    );
  } finally {
    rmFixture(dir);
  }
});

test("(g) documented_at file missing -> a finding naming the row id", async () => {
  const { dir, ledgerPath } = makeFixture(validFiles(), (d) => [
    validRow(d, { id: "DOC-GONE", documented_at: `${join(d, "no-such-doc.md")}:1` }),
  ]);
  try {
    const { ok, findings } = await checkClaims(ledgerPath);
    assert.equal(ok, false, "a row documented nowhere on disk must not report ok");
    assert.equal(findings.length, 1, `expected exactly one finding, got ${JSON.stringify(findings)}`);
    assert.ok(findings[0].includes("DOC-GONE"),
      `the finding must name the row id, got ${JSON.stringify(findings)}`);
  } finally {
    rmFixture(dir);
  }
});

test("(h) CLI end-to-end on a broken fixture -> process exit 1, report names the row id", async () => {
  const { dir, ledgerPath } = makeFixture(validFiles(), (d) => [
    validRow(d, { id: "CLI-BROKEN-ROW", marker: "ZZ-ABSENT-FROM-EVERY-FIXTURE-ZZ" }),
  ]);
  try {
    const r = spawnSync(process.execPath, [CHECKER, "--ledger", ledgerPath], { encoding: "utf8" });
    assert.equal(
      r.status, 1,
      `expected the CLI to exit 1 on a broken ledger, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`
    );
    const out = `${r.stdout || ""}\n${r.stderr || ""}`;
    assert.ok(out.includes("CLI-BROKEN-ROW"),
      `the CLI report must name the broken row id, got: ${JSON.stringify(out)}`);
  } finally {
    rmFixture(dir);
  }
});
