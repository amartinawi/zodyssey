#!/usr/bin/env node
// run-report.version.test.mjs — the emitted trend record self-identifies its plugin version (item 27, C3).
//
// WHY A SIBLING, not an extension of run-report.test.mjs: scripts/run-tests.mjs counts test FILES
// (run-tests.mjs:46, `e.name.endsWith(".test.mjs")`), so the suite count 56 → 57 that brief 27's
// acceptance demands cannot come from extending an existing suite. Precedent: v0.7.1 shipped the
// sibling set-phase.audit-vehicle.test.mjs for exactly this reason (CHANGELOG "Suite 55 → 56").
// run-report.test.mjs therefore stays BYTE-IDENTICAL (`git diff --exit-code` pinned in every wave).
//
// WHY THIS EXISTS (brief 27, candidate C3): every orchestration close appends a run-report.mjs
// --json row to the trend log (set-phase.mjs auto-append), but no field says which plugin version
// wrote it — and the only thing that could answer, the version-named cache dir the script runs
// from, answers WRONG whenever a --sync-cache refresh outpaces a reinstall (install.mjs:37). The
// behavior under test: run-report.mjs reads its OWN .zcode-plugin/plugin.json — resolved
// self-relative, up-3 from its own location, exactly as this suite resolves the checkout manifest
// — and stamps `zodyssey_version` into the record; an unreachable, unparseable, or version-less
// manifest degrades to `null`: never a throw, never a non-zero exit (set-phase.mjs's auto-append
// swallows report errors, so the fail-safe must live at the read site — a throw does not merely
// null the field, it DROPS the whole record).
//
// Cases, black-box subprocess style copied from run-report.test.mjs (spawnSync + JSON.parse,
// mkdtemp fixtures, no internal imports; stderr never discarded):
//   (a) the CHECKOUT emitter's --json record carries zodyssey_version === the checkout manifest's
//       .version, read DYNAMICALLY at test time — never a version literal, so a future version
//       bump cannot false-green this suite (the bump-drift class);
//   (b) fail-safe, manifest unreachable: run-report.mjs + lib/ copied into a /tmp mkdtemp — up-3
//       resolves to /, which has no .zcode-plugin — field present, === null, exit 0, no crash;
//   (c) the OTHER two failure classes the contract claims (oracle plan-review addition): a
//       three-level T/a/b/c tree holds the copy (up-3 lands at T, writable — unlike (b)'s escape
//       to /) with T/.zcode-plugin/plugin.json first INVALID JSON (`{oops`), then valid JSON
//       lacking .version ({"name":"x"}) — both: field present, === null, exit 0, no crash.
//       Without (c), a future edit moving JSON.parse out of the try stays green while a corrupt
//       manifest crashes the emitter — and set-phase.mjs's swallow DROPS the record entirely.
//
// RED-first: on the unmodified emitter every zodyssey_version check fails with the field absent
// (`undefined`); every plumbing check (exit codes, JSON parsability, crash-output absence) is
// GREEN in the RED run — a plumbing failure is a fixture bug, never evidence.
//
// Run:  node run-report.version.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, cpSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const RR = join(SCRIPT_DIR, "run-report.mjs");
const LIB = join(SCRIPT_DIR, "lib");
// The checkout manifest the emitter (post-change) resolves the same way: up-3 from its own
// location. Read DYNAMICALLY so this suite never carries a version literal.
const MANIFEST = join(SCRIPT_DIR, "..", "..", "..", ".zcode-plugin", "plugin.json");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "zod-rrv-"));
  mkdirSync(join(dir, ".zcode", "state"), { recursive: true });
  return dir;
}
function writeState(dir, slug, obj) {
  writeFileSync(join(dir, ".zcode", "state", `${slug}.json`), JSON.stringify(obj, null, 2));
}
function run(script, args) {
  const r = spawnSync("node", [script, ...args], { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}
// Far-past window (run-report.test.mjs case-(i) pattern): collectRunTokens is deterministically
// inert on EVERY machine, so the only behavior under test here is the version field.
const baseState = (over = {}) => ({
  slug: "t", intent: "standard", phase: "done",
  started_at: "2020-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:05:00.000Z",
  review: { verdict: "OKAY", round: 1 }, todos: {}, checkpoints: [], ...over,
});
// Copy the emitter AND the whole lib/ (cpSync recursive): a bare script copy dies
// ERR_MODULE_NOT_FOUND on ./lib/tokens.mjs — which is a fixture bug, not a fail-safe case.
function copyEmitter(dest) {
  cpSync(RR, join(dest, "run-report.mjs"));
  cpSync(LIB, join(dest, "lib"), { recursive: true });
}
const noCrash = (r) => !/SyntaxError|node:internal|\n {4}at /.test(r.stdout + r.stderr);
function parseJson(s) {
  try { return JSON.parse(s); } catch { return null; } // leave null — the field checks report it
}

console.log("run-report.mjs — zodyssey_version (self-relative manifest stamp, item 27 / C3)\n");

// --- (a) checkout record self-identifies the checkout manifest's .version -------------------
{
  const manifestVersion = JSON.parse(readFileSync(MANIFEST, "utf8")).version;
  check("(a) checkout manifest .version reads dynamically as a non-empty string",
    typeof manifestVersion === "string" && manifestVersion.length > 0,
    `got ${JSON.stringify(manifestVersion)}`);
  const dir = makeRepo();
  try {
    writeState(dir, "t", baseState());
    const r = run(RR, [dir, "t", "--json"]);
    check("(a) checkout emitter exits 0 (--json)", r.code === 0, `got ${r.code}`);
    const j = parseJson(r.stdout);
    check("(a) zodyssey_version === checkout manifest .version (dynamic read, no literal)",
      j !== null && j.zodyssey_version === manifestVersion,
      `got ${j === null ? "<no JSON>" : JSON.stringify(j.zodyssey_version)}, want ${JSON.stringify(manifestVersion)}`);
    check("(h) no crash output (a)", noCrash(r));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// --- (b) fail-safe: no manifest reachable (tmpdir copy, up-3 escapes to /) --------------------
{
  check("(b) fixture determinism: /.zcode-plugin absent in this environment",
    !existsSync("/.zcode-plugin/plugin.json"),
    "environment provides /.zcode-plugin — the null would not be deterministic");
  const box = mkdtempSync(join(tmpdir(), "zod-rrv-b-"));
  const dir = makeRepo();
  try {
    copyEmitter(box); // /tmp/<box>/run-report.mjs — up-3 → / , no .zcode-plugin there
    writeState(dir, "t", baseState());
    const r = run(join(box, "run-report.mjs"), [dir, "t", "--json"]);
    check("(b) tmpdir copy exits 0 (--json)", r.code === 0, `got ${r.code}`);
    const j = parseJson(r.stdout);
    check("(b) zodyssey_version present and === null (no manifest up-3)",
      j !== null && "zodyssey_version" in j && j.zodyssey_version === null,
      `got ${j === null ? "<no JSON>" : JSON.stringify(j.zodyssey_version)}`);
    check("(h) no crash output (b)", noCrash(r));
  } finally { rmSync(box, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
}

// --- (c) corrupt / version-less manifest in a three-level T/a/b/c tree -----------------------
{
  const T = mkdtempSync(join(tmpdir(), "zod-rrv-c-"));
  const dir = makeRepo();
  try {
    const c = join(T, "a", "b", "c"); // up-3 from T/a/b/c lands at T — writable, unlike (b)'s /
    mkdirSync(c, { recursive: true });
    copyEmitter(c);
    mkdirSync(join(T, ".zcode-plugin"));
    const copy = join(c, "run-report.mjs");
    writeState(dir, "t", baseState());

    writeFileSync(join(T, ".zcode-plugin", "plugin.json"), "{oops"); // invalid JSON
    let r = run(copy, [dir, "t", "--json"]);
    check("(c1) exits 0 (invalid-JSON manifest)", r.code === 0, `got ${r.code}`);
    let j = parseJson(r.stdout);
    check("(c1) zodyssey_version present and === null (invalid-JSON manifest)",
      j !== null && "zodyssey_version" in j && j.zodyssey_version === null,
      `got ${j === null ? "<no JSON>" : JSON.stringify(j.zodyssey_version)}`);
    check("(h) no crash output (c1)", noCrash(r));

    writeFileSync(join(T, ".zcode-plugin", "plugin.json"), '{"name":"x"}'); // valid, no .version
    r = run(copy, [dir, "t", "--json"]);
    check("(c2) exits 0 (version-less manifest)", r.code === 0, `got ${r.code}`);
    j = parseJson(r.stdout);
    check("(c2) zodyssey_version present and === null (version-less manifest)",
      j !== null && "zodyssey_version" in j && j.zodyssey_version === null,
      `got ${j === null ? "<no JSON>" : JSON.stringify(j.zodyssey_version)}`);
    check("(h) no crash output (c2)", noCrash(r));
  } finally { rmSync(T, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); }
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
