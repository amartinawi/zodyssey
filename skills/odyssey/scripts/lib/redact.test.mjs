// redact.test.mjs — tests for the shared secret-redaction helper.
// Run: node skills/odyssey/scripts/lib/redact.test.mjs
// Exits 0 on success, non-zero on any failure.

import assert from "node:assert/strict";
import { SECRET_PATH_RE, isSecretPath, redactSecrets } from "./redact.mjs";

let failures = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL - ${name}: ${e.message}`);
  }
};

// --- the names the OLD regex leaked must now be caught (audit M1) --------------
test("suffix-named env / credential files are recognised as secret", () => {
  for (const p of [
    "prod.env",
    "production.env",
    "staging.env",
    "backend/prod.env",
    ".envrc",
    "aws.credentials",
    "app.secrets",
  ]) {
    assert.equal(isSecretPath(p), true, `${p} should be secret`);
  }
});

test("the originally-covered names still redact", () => {
  for (const p of [".env", ".env.local", "backend/.env", "server.pem", "id_rsa", ".npmrc", ".netrc"]) {
    assert.equal(SECRET_PATH_RE.test(p), true, `${p} should match`);
  }
});

test("ordinary source files are not treated as secret", () => {
  for (const p of ["src/index.js", "README.md", "environment.ts", "keyboard.css"]) {
    assert.equal(isSecretPath(p), false, `${p} should NOT be secret`);
  }
});

// --- redactSecrets withholds the body but keeps the path ----------------------
test("redactSecrets drops the body of a suffix-named env file", () => {
  const diff = [
    "diff --git a/prod.env b/prod.env",
    "index 000..111 100644",
    "--- a/prod.env",
    "+++ b/prod.env",
    "@@ -0,0 +1 @@",
    "+SECRET=abc123",
  ].join("\n");
  const out = redactSecrets(diff);
  assert.ok(!out.includes("SECRET=abc123"), "secret body must be withheld");
  assert.ok(out.includes("prod.env"), "path must stay visible");
});

test("redactSecrets tolerates a space in the path", () => {
  const diff = [
    "diff --git a/my prod.env b/my prod.env",
    "@@ -0,0 +1 @@",
    "+TOKEN=xyz789",
  ].join("\n");
  const out = redactSecrets(diff);
  assert.ok(!out.includes("TOKEN=xyz789"), "secret body in a spaced path must be withheld");
});

test("redactSecrets leaves a non-secret hunk untouched", () => {
  const diff = ["diff --git a/src/a.js b/src/a.js", "@@ -1 +1 @@", "+const a = 1;"].join("\n");
  assert.ok(redactSecrets(diff).includes("const a = 1;"), "normal code must pass through");
});

// --- `+++ new file:` sections (untracked bodies consult/judge append) -----------
// 2026-08-25 audit: consult.mjs appended secret untracked bodies under this header shape, and the
// old split/regex only recognized `diff --git`/`+++ b/` — the section sailed through untouched.
test("redactSecrets withholds a secret untracked `+++ new file:` section", () => {
  const diff = [
    "diff --git a/src/a.js b/src/a.js",
    "@@ -1 +1 @@",
    "+const a = 1;",
    "",
    "+++ new file: prod.env (untracked)",
    "API_KEY=sk-super-secret",
  ].join("\n");
  const out = redactSecrets(diff);
  assert.ok(!out.includes("sk-super-secret"), "untracked secret body must be withheld");
  assert.ok(!out.includes("API_KEY"), "no line of the secret body may survive");
  assert.ok(out.includes("prod.env"), "path must stay visible");
  assert.ok(out.includes("const a = 1;"), "the preceding non-secret hunk must pass through");
});

test("redactSecrets withholds a secret `+++ new file:` section without the (untracked) marker", () => {
  const diff = ["+++ new file: backend/.env", "DB_PASSWORD=hunter2"].join("\n");
  const out = redactSecrets(diff);
  assert.ok(!out.includes("hunter2"), "secret body must be withheld");
  assert.ok(out.includes("backend/.env"), "path must stay visible");
});

test("redactSecrets leaves a non-secret `+++ new file:` section untouched", () => {
  const diff = ["+++ new file: src/new-file.js (untracked)", "export const x = 2;"].join("\n");
  assert.ok(redactSecrets(diff).includes("export const x = 2;"), "normal new-file body must pass through");
});

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall redact tests passed");
