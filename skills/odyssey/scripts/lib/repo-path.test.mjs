// repo-path.test.mjs — the relative-vs-absolute cases the whole suite was blind to.
// Run: node skills/odyssey/scripts/lib/repo-path.test.mjs   (exit 0 = pass)
//
// Every one of the 62 mkdtempSync fixtures in this repo passes an ABSOLUTE repo path, which is
// why three fail-open guards survived to production. These cases pass a relative one.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { resolvePath, resolveRepo, containedIn, sameFile, repoAliases } from "./repo-path.mjs";

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`ok - ${name}`); }
  catch (e) { failures++; console.error(`FAIL - ${name}: ${e.message}`); }
};

const root = realpathSync(mkdtempSync(join(tmpdir(), "repo-path-")));
mkdirSync(join(root, ".zcode", "plans"), { recursive: true });
mkdirSync(join(root, ".zcode", "staging"), { recursive: true });
writeFileSync(join(root, ".zcode", "plans", "verdict.json"), "{}\n");
const origCwd = cwd();

test("a relative repo arg resolves to the same place as the absolute one", () => {
  chdir(root);
  try { assert.equal(resolveRepo("."), resolveRepo(root)); }
  finally { chdir(origCwd); }
});

// THE BUG: the guard built its prefix from an un-normalized repo arg, so with repo="." the
// prefix was ".zcode/plans/" and the candidate was "/abs/...", and startsWith was always false.
test("containedIn catches a bookkeeping path even when the root arg is relative", () => {
  chdir(root);
  try {
    assert.equal(containedIn(join(root, ".zcode/plans/verdict.json"), join(".", ".zcode", "plans")), true);
    assert.equal(containedIn(join(root, ".zcode/plans/verdict.json"), join(root, ".zcode", "plans")), true);
  } finally { chdir(origCwd); }
});

test("containedIn rejects a sanctioned staging path (the escape hatch must stay open)", () => {
  assert.equal(containedIn(join(root, ".zcode/staging/v.json"), join(root, ".zcode", "plans")), false);
});

test("containedIn is not fooled by a sibling sharing a name prefix", () => {
  assert.equal(containedIn(join(root, ".zcode", "plans-backup", "x"), join(root, ".zcode", "plans")), false);
});

test("containedIn resolves ../ traversal before comparing", () => {
  assert.equal(containedIn(join(root, ".zcode/plans/../staging/v.json"), join(root, ".zcode", "plans")), false);
});

test("a symlinked root still compares equal (the protected-dirs guard's blind spot)", () => {
  const link = join(tmpdir(), `repo-path-link-${process.pid}`);
  try {
    symlinkSync(root, link);
    assert.equal(containedIn(join(link, ".zcode/plans/verdict.json"), join(root, ".zcode", "plans")), true);
    assert.equal(sameFile(link, root), true);
  } finally { try { rmSync(link, { force: true }); } catch {} }
});

test("resolvePath handles a file that does not exist yet", () => {
  const p = join(root, "src", "not-created-yet.js");
  assert.equal(resolvePath(p), join(realpathSync(root), "src", "not-created-yet.js"));
});

test("trailing slashes and doubled separators normalize", () => {
  assert.equal(resolvePath(root + "/"), resolvePath(root));
  assert.equal(resolvePath(root + "//.zcode"), resolvePath(join(root, ".zcode")));
});

test("empty input degrades to not-contained rather than throwing", () => {
  assert.equal(resolvePath(""), "");
  assert.equal(containedIn("", root), false);
  assert.equal(containedIn(root, ""), false);
});

test("repoAliases includes the canonical form and known mount twins", () => {
  const aliases = repoAliases("/Users/amartinawi/Desktop/ZOdyssey");
  assert.ok(aliases.some((a) => a.includes("Desktop/ZOdyssey")), JSON.stringify(aliases));
});

rmSync(root, { recursive: true, force: true });
if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall repo-path tests passed");
