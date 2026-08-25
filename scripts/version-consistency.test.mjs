#!/usr/bin/env node
// version-consistency.test.mjs — the version is declared in three files; they must agree.
//
// WHY: cutting v0.3.2 bumped `.zcode-plugin/plugin.json` and `package.json` and MISSED
// `marketplace.json`. Nothing noticed. The tag was pushed, the GitHub release was published, CI
// was green — and the plugin could not be installed at the new version, because the marketplace
// serves what its own index advertises, which was still 0.3.1. The user clicked Update, got
// 0.3.1, and the only symptom was a version-mismatch line in smoke-gate.
//
// Each file is read by a different consumer, which is why the drift is invisible:
//   marketplace.json         → the MARKETPLACE, when resolving what to install
//   .zcode-plugin/plugin.json → the LOADER, once installed (identity, namespace, hooks)
//   package.json             → npm/CI tooling
//
// A number duplicated in three places with nothing comparing them is a documented-but-unenforced
// invariant — the exact class this repo keeps being bitten by. This is the check.
//
// Run:  node version-consistency.test.mjs   (exit 0 = pass, 1 = fail)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

console.log("version consistency across every file that declares it\n");

function readJson(rel) {
  const p = join(ROOT, rel);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return undefined; }
}

const pluginJson = readJson(".zcode-plugin/plugin.json");
const packageJson = readJson("package.json");
const marketplaceJson = readJson("marketplace.json");

check(".zcode-plugin/plugin.json parses", !!pluginJson);
check("package.json parses", !!packageJson);
check("marketplace.json parses", !!marketplaceJson);

if (pluginJson && packageJson && marketplaceJson) {
  const pluginV = pluginJson.version;
  const packageV = packageJson.version;
  const entry = (marketplaceJson.plugins || []).find((p) => p && p.name === pluginJson.name);
  const marketV = entry && entry.version;

  check("marketplace.json lists this plugin", !!entry,
    `(looking for name "${pluginJson.name}" in marketplace.json plugins[])`);

  const SEMVER = /^\d+\.\d+\.\d+$/;
  check(`plugin.json version is semver (${pluginV})`, SEMVER.test(String(pluginV)));

  check("package.json version === plugin.json version",
    packageV === pluginV, `(package ${packageV} vs plugin ${pluginV})`);

  check("marketplace.json version === plugin.json version",
    marketV === pluginV,
    `(marketplace ${marketV} vs plugin ${pluginV}) — the MARKETPLACE serves what its own index says, ` +
    `so a stale value here means Update installs the OLD version no matter what plugin.json claims. ` +
    `This is exactly how v0.3.2 shipped uninstallable.`);

  // The CHANGELOG must document the version being shipped, or the release notes describe
  // something else. Unreleased work is fine; a version with no entry is not.
  const changelog = existsSync(join(ROOT, "CHANGELOG.md")) ? readFileSync(join(ROOT, "CHANGELOG.md"), "utf8") : "";
  check(`CHANGELOG has an entry for ${pluginV}`,
    new RegExp(`^## \\[${String(pluginV).replace(/\./g, "\\.")}\\]`, "m").test(changelog),
    "add `## [x.y.z] — YYYY-MM-DD` before tagging");

  // (deep audit 2026-08-25, finding 1) the check above is one-directional: it only asserts the
  // PINS' version has an entry — a CHANGELOG section AHEAD of the pins passes silently. That is
  // exactly how v0.7.3 shipped: CHANGELOG documented 0.7.3 (code present, README announced the
  // 0.7.3 launch) while all three pins and the marketplace still said 0.7.2, so Update installed
  // the old version and run-report stamped 0.7.3-era records as 0.7.2. Inverse check: the NEWEST
  // CHANGELOG version heading must equal the pins — a section may only run ahead of the pins
  // while it is titled "Unreleased".
  const newest = (changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m) || [])[1];
  check(`CHANGELOG's newest version entry (${newest || "none"}) matches the pins (${pluginV})`,
    newest === pluginV,
    "either bump all three manifests to the CHANGELOG's newest version, or retitle the section `## [Unreleased]`");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
