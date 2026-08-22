# Brief 27 — the trend record identifies the version that emitted it (candidate C3, commissioning)

2026-08-22 · QUEUED — the build brief for the next `/orchestrate` run · target release decided by that run

Promotes candidate **C3** (`docs/impl/00-INDEX.md`, "Three defects found at run-close"). C1 shipped
as row 26, C2 as row 21; C3 is the last of the three and was recorded but never briefed. This is
that prompt.

## What is broken

The version-named plugin-cache directory no longer identifies its own contents, and nothing in the
data it emits closes the gap. The cache path names the **last marketplace Get**; the contents track
the **last `--sync-cache`** (`scripts/install.mjs:37` — "what actually executes"). The two diverge
whenever a `--sync-cache` refreshes content without a Get: the live cache dir observed on this
machine is named `.../zodyssey/0.6.14/` while its `.zcode-plugin/plugin.json` content is the current
release — the directory name and the declared version disagree, and the directory name loses.

This is load-bearing, not cosmetic. The terminal auto-append runs the **cached** `run-report.mjs`
(`set-phase.mjs:480-485` resolves it self-relative "so it is found from the plugin cache install"),
so "which plugin version actually emitted this record?" is a provenance question this project asks on
every `done`/`audited` close. The emitted record (`run-report.mjs:134-166`) carries `slug`, `phase`,
`verify_origin`, `wall_clock_min`, `generated_at`, … but **no version field at all** — so a row in
`~/.zcode/orchestration/eval/results.jsonl` cannot say which plugin version produced it, and the only
thing that could answer it (the cache dir name) answers it wrong.

The operator-facing half is already detected — `scripts/smoke-gate.mjs:105-107` refuses "deployed
version matches repo" on exactly this repo-vs-registered divergence. The **data-facing** half — a
trend corpus whose records are anonymous as to emitter — is what C3 closes.

## What fixed means

Every trend-log record self-identifies the plugin version that emitted it, read from the copy that
actually executed — so provenance survives both the sparse cache dir name and a future `--sync-cache`.

1. **Stamp the self-relative declared version.** `run-report.mjs` reads its OWN plugin manifest,
   resolved relative to its own location — `pathResolve(<this-script-dir>, "..", "..", "..",
   ".zcode-plugin", "plugin.json")` (the install-root depth precedent is `pre-tool.mjs:1750`,
   `pathResolve(SCRIPTS_DIR, "..","..","..")`; `run-report.test.mjs:36` already uses
   `new URL(".", import.meta.url).pathname` for the same self-locate) — parses `.version`, and adds
   it to the emitted `report` object as `zodyssey_version`. Self-relative is the whole point: the
   cache copy's `plugin.json` content tracks `--sync-cache`, so it reports the TRUE executing
   version even inside a stale-named directory. Reading the repo's or cwd's manifest would re-answer
   the same wrong question the directory name already botches.
2. **Fail safe, never fail the close.** An unreadable or unparseable manifest yields
   `zodyssey_version: null` — never a throw. The auto-append is best-effort by contract
   (`set-phase.mjs:479` swallows report errors so a telemetry failure can never fail a phase
   transition); this read must honour that. A missing `version` key is `null`, not `"undefined"`.
3. **Additive only.** The field is appended to the existing record shape; every consumer that does
   not know it ignores it, and legacy records (no field) read as version-absent.

The record moves the provenance answer from the mutable directory name to the immutable emitted row.

## Files

- `skills/odyssey/scripts/run-report.mjs` — the self-relative manifest read (fail-safe to `null`) +
  the `zodyssey_version` field on the `report` object (`:134-166`). No other logic changes; the read
  is a small helper near the top, the field is one line in the object.
- `skills/odyssey/scripts/run-report.test.mjs` — extend the existing black-box subprocess suite
  (`spawnSync` over `run-report.mjs --json`, then `JSON.parse` — the established shape,
  `run-report.test.mjs:33-37`). Cases, RED-first on the unmodified emitter:
  (a) the `--json` record carries `zodyssey_version` equal to the self-relative
  `.zcode-plugin/plugin.json` `.version` (assert it matches the manifest the running checkout ships);
  (b) fail-safe: when the manifest is unreadable from the script's location, the field is `null` and
  the report still emits (no crash, exit 0) — drive this by running a COPY of `run-report.mjs` from a
  temp dir with no `.zcode-plugin/` above it, or by asserting the null-branch directly; do not delete
  the repo's real manifest.
- `skills/odyssey/references/scripts.md` — update `run-report.mjs`'s contract row to name the new
  field and its self-relative, fail-safe source.
- `docs/impl/00-INDEX.md` — promote C3: add row 27 to the DAG table, mark SHIPPED with release +
  outcome at close, update the C3 candidate note to point at this brief.
- OPTIONAL, name-don't-build: `skills/odyssey/scripts/dashboard.mjs` could group/annotate rows by
  `zodyssey_version`. Out of scope here — stamping is the fix; rendering is a separate, later item.
  If touched at all, it is read-only display, no schema change.

## Must NOT do

Read the version from the repo root, cwd, or `package.json`-by-path (the emitter must report the copy
that RAN, resolved self-relative — a repo/cwd read reproduces the exact wrong-answer the directory
name gives); throw or exit non-zero on a missing/corrupt manifest (best-effort — `null` and continue,
so the auto-append never fails a phase transition); refuse or block `--sync-cache` on a version
mismatch (the fail-closed alternative the INDEX weighs and rejects: it trades a provenance hazard for
a broken hotfix channel); change `scripts/smoke-gate.mjs` (its operator-facing check stays — this is
the complementary data-facing half); alter any other field of the record or its ordering beyond
adding one.

Zero npm dependencies · Node 18+ built-ins only · synchronous · the read is best-effort and inert on
failure · every hook/close stays a no-op unless a run is active · fail closed on enforcement, fail
safe on telemetry (this is telemetry).

Anti-goal: no new gate, no refusal path. One additive, self-identifying field.

## Acceptance criteria

(To be finalized by the run's plan; shape:) `node --check skills/odyssey/scripts/run-report.mjs` and
the extended suite; RED first (the unmodified `--json` record has no `zodyssey_version` — case (a)
fails before the change); GREEN after with zero edits to the pre-existing test cases; the fail-safe
case (b) proves `null` + exit 0 with no manifest reachable; suite count **56 → 57**;
`node scripts/run-tests.mjs` green; `node scripts/check-anchors.mjs` clean after reconciliation.
Demonstration (read-only): a fresh `run-report.mjs <repo> <slug> --json` emits a record whose
`zodyssey_version` equals `.zcode-plugin/plugin.json`'s `.version`.

## Paired probe

RED: on the unmodified emitter, `run-report.mjs --json | node -e 'process.exit("zodyssey_version" in
JSON.parse(require("fs").readFileSync(0)) ? 1 : 0)'` — the field is absent, so no corpus record can
answer "which version emitted me". GREEN: the field is present and equals the self-relative manifest
version; with that manifest made unreadable from the script's location, the field is `null` and the
report still emits (exit 0), proving the fail-safe.

## What it breaks

Nothing. The field is additive; unknown-field-tolerant consumers (dashboard, judge, registry) ignore
it; legacy `results.jsonl` rows read as version-absent. The rolling cap and lane routing
(`set-phase.mjs:495-500`) are untouched — one more key per line, well under the cap's concern.

## The class it closes

Provenance rot: a version-named path that stopped naming its contents, so the question the project
asks on every close ("which cached copy executed?") got a confidently wrong answer. Closed by moving
the answer out of the mutable directory name and into the immutable emitted record, read from the
copy that actually ran. NOT closed here: the cache-dir naming itself (owned by the marketplace Get,
not this repo — smoke-gate already surfaces the mismatch to the operator); dashboard rendering of the
new field (separate later item); any refusal-on-mismatch design (explicitly rejected above).

## Docs to update

`docs/impl/00-INDEX.md` (row 27 + C3 candidate note), `skills/odyssey/references/scripts.md`
(run-report contract row), CHANGELOG entry by the implementing run, this brief stays the
commissioning record.

## CHANGELOG entry shape

```
### Fixed — trend records identify the plugin version that emitted them (candidate C3)

The plugin-cache directory name tracks the last marketplace Get while its contents track the last
--sync-cache (install.mjs:37), so a version-named cache dir can execute a different version's code
— and the emitted trend record (run-report.mjs) carried no version at all, leaving every
results.jsonl row anonymous as to emitter. run-report.mjs now stamps zodyssey_version into each
record, read self-relative from its own .zcode-plugin/plugin.json (the copy that actually ran, whose
content follows --sync-cache) and fail-safe to null so the best-effort auto-append never fails a
close. Additive; smoke-gate's operator-facing version check is unchanged. Suite 56 → 57.
```

## Anchor-drift reconciliation

`run-report.mjs` carries **9 pinned citations** (measured 2026-08-22) — low exposure, but a helper
inserted near the top will shift them. Fixed order after any line shift: change code →
`node scripts/check-anchors.mjs` (read the drift) → repoint each affected citation AT ITS SOURCE
document → *only then* `node scripts/check-anchors.mjs --update`. Never `--update` first. Keep the
read to a tight helper to hold drift small.

## Capability routing

`routed: skill:test-driven-development` (a telemetry-field change: red-first against the unmodified
`--json` record) + `routed: agent:zodyssey:oracle` at plan review (provenance/measurement integrity,
the architecture-intent lane).

## Estimated size

S — one small self-relative read helper + one record field in `run-report.mjs` + two test cases +
doc touches. The only subtlety is *which* manifest is read: it MUST be self-relative to the executing
script (so it follows `--sync-cache`), never the repo/cwd — the read that would reproduce the very
wrong answer the directory name already gives.
