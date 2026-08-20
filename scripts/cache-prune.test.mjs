#!/usr/bin/env node
// cache-prune.test.mjs — red-first suite for the plugin cache prune capability.
//
// WHY THIS EXISTS: old version dirs pile up forever under the plugin cache
// (<HOME>/.zcode/cli/plugins/cache/<marketplace>/<plugin>/<version>/) because the
// marketplace subsystem only ever ADDS. This suite pins the contract for the
// prune capability BEFORE the capability exists (TDD, item 13):
//
//   · scripts/lib/cache-prune.mjs — a PURE plan module (no deletion, no subprocess):
//       planCachePrune({ pluginsJsonPath }) → { liveVersion, keep[], prune[],
//                                               skipped[], provenance{} } | { error }
//       compareSemver(a, b) → <0 | 0 | >0    numeric x.y.z; negative when a is older
//       CACHE_PRUNE_KEEP = 2                 live + on-disk predecessor
//     Semantics pinned by the cases below: live-ness comes ONLY from the registry
//     (never dir contents, never mtime/count heuristics); the predecessor is the
//     highest semver dir STRICTLY below registry-live as read from disk; prune =
//     semver dirs strictly older than the predecessor; newer-than-live is kept;
//     non-semver entries and stray files in the live parent are reported skipped
//     and never touched; provenance (per-dir git HEAD, fs-read only) is reportage
//     and never participates in the keep/prune/skipped decision.
//   · scripts/install.mjs --prune-cache — exclusive mode (the --sync-cache
//     early-exit shape). Dry path prints `[dry-run] rm <dir>` lines plus one
//     machine-greppable summary `prune-plan: live=<V> keep=<V1,V2> prune=<N>`;
//     an unverifiable registry fails closed: print the reason, exit 1, delete
//     nothing. Zero stale: exit 0, prune=0. The default `--dry-run` flow carries
//     the same cache preview (one plan function, two consumers).
//
// THE RED CONTRACT (this file lands in wave 1, BEFORE any wiring):
//   Run against the unmodified tree this suite MUST exit non-zero. The in-process
//   families fail recorded at the lib import (dynamic import in try/catch — one
//   red per family, the file never crashes), and the spawn families run the
//   pre-change installer, which silently ignores the unknown --prune-cache flag:
//   exit 0, default flow, no plan line, no cache [dry-run] rm lines — the
//   documented false-green shape, one level up. A suite that exits 0 against the
//   unmodified tree is vacuous and must be rewritten until it reddens.
//
// WAVE 3 EXTENSION — family (m), the execution cases. Bare --prune-cache (and the
// default install run's final step) must delete EXACTLY the dry-run-verified list,
// and only inside throwaway fixtures: on-disk delta == printed rm targets == the
// summary's prune=N (three-way equality); the live and predecessor trees, the
// registry, and the sibling plugin tree stay byte-identical across every execution
// path; fail-closed holds in execution mode too (exit 1, zero deletions, byte-
// identical fixture). Families (a)-(l) remain all-dry; the (m) spawns are the only
// deletion spawns in this suite and every one targets an mkdtemp fixture HOME.
//
// REMEDIATION EXTENSION — consult-audit gap: (m6)/(m7) pin the registry-version ≠
// live-DIR-name disagreement (version 0.6.12, installPath → .../0.4.0) — the live
// DIR must be carved out of prune (never in keep AND prune, never rm'd, byte-identical
// through both consumers); (e)×7 adds installPath == cache base → fail closed.
//
// FIXTURE DISCIPLINE (load-bearing):
//   · Every fixture lives under fs.mkdtempSync(os.tmpdir()) — NEVER the real HOME.
//   · Every spawn uses env { ...process.env, HOME: <fixture> } — the spread
//     preserves PATH and the synthetic eval-lane stamp; only HOME is overridden.
//     os.homedir() honours $HOME on POSIX, so the installer resolves the fixture
//     tree, not the operator's.
//   · Fixtures carry real payloads (a .zcode-plugin/plugin.json + one file per
//     tree, bytes unique per version) so byte-identity hashing is meaningful.
//   · This suite deletes nothing outside its own throwaway fixtures.
//
// Run:  node scripts/cache-prune.test.mjs   (exit 0 = pass, 1 = fail)
// No file:line citations appear in this file by design — they are anchor-lock bait.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INSTALLER = join(REPO_ROOT, "scripts", "install.mjs");

// The capability under test lives in scripts/lib/cache-prune.mjs. Dynamic import
// in try/catch: in the wave-1 red run the module does not exist and every
// in-process family must FAIL RECORDED while the spawn families still execute.
let lib = null;
let libErr = null;
try { lib = await import("./lib/cache-prune.mjs"); }
catch (e) { libErr = e; }

let pass = 0, fail = 0;
const letters = new Set(); // family-coverage guard: every (a)..(l) must appear at least once
const check = (n, c, d = "") => {
  const m = n.match(/^\(([a-m])\)/);
  if (m) letters.add(m[1]);
  if (c) { console.log(`  ✓ ${n}`); pass++; }
  else { console.log(`  ✗ ${n} ${d}`); fail++; }
};
const fmt = (x) => { try { return JSON.stringify(x); } catch { return String(x); } };

// ---------- fixture vocabulary (mirrors the corrected 2026-08-20 cache census) ----------

const LIVE = "0.6.12";   // registry-live
const PRED = "0.6.9";    // on-disk predecessor (no 0.6.11 dir exists — gapped on purpose)
const PRUNE8 = ["0.3.2", "0.4.0", "0.4.1", "0.5.0", "0.5.1", "0.5.2", "0.6.0", "0.6.2"];
const SPARSE = [...PRUNE8, PRED, LIVE];

const SHA_MAIN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_STALE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"; // packed-refs decoy for the loose-ref case
const SHA_DETACHED = "cccccccccccccccccccccccccccccccccccccccc";
const SHA_PACKED = "dddddddddddddddddddddddddddddddddddddddd";
const SHA_OTHER = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; // unrelated packed ref

const FIXTURES = [];
const zcodeDir = (home) => join(home, ".zcode");
const cacheParentOf = (home) => join(home, ".zcode", "cli", "plugins", "cache", "zodyssey-local", "zodyssey");
const otherPluginDir = (home) => join(home, ".zcode", "cli", "plugins", "cache", "zodyssey-local", "other-plugin");
const registryPath = (home) => join(home, ".zcode", "cli", "plugins", "installed_plugins.json");

function writePluginTree(parent, version, innerVersion = version) {
  const dir = join(parent, version);
  mkdirSync(join(dir, ".zcode-plugin"), { recursive: true });
  writeFileSync(join(dir, ".zcode-plugin", "plugin.json"),
    JSON.stringify({ name: "zodyssey", version: innerVersion, description: "cache-prune suite fixture" }, null, 2) + "\n");
  mkdirSync(join(dir, "skills", "odyssey"), { recursive: true });
  writeFileSync(join(dir, "skills", "odyssey", "SKILL.md"),
    `# zodyssey ${version} fixture\n\nbyte payload for tree hashing, unique per version: ${version}\n`);
  return dir;
}

function writeRegistry(home, { mode = "ok", installPath = null, version = LIVE } = {}) {
  const p = registryPath(home);
  mkdirSync(dirname(p), { recursive: true });
  if (mode === "unparseable") { writeFileSync(p, "{ this is not json ,\n"); return; }
  const entry = {
    id: "zodyssey@zodyssey-local", name: "zodyssey",
    marketplace: "zodyssey-local", version, scope: "user",
  };
  if (mode !== "no-installpath") entry.installPath = installPath;
  const plugins = mode === "entryless" ? [] : [entry];
  writeFileSync(p, JSON.stringify({ version: 1, plugins }, null, 2) + "\n");
}

function writeOtherPluginTree(home) {
  const dir = join(otherPluginDir(home), "0.1.0");
  mkdirSync(join(dir, ".zcode-plugin"), { recursive: true });
  writeFileSync(join(dir, ".zcode-plugin", "plugin.json"),
    JSON.stringify({ name: "other-plugin", version: "0.1.0" }, null, 2) + "\n");
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(join(dir, "agents", "scout.md"), "# other-plugin scout fixture\nnever visible to the zodyssey prune\n");
}

// Per-dir git provenance fixtures, resolved by fs-read only (never a subprocess):
//   loose   — HEAD names refs/heads/main; the loose ref file wins over a packed decoy
//   detached— HEAD holds the sha itself
//   packed  — HEAD names a ref with NO loose file; packed-refs carries it (plus an
//             unrelated decoy ref)
//   absent  — no .git at all → 'unknown'
function applyGitShapes(parent, shapes) {
  for (const [version, shape] of Object.entries(shapes)) {
    const git = join(parent, version, ".git");
    if (shape === "loose") {
      mkdirSync(join(git, "refs", "heads"), { recursive: true });
      writeFileSync(join(git, "HEAD"), "ref: refs/heads/main\n");
      writeFileSync(join(git, "refs", "heads", "main"), SHA_MAIN + "\n");
      writeFileSync(join(git, "packed-refs"), SHA_STALE + " refs/heads/main\n");
    } else if (shape === "detached") {
      mkdirSync(git, { recursive: true });
      writeFileSync(join(git, "HEAD"), SHA_DETACHED + "\n");
    } else if (shape === "packed") {
      mkdirSync(join(git, "refs", "heads"), { recursive: true }); // dir present, ref file absent
      writeFileSync(join(git, "HEAD"), "ref: refs/heads/release\n");
      writeFileSync(join(git, "packed-refs"), `${SHA_OTHER} refs/heads/main\n${SHA_PACKED} refs/heads/release\n`);
    }
  }
}

function buildFixture({
  versions = SPARSE,
  extraDirs = [],        // non-semver dirs in the live parent (each with a payload)
  strayFiles = [],       // stray files in the live parent
  innerOverrides = {},   // { dirVersion: innerPluginJsonVersion } — mixture realism
  otherPlugin = true,    // sibling plugin tree under the same marketplace
  registry = "ok",       // ok | missing | unparseable | entryless | no-installpath |
                         // nonexistent-path | outside-cache | live-dir-mismatch |
                         // cache-base
  gitShapes = null,
} = {}) {
  const home = mkdtempSync(join(tmpdir(), "zod-prune-"));
  const parent = cacheParentOf(home);
  for (const v of versions) writePluginTree(parent, v, innerOverrides[v] ?? v);
  for (const name of extraDirs) {
    mkdirSync(join(parent, name, ".zcode-plugin"), { recursive: true });
    writeFileSync(join(parent, name, ".zcode-plugin", "plugin.json"),
      JSON.stringify({ name: "zodyssey", version: "unversioned backup" }, null, 2) + "\n");
  }
  for (const f of strayFiles) writeFileSync(join(parent, f), `stray payload: ${f}\n`);
  if (otherPlugin) writeOtherPluginTree(home);

  let installPath = join(parent, LIVE);
  if (registry === "outside-cache") {
    installPath = writePluginTree(join(home, ".zcode", "cli", "plugins", "marketplaces", "zodyssey-local"), LIVE);
  } else if (registry === "nonexistent-path") {
    installPath = join(parent, "0.6.99");
  } else if (registry === "live-dir-mismatch") {
    // The hand-rollback shape: registry version stays 0.6.12 while installPath points
    // at the on-disk 0.4.0 dir (a STALE-by-version dir that is actually RUNNING).
    installPath = join(parent, "0.4.0");
  } else if (registry === "cache-base") {
    // installPath exactly equal to the cache base — the parent would be the plugins
    // dir itself; must fail closed, not walk plugin siblings.
    installPath = join(home, ".zcode", "cli", "plugins", "cache");
  }
  if (registry !== "missing") {
    writeRegistry(home, {
      mode: ["unparseable", "entryless", "no-installpath"].includes(registry) ? registry : "ok",
      installPath,
    });
  }
  if (gitShapes) applyGitShapes(parent, gitShapes);

  FIXTURES.push(home);
  return { home, parent, pluginsJson: registryPath(home), installPath };
}

// ---------- byte-identity helpers ----------

const hashBytes = (buf) => createHash("sha256").update(buf).digest("hex");

function hashFile(p) {
  try { return hashBytes(readFileSync(p)); } catch { return "<absent>"; }
}

function hashTree(root) {
  const h = createHash("sha256");
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const walk = (abs, rel) => {
    for (const e of readdirSync(abs, { withFileTypes: true }).sort(byName)) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { h.update(`D ${r}\n`); walk(join(abs, e.name), r); }
      else if (e.isFile()) { h.update(`F ${r} `); h.update(hashBytes(readFileSync(join(abs, e.name)))); h.update("\n"); }
      else h.update(`O ${r}\n`);
    }
  };
  walk(root, "");
  return h.digest("hex");
}

// ---------- comparison helpers (the suite's OWN semver compare — never the lib's) ----------

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function cmpSemverTest(a, b) {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
function sameSet(actual, expected, cmp = cmpStr) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length &&
    JSON.stringify([...actual].sort(cmp)) === JSON.stringify([...expected].sort(cmp));
}

// ---------- installer-spawn helpers ----------

function runInstaller(home, args) {
  return spawnSync(process.execPath, [INSTALLER, ...args], {
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, HOME: home }, // the spread is load-bearing; only HOME is overridden
  });
}
const outOf = (r) => `${r.stdout || ""}\n${r.stderr || ""}`;
const exitDetail = (r) => `exit ${r.status}${r.error ? ` (spawn error: ${r.error.message})` : ""}`;
function summaryOf(r) {
  const m = outOf(r).match(/prune-plan: live=(\S+) keep=(\S+) prune=(\d+)/);
  return m ? { live: m[1], keep: m[2].split(","), prune: m[3] } : null;
}
// [dry-run] rm lines that point INTO the zodyssey cache parent (pollution-purge rm
// lines elsewhere under HOME are intentionally not counted).
function cacheRmLines(r, home) {
  const parent = cacheParentOf(home);
  return (r.stdout || "").split("\n")
    .filter((l) => l.includes("[dry-run] rm "))
    .map((l) => l.replace(/^.*\[dry-run\] rm /, "").trim())
    .filter((p) => p.startsWith(parent + "/"));
}
// rm lines into the cache parent in EITHER form — dry prints `[dry-run] rm <path>`,
// execution prints `rm <path>` (the phasePurge shape). The execution families use
// this to read the printed plan from non-dry runs.
function pruneTargets(r, home) {
  const parent = cacheParentOf(home);
  return (r.stdout || "").split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(?:\[dry-run\] )?rm /.test(l))
    .map((l) => l.replace(/^(?:\[dry-run\] )?rm /, ""))
    .filter((p) => p.startsWith(parent + "/"));
}

// ---------- lib guards ----------

function guard(label) {
  if (lib) return true;
  check(label, false,
    `scripts/lib/cache-prune.mjs not importable (${libErr && (libErr.code || libErr.message)}) — capability absent, family recorded red`);
  return false;
}
function planOf(pluginsJson) {
  try { return lib.planCachePrune({ pluginsJsonPath: pluginsJson }); }
  catch (e) { return { error: `threw: ${e.message}` }; }
}
const isErrPlan = (p) => !!p && typeof p === "object" && !!p.error &&
  p.keep === undefined && p.prune === undefined;

// ---------- fixture board ----------

console.log("cache prune — suite (non-deletion families (a)-(l) + execution families (m))");
console.log(`lib import: ${lib ? "loaded" : `FAILED (${libErr && (libErr.code || libErr.message)}) — expected in the wave-1 red run`}\n`);

const FIX_A = buildFixture(); // sparse/gapped + sibling plugin tree
const FIX_B = buildFixture({ versions: [LIVE] }); // single dir, no predecessor
const FIX_C = buildFixture({ innerOverrides: { [LIVE]: "0.6.11", [PRED]: "0.6.8" } }); // mixture realism
const FIX_D = buildFixture({ versions: [...SPARSE, "0.7.0"] }); // newer than live
const FIX_E = {
  "missing-registry": buildFixture({ registry: "missing" }),
  "unparseable-registry": buildFixture({ registry: "unparseable" }),
  "entryless-registry": buildFixture({ registry: "entryless" }),
  "installpath-less-entry": buildFixture({ registry: "no-installpath" }),
  "nonexistent-installpath": buildFixture({ registry: "nonexistent-path" }),
  "installpath-outside-cache": buildFixture({ registry: "outside-cache" }),
  "installpath-equals-cache-base": buildFixture({ registry: "cache-base" }),
};
const FIX_F = buildFixture({ extraDirs: ["backup-tmp"], strayFiles: ["notes.txt"] });
const FIX_J = buildFixture({ versions: [...SPARSE, "0.7.0"], extraDirs: ["backup-tmp"], strayFiles: ["notes.txt"] });
const FIX_K = buildFixture({ versions: [...SPARSE, "0.7.0"], extraDirs: ["backup-tmp"], strayFiles: ["notes.txt"] });
const FIX_L1 = buildFixture({
  gitShapes: { [LIVE]: "loose", [PRED]: "detached", "0.6.2": "packed" }, // 0.5.2 left .git-less
});
const FIX_L2 = buildFixture(); // same sparse shape, no .git anywhere

check(`fixture board built (${FIXTURES.length} throwaway homes under ${tmpdir()})`,
  FIXTURES.every((h) => existsSync(zcodeDir(h))));
check("no fixture is the real HOME", FIXTURES.every((h) => h !== homedir()));

// ---------- (a) sparse/gapped plan ----------

if (guard("(a) sparse/gapped plan (in-process)")) {
  const plan = planOf(FIX_A.pluginsJson);
  check("(a) liveVersion comes from the registry", plan && plan.liveVersion === LIVE, `got ${fmt(plan && plan.liveVersion)}`);
  check("(a) keep = {live, on-disk predecessor} (no 0.6.11 exists — predecessor read from disk, not arithmetic)",
    sameSet(plan && plan.keep, [LIVE, PRED], cmpSemverTest), `got ${fmt(plan && plan.keep)}`);
  check("(a) prune = the 8 strictly-older dirs, exactly",
    sameSet(plan && plan.prune, PRUNE8, cmpSemverTest), `got ${fmt(plan && plan.prune)}`);
  check("(a) skipped = [] (every child of the live parent is a semver dir)",
    sameSet(plan && plan.skipped, []), `got ${fmt(plan && plan.skipped)}`);
  check("(a) CACHE_PRUNE_KEEP = 2 (live + predecessor)",
    lib.CACHE_PRUNE_KEEP === 2, `got ${fmt(lib.CACHE_PRUNE_KEEP)}`);
}

// ---------- (b) single-dir fixture, zero stale ----------

if (guard("(b) single-dir zero-stale plan (in-process)")) {
  const plan = planOf(FIX_B.pluginsJson);
  check("(b) keep = {live} (no predecessor on disk)",
    sameSet(plan && plan.keep, [LIVE], cmpSemverTest), `got ${fmt(plan && plan.keep)}`);
  check("(b) prune = ∅",
    sameSet(plan && plan.prune, []), `got ${fmt(plan && plan.prune)}`);
  check("(b) skipped = ∅",
    sameSet(plan && plan.skipped, []), `got ${fmt(plan && plan.skipped)}`);
}
{
  const before = hashTree(zcodeDir(FIX_B.home));
  const r = runInstaller(FIX_B.home, ["--dry-run", "--prune-cache"]);
  const s = summaryOf(r);
  check("(b) zero-stale dry spawn exits 0", r.status === 0, exitDetail(r));
  check("(b) zero-stale summary: live named, prune=0",
    !!s && s.live === LIVE && s.prune === "0",
    s ? fmt(s) : "no prune-plan: line — the flag was silently ignored (pre-change installer)");
  check("(b) zero cache [dry-run] rm lines",
    cacheRmLines(r, FIX_B.home).length === 0, `got ${fmt(cacheRmLines(r, FIX_B.home))}`);
  check("(b) fixture tree byte-identical after the dry spawn",
    hashTree(zcodeDir(FIX_B.home)) === before, "the dry path must not touch anything");
}

// ---------- (c) mixture realism: inner manifest disagrees with the dir name ----------

if (guard("(c) mixture-realism plan (in-process)")) {
  const plan = planOf(FIX_C.pluginsJson);
  check("(c) predecessor kept although its inner plugin.json disagrees with the dir name",
    sameSet(plan && plan.keep, [LIVE, PRED], cmpSemverTest), `got ${fmt(plan && plan.keep)}`);
  check("(c) liveVersion still the registry's — never read from dir contents",
    plan && plan.liveVersion === LIVE, `got ${fmt(plan && plan.liveVersion)}`);
  check("(c) prune unchanged by the mixture",
    sameSet(plan && plan.prune, PRUNE8, cmpSemverTest), `got ${fmt(plan && plan.prune)}`);
}

// ---------- (d) a dir NEWER than live is kept, never pruned ----------

if (guard("(d) newer-than-live plan (in-process)")) {
  const plan = planOf(FIX_D.pluginsJson);
  check("(d) keep = {predecessor, live, newer-than-live}",
    sameSet(plan && plan.keep, [PRED, LIVE, "0.7.0"], cmpSemverTest), `got ${fmt(plan && plan.keep)}`);
  check("(d) newer-than-live never in prune",
    Array.isArray(plan && plan.prune) && !plan.prune.includes("0.7.0"), `got ${fmt(plan && plan.prune)}`);
  check("(d) prune = the same 8",
    sameSet(plan && plan.prune, PRUNE8, cmpSemverTest), `got ${fmt(plan && plan.prune)}`);
}

// ---------- (e) fail-closed family ×6 ----------

if (guard("(e) fail-closed plan shapes (in-process)")) {
  for (const [name, fx] of Object.entries(FIX_E)) {
    const plan = planOf(fx.pluginsJson);
    check(`(e) ${name} → { error } with no keep/prune`,
      isErrPlan(plan), `got ${fmt(plan)}`);
  }
}
for (const [name, fx] of Object.entries(FIX_E)) {
  const beforeTree = hashTree(zcodeDir(fx.home));
  const beforeReg = hashFile(fx.pluginsJson);
  const r = runInstaller(fx.home, ["--dry-run", "--prune-cache"]);
  check(`(e) ${name}: dry --prune-cache exits 1 (fail closed)`,
    r.status === 1, `${exitDetail(r)} — the unknown flag is silently ignored and the default flow runs`);
  check(`(e) ${name}: no plan summary is printed`,
    !summaryOf(r), `summary ${fmt(summaryOf(r))}`);
  check(`(e) ${name}: zero deletions, fixture tree byte-identical`,
    hashTree(zcodeDir(fx.home)) === beforeTree, "something changed under the fixture");
  check(`(h) ${name}: registry file byte-identical`,
    hashFile(fx.pluginsJson) === beforeReg, "the registry must be read-only");
}

// ---------- (f) non-semver dir + stray file → skipped, present ----------

if (guard("(f) skipped-entries plan (in-process)")) {
  const plan = planOf(FIX_F.pluginsJson);
  check("(f) skipped = {backup-tmp, notes.txt}",
    sameSet(plan && plan.skipped, ["backup-tmp", "notes.txt"]), `got ${fmt(plan && plan.skipped)}`);
  check("(f) keep/prune unchanged by the non-semver noise",
    sameSet(plan && plan.keep, [LIVE, PRED], cmpSemverTest) && sameSet(plan && plan.prune, PRUNE8, cmpSemverTest),
    `keep ${fmt(plan && plan.keep)} prune ${fmt(plan && plan.prune)}`);
  check("(f) neither skipped entry appears in keep or prune",
    Array.isArray(plan && plan.keep) && Array.isArray(plan && plan.prune) &&
    !plan.keep.concat(plan.prune).some((x) => x === "backup-tmp" || x === "notes.txt"),
    "a non-semver entry leaked into the removable set");
}

// ---------- (g) sibling plugin tree is invisible to every mode ----------

if (guard("(g) containment plan (in-process)")) {
  const plan = planOf(FIX_A.pluginsJson);
  const blob = fmt(plan);
  check("(g) the plan never mentions the sibling plugin tree",
    !blob.includes("other-plugin"), `plan leaked: ${blob}`);
  check("(g) every keep/prune/skipped entry is a name inside the zodyssey parent",
    Array.isArray(plan && plan.keep) && Array.isArray(plan && plan.prune) && Array.isArray(plan && plan.skipped) &&
    [...plan.keep, ...plan.prune, ...plan.skipped].every((x) => typeof x === "string" && !x.includes("/")),
    "entries must be plain dir/file names, never paths into sibling trees");
}
// (g) spawn-side: the sibling tree's hash is asserted unchanged inside families
// (j) and (k) below, and whole-tree byte-identity inside (e)/(b) covers it there.

// ---------- (h) registry byte-identity after every mode ----------
// Asserted inline in every spawn family (each carries an "(h)"-labelled check):
// the registry is read-only by design; no mode may rewrite it.

// ---------- (i) semver compare unit checks ----------

if (guard("(i) compareSemver units (in-process)")) {
  const cs = lib.compareSemver;
  check("(i) equal versions compare 0", cs("0.6.12", "0.6.12") === 0, `got ${fmt(cs("0.6.12", "0.6.12"))}`);
  check("(i) older compares negative", cs("0.5.2", "0.6.0") < 0, `got ${fmt(cs("0.5.2", "0.6.0"))}`);
  check("(i) newer compares positive", cs("0.6.12", "0.6.9") > 0, `got ${fmt(cs("0.6.12", "0.6.9"))}`);
  check("(i) differing major orders numerically", cs("1.0.0", "0.9.9") > 0, `got ${fmt(cs("1.0.0", "0.9.9"))}`);
  check("(i) gapped ordering 0.6.9 < 0.6.12 (numeric, not lexicographic)",
    cs("0.6.9", "0.6.12") < 0, `got ${fmt(cs("0.6.9", "0.6.12"))}`);
}

// ---------- (j) exclusive mode: --dry-run --prune-cache ----------

{
  const ks = FIX_J;
  const before = {
    tree: hashTree(zcodeDir(ks.home)),
    registry: hashFile(ks.pluginsJson),
    other: hashTree(otherPluginDir(ks.home)),
  };
  const r = runInstaller(ks.home, ["--dry-run", "--prune-cache"]);
  const s = summaryOf(r);
  const rm = cacheRmLines(r, ks.home);
  check("(j) exits 0 on a healthy fixture", r.status === 0, exitDetail(r));
  check("(j) summary names live=0.6.12, keep carries live+predecessor, prune=8",
    !!s && s.live === LIVE && s.prune === "8" && s.keep.includes(LIVE) && s.keep.includes(PRED),
    s ? fmt(s) : "no prune-plan: line — the flag was silently ignored (pre-change installer)");
  check("(j) [dry-run] rm lines name exactly the 8 stale dirs (nothing else)",
    sameSet(rm, PRUNE8.map((v) => join(ks.parent, v))),
    `got ${fmt(rm)}`);
  check("(j) live, predecessor, newer-than-live, skipped and stray entries have no rm line",
    rm.every((p) => ![LIVE, PRED, "0.7.0", "backup-tmp", "notes.txt"].some((n) => p.includes(n))),
    `got ${fmt(rm)}`);
  check("(h) registry byte-identical after --dry-run --prune-cache",
    hashFile(ks.pluginsJson) === before.registry, "the registry must be read-only");
  check("(j) fixture tree byte-identical (dry deletes nothing)",
    hashTree(zcodeDir(ks.home)) === before.tree, "something changed under the fixture");
  check("(g) sibling plugin tree untouched",
    hashTree(otherPluginDir(ks.home)) === before.other, "the prune walked outside the zodyssey parent");
}

// ---------- (k) default flow dry run carries the same preview ----------

{
  const ks = FIX_K;
  const before = {
    tree: hashTree(zcodeDir(ks.home)),
    registry: hashFile(ks.pluginsJson),
    other: hashTree(otherPluginDir(ks.home)),
  };
  const r = runInstaller(ks.home, ["--dry-run"]); // NO prune flag
  const rm = cacheRmLines(r, ks.home);
  check("(k) default dry run exits 0", r.status === 0, exitDetail(r));
  check("(k) default dry run carries the cache preview for exactly the prune set (one plan, two consumers)",
    sameSet(rm, PRUNE8.map((v) => join(ks.parent, v))),
    `got ${fmt(rm)} — the default flow has no prune preview yet`);
  check("(h) registry byte-identical after the default dry run",
    hashFile(ks.pluginsJson) === before.registry, "the registry must be read-only");
  check("(k) fixture tree byte-identical",
    hashTree(zcodeDir(ks.home)) === before.tree, "something changed under the fixture");
  check("(g) sibling plugin tree untouched by the default flow",
    hashTree(otherPluginDir(ks.home)) === before.other, "the preview walked outside the zodyssey parent");
}

// ---------- (l) .git provenance shapes ----------

if (guard("(l) provenance shapes (in-process)")) {
  const withGit = planOf(FIX_L1.pluginsJson);
  const prov = withGit && withGit.provenance;
  check("(l) loose ref resolves the ref FILE (packed decoy loses)",
    !!prov && prov[LIVE] === SHA_MAIN, `got ${fmt(prov && prov[LIVE])}`);
  check("(l) detached HEAD resolves to the sha itself",
    !!prov && prov[PRED] === SHA_DETACHED, `got ${fmt(prov && prov[PRED])}`);
  check("(l) packed-refs-only resolves via packed-refs (right ref, not the decoy)",
    !!prov && prov["0.6.2"] === SHA_PACKED, `got ${fmt(prov && prov["0.6.2"])}`);
  check("(l) absent .git → 'unknown'",
    !!prov && prov["0.5.2"] === "unknown", `got ${fmt(prov && prov["0.5.2"])}`);

  const noGit = planOf(FIX_L2.pluginsJson);
  const sameDecisions =
    JSON.stringify([...(withGit.keep || [])].sort(cmpSemverTest)) === JSON.stringify([...(noGit.keep || [])].sort(cmpSemverTest)) &&
    JSON.stringify([...(withGit.prune || [])].sort(cmpSemverTest)) === JSON.stringify([...(noGit.prune || [])].sort(cmpSemverTest)) &&
    JSON.stringify([...(withGit.skipped || [])].sort(cmpStr)) === JSON.stringify([...(noGit.skipped || [])].sort(cmpStr));
  check("(l) keep/prune/skipped byte-identical with .git absent (provenance never decides)",
    sameDecisions, "decisions shifted when .git was removed");
  check("(l) provenance all 'unknown' with .git absent",
    [LIVE, PRED, "0.6.2", "0.5.2"].every((v) => noGit.provenance && noGit.provenance[v] === "unknown"),
    `got ${fmt(noGit && noGit.provenance)}`);
}

// ---------- (m) execution: the dry-run-verified list is exactly what gets deleted ----------

{
  // (m1) exclusive bare --prune-cache on the kitchen-sink fixture — exact execution.
  // Three-way equality: printed rm targets == on-disk delta == the summary's prune=N.
  const ks = buildFixture({ versions: [...SPARSE, "0.7.0"], extraDirs: ["backup-tmp"], strayFiles: ["notes.txt"] });
  const before = {
    registry: hashFile(ks.pluginsJson),
    live: hashTree(join(ks.parent, LIVE)),
    pred: hashTree(join(ks.parent, PRED)),
    other: hashTree(otherPluginDir(ks.home)),
    dirs: readdirSync(ks.parent).sort(),
  };
  const r = runInstaller(ks.home, ["--prune-cache"]); // NO --dry-run: this deletes (in the fixture)
  const s = summaryOf(r);
  const targets = pruneTargets(r, ks.home);
  const afterDirs = readdirSync(ks.parent).sort();
  const removed = before.dirs.filter((n) => !afterDirs.includes(n));
  check("(m) bare --prune-cache exits 0", r.status === 0, exitDetail(r));
  check("(m) summary: live named, keep carries live+predecessor, prune=8",
    !!s && s.live === LIVE && s.prune === "8" && s.keep.includes(LIVE) && s.keep.includes(PRED),
    s ? fmt(s) : "no prune-plan: line");
  check("(m) printed rm targets = exactly the 8 stale dirs",
    sameSet(targets, PRUNE8.map((v) => join(ks.parent, v))), `got ${fmt(targets)}`);
  check("(m) on-disk delta = exactly the 8 stale dirs removed",
    sameSet(removed, PRUNE8), `got ${fmt(removed)}`);
  check("(m) three-way equality: printed plan == on-disk delta == summary prune=N",
    !!s && sameSet(targets, removed.map((v) => join(ks.parent, v))) &&
      Number(s.prune) === removed.length && removed.length === targets.length,
    `printed ${targets.length}, removed ${removed.length}, summary ${s ? s.prune : "none"}`);
  check("(m) survivors on disk = keep set + skipped entries, exactly",
    sameSet(afterDirs, ["0.7.0", LIVE, PRED, "backup-tmp", "notes.txt"]), `got ${fmt(afterDirs)}`);
  check("(m) live tree byte-identical to its pre-execution hash",
    hashTree(join(ks.parent, LIVE)) === before.live, "the live copy was touched");
  check("(m) predecessor tree byte-identical to its pre-execution hash",
    hashTree(join(ks.parent, PRED)) === before.pred, "the predecessor was touched");
  check("(h) registry byte-identical after execution",
    hashFile(ks.pluginsJson) === before.registry, "the registry must be read-only");
  check("(g) sibling plugin tree untouched by execution",
    hashTree(otherPluginDir(ks.home)) === before.other, "the prune walked outside the zodyssey parent");
}

{
  // (m2) zero-stale execution: exit 0, prune=0, nothing deleted.
  const fx = buildFixture({ versions: [LIVE] });
  const beforeTree = hashTree(zcodeDir(fx.home));
  const beforeReg = hashFile(fx.pluginsJson);
  const r = runInstaller(fx.home, ["--prune-cache"]);
  const s = summaryOf(r);
  check("(m) zero-stale execution exits 0", r.status === 0, exitDetail(r));
  check("(m) zero-stale summary: live named, prune=0",
    !!s && s.live === LIVE && s.prune === "0", s ? fmt(s) : "no prune-plan: line");
  check("(m) zero-stale execution deletes nothing (fixture byte-identical)",
    hashTree(zcodeDir(fx.home)) === beforeTree, "something was deleted");
  check("(h) registry byte-identical after zero-stale execution",
    hashFile(fx.pluginsJson) === beforeReg, "the registry must be read-only");
}

{
  // (m3) fail-closed holds WITHOUT --dry-run too — the catastrophic guardrail:
  // nothing may be deleted before live-ness is proven, in execution mode as well.
  for (const shape of ["missing", "outside-cache"]) {
    const fx = buildFixture({ registry: shape });
    const beforeTree = hashTree(zcodeDir(fx.home));
    const beforeReg = hashFile(fx.pluginsJson);
    const r = runInstaller(fx.home, ["--prune-cache"]); // bare: any deletion here is catastrophic
    check(`(m) ${shape} registry: bare --prune-cache exits 1 (fail closed, execution mode)`,
      r.status === 1, exitDetail(r));
    check(`(m) ${shape} registry: no plan summary is printed`, !summaryOf(r), fmt(summaryOf(r)));
    check(`(m) ${shape} registry: zero deletions, fixture byte-identical`,
      hashTree(zcodeDir(fx.home)) === beforeTree, "something was deleted before live-ness was proven");
    check(`(h) ${shape} registry: registry file byte-identical`,
      hashFile(fx.pluginsJson) === beforeReg, "the registry must be read-only");
  }
}

{
  // (m4) the default install run's FINAL step prunes (the second consumer, executing).
  const ks = buildFixture({ versions: [...SPARSE, "0.7.0"], extraDirs: ["backup-tmp"], strayFiles: ["notes.txt"] });
  const before = {
    registry: hashFile(ks.pluginsJson),
    live: hashTree(join(ks.parent, LIVE)),
    pred: hashTree(join(ks.parent, PRED)),
    other: hashTree(otherPluginDir(ks.home)),
  };
  const r = runInstaller(ks.home, []); // plain default install run — the final step prunes
  const afterDirs = readdirSync(ks.parent).sort();
  check("(m) default install run exits 0", r.status === 0, exitDetail(r));
  check("(m) the final step pruned exactly the 8 stale dirs (survivors = keep + skipped)",
    sameSet(afterDirs, ["0.7.0", LIVE, PRED, "backup-tmp", "notes.txt"]), `got ${fmt(afterDirs)}`);
  check("(m) the final step printed the same rm targets (one plan, two consumers)",
    sameSet(pruneTargets(r, ks.home), PRUNE8.map((v) => join(ks.parent, v))),
    `got ${fmt(pruneTargets(r, ks.home))}`);
  check("(m) live + predecessor trees byte-identical after the default run",
    hashTree(join(ks.parent, LIVE)) === before.live && hashTree(join(ks.parent, PRED)) === before.pred,
    "the default run's final step touched a kept dir");
  check("(h) registry byte-identical after the default run",
    hashFile(ks.pluginsJson) === before.registry, "the registry must be read-only");
  check("(g) sibling plugin tree untouched by the default run",
    hashTree(otherPluginDir(ks.home)) === before.other, "the final step walked outside the zodyssey parent");
}

{
  // (m5) default install run with an unverifiable registry: best-effort — warn,
  // delete nothing under the cache, do not block the installer.
  const fx = buildFixture({ registry: "missing" });
  const cacheRoot = join(fx.home, ".zcode", "cli", "plugins", "cache");
  const beforeCache = hashTree(cacheRoot);
  const r = runInstaller(fx.home, []);
  check("(m) default run with unverifiable registry exits 0 (warn + continue)",
    r.status === 0, exitDetail(r));
  check("(m) unverifiable registry: the best-effort step deletes nothing under the cache",
    hashTree(cacheRoot) === beforeCache, "the best-effort step deleted something");
}

{
  // (m6) registry version ≠ live DIR name (the hand-rollback shape: version 0.6.12,
  // installPath → .../0.4.0). The live DIR — a stale-BY-VERSION dir that is actually
  // RUNNING — must be carved out of prune by BOTH consumers, never rm'd, byte-identical.
  const LIVE_ELSEWHERE = "0.4.0";
  const PRUNE7 = PRUNE8.filter((v) => v !== LIVE_ELSEWHERE);
  const fx = buildFixture({ registry: "live-dir-mismatch" });
  const beforeLive = hashTree(join(fx.parent, LIVE_ELSEWHERE));
  const beforeReg = hashFile(fx.pluginsJson);
  const plan = planOf(fx.pluginsJson);
  check("(m) mismatch: liveVersion still the registry's 0.6.12",
    plan && plan.liveVersion === LIVE, `got ${fmt(plan && plan.liveVersion)}`);
  check("(m) mismatch: the live DIR (0.4.0) is in keep, whatever its name",
    Array.isArray(plan && plan.keep) && plan.keep.includes(LIVE_ELSEWHERE), `got ${fmt(plan && plan.keep)}`);
  check("(m) mismatch: the live DIR is absent from prune",
    Array.isArray(plan && plan.prune) && !plan.prune.includes(LIVE_ELSEWHERE), `got ${fmt(plan && plan.prune)}`);
  check("(m) mismatch: prune = the 7 remaining stale dirs (the live DIR carved out)",
    sameSet(plan && plan.prune, PRUNE7, cmpSemverTest), `got ${fmt(plan && plan.prune)}`);
  check("(m) mismatch: keep and prune are disjoint (a live dir in BOTH would delete it)",
    Array.isArray(plan && plan.keep) && Array.isArray(plan && plan.prune) &&
    !plan.keep.some((n) => plan.prune.includes(n)),
    `keep ${fmt(plan && plan.keep)} prune ${fmt(plan && plan.prune)}`);

  const r = runInstaller(fx.home, ["--prune-cache"]); // bare: this deletes (in the fixture)
  check("(m) mismatch: bare --prune-cache exits 0", r.status === 0, exitDetail(r));
  check("(m) mismatch: no rm line names the live DIR",
    !pruneTargets(r, fx.home).some((p) => p === join(fx.parent, LIVE_ELSEWHERE)),
    `got ${fmt(pruneTargets(r, fx.home))}`);
  check("(m) mismatch: the live DIR tree byte-identical after bare --prune-cache",
    existsSync(join(fx.parent, LIVE_ELSEWHERE)) &&
    hashTree(join(fx.parent, LIVE_ELSEWHERE)) === beforeLive,
    "the RUNNING plugin's dir was deleted by the exclusive mode");
  check("(h) registry byte-identical after the mismatch bare run",
    hashFile(fx.pluginsJson) === beforeReg, "the registry must be read-only");
}

{
  // (m7) the same disagreement through the DEFAULT install run's final step — the
  // silent path (no flag): the live DIR must survive it untouched too.
  const LIVE_ELSEWHERE = "0.4.0";
  const fx = buildFixture({ registry: "live-dir-mismatch" });
  const beforeLive = hashTree(join(fx.parent, LIVE_ELSEWHERE));
  const beforeReg = hashFile(fx.pluginsJson);
  const r = runInstaller(fx.home, []); // plain default install run — the final step prunes
  check("(m) mismatch: default install run exits 0", r.status === 0, exitDetail(r));
  check("(m) mismatch: the live DIR survives the default run, byte-identical",
    existsSync(join(fx.parent, LIVE_ELSEWHERE)) &&
    hashTree(join(fx.parent, LIVE_ELSEWHERE)) === beforeLive,
    "the RUNNING plugin's dir was deleted by the install's final step");
  check("(m) mismatch: no rm line names the live DIR in the default run",
    !pruneTargets(r, fx.home).some((p) => p === join(fx.parent, LIVE_ELSEWHERE)),
    `got ${fmt(pruneTargets(r, fx.home))}`);
  check("(h) registry byte-identical after the mismatch default run",
    hashFile(fx.pluginsJson) === beforeReg, "the registry must be read-only");
}

// ---------- family-coverage guard + teardown ----------

check("every family (a)-(m) was exercised at least once",
  "abcdefghijklm".split("").every((l) => letters.has(l)),
  `missing: ${"abcdefghijklm".split("").filter((l) => !letters.has(l)).join(", ")}`);

for (const home of FIXTURES) {
  try { rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
