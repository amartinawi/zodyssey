#!/usr/bin/env node
// check-imports.mjs — every imported package must actually exist.
//
// WHY: across 576,000 generated samples from 16 models, 19.7% of recommended packages DO NOT
// EXIST (open-source models average 21.7%; per-model range 0.22%–46.15%). Hallucinated names
// recur across runs, which is what makes slopsquatting a viable supply-chain attack: register the
// name an LLM keeps inventing and wait. `docs/MEASUREMENT.md` has listed "no hallucinated
// APIs/files" as a quality target with no mechanism behind it — nothing here ran a type-check, a
// build, or import resolution.
//
// OFFLINE BY CONSTRUCTION. This does not query any registry. The question it answers is narrower
// and better: does this import resolve against THIS REPO'S declared dependencies or installed
// modules? A package that exists on npm but is not a dependency here is still a broken import,
// and a network call would make the check flaky, slow, and unavailable in sandboxes — which is
// how checks end up disabled.
//
// Scope: JS/TS ESM + CJS, and Python. Relative paths, absolute paths, and language builtins are
// ignored. Unknown file types are skipped rather than guessed at.
//
// Usage:
//   check-imports.mjs <repo> [--since <sha>] [--files a,b,c]
//     default: files changed since <sha> (or the whole tracked tree if no git)
//   exit: 0 clean/inert · 2 bad args · 9 unresolved import(s) found

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname, resolve as pathResolve } from "node:path";
import { argv, exit } from "node:process";
import { execFileSync } from "node:child_process";
import { builtinModules } from "node:module";

const repo = argv[2];
if (!repo || !existsSync(repo)) {
  console.error("usage: check-imports.mjs <repo> [--since <sha>] [--files a,b,c]");
  exit(2);
}
const rest = argv.slice(3);
const sinceIdx = rest.indexOf("--since");
const since = sinceIdx !== -1 ? rest[sinceIdx + 1] : null;
const filesIdx = rest.indexOf("--files");
const explicitFiles = filesIdx !== -1 ? (rest[filesIdx + 1] || "").split(",").filter(Boolean) : null;

const NODE_BUILTINS = new Set([...builtinModules, ...builtinModules.map((m) => "node:" + m)]);
// Python's stdlib is large; this covers what generated code actually reaches for. A miss here
// produces a false positive, so the list errs generous.
const PY_STDLIB = new Set(["os", "sys", "re", "json", "math", "time", "datetime", "pathlib", "typing",
  "collections", "itertools", "functools", "subprocess", "shutil", "tempfile", "random", "logging",
  "unittest", "argparse", "csv", "io", "abc", "enum", "dataclasses", "hashlib", "base64", "uuid",
  "sqlite3", "threading", "asyncio", "socket", "struct", "copy", "glob", "pickle", "string",
  "textwrap", "traceback", "warnings", "weakref", "contextlib", "inspect", "operator", "secrets",
  "statistics", "urllib", "http", "email", "html", "xml", "zipfile", "tarfile", "gzip", "signal",
  "multiprocessing", "queue", "select", "ssl", "types", "unicodedata", "decimal", "fractions"]);

function changedFiles() {
  if (explicitFiles) return explicitFiles;
  try {
    const args = since ? ["-C", repo, "diff", "--name-only", since] : ["-C", repo, "ls-files"];
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
      .split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return []; // not a git repo and no explicit list → nothing to check, stay inert
  }
}

// Declared JS dependencies: package.json (all dep fields) plus anything actually installed.
function jsKnown() {
  const known = new Set();
  const pkgPath = join(repo, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const k of Object.keys(pkg[field] || {})) known.add(k);
      }
      // workspace self-reference and import aliases both count as declared
      for (const k of Object.keys((pkg.imports) || {})) known.add(k);
      if (pkg.name) known.add(pkg.name);
    } catch { /* unparseable package.json → fall back to node_modules only */ }
  }
  return known;
}

function isInstalled(name) {
  const base = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
  try { return statSync(join(repo, "node_modules", base)).isDirectory(); } catch { return false; }
}

function pyKnown() {
  const known = new Set();
  for (const f of ["requirements.txt", "requirements-dev.txt", "pyproject.toml", "setup.py", "Pipfile"]) {
    const p = join(repo, f);
    if (!existsSync(p)) continue;
    try {
      const txt = readFileSync(p, "utf8");
      for (const m of txt.matchAll(/^\s*["']?([A-Za-z0-9_.-]+)\s*(?:[=<>!~\[]|$)/gm)) {
        known.add(m[1].toLowerCase().replace(/-/g, "_"));
      }
    } catch { /* skip unreadable manifest */ }
  }
  return known;
}

const JS_EXT = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const findings = [];

const jsDeclared = jsKnown();
const pyDeclared = pyKnown();
const hasJsManifest = existsSync(join(repo, "package.json"));
const hasPyManifest = pyDeclared.size > 0;

for (const rel of changedFiles()) {
  const abs = join(repo, rel);
  if (!existsSync(abs)) continue; // deleted in the diff
  const ext = extname(rel);
  let src;
  try { src = readFileSync(abs, "utf8"); } catch { continue; }

  if (JS_EXT.has(ext) && hasJsManifest) {
    const specs = new Set();
    for (const m of src.matchAll(/^\s*import\s+(?:[\s\S]*?\sfrom\s+)?["']([^"']+)["']/gm)) specs.add(m[1]);
    for (const m of src.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.add(m[1]);
    for (const m of src.matchAll(/^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/gm)) specs.add(m[1]);
    for (const spec of specs) {
      if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("#")) continue;
      if (NODE_BUILTINS.has(spec) || NODE_BUILTINS.has(spec.split("/")[0])) continue;
      const base = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
      if (jsDeclared.has(base) || jsDeclared.has(spec) || isInstalled(base)) continue;
      findings.push({ file: rel, spec, lang: "js",
        reason: "not in package.json dependencies and not present in node_modules" });
    }
  } else if (ext === ".py" && hasPyManifest) {
    const specs = new Set();
    for (const m of src.matchAll(/^\s*import\s+([A-Za-z_][\w.]*)/gm)) specs.add(m[1].split(".")[0]);
    for (const m of src.matchAll(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\s/gm)) specs.add(m[1].split(".")[0]);
    for (const spec of specs) {
      const norm = spec.toLowerCase().replace(/-/g, "_");
      if (PY_STDLIB.has(spec) || pyDeclared.has(norm)) continue;
      // a sibling module/package in the repo is a local import, not a dependency
      if (existsSync(join(repo, spec + ".py")) || existsSync(join(repo, spec, "__init__.py"))) continue;
      if (existsSync(join(dirname(pathResolve(repo, rel)), spec + ".py"))) continue;
      findings.push({ file: rel, spec, lang: "py",
        reason: "not in requirements/pyproject and not a local module" });
    }
  }
}

if (findings.length === 0) {
  console.log("check-imports: no unresolved imports");
  exit(0);
}

console.error(`UNRESOLVED IMPORTS (${findings.length}) — these packages are imported but do not exist here:`);
for (const f of findings.slice(0, 40)) {
  console.error(`  ${f.file}: \`${f.spec}\` — ${f.reason}`);
}
console.error(
  `\nEither the package name is hallucinated, or it needs to be added as a dependency.\n` +
  `Roughly 1 in 5 LLM-recommended packages do not exist at all, and the invented names repeat\n` +
  `across runs — which is precisely what makes registering them a workable attack.\n` +
  `Verify the package is real BEFORE adding it to the manifest.`
);
exit(9);
