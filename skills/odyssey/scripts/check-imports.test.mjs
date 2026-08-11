#!/usr/bin/env node
// check-imports.test.mjs — imported packages must exist.
//
// 19.7% of packages recommended across 576,000 generated samples DO NOT EXIST (per-model range
// 0.22%–46.15%), and the invented names REPEAT across runs — which is what turns a hallucination
// into a supply-chain attack: register the name the model keeps producing and wait.
// `docs/MEASUREMENT.md` listed "no hallucinated APIs/files" as a target with nothing behind it.
//
// The check is offline on purpose. "Does this resolve against THIS repo's declared dependencies"
// is both stricter than a registry lookup (a real package that isn't a dependency here is still a
// broken import) and never flaky. A check that needs the network fails in sandboxes and CI, and
// checks that fail for environmental reasons get deleted.
//
// Half these assertions are FALSE-POSITIVE guards. A checker that flags `node:fs`, a relative
// import, or a local Python module is one nobody keeps.
//
// Run:  node check-imports.test.mjs   (exit 0 = pass, 1 = fail)

import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT = join(new URL(".", import.meta.url).pathname, "check-imports.mjs");

let pass = 0, fail = 0;
const check = (n, c, d = "") => c ? (console.log(`  ✓ ${n}`), pass++) : (console.log(`  ✗ ${n} ${d}`), fail++);

const cleanup = [];
function repoWith(files, manifest = { name: "x", dependencies: { express: "^4" } }) {
  const repo = mkdtempSync(join(tmpdir(), "zod-imp-"));
  cleanup.push(repo);
  if (manifest) writeFileSync(join(repo, "package.json"), JSON.stringify(manifest));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(repo, rel, ".."), { recursive: true });
    writeFileSync(join(repo, rel), body);
  }
  return repo;
}
const run = (repo, ...extra) => {
  const r = spawnSync(process.execPath, [SCRIPT, repo, ...extra], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
// --files avoids depending on git in the fixture.
const scan = (repo, files) => run(repo, "--files", files.join(","));

console.log("check-imports.mjs — imported packages must exist\n");

// --- the thing it exists to catch --------------------------------------------
{
  const repo = repoWith({ "src/a.js": `import turbo from "turbo-json-parser-9000";\n` });
  const r = scan(repo, ["src/a.js"]);
  check("flags an undeclared package", r.code === 9, `(exit ${r.code})`);
  check("names the package", /turbo-json-parser-9000/.test(r.out));
}
{
  const repo = repoWith({ "src/a.js": `const x = require("definitely-not-real-pkg");\n` });
  check("flags CJS require too", scan(repo, ["src/a.js"]).code === 9);
}
{
  const repo = repoWith({ "src/a.js": `export * from "another-fake-one";\n` });
  check("flags re-export form", scan(repo, ["src/a.js"]).code === 9);
}
{
  const repo = repoWith({ "src/a.js": `import x from "@fakescope/nope";\n` });
  check("flags a scoped package", scan(repo, ["src/a.js"]).code === 9);
}

// --- FALSE-POSITIVE GUARDS ---------------------------------------------------
{
  const repo = repoWith({ "src/a.js": `import express from "express";\n` });
  check("declared dependency is fine", scan(repo, ["src/a.js"]).code === 0);
}
{
  const repo = repoWith({ "src/a.js": `import { readFileSync } from "node:fs";\nimport path from "path";\n` });
  check("node builtins are fine (both prefixed and bare)", scan(repo, ["src/a.js"]).code === 0);
}
{
  const repo = repoWith({ "src/a.js": `import h from "./helper.js";\nimport g from "../lib/g.js";\n` });
  check("relative imports are fine", scan(repo, ["src/a.js"]).code === 0);
}
{
  const repo = repoWith({ "src/a.js": `import sub from "express/lib/router";\n` });
  check("subpath of a declared package is fine", scan(repo, ["src/a.js"]).code === 0);
}
{
  const repo = repoWith({ "src/a.js": `import x from "installed-only";\n` }, { name: "x" });
  mkdirSync(join(repo, "node_modules", "installed-only"), { recursive: true });
  check("installed but undeclared is fine (node_modules counts)", scan(repo, ["src/a.js"]).code === 0);
}
{
  // No package.json at all → nothing to check against. Inert, not a blanket failure.
  const repo = repoWith({ "src/a.js": `import whatever from "whatever";\n` }, null);
  check("no package.json → inert", scan(repo, ["src/a.js"]).code === 0);
}

// --- Python ------------------------------------------------------------------
{
  const repo = repoWith({ "requirements.txt": "requests==2.31.0\n", "app/m.py": `import requests\nimport os\n` }, null);
  check("declared python dep + stdlib are fine", scan(repo, ["app/m.py"]).code === 0);
}
{
  const repo = repoWith({ "requirements.txt": "requests==2.31.0\n", "app/m.py": `import notarealpylib\n` }, null);
  const r = scan(repo, ["app/m.py"]);
  check("flags an undeclared python package", r.code === 9);
  check("names it", /notarealpylib/.test(r.out));
}
{
  const repo = repoWith({ "requirements.txt": "requests==2.31.0\n", "helper.py": "x = 1\n", "app/m.py": `import helper\n` }, null);
  check("local python module is not flagged", scan(repo, ["app/m.py"]).code === 0);
}

for (const d of cleanup) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
