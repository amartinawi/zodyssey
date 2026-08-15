#!/usr/bin/env node
// record-final-artifact.mjs — the trusted writer for F2 / F4 artifacts.
//
// WHY: `.zcode/reviews/` is deliberately NOT bookkeeping, so no agent can Write there — that is
// what stops a forged review artifact. The review lane has had a trusted writer since W7-2
// (record-momus-artifact.mjs); the FINAL WAVE never got one. So F2/F4 artifacts had nowhere
// legitimate to come from: `record-final-wave.mjs` demands a path under `.zcode/reviews/` that
// nothing in the toolchain could create. The first end-to-end shakedown run hit this and had to
// place them out-of-band through an MCP terminal. This closes that gap.
//
// DIFFERENT FROM record-momus-artifact ON PURPOSE: that script consumes the review nonce itself.
// Here the nonce is consumed later, by record-final-wave.mjs's consumeFinalNonce, which binds it
// to the artifact's bytes. So this script does NOT consume — it places the artifact and, if given
// --nonce, checks it against the pending nonce so a mismatch surfaces here instead of at the gate.
//
// It also REJECTS an unparseable verdict at write time. record-final-wave resolves an ambiguous
// verdict to `missing` and fails closed, which is correct but arrives late and — because the
// gate consumes nonces — expensive. Failing here means a malformed artifact never reaches it.
//
// Usage:
//   record-final-artifact.mjs <repo> <slug> <F2|F4> [--nonce N] [--from <file>]
//     verdict JSON on stdin, or --from <file>
//   exit: 0 ok (prints the artifact path) · 2 bad args · 3 no state · 6 refused

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { argv, exit } from "node:process";
import { resolveRepo, resolvePath, containedIn } from "./lib/repo-path.mjs";

const [repo, slug, itemRaw, ...rest] = argv.slice(2);
if (!repo || !slug || !itemRaw) {
  console.error("usage: record-final-artifact.mjs <repo> <slug> <F2|F4> [--nonce N] [--from <file>]");
  exit(2);
}
const item = String(itemRaw).toUpperCase();
if (item !== "F2" && item !== "F4") {
  console.error(`record-final-artifact.mjs: item must be F2 or F4 (got ${itemRaw}). F1 is machine-checked and F3 is a plain checklist file — neither has an artifact.`);
  exit(2);
}
let fromFile, nonceArg;
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--from") fromFile = rest[++i];
  else if (rest[i] === "--nonce") nonceArg = rest[++i];
}

const statePath = join(repo, ".zcode", "state", `${slug}.json`);
if (!existsSync(statePath)) { console.error("no state file: " + statePath); exit(3); }
let st;
try { st = JSON.parse(readFileSync(statePath, "utf8")); } catch { console.error("cannot parse state"); exit(3); }

let raw;
if (fromFile) {
  // SEC-6 parity with the review lane: refuse a verdict pre-staged in the dirs the PLANNER writes.
  // `.zcode/staging/` is fine (SEC-6b) — it exists precisely so there IS a writable path.
  try {
    // Class B fix: byte-identical to the record-momus-artifact bypass and undiscovered until the
    // 2026-08-14 sweep — the prefix was built from the as-passed repo arg and compared against an
    // absolute realpath, so a relative repo arg silently disabled this guard too.
    const zcode = join(resolveRepo(repo), ".zcode");
    if (containedIn(fromFile, join(zcode, "notepads")) || containedIn(fromFile, join(zcode, "plans"))) {
      console.error(`record-final-artifact.mjs: --from <file> under agent-writable bookkeeping (${resolvePath(fromFile)}) refused. Stage it in .zcode/staging/ or pipe the verdict on stdin.`);
      exit(6);
    }
  } catch (e) {
    if (!e || typeof e.code !== "string" || !/^(ENOENT|EACCES|ELOOP|ENOTDIR|ENOMEM)$/.test(e.code)) throw e;
  }
  try { raw = readFileSync(fromFile, "utf8"); } catch { console.error("cannot read --from file"); exit(6); }
} else {
  try { raw = readFileSync(0, "utf8"); } catch { raw = ""; }
  if (!raw || !raw.trim()) { console.error("no verdict on stdin and no --from <file>"); exit(6); }
}

let verdict;
try { verdict = JSON.parse(raw); } catch { console.error(`record-final-artifact.mjs: ${item} verdict is not valid JSON`); exit(6); }

// Fail here, not at the gate. Mirrors record-final-wave's classifyVerdict: an unrecognized value
// is NOT an approval, and refusing it now costs nothing while refusing it later costs a nonce.
const v = String(verdict.verdict ?? verdict.overall ?? verdict.status ?? "").trim().toUpperCase();
if (!/^(APPROVE|APPROVED|OKAY|OK|PASS|PASSED|ACCEPT|ACCEPTED|REJECT|REJECTED|FAIL|FAILED|BLOCK|BLOCKED)$/.test(v)) {
  console.error(
    `record-final-artifact.mjs: ${item} artifact has no recognizable verdict (got ${JSON.stringify(verdict.verdict ?? verdict.overall ?? verdict.status ?? null)}).\n` +
    `  It needs a "verdict" field of APPROVE or REJECT. record-final-wave treats anything else as\n` +
    `  "missing" and fails closed — an unknown verdict must never close a gate.`
  );
  exit(6);
}

const field = item === "F2" ? "final_f2" : "final_f4";
const pending = st[field] && st[field].pending_nonce && st[field].pending_nonce.nonce;
// AUDIT-3 FINDING 2: this check was soft in two directions, and both were writable.
// `if (nonceArg && pending && ...)` meant OMITTING --nonce skipped the comparison entirely, and a
// missing pending nonce only printed a WARNING — the artifact was written either way. So an
// artifact could be placed in .zcode/reviews/ with no dispatch behind it at all. Require both, and
// refuse. record-final-wave still consumes and sha-binds the nonce later; this is the cheap
// early refusal that keeps a malformed artifact from ever reaching the gate.
const reviewer = item === "F2" ? "code-reviewer" : "oracle";
if (!nonceArg) {
  console.error(`record-final-artifact.mjs: --nonce <nonce> is required. The hook mints it when it observes the ${reviewer} dispatch in phase=final and prints it on stderr; it is also at state.${field}.pending_nonce.`);
  exit(6);
}
if (!pending) {
  console.error(`record-final-artifact.mjs: state.${field}.pending_nonce is absent — no ${reviewer} dispatch has been observed for this run, so there is no verdict to record. Dispatch the reviewer first.`);
  exit(6);
}
if (nonceArg !== pending) {
  console.error(`record-final-artifact.mjs: --nonce does not match state.${field}.pending_nonce. The hook mints that nonce when it observes the ${reviewer} dispatch in phase=final; pass the one from state (or the hook's stderr line).`);
  exit(6);
}

// RESIDUAL, stated plainly because the nonce apparatus reads stronger than it is: this proves a
// reviewer was DISPATCHED, not what the reviewer SAID. The nonce lives in .zcode/state/, which any
// agent can read with ungated `cat`, so an injected executor can wait for the legitimate dispatch,
// read the minted nonce, and submit its own verdict bytes under it. Closing that needs the artifact
// bound to something the executor cannot produce — the reviewer's transcript hash, handed to the
// hook by the harness (see record-momus-artifact.mjs's SEC-6 note, which proposes the same thing
// for the review lane). That is a harness change, not a script change, and is NOT done.

const reviewsDir = join(repo, ".zcode", "reviews");
mkdirSync(reviewsDir, { recursive: true });
const artifactPath = join(reviewsDir, `${slug}-${item.toLowerCase()}.json`);
const onDisk = JSON.stringify({
  ...verdict,
  _provenance: {
    slug, item, nonce: nonceArg || pending || null,
    recorded_at: new Date().toISOString(),
    // The nonce is consumed by record-final-wave, which sha-binds it to these exact bytes.
    consumed_by: "record-final-wave.mjs",
  },
}, null, 2) + "\n";

const tmp = artifactPath + ".tmp." + process.pid;
writeFileSync(tmp, onDisk);
try { renameSync(tmp, artifactPath); } catch { try { unlinkSync(tmp); } catch {} }

console.log(artifactPath);
exit(0);
