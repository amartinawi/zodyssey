# 14 — OTel GenAI span emission: one run-span exported at close, recorded-inert when unconfigured

Build order **14** · depends-on **—** · queue row: [`docs/impl/00-INDEX.md`](00-INDEX.md)
`14 otel-genai-span-emission` · observability/measurement-class · **minor** release. Last in the
queue on purpose: the item is externally blocked — every `gen_ai.*` semconv attribute is still
"Development" stability (`docs/OPPORTUNITY-MAP.md:275`, label carried from the discovery pass,
**not re-fetched** for this prompt) — so it was demoted behind everything the repo can finish on
its own. That block is a design constraint here, not a footnote: see "What fixed means" item 5.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were re-derived on 2026-08-16 and this file moves fast. Do exactly this one change.

## What is broken

**Zero OpenTelemetry surface exists in the code.** `grep -ri 'otel\|opentelemetry\|otlp\|semconv'`
across `skills/`, `scripts/`, `agents/`, `commands/` (`*.mjs`, `*.bash`) returns **no hits**
(stamped 2026-08-16; re-run it, the absence is the "before" half of your paired probe). No span is
emitted, no exporter exists, no OTLP protocol is spoken anywhere.

**Meanwhile the data that would populate spans is already recorded — into a private silo.** When a
run reaches `done|audited`, `skills/odyssey/scripts/set-phase.mjs:478-498` spawns the cached
run-report and appends its JSON record to `~/.zcode/orchestration/eval/results.jsonl`
(203 records at re-derivation time; the file is live and drifted 184 → 185 → 203 across this
queue's own lifetime — stamp your own count). That record already carries everything a run-span
needs: timing (`skills/odyssey/scripts/run-report.mjs:37-42` derives `start` from
`state.started_at` and `end` from the phase/checkpoint tail; `:117` emits `wall_clock_min`),
outcome (`:103-124` — `success`, `verdict`, `review_rounds`, `todos_total/done/failed`, retries,
resume events, hook blocks), and cost (`:99` calls `collectRunTokens`; `:127` passes `tokens`
through, null-or-populated per queue item 06). `results.jsonl` is read by exactly two audiences:
this repo's own dashboard script and a human with `grep`. No standard observability tool — no
collector, no Jaeger, no vendor backend — can see any of it. The GenAI semconv shape this data maps
onto is already written down at `docs/OPPORTUNITY-MAP.md:411-412` (`invoke_agent` → `chat` /
`execute_tool` span tree).

**And the reason nothing was built is still true: the attribute vocabulary churns.** Every
`gen_ai.*` attribute is "Development" stability, none Stable (`docs/OPPORTUNITY-MAP.md:275` — a
label carried from the discovery pass, dated; this prompt deliberately does not re-fetch it). What
that means concretely: attribute names and shapes may rename or disappear in any semconv revision,
so any consumer query pinned to today's names can break underneath them. An emitter that scatters
`gen_ai.*` string literals across its code inherits that churn as N edit sites; an emitter that
pins one named snapshot constant inherits it as one.

**The constraint tension this prompt must resolve, stated up front:** the repo runs **Zero npm
dependencies** (Step 5, verbatim below), so the OpenTelemetry JS SDK — the default way anyone
emits spans — is unavailable. The constraint-compatible path is a hand-rolled **OTLP/JSON over
HTTP** export: `POST <endpoint>/v1/traces` with an
`application/json` `ExportTraceServiceRequest` body, built from Node built-ins (`node:http` or
built-in `fetch`, `node:crypto` for trace/span ids). The honest tradeoff: the SDK gives you
batching, retries, resource detection, and semconv constants for free; hand-rolled gives you none
of that, in exchange for zero dependency surface and ~120 lines you fully control. This repo has
already chosen that side of the trade once — `skills/odyssey/scripts/lib/tokens.mjs:179-192` reads
SQLite through `process.getBuiltinModule` rather than taking a dependency — and this change makes
the same choice. No-SDK is the path; do not propose the SDK.

## What fixed means

Stated as observable behaviour, not as a diff:

1. **Endpoint configured → one span per run, exported at run close.** If
   `ZODYSSEY_OTLP_TRACES_ENDPOINT` is set, the `done|audited` transition exports exactly one span
   for the run: an OTLP/JSON `POST` to `<endpoint>/v1/traces`, span name `invoke_agent` (the
   convention's root operation per `docs/OPPORTUNITY-MAP.md:411`), start/end timestamps from the
   same derivation run-report uses (`skills/odyssey/scripts/run-report.mjs:37-42`), and attributes
   mapped from the already-computed run-report record (slug, intent, verdict, success,
   `todos_total/done/failed`, `wall_clock_min`, token totals when populated). The emitter consumes
   that record — set-phase already has it in hand at `:456-461` — rather than re-deriving scorecard
   arithmetic that could drift from run-report. One source of truth.
2. **No endpoint → recorded inert, zero cost.** With the env var unset, run close makes **no
   network attempt and spawns no emitter process**; run state gains an additive
   `telemetry.otel = { status: "inert", reason: "unconfigured", at }` stamp (the
   backward-compat `|| {}` discipline; old states load unchanged). This is the graceful-no-op
   rule: the optional tool is absent, its absence is *recorded*, and it costs nothing.
3. **Export failure never breaks the run.** Endpoint unreachable, non-2xx response, malformed
   response, timeout (bound it — ~2 s): the outcome is stamped
   `{ status: "inert", reason: "export-failed", detail }` and the phase transition proceeds
   exactly as before. Telemetry is downstream of the run, never in its critical path — the same
   best-effort contract the results.jsonl append already carries
   (`skills/odyssey/scripts/set-phase.mjs:501`, "never fail the phase transition on a report
   error"). On success, state records `{ status: "exported", trace_id, span_id, at }`.
4. **Emitter exit contract:** `0` for exported *or* inert (both are successful outcomes — inert is
   honest absence, not failure), `2` for bad args — the same shape as run-report's
   (`skills/odyssey/scripts/run-report.mjs:13`). Stdout always carries one machine-readable JSON
   outcome line; that line is the test surface.
5. **Attribute churn is a one-line bump.** Every emitted attribute name and the span name live in
   one exported map keyed by a single `SEMCONV_SNAPSHOT` constant that names the pinned semconv
   snapshot (a dated version string you verify at build time — see Must NOT do). No `gen_ai.*`
   string literal appears anywhere outside that map. When the conventions rename an attribute, the
   bump is one constant plus the map entries behind it, and the CHANGELOG records it.
6. **Granularity: one span per run — chosen, and here is why.** The only timestamped per-todo and
   per-dispatch data that exists today is none: state records todo *status*, not timing, and hook
   events are not logged as time series. Per-todo or per-dispatch spans would therefore carry
   fabricated or absent timestamps — dishonest telemetry, and this repo does not fake measurements
   (`skills/odyssey/scripts/lib/tokens.mjs:26-29` states the rule for tokens; it holds for spans).
   Run-level timing is real (`state.started_at` → checkpoint tail), so run-level is the honest
   granularity. The full `invoke_agent` → `chat`/`execute_tool` per-dispatch tree remains the named
   follow-up (CHANGELOG *Known, not fixed*) and would require per-dispatch timestamp capture first.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/scripts/otel-emit.mjs` (new — the emitter: env check, span build, OTLP/JSON
  export, inert stamping, the `SEMCONV_SNAPSHOT` map)
- `skills/odyssey/scripts/set-phase.mjs` (the hook-in, following the B8 wiring precedent at
  `:338-341`: a bounded `execFileSync` child inside the `done|audited` block at `:454-481`, plus
  the additive `telemetry.otel` state stamp — reusing the file's existing locked-write helpers,
  best-effort)
- `skills/odyssey/scripts/otel-emit.test.mjs` (new — local receiver test; see Paired probe)

Deliberate omissions, both verified non-causal: `skills/odyssey/scripts/run-report.mjs` (the
emitter consumes its already-computed record; forking its arithmetic would create a second source
of truth that drifts) and `skills/odyssey/hooks/pre-tool.mjs` (the enforcement gate; a telemetry
change has no business in it — network I/O in the per-tool-call hook path would put export
latency inside the gate). `scripts/run-tests.mjs` needs no edit: it auto-discovers every
`*.test.mjs`, so the new suite joins the aggregate by existing. The docs listed under "Docs to
update" belong to the release pass, not the gated run.

## Must NOT do

- **No OTel SDK, no npm dependency of any kind.** Zero npm dependencies · Node 18+ built-ins only.
  The hand-rolled OTLP/JSON exporter is the constraint-compatible path, chosen above with its
  tradeoff stated. A proposal that adds `@opentelemetry/*` to `package.json` is cut, not footnoted.
- **No emission, no network attempt, no emitter spawn when unconfigured.** The env-absent path is
  a recorded inert and a local state write — nothing else. Zero cost means zero.
- **Do not block run close on export failure.** No retry loop, no non-zero exit from inside the
  transition, no second attempt after a refused connection. Inert-on-error, once, recorded —
  telemetry MUST NOT break the run.
- **Do not put export calls in a hook's per-tool-call path** (`pre-tool.mjs`/`post-tool.mjs` are
  out of `Files:` entirely). Emission happens once, at close, out of process.
- **Do not fabricate timing, tokens, or attributes.** Spans carry only values that exist in run
  state or the run-report record. Absent value → attribute omitted, never zero-filled.
- **Do not hard-code `gen_ai.*` names outside the snapshot map**, and do not pin the snapshot to
  this prompt's date blindly: at build time you MUST check the current GenAI semconv attribute
  names for the vocabulary you emit (the carried label at `docs/OPPORTUNITY-MAP.md:275` is
  discovery-pass vintage, and this prompt did not re-fetch it) and pin what you verify. One
  constant, one map, dated.
- **Do not use the standard `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` var as the trigger.** An operator
  who has OTel configured machine-wide for other tooling would get surprise emission from every
  run. The `ZODYSSEY_` prefix (the `ZODYSSEY_UNGATE_BASH` / `ZODYSSEY_PARALLEL_CAP` precedent)
  makes opt-in deliberate. Documenting the choice is part of the change.
- Do not alter the results.jsonl record shape, the append at
  `skills/odyssey/scripts/set-phase.mjs:495-498`, or run-report's exit contract.
- Do not add a reviewer, judge, or verifier agent for anything here. **No LLM opinion layer** —
  every verification in this change is an exit code, a received HTTP body, or a grep.

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active
- **No argv flag authenticates anyone** — every script is invocable by any agent with the same argv
  surface the operator has. A flag can remove a *silent* path; it cannot grant authority.
- Fail closed. An unverifiable state blocks; it never passes.
- A repo-capability check degrades to a recorded `inert`, never to a block. Over-blocking is a new
  failure of the class the change exists to remove.

### Anchor-drift reconciliation (amendment, 2026-08-16)

`scripts/check-anchors.test.mjs` landed after this prompt was written and runs inside
`node scripts/run-tests.mjs`. It content-pins every `file:line` citation in the repo's docs, so
**editing a cited file makes the suite go red until the citations are reconciled.** That is the
check working, not a defect in your change.

**This change's exposure: 95 pinned citations point into the files it edits.** Heaviest: `skills/odyssey/hooks/pre-tool.mjs` (51), `skills/odyssey/scripts/set-phase.mjs` (29), `skills/odyssey/scripts/run-report.mjs` (9).

Procedure, in this order:

1. Make the code change and get your own criteria passing.
2. Run `node scripts/check-anchors.mjs`. Every reported `[drift]` names the citing document, the
   cited file and line, and what that line now holds.
3. **Reconcile each one at the source** — fix the citation to point where the content actually
   moved. Do not skip to step 4.
4. Only then run `node scripts/check-anchors.mjs --update` to re-pin, and re-run the suite.

**The footgun is running `--update` first.** It re-pins whatever is there, including citations that
were already wrong, and the drift becomes invisible. That happened during item 15's own build: the
lock was seeded over a README citation that had already drifted 11 lines, and the check
could only flag the *next* shift. The lock records "unchanged since seeding", never "correct".

## Acceptance criteria

Every criterion is an exact command from the repo root plus its expected exit code. `record-verify`
executes them and records the codes as evidence; a criterion a human must read and agree with is
not a criterion.

1. `node --check skills/odyssey/scripts/otel-emit.mjs && node --check skills/odyssey/scripts/set-phase.mjs`
   — expected exit **0**.
2. `node skills/odyssey/scripts/otel-emit.test.mjs` — expected exit **0** (prints `N passed,
   0 failed`; contains the three arms: configured → receiver asserts the OTLP/JSON body;
   unconfigured → inert, canary receiver untouched; dead endpoint → inert `export-failed`,
   exit 0).
3. Live unconfigured probe, run against the fix-run's own state (any non-`inflight` slug under
   `.zcode/state/` — the fix run's own qualifies):
   `env -u ZODYSSEY_OTLP_TRACES_ENDPOINT node skills/odyssey/scripts/otel-emit.mjs . "$(ls .zcode/state/*.json | grep -v inflight | head -1 | xargs basename | sed 's/\.json$//')" </dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s.trim().split("\n").pop());process.exit(o.inert===true&&o.reason==="unconfigured"?0:1)})'`
   — expected exit **0**: stdout's last line is the machine-readable inert outcome, never a stack
   trace, never silence.
4. Delimit the snapshot map with sentinel comments (`// --- semconv snapshot map: every gen_ai.*
   literal lives here ---` … `// --- end semconv snapshot map ---`), then:
   `test "$(grep -c 'gen_ai\.' skills/odyssey/scripts/otel-emit.mjs)" = "$(sed -n '/semconv snapshot map/,/end semconv snapshot map/p' skills/odyssey/scripts/otel-emit.mjs | grep -c 'gen_ai\.')" && grep -q 'SEMCONV_SNAPSHOT' skills/odyssey/scripts/otel-emit.mjs`
   — expected exit **0**: every `gen_ai.` literal in the emitter sits inside the map block, and the
   snapshot constant exists. Churn is provably a one-edit-site change, not an assertion about it.
5. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites,
   2026-08-16; the runner auto-discovers the new suite (33rd), and the count may legitimately
   grow — the exit code must not change.
6. The paired direction — proof the new test actually runs against the broken code, re-provable on
   demand (in TDD order you demonstrate the red BEFORE writing the emitter):
   `git stash push -u -- skills/odyssey/scripts/otel-emit.mjs skills/odyssey/scripts/otel-emit.test.mjs && { node skills/odyssey/scripts/otel-emit.test.mjs; ec=$?; }; git stash pop; test $ec -eq 1`
   — expected exit **0** overall: with only the two new files reverted (`-u` because they are
   untracked/new), the suite fails (module absent) and exits 1.

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** No deny-list shape anywhere; the inert reasons are a
   closed set (`unconfigured` | `export-failed` | `bad-args`) derived from the actual failure
   sites, and an unexpected export error falls into `export-failed` rather than passing silently.
2. **A check that cannot detect the class of failure it exists for.** The class here is invisible
   telemetry. Emission is proven by a receiver that **asserts on the received HTTP body** — not by
   the emitter's own claim of success — and absence is proven by a canary receiver that fails the
   test if touched. The check can see its own failure.
3. **Ceremony without mechanism.** Ships an emitter plus a receiver-asserting suite; the env-absent
   and dead-endpoint arms are executed every run of the suite, not documented hopes.
4. **Self-grading.** Every criterion is machine-executed with a recorded exit code; the receiver,
   not the emitter, grades the export.
5. **A fix that reopens its own class.** Covered in "The class it closes" — the unconfigured→inert
   arm is the standing tripwire against a second silent telemetry path.

## Paired probe

Three probes, each with both directions stated:

- **Probe A — the export (the core deliverable).** Start a local receiver with `node:http` on
  `127.0.0.1:0` (ephemeral port) inside the test; set `ZODYSSEY_OTLP_TRACES_ENDPOINT` to it; run
  the emitter against a seeded state fixture. **Before (current HEAD): no protocol exists at all —
  the emitter module is absent (`node … otel-emit.mjs` exits 1, cannot-find-module) and no byte
  ever reaches the receiver; the receiver's request count is 0 forever.** **After: the receiver
  captured exactly one `POST /v1/traces` with `content-type: application/json`, a body that parses
  as an OTLP `ExportTraceServiceRequest`, exactly one span, and the span carries the expected
  fields** — name `invoke_agent`, 32-hex `traceId` and 16-hex `spanId`, nanosecond
  start/end consistent with the fixture's `state.started_at` and close time, and attributes
  including the run slug, the outcome, and the `gen_ai.*` set exactly as pinned in
  `SEMCONV_SNAPSHOT`.
- **Probe B — unconfigured inertness (the graceful no-op).** Same canary receiver still listening;
  run the emitter with the env var unset. **Before: no behavior to observe (module absent).**
  **After: exit 0, last stdout line `{"inert":true,"reason":"unconfigured",…}`, and the canary
  receiver's request count is STILL 0** — zero network attempt, provably, because a server was
  listening the whole time and nothing arrived.
- **Probe C — export failure degradation.** Point the env var at a port where nothing listens
  (`http://127.0.0.1:1`). **Before: no behavior.** **After: exit 0 within the bound (~2 s), stdout
  inert line with `reason:"export-failed"`** — never a crash, never a non-zero exit, never a
  retry.

Controls required on BOTH builds — a probe that moves any of them has overreached: the
`done|audited` transition still completes with the endpoint set to garbage (telemetry never blocks
the run); the results.jsonl append at `skills/odyssey/scripts/set-phase.mjs:495-498` still fires,
byte-shape unchanged; run-report's exit contract (`0/2/3`) is untouched; pre- and post-tool hooks
are untouched; `node scripts/run-tests.mjs` still exits 0.

## What it breaks

**Nothing when unconfigured — by construction, and provably so.** The env-absent path adds one
local state-key write and makes no network call and no child spawn; probe B's canary is the proof,
and every existing run (every user who never sets the var) executes exactly that path. The state
schema grows an optional `telemetry` field — additive, `|| {}` discipline, old states load
unchanged.

When configured, the honest blast radius is:

- **Run close gains one outbound HTTP request and one bounded child spawn.** Opt-in by env var;
  the operator who set the endpoint asked for exactly this. The ~2 s timeout and
  inert-on-error contract bound the worst case (the B8/CRIT-4a wiring shape at
  `skills/odyssey/scripts/set-phase.mjs:356-366` and `:503-514` is the precedent: best-effort
  child inside the transition, `try/catch`, never fail the phase).
- **Consumers pinned to today's `gen_ai.*` attribute names can break when semconv renames them**
  — the external caveat, now inherited. Mitigated, not solved: the `SEMCONV_SNAPSHOT` constant
  makes churn a one-line bump plus a CHANGELOG line, and criterion 4 keeps every name inside one
  map so nothing scatters. This residual is named under *Known, not fixed*; it closes only when
  the attributes go Stable.
- `results.jsonl` consumers: none affected — the record shape is deliberately untouched; the span
  is a parallel output channel, not a mutation of the trend log.

## The class it closes

**Telemetry trapped in a private silo — data recorded where no standard tool can see it.** This is
the same class as queue item 06 (token-null telemetry: values flattened into a private sentinel
inside a private JSONL). 06 made the *values* honest; this item makes the *channel* standard: the
run record stops being readable only by this repo's own dashboard and becomes legible to any
OTLP-speaking collector, backend, or dashboard an operator already runs.

How this change could reintroduce the class: the next telemetry path (per-dispatch spans, cost
export, a second signal) gets added without the inert discipline — emitting unconfigured,
throwing on failure, or silently doing nothing with no record — and a new silent-or-brittle
telemetry path appears at a new key. What prevents that: probe B's canary arm is a standing
regression test for the exact rule "unconfigured → recorded inert, zero network", the closed
reason set means an unexpected failure mode lands in `export-failed` instead of passing silently,
and criterion 6 keeps the whole suite red-if-reverted. A future telemetry addition that skips the
rule fails the same shape of test it must copy.

## Docs to update

Every doc that states the claim this change alters, each checked against the 2026-08-16 tree:

- `docs/MEASUREMENT.md` — the observability/output-channel material (the trend-log pipeline around
  `:133-140`): add the OTel export as a second output channel — the env var, the one-span
  granularity and why, the snapshot constant, and the inert outcome shapes.
- `CHANGELOG.md` — new version's **Added** entry (shape below) plus the *Known, not fixed*
  residuals.
- `skills/odyssey/references/scripts.md` — a new entry for `scripts/otel-emit.mjs` (argv, env var,
  exit contract `0/2`, stdout outcome line, `SEMCONV_SNAPSHOT`); the set-phase entry at `:9` gains
  one clause (on `done|audited`, exports one run-span when the OTLP endpoint is configured).
- `docs/DESIGN.md` §11 "Observability & evaluation" (`:398`; the eval-harness inventory row at
  `:426` names `results.jsonl` today) — add the OTLP export as the standard-tooling leg of the
  observability story, with the Development-stability caveat carried.
- `README.md` — checked: it makes no observability-channel claim (zero hits for observ/telemetry/
  results.jsonl). No edit required unless the release notes want to advertise the env var; record
  the decision either way.

## CHANGELOG entry shape

**Minor** release — a new optional capability under **Added**, no behavior change for anyone who
does not opt in, no security surface touched.

- **Added** — one entry: run close can now export one OTel/GenAI span per run via OTLP/JSON over
  HTTP, built entirely on Node built-ins (no SDK, zero npm dependencies — name the tradeoff in the
  clause). State the trigger (`ZODYSSEY_OTLP_TRACES_ENDPOINT`, deliberately not the standard
  `OTEL_EXPORTER_OTLP_*` var, so machine-wide OTel config never causes surprise emission), the
  granularity (one run-span; why not per-todo/per-dispatch — no honest per-dispatch timestamps
  exist yet), and the degradation contract (unconfigured → recorded inert, zero cost; export
  failure → recorded inert, never blocks the run). Cite the probe evidence: receiver-asserted
  export, canary-proved no-op, dead-endpoint inertness.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - The `gen_ai.*` attributes are Development-stability (`docs/OPPORTUNITY-MAP.md:275` label,
    re-verified at build time) and **may churn**; consumers pinned to current names are exposed,
    mitigated only by the `SEMCONV_SNAPSHOT` one-line bump.
  - Emission granularity is run-level only; the `invoke_agent` → `chat`/`execute_tool`
    per-dispatch tree is unbuilt and blocked on per-dispatch timestamp capture.
  - The export is one shot, no retry, no batching — a collector blip at close loses that run's
    span to a recorded `export-failed` inert; it is not re-emitted.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs`, then
  **re-Get/Update the plugin so the marketplace cache picks up the scripts** — the emitter is
  spawned from the cache path exactly like run-report is (`set-phase.mjs:481-485`), so a fix that
  stays only in the dev tree emits nothing (the `truncate-roundto` cache-refresh natural experiment
  documented in queue item 06 is the standing proof of that failure shape).

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is pure code logic across one new emitter, one wiring change, and one new receiver test; the
run's whole method is red-green — write the failing receiver/inert/canary cases first (criterion
6's demonstration against the module-absent tree), then make them green. F5 cross-checks the
declaration against hook-witnessed loads, so a declaration without a real load fails the final
wave — declare nothing speculative. No `discovered:`/`generic:` (no find-skills call is planned)
and no `mcp:` declarations (none will be loaded — the receiver is `node:http`, the export is
built-ins; if a test fails in a way two fix attempts do not diagnose, loading
`systematic-debugging` is correct — declare it only if it is actually loaded, after the fact,
never in anticipation).

## Estimated size

~120 lines in `skills/odyssey/scripts/otel-emit.mjs` (env check, span build from the run record,
OTLP/JSON body, export with timeout, inert stamping, the `SEMCONV_SNAPSHOT` map), ~25 in
`skills/odyssey/scripts/set-phase.mjs` (B8-shape wiring in the `done|audited` block plus the
additive state stamp), ~140 in `skills/odyssey/scripts/otel-emit.test.mjs` (local receiver,
fixture state, three probe arms), ~15 of docs. **Minor** release — a new opt-in capability, additive
state field, zero change for unconfigured users; ship it without unrelated riders so the first
configured emission is attributable to exactly this change.
