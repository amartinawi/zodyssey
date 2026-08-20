#!/usr/bin/env node
// scaffold.criteria-confirm.test.mjs — the --criteria-state flag suite (item 12).
//
// RED-first by design: this suite is written to pass against the FUTURE scaffold that
// implements `--criteria-state confirmed|adjusted|skipped` — a first-line HTML-comment
// stamp on plans/<slug>.task.md ONLY (plan.md and state.json byte-unaffected), additive
// (body after line 1 byte-identical to the brief), fail-closed exit 2 on a bad value
// BEFORE any write, and no-brief = the existing W5 warning path. Against the UNMODIFIED
// scaffold, cases (a)(b)(c)(e)(f) are expected RED and (d)(g)(h) GREEN; the plan's todo 2
// witnesses exactly that red run.
//
// Cases (a)-(g) mirror docs/impl/12-prime-user-confirmed-acceptance.md §Acceptance criteria
// (criterion 2). Case (h) is the SKILL.md state-machine box-envelope fence, measured on the
// pre-edit tree 2026-08-20: 79 lines carry the U+2502 bar, every one has exactly 2 bars and
// 63-65 UTF-8 code points, all inside the single fenced code block containing "-1. PRIME".
//
// NOTE: this TEST SOURCE intentionally carries the literal HTML-comment stamp opener — the
// regexes below must assert the real bytes. (The plan file itself must never carry it:
// parse-plan strips HTML comments from plan bodies, so the plan describes the stamp obliquely.)
//
// Runs BOTH ways, no node:test APIs:   node scaffold.criteria-confirm.test.mjs   (exit 0/1)
//                                      node --test scaffold.criteria-confirm.test.mjs

import { mkdtempSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { exit } from "node:process";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const SCAFFOLD = join(SCRIPT_DIR, "scaffold.mjs");
const SKILL_MD = join(SCRIPT_DIR, "..", "SKILL.md");

let pass = 0, fail = 0;
function check(name, cond, detail = "") {
  if (cond) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name} ${detail}`); fail++; }
}

// The stamp the flag must write as line 1 of plans/<slug>.task.md:
//   <!-- criteria-confirmation: <state>@<ISO-8601 timestamp> -->
const STAMP_RE = /^<!-- criteria-confirmation: ([a-z]+)@(\S+) -->$/;

// Invoke the REAL scaffold (no mocks) in a scratch repo. extraArgs ride after <intent>, so
// the brief is the 5th positional and --criteria-state trails it — the invocation shape the
// conductor contract documents. input:"" hands the child an immediately-EOF stdin pipe (the
// W6-minor stdin path must see empty, not hang).
function scaffoldIn(repoDir, slug, extraArgs) {
  return spawnSync(process.execPath,
    [SCAFFOLD, repoDir, slug, "Criteria confirm test", "standard", ...extraArgs],
    { encoding: "utf8", input: "" });
}

// Split plans/<slug>.task.md into line 1 (the stamp, once the flag exists) + the body Buffer.
function readStamped(taskPath) {
  const buf = readFileSync(taskPath);
  const nl = buf.indexOf(0x0a);
  const line1 = nl === -1 ? buf.toString("utf8") : buf.subarray(0, nl).toString("utf8");
  const body = nl === -1 ? Buffer.alloc(0) : buf.subarray(nl + 1);
  return { line1, match: line1.match(STAMP_RE), body };
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : Math.min(a.length, b.length);
}

// state.json varies across invocations ONLY through fields that must vary (where/when the run
// started): plan_path embeds the scratch repo path, started_at/updated_at/checkpoints[].at
// are timestamps, and run_auth is the HMAC over {slug, started_at, run_start_sha}. Neutralize
// exactly those axes — as-passed AND realpath'd repo spellings, so a symlinked tmpdir cannot
// fake a diff — then compare the rest byte-for-byte. Any flag-induced difference anywhere
// else in state.json still fails this compare.
function normalizeState(repoDir, buf) {
  let s = buf.toString("utf8");
  for (const form of new Set([repoDir, realpathSync(repoDir)])) s = s.split(form).join("<REPO>");
  return s
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<TS>")
    .replace(/"run_auth": "[0-9a-f]{64}"/g, '"run_auth": "<AUTH>"');
}

const BRIEF_CONFIRMED = `# Primed brief — criteria-confirm suite
## Success criteria
- \`npm test\` exits 0
- \`node --check scripts/scaffold.mjs\` exits 0
`;

const BRIEF_ADJUSTED = `# Primed brief — user adjusted the criteria
## Success criteria
- \`npm test\` exits 0
## User-adjusted criteria
- \`echo deployment-blocker-check ok\` prints ok
`;

const BRIEF_SKIPPED = `# Primed brief — user skipped the round
## Success criteria
- \`npm test\` exits 0
`;

console.log("scaffold.mjs --criteria-state suite (item 12)\n");

// --- (a) brief + --criteria-state confirmed → exit 0, stamped line 1, body byte-identical --
{
  const repoDir = mkdtempSync(join(tmpdir(), "zod-criteria-a-"));
  const slug = "case-a";
  try {
    const res = scaffoldIn(repoDir, slug, [BRIEF_CONFIRMED, "--criteria-state", "confirmed"]);
    check("(a) brief + --criteria-state confirmed → exit 0", res.status === 0,
      `(exit ${res.status}; stderr: ${(res.stderr || "").trim().split("\n")[0] || ""})`);
    const taskPath = join(repoDir, ".zcode", "plans", `${slug}.task.md`);
    check("(a) plans/<slug>.task.md exists", existsSync(taskPath));
    if (existsSync(taskPath)) {
      const s = readStamped(taskPath);
      check("(a) line 1 is the stamp comment", s.match !== null, `(line 1 = ${JSON.stringify(s.line1)})`);
      check("(a) stamp reads criteria-confirmation: confirmed@", s.match !== null && s.match[1] === "confirmed",
        `(state = ${s.match ? s.match[1] : "none"})`);
      check("(a) stamp timestamp is ISO-8601", s.match !== null && !Number.isNaN(Date.parse(s.match[2])),
        `(ts = ${s.match ? s.match[2] : "none"})`);
      const briefBuf = Buffer.from(BRIEF_CONFIRMED, "utf8");
      check("(a) body after line 1 is byte-identical to the brief (additive stamp)",
        Buffer.compare(s.body, briefBuf) === 0,
        `(first diff at byte ${firstDiff(s.body, briefBuf)}; body ${s.body.length}B vs brief ${briefBuf.length}B)`);
    }
  } finally { rmSync(repoDir, { recursive: true, force: true }); }
}

// --- (b) --criteria-state adjusted → stamp adjusted@, user wording byte-intact ------------
{
  const repoDir = mkdtempSync(join(tmpdir(), "zod-criteria-b-"));
  const slug = "case-b";
  try {
    const res = scaffoldIn(repoDir, slug, [BRIEF_ADJUSTED, "--criteria-state", "adjusted"]);
    check("(b) brief + --criteria-state adjusted → exit 0", res.status === 0, `(exit ${res.status})`);
    const taskPath = join(repoDir, ".zcode", "plans", `${slug}.task.md`);
    check("(b) plans/<slug>.task.md exists", existsSync(taskPath));
    if (existsSync(taskPath)) {
      const s = readStamped(taskPath);
      check("(b) stamp reads criteria-confirmation: adjusted@", s.match !== null && s.match[1] === "adjusted",
        `(line 1 = ${JSON.stringify(s.line1)})`);
      const briefBuf = Buffer.from(BRIEF_ADJUSTED, "utf8");
      check("(b) body after line 1 is byte-identical to the brief (user wording intact)",
        Buffer.compare(s.body, briefBuf) === 0,
        `(first diff at byte ${firstDiff(s.body, briefBuf)}; body ${s.body.length}B vs brief ${briefBuf.length}B)`);
    }
  } finally { rmSync(repoDir, { recursive: true, force: true }); }
}

// --- (c) --criteria-state skipped → stamp skipped@ -----------------------------------------
{
  const repoDir = mkdtempSync(join(tmpdir(), "zod-criteria-c-"));
  const slug = "case-c";
  try {
    const res = scaffoldIn(repoDir, slug, [BRIEF_SKIPPED, "--criteria-state", "skipped"]);
    check("(c) brief + --criteria-state skipped → exit 0", res.status === 0, `(exit ${res.status})`);
    const taskPath = join(repoDir, ".zcode", "plans", `${slug}.task.md`);
    check("(c) plans/<slug>.task.md exists", existsSync(taskPath));
    if (existsSync(taskPath)) {
      const s = readStamped(taskPath);
      check("(c) stamp reads criteria-confirmation: skipped@", s.match !== null && s.match[1] === "skipped",
        `(line 1 = ${JSON.stringify(s.line1)})`);
      const briefBuf = Buffer.from(BRIEF_SKIPPED, "utf8");
      check("(c) body after line 1 is byte-identical to the brief",
        Buffer.compare(s.body, briefBuf) === 0,
        `(first diff at byte ${firstDiff(s.body, briefBuf)}; body ${s.body.length}B vs brief ${briefBuf.length}B)`);
    }
  } finally { rmSync(repoDir, { recursive: true, force: true }); }
}

// --- (d) NO flag + brief → exit 0, task file byte-identical (legacy, no stamp) -------------
{
  const repoDir = mkdtempSync(join(tmpdir(), "zod-criteria-d-"));
  const slug = "case-d";
  try {
    const res = scaffoldIn(repoDir, slug, [BRIEF_CONFIRMED]);
    check("(d) no flag + brief → exit 0 (legacy path)", res.status === 0, `(exit ${res.status})`);
    const taskPath = join(repoDir, ".zcode", "plans", `${slug}.task.md`);
    const buf = existsSync(taskPath) ? readFileSync(taskPath) : null;
    const briefBuf = Buffer.from(BRIEF_CONFIRMED, "utf8");
    check("(d) task file byte-identical to the brief — no first-line stamp",
      buf !== null && Buffer.compare(buf, briefBuf) === 0,
      buf === null ? "(task file missing)"
        : `(first diff at byte ${firstDiff(buf, briefBuf)}; file ${buf.length}B vs brief ${briefBuf.length}B)`);
  } finally { rmSync(repoDir, { recursive: true, force: true }); }
}

// --- (e) --criteria-state banana → exit 2, NOTHING written (fail closed before any write) --
{
  const repoDir = mkdtempSync(join(tmpdir(), "zod-criteria-e-"));
  const slug = "case-e";
  try {
    const res = scaffoldIn(repoDir, slug, [BRIEF_CONFIRMED, "--criteria-state", "banana"]);
    check("(e) --criteria-state banana → exit 2 (fail closed)", res.status === 2, `(exit ${res.status})`);
    check("(e) usage error on stderr", res.status === 2 && (res.stderr || "").trim().length > 0,
      `(stderr: ${(res.stderr || "").trim().split("\n")[0] || "empty"})`);
    check("(e) no plans/<slug>.md written", !existsSync(join(repoDir, ".zcode", "plans", `${slug}.md`)));
    check("(e) no state/<slug>.json written", !existsSync(join(repoDir, ".zcode", "state", `${slug}.json`)));
    check("(e) no plans/<slug>.task.md written", !existsSync(join(repoDir, ".zcode", "plans", `${slug}.task.md`)));
    check("(e) no .zcode dir created at all (validation precedes mkdirSync)",
      !existsSync(join(repoDir, ".zcode")));
  } finally { rmSync(repoDir, { recursive: true, force: true }); }
}

// --- (f) flag with NO brief → exit 0 + existing W5 warning, nothing stamped ----------------
// The flag rides the 5th (taskArg) position here — the silent-drop shape this change closes:
// today the flag string itself is captured as an inline brief.
{
  const repoDir = mkdtempSync(join(tmpdir(), "zod-criteria-f-"));
  const slug = "case-f";
  try {
    const res = scaffoldIn(repoDir, slug, ["--criteria-state", "confirmed"]);
    check("(f) flag with no brief → exit 0 (never an error)", res.status === 0, `(exit ${res.status})`);
    check("(f) existing W5 no-brief warning on stderr",
      (res.stderr || "").includes("no primed brief captured"),
      `(stderr: ${(res.stderr || "").trim().split("\n").slice(-1)[0] || "empty"})`);
    check("(f) nothing stamped — no task file written",
      !existsSync(join(repoDir, ".zcode", "plans", `${slug}.task.md`)));
  } finally { rmSync(repoDir, { recursive: true, force: true }); }
}

// --- (g) plan.md and state.json unaffected by the flag in every passing case ---------------
// Two scratch repos, same slug/title/intent/brief: one flagged, one plain. plan.md is a
// static template → raw byte compare. state.json → compare after neutralizing only the
// where/when axes (see normalizeState).
{
  const repoFlagged = mkdtempSync(join(tmpdir(), "zod-criteria-g1-"));
  const repoPlain = mkdtempSync(join(tmpdir(), "zod-criteria-g2-"));
  const slug = "case-g";
  try {
    const rf = scaffoldIn(repoFlagged, slug, [BRIEF_CONFIRMED, "--criteria-state", "confirmed"]);
    const rp = scaffoldIn(repoPlain, slug, [BRIEF_CONFIRMED]);
    check("(g) both invocations exit 0", rf.status === 0 && rp.status === 0,
      `(flagged exit ${rf.status}, plain exit ${rp.status})`);
    const planFlagged = readFileSync(join(repoFlagged, ".zcode", "plans", `${slug}.md`));
    const planPlain = readFileSync(join(repoPlain, ".zcode", "plans", `${slug}.md`));
    check("(g) plan.md byte-identical with vs without the flag",
      Buffer.compare(planFlagged, planPlain) === 0,
      `(first diff at byte ${firstDiff(planFlagged, planPlain)})`);
    const stateFlagged = normalizeState(repoFlagged,
      readFileSync(join(repoFlagged, ".zcode", "state", `${slug}.json`)));
    const statePlain = normalizeState(repoPlain,
      readFileSync(join(repoPlain, ".zcode", "state", `${slug}.json`)));
    check("(g) state.json identical with vs without the flag (repo/timestamp/marker normalized)",
      stateFlagged === statePlain,
      `(first diff at char ${firstDiff(Buffer.from(stateFlagged), Buffer.from(statePlain))})`);
  } finally {
    rmSync(repoFlagged, { recursive: true, force: true });
    rmSync(repoPlain, { recursive: true, force: true });
  }
}

// --- (h) SKILL.md box-envelope fence (conductor-contract shape, asserted on THIS tree) -----
// Plain string ops only — no regex, no HTML-comment literal (that restriction is about the
// plan body; this case just does not need one). Envelope values were re-measured at write
// time and pinned: 63-65 code points, exactly 2 bars, >= 75 bar-bearing lines (79 today).
{
  const text = readFileSync(SKILL_MD, "utf8");
  const lines = text.split("\n");
  const BAR = "│"; // U+2502 box-drawing vertical
  const primeIdx = lines.findIndex((l) => l.includes("-1. PRIME"));
  let fenceStart = -1;
  for (let i = primeIdx; i >= 0; i--) { if (lines[i].trim().startsWith("```")) { fenceStart = i; break; } }
  let fenceEnd = -1;
  for (let i = primeIdx + 1; i < lines.length; i++) { if (lines[i].trim().startsWith("```")) { fenceEnd = i; break; } }
  check("(h) state-machine fence located (fenced block containing -1. PRIME)",
    fenceStart !== -1 && fenceEnd > fenceStart, `(fence lines ${fenceStart + 1}..${fenceEnd + 1})`);
  const barLines = [];
  lines.forEach((l, i) => { if (l.includes(BAR)) barLines.push(i); });
  check("(h) bar-bearing lines present (>= 75)", barLines.length >= 75, `(count = ${barLines.length})`);
  const badBarCount = barLines.filter((i) => lines[i].split(BAR).length - 1 !== 2);
  check("(h) every bar-bearing line has EXACTLY 2 bars", badBarCount.length === 0,
    `(offenders: ${badBarCount.map((i) => i + 1).join(",").slice(0, 80)})`);
  const MIN_LEN = 63, MAX_LEN = 65; // measured envelope, UTF-8 code points
  const badLen = barLines.filter((i) => {
    const n = [...lines[i]].length;
    return n < MIN_LEN || n > MAX_LEN;
  });
  check("(h) bar-bearing line length envelope 63-65 chars", badLen.length === 0,
    `(offenders: ${badLen.map((i) => `${i + 1}(${[...lines[i]].length})`).join(",").slice(0, 80)})`);
  const outside = barLines.filter((i) => i <= fenceStart || i >= fenceEnd);
  check("(h) no bar-bearing line outside the state-machine fence", outside.length === 0,
    `(offenders: ${outside.map((i) => i + 1).join(",").slice(0, 80)})`);
}

console.log(`\n${pass}/${pass + fail} passed`);
exit(fail === 0 ? 0 : 1);
