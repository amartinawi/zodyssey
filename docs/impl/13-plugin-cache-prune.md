# 13 — Prune stale plugin-cache versions

Build order **13** · depends-on **—** (nothing precedes or blocks it) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `13 plugin-cache-prune` · not security-class · patch release.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
and on-disk counts below were re-derived on 2026-08-16 and both this repo and the live cache move
fast. Do exactly this one change.

## What is broken

Every marketplace Update of the plugin leaves the previous version's cache directory on disk, and
nothing in this repo ever removes any of them. Measured fresh for this prompt, 2026-08-16:
`ls -1 ~/.zcode/cli/plugins/cache/zodyssey-local/zodyssey/` → **6 version dirs** — `0.3.2`
(Aug 12), `0.4.0`, `0.4.1` (Aug 14), `0.5.0`, `0.5.1`, `0.5.2` (Aug 15) — i.e. the full release
history of the last four days, accumulating one dir per Update, forever. `du -sh` per dir: 9.3M,
12M, 13M, 15M, 16M, 16M — **~65M of the 79M total is stale** (everything but the live `0.5.2`).

Which dir is live is not a guess and not a property of the tree — it is recorded in the registry:
`~/.zcode/cli/plugins/installed_plugins.json` carries the `zodyssey@zodyssey-local` entry with
`"version": "0.5.2"` and `"installPath": ".../cache/zodyssey-local/zodyssey/0.5.2"` (plus a
marketplace-owned `cacheTransactionId`). `scripts/install.mjs` already reads exactly this truth:
`PLUGINS_JSON_PATH` at `scripts/install.mjs:54`, `loadPluginsJson()` at `:138-149`,
`findInstalledEntry()` at `:154-160`, `resolveInstallPath()` at `:162-167`. The repo manifest
(`.zcode-plugin/plugin.json:4`) also reads `0.5.2` today, but that is coincidence of timing, not
the mechanism — during a version bump the registry points at the OLD dir while the repo says the
NEW one, so "matches the repo's VERSION" is exactly the wrong live-ness test.

No prune path exists. Proof by exhaustion of the delete sites: `grep -n 'rmSync'
scripts/install.mjs` → exactly 3 hits — the import (`:40`), the pre-v0.3.0 pollution purge
(`:419`, removing `~/.zcode/skills`-era paths), and `--uninstall` (`:955`, the same purge paths)
— none of which walks `cache/<marketplace>/<plugin>/<version>/`. The one command that writes into
the cache at all, `--sync-cache`, only ever `cpSync`s INTO the registered dir
(`scripts/install.mjs:282`) and its own header boasts "no registry writes, no config edits"
(`:183-184`); the marketplace subsystem owns cache creation (`:6-7`) and leaves old versions
behind on Update — empirically, six of them in four days. `--verify` checks the registered
path's liveness (`scripts/install.mjs:668-686`) but never enumerates its siblings, so the
accumulation is invisible to every current check; `--uninstall` explicitly defers cache +
registry to the GUI (`:958-961`).

The paired-probe broken direction below shows the sharpest edge: today `install.mjs` accepts any
argv without complaint (only the four booleans at `scripts/install.mjs:93-96` are ever consulted),
so a hypothetical `--prune-cache` flag run against the current build is **silently ignored** and
the default install flow runs — exit 0, nothing listed, nothing deleted, indistinguishable from
success. That is this repo's documented false-green shape (`scripts/run-tests.mjs:16-18`), one
directory level up.

## What fixed means

Stated as observable behaviour, not as a diff. **No registry writes, ever** — the v0.3.0 bug was
hand-writing `installed_plugins.json` (`scripts/install.mjs:8-10`, `:219-222`); this change reads
it, and deletes only cache directories it proves are not live.

**1. Retention policy, stated once.** Of the version-shaped directories in the live version's
parent dir (the parent of the registry-resolved `installPath` — and no other directory), keep
exactly: **the live version** (registry truth) and **its immediate semver predecessor** (the
rollback window — a hand-edited-registry rollback by one release still finds its dir on disk).
Prune every version strictly older than the predecessor. **Never prune a version newer than
live**: a downloaded-but-not-yet-registered update is indistinguishable from an orphaned newer
dir, and the registry cannot arbitrate, so both are kept. Concretely, against today's real tree
(6 dirs, live `0.5.2`): keep `0.5.2` + `0.5.1`, prune `0.3.2`, `0.4.0`, `0.4.1`, `0.5.0` — 4 dirs,
~49M. The window is a named constant (`CACHE_PRUNE_KEEP = 2`, i.e. live + previous) in the new
lib, not a per-call argument.

**2. `--prune-cache` — the explicit, exclusive mode.** `node scripts/install.mjs --prune-cache`
computes the plan and executes it, then exits without running any other install phase (the
`--sync-cache` shape: `if (SYNC_CACHE) syncCache()` at `scripts/install.mjs:299` early-exits).
With the existing `--dry-run` flag it prints the plan and deletes nothing — `[dry-run] rm <path>`
lines in the `phasePurge` shape (`scripts/install.mjs:418`). Both modes print one machine-greppable
summary line: `prune-plan: live=<V> keep=<V1,V2> prune=<N>` — the dry run and the execution
consume **the same computed list** (one plan function, two consumers), so "listed" and "deleted"
cannot diverge. Exit codes: **0** on success — including the healthy zero-stale case ("nothing to
prune" is a passing state, not an error); **1** when live-ness cannot be established, with nothing
deleted (below).

**3. Fail closed on unverifiable live-ness — deleting the live cache is the catastrophic case.**
Any of: `installed_plugins.json` missing or unparseable · no `zodyssey` entry · entry without
`version`/`installPath` · resolved `installPath` does not exist · `installPath` not under the
cache base → the explicit flag prints the reason, deletes **nothing**, exits **1**. No fallback
heuristic is ever consulted — not directory mtime, not dir count, not the repo's `VERSION`, not
"looks like a cache dir". During a bump the registry's old dir is live while the repo says the new
one; mtime ordering breaks the same way. The registry is the only truth because the registry is
what the loader reads.

**4. The prune is part of install itself.** A default `node scripts/install.mjs` run performs the
prune as its final step, after the existing phases, best-effort: on unverifiable live-ness it
prints a warning and continues (the install's other guarantees do not depend on pruning — fail
closed means *delete nothing*, not *block the installer*). This is the anti-reopening property:
GC that fires only when remembered is the opt-in shape prompt 02 closed for the zero-caller
checks; GC inside install fires every upgrade by construction.

**5. Deletion hygiene, all structural.** Only direct children of the live parent dir whose names
match `/^\d+\.\d+\.\d+$/` are candidates; anything else in that dir (files, non-semver names) is
reported as `skipped` and never touched. Other plugins' and other marketplaces' cache trees are
never walked — containment derives from the registry entry's own `installPath`, not from a glob
over the cache base. No mid-run refusal is needed (contrast `--sync-cache`'s guard at
`scripts/install.mjs:195-212`): stale dirs are never executed — hooks resolve via
`${CLAUDE_PLUGIN_ROOT}` = the registered path — so removing them changes no live behaviour
between tool calls.

**6. `--verify` gains one informational line** — `stale cache dirs: N (prunable via
--prune-cache)` — computed from the same plan function. It is never a failing check: ops hygiene
degrades to a recorded observation, never to a block.

Mechanism notes, secondary to the behaviour: the plan lives in a new pure module
`scripts/lib/cache-prune.mjs` (the `scripts/lib/deploy-surface.mjs` precedent) exporting
`planCachePrune({ pluginsJsonPath })` → `{ liveVersion, keep[], prune[], skipped[] }` or
`{ error }`; it performs no deletion — `install.mjs` consumes the list. Version comparison is a
hand-rolled numeric `x.y.z` compare. Testability rides on `os.homedir()` honouring `$HOME` on
POSIX: the suite spawns `install.mjs` with `HOME=<fixture>` and a fake
`<fixture>/.zcode/cli/plugins/{installed_plugins.json, cache/zodyssey-local/zodyssey/*}`.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `scripts/install.mjs` (the `--prune-cache` flag + exclusive mode, the default-run final prune
  step, the `--verify` informational line, the usage block at `:27-32`)
- `scripts/lib/cache-prune.mjs` (new — the pure plan function; no deletion code lives here)
- `scripts/cache-prune.test.mjs` (new — no install/cache suite exists today; `ls scripts/*.test.mjs`
  → `deploy-surface.test.mjs`, `version-consistency.test.mjs` only. `scripts/run-tests.mjs`
  discovers every `*.test.mjs` recursively, so the suite count grows by one with no runner
  change.)

Nothing else. Docs (`docs/DEVELOPMENT.md`, `docs/INSTALL.md`, `CHANGELOG.md`) belong to the
release pass, not the gated run — do not widen the set to include them by default. No hook is
touched; no registry is written; `scripts/lib/deploy-surface.mjs` is untouched (the drift gate
compares repo↔live content, which this change does not alter).

## Must NOT do

- **Never delete the live version's directory** — the resolved `installPath` itself, and never
  its parent or any ancestor. This is the catastrophic case the whole fail-closed posture exists
  to prevent; the fixture test asserts the live tree is byte-identical across every code path.
- **Never prune without live-ness confirmed from `installed_plugins.json`.** No mtime ordering,
  no dir-count heuristic, no "matches the repo's `VERSION`" shortcut (wrong by construction during
  a bump), no "anything under cache/ older than X". An unverifiable registry prunes nothing.
- **No `rm -rf` on any list other than the dry-run-verified one.** One plan function computes the
  list; dry-run prints it; execution deletes it. The test asserts the post-execution directory
  state equals exactly the printed plan.
- Never write to `installed_plugins.json` or any marketplace registry — the v0.3.0 bug
  (`scripts/install.mjs:8-10`); this change is read-only against the registry by design.
- Never walk cache dirs other than the parent of the registry-resolved `installPath` (other
  marketplaces', other plugins', or sibling trees are invisible to this code).
- Never delete non-semver-shaped entries in the live parent dir — report them as `skipped`.
- Never prune versions newer than live, no matter how orphaned they look — the pending-update
  ambiguity is unresolvable from the registry, so the safe answer is keep.
- Do not add npm packages (hand-roll the semver compare), no daemon, no background GC, no
  scheduled anything — synchronous process, exit when done.
- Do not make `--verify` fail on stale dirs (informational line only; over-blocking is a new
  failure of the class this change exists to remove).
- Do not batch this into a release carrying queue items 01, 03, or 04 (one security change per
  release; this change is not security-class).
- Do not add an LLM anywhere in the prune path — no "smart" staleness judgment, no agent that
  reviews the plan before deletion. The plan is registry truth + arithmetic, so there is no
  **LLM opinion layer** here — nothing in this change expresses a judgment, and nothing needs one.

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active
- **No argv flag authenticates anyone** — every script is invocable by any agent with the same argv
  surface the operator has. A flag can remove a *silent* path; it cannot grant authority.
  (`--prune-cache` grants nothing: any agent with Bash could already `rm -rf` those dirs with no
  retention window and no live-version protection — the flag is strictly *narrower* than the
  pre-existing shell capability it surfaces. What it removes is the silent path: accumulation
  with no command to see or stop it.)
- Fail closed. An unverifiable state blocks; it never passes. (Unverifiable registry → prune
  nothing; explicit flag exits 1. A prune that cannot prove a dir is stale treats it as not
  stale.)
- A repo-capability check degrades to a recorded `inert`, never to a block. Over-blocking is a new
  failure of the class the change exists to remove. (The `--verify` stale-count line informs,
  never fails; the default-install prune step warns and continues, never aborts the install.)

## Acceptance criteria

Every criterion is an exact command from the repo root plus its expected exit code. `record-verify`
executes them and records the codes as evidence; a criterion a human must read and agree with is
not a criterion. No criterion deletes anything outside a throwaway fixture or a `[dry-run]`.

1. `node --check scripts/install.mjs` — expected exit **0**.
2. `node --check scripts/lib/cache-prune.mjs` — expected exit **0**.
3. `node scripts/cache-prune.test.mjs` — expected exit **0**. The suite must contain and pass, at
   minimum (fixtures under a temp dir; `HOME=<fixture>` for spawn cases): (a) a fixture cache with
   live `0.5.2` + stale `0.3.2, 0.4.0, 0.4.1, 0.5.0, 0.5.1` and a matching registry —
   `planCachePrune` returns keep `{0.5.2, 0.5.1}`, prune `{0.3.2, 0.4.0, 0.4.1, 0.5.0}`, exactly;
   (b) spawn `HOME=<fixture> node scripts/install.mjs --prune-cache` — exit 0, the four prune dirs
   are gone, the live and previous dirs' trees are **byte-identical** to pre-execution hashes, the
   registry file is byte-identical, and the on-disk result equals the summary line's plan exactly;
   (c) the same fixture with `--dry-run --prune-cache` — exit 0, identical plan output, **zero
   deletions** (fixture unchanged); (d) a fixture with a version NEWER than live (e.g. `0.6.0`
   present, registry still `0.5.2`) — newer dir is in `keep`, never pruned; (e) a fixture whose
   registry is missing / unparseable / entry-less / `installPath`-less — exit **1** each, and the
   fixture cache tree is byte-identical afterwards (fail closed deletes nothing); (f) a fixture
   with zero stale dirs — exit 0, `prune=0`, "nothing to prune", no deletions; (g) a fixture with
   a non-semver entry (`backup-tmp`) and a stray file in the live parent dir — both reported
   `skipped`, both still present after execution; (h) a fixture with a second plugin's cache tree
   (`cache/zodyssey-local/other-plugin/0.1.0`) — untouched by every mode; (i) spawn
   `HOME=<fixture> node scripts/install.mjs --dry-run` (no flags) — exit 0 and the output contains
   `[dry-run] rm` lines for exactly the prune set (the default flow carries the step, preview
   only); (j) in-process unit checks of the semver compare (equal, older, newer, differing major).
4. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 32/32 suites,
   2026-08-16; after this change it must read 33/33 (the new suite is discovered — a count that
   stays 32 means the file is misnamed or misplaced, and a runner that reports success over an
   empty set is this repo's documented false-green).
5. The paired direction — proof the suite runs red against the unwired code, re-provable on demand
   (in TDD order you demonstrate it BEFORE writing the wiring):
   `git stash push -u -- scripts/install.mjs scripts/lib/cache-prune.mjs && node scripts/cache-prune.test.mjs; ec=$?; git stash pop; test $ec -ne 0`
   — expected exit **0** overall: with the lib and wiring reverted, the in-process cases fail at
   import and the spawn cases run the pre-change installer, which ignores unknown flags and
   deletes nothing — the suite must exit non-zero.
6. Source tripwire against silent unhooking (the `pre-tool.bash-gate.test.mjs` spirit):
   `test $(grep -c -- '--prune-cache' scripts/install.mjs) -ge 2`
   — expected exit **0** (usage block + implementation; a flag that exists only in the usage
   comment is the ceremony-only shape).
7. The verify-report tripwire: `test $(grep -c 'stale cache' scripts/install.mjs) -ge 1`
   — expected exit **0** (the informational line cannot be silently dropped without this going
   red alongside the suite's spawn case for it).
8. Real-registry dry run, read-only, self-calibrating against the registry's own truth (no
   hard-coded version — this prompt's `0.5.2` stamp is evidence, not a fixture):
   `V=$(node -p 'JSON.parse(require("fs").readFileSync(require("os").homedir()+"/.zcode/cli/plugins/installed_plugins.json","utf8")).plugins.find(p=>p.name==="zodyssey").version'); node scripts/install.mjs --dry-run --prune-cache | tee /tmp/zod-prune-preview.txt | grep -F "live=$V"`
   — expected exit **0**: the preview runs against the real HOME, exits 0 through the pipe, and
   its summary names the registry's live version as kept. The fix-run MAY follow it with a real
   `--prune-cache` (that is this change's point) but no criterion requires the real deletion —
   fixtures carry that proof.

### Failure-mode check (Step 6)

Failure-mode check (Step 6): audited against the five ways this project has actually failed —

1. **Enumeration instead of structure.** The prune set is derived structurally — registry truth +
   semver ordering + a containment rule — not matched against a list of known-stale names. The one
   regex (`/^\d+\.\d+\.\d+$/`) is a type filter whose miss-behaviour is keep-and-report, never
   delete. There is no deny-list to drift.
2. **A check that cannot detect the class of failure it exists for.** The failure here is silent:
   today an unknown flag exits 0 having done nothing. Criterion 5 demonstrates the suite red
   against exactly that build; criteria 3(b)/3(c) assert listed = deleted = plan, so a dry run
   that prints a list nothing consumes, or an execution that deletes off-list, both go red.
3. **Ceremony without mechanism.** The current state is the pure form: dirs accumulate, no command
   exists, no doc mentions it. This ships one plan function with two consumers (print, delete) and
   puts the prune inside the default install so it fires without being remembered — the
   prompt-02/11 lesson applied to disk instead of wiring.
4. **Self-grading.** Every criterion is machine-executed with a recorded exit code; both paired
   directions run; "live intact" is a byte-identity assertion against pre-execution hashes, not a
   reviewer's agreement.
5. **A fix that reopens its own class.** Covered in "The class it closes" — the reopening shapes
   are heuristic live-detection and remember-to-run GC; the fail-closed fixture cases and the
   default-install step fence them respectively.

## Paired probe

**Probe:** a throwaway fixture `HOME` with a registry naming live `0.5.2` and a cache dir holding
`0.3.2, 0.4.0, 0.4.1, 0.5.0, 0.5.1, 0.5.2` — today's real tree, miniaturized.

- **Before the fix (current HEAD): the mode does not exist, and cannot be distinguished from
  success.** `HOME=<fixture> node scripts/install.mjs --dry-run --prune-cache` exits **0** —
  unknown argv is silently ignored (`scripts/install.mjs:93-96` consult four booleans; nothing
  validates the rest), the default flow's dry preview prints, no cache dir is ever named.
  `HOME=<fixture> node scripts/install.mjs --prune-cache` (no `--dry-run`) likewise exits 0 with
  all six dirs intact. Exit 0, nothing listed, nothing gone — the accumulation is invisible from
  inside the tooling.
- **After the fix: the plan is exact and the deletion is exactly the plan.** The dry run exits 0
  printing `prune-plan: live=0.5.2 keep=0.5.2,0.5.1 prune=4` with `[dry-run] rm` lines for
  `0.3.2, 0.4.0, 0.4.1, 0.5.0` — never `0.5.2`, never `0.5.1`, never a newer dir — and the
  fixture is unchanged. The execution exits 0 with those four dirs gone, `0.5.2` and `0.5.1`
  byte-identical (hash the trees before and after), and `installed_plugins.json` byte-identical.

Unchanged controls, required on BOTH builds — a probe that moves any of them has over-reached:

| Control | Before | After |
|---|---|---|
| Registry missing/unparseable (explicit flag) | exit 0 (flag ignored), dirs intact | **exit 1, dirs intact** (fail closed) |
| Zero stale dirs | exit 0, no output about cache | **exit 0, `prune=0`, nothing to prune** |
| Version newer than live present | kept (nothing deletes anything) | **kept** (pending-update ambiguity resolves to keep) |
| Non-semver entry / stray file in live parent dir | present | **present** (reported `skipped`) |
| Other plugin's cache tree | present | **present, never walked** |
| Default `install.mjs --dry-run` (no prune flag) | phase previews only | phase previews **+ `[dry-run] rm` cache lines**, zero writes |
| `--verify` | no cache mention | **`stale cache dirs: N` informational line**, exit code semantics unchanged |

## What it breaks

The intended break: old cache dirs stop being immortal. Named costs, honestly: (a) **hand-rollback
beyond one release loses its dir** — a user who hand-edits `installed_plugins.json` to point at
`0.4.0` (the bug-shaped rollback `scripts/install.mjs:219-222` warns about, but people do it)
finds it gone after the next install; the retention window keeps exactly one release of rollback,
the dry-run prints the removal list before it happens, and a marketplace Get of the old tag
recreates the dir — recoverable, not free. (b) **`install.mjs` stops being cache-side-effect-free**
— a routine install now deletes; that is the point (GC that fires only when remembered is the
ceremony shape), and the loudness budget is the printed plan plus the `--dry-run` preview.
(c) **Shared-cache multi-home setups**: two `$HOME`s sharing one cache dir each consult only their
own registry, so home A's prune can remove home B's live-but-different version; exotic, named
here and under *Known, not fixed* rather than solved — the correct fix (consulting foreign
registries) is out of scope and probably wrong. (d) Disk archaeology — bisecting behaviour by
diffing old cached copies — now requires re-Getting the tag first. No pipeline behaviour changes:
stale dirs are never executed (hooks resolve via the registered path), so no run, no hook, and no
session can observe the prune except by `du`.

## The class it closes

**Unbounded accumulation of derived state with no GC** — the disk twin of the metrics-corpus
defect prompt 05 closes (`skills/odyssey/scripts/set-phase.mjs:226` appends every run
unconditionally; the cache appends every release unconditionally). Both are shared mutable state
that only grows, invisible to every check that reads the current entry and never the siblings.

How this change could reintroduce the class:

- **Heuristic live-detection.** A future "improvement" relaxes the registry requirement — prune by
  mtime, by dir count, or by matching the repo's `VERSION` (which is wrong during every bump:
  the registry's OLD dir is live while the repo says the new one). That converts a safe prune
  into an occasional live-cache deletion — the catastrophic case. Prevented by: the fail-closed
  fixture family (criterion 3e asserts exit 1 + zero deletion for every unverifiable shape) and
  by the structural rule stated in *Must NOT do*: the registry is the only truth, an
  unverifiable state prunes nothing.
- **Remember-to-run GC.** The prune exists but lives only behind the flag; nobody runs it and the
  accumulation continues. Prevented by: the default-install final step (criterion 3i asserts the
  default flow carries it) and the `--verify` visibility line (criterion 7) — the prompt-02
  lesson, applied.
- **New write paths without collection.** A future release process adds another
  cache-writing path that does not go through a versioned Update. Anything under the versioned
  layout is collected by construction (the prune derives from the registry's parent dir, not from
  a blessed write list); a path outside that layout is a different defect and shows up as
  `skipped` entries in the plan output rather than silent growth.

## Docs to update

Every doc that states the claim this change alters ("the cache accumulates / the installer never
touches the cache"), each checked against the 2026-08-16 tree:

- `docs/DEVELOPMENT.md:49-62` — the "Upgrading the active install" section: the install run now
  prunes stale cache dirs as its final step; preview with `node scripts/install.mjs --dry-run
  --prune-cache`; retention = live + previous.
- `docs/DEVELOPMENT.md:75` — the `scripts/install.mjs` repository-layout row gains "stale
  plugin-cache prune".
- `docs/DEVELOPMENT.md:101` — the flags line gains `--prune-cache`.
- `docs/INSTALL.md:25` — the responsibility split sentence gains the precise carve-out: the
  installer now *deletes non-registered sibling version dirs only*; it still never writes into
  the registered dir, the registry, or the manifest (ownership of writes unchanged — only
  read-derived deletion is added).
- `docs/INSTALL.md:195-204` — the upgrade flow ("two things update") gains the prune as the third
  thing install.mjs does for you.
- `docs/INSTALL.md:226-234` — the `--sync-cache` situations table gains a row: "Stale version
  dirs accumulating under `cache/<mp>/zodyssey/` → `node scripts/install.mjs --prune-cache`";
  the existing sentence "The cache is laid out per version … and `installed_plugins.json` records
  which one is live" gains "and the installer prunes everything older than the rollback window,
  never the live dir".
- `docs/INSTALL.md` flags/usage section (the `--uninstall` entry at `:134` region) — document
  `--prune-cache` with its exit codes and the fail-closed rule.
- `CHANGELOG.md` — shape below.

## CHANGELOG entry shape

Patch release (v0.6.x line): a new read-only-registry maintenance mode plus one final install
step; no interface, contract, or state change reaches any run, hook, or session (stale dirs are
never executed). Not batched with queue items 01/03/04 (one security change per release; this is
not security-class).

- **Added — the installer prunes stale plugin-cache versions.** One entry stating: the mode
  (`--prune-cache`, dry-run with `--dry-run`) and the default-install final step; the retention
  policy (keep the registry-live version + its immediate predecessor; prune strictly older;
  never newer); the fail-closed rule (unverifiable registry → prune nothing, exit 1 on the
  explicit flag); and — in its own sentence — that the live dir's byte-integrity and the
  registry's read-only treatment are asserted by the new suite, not promised. Cite the paired
  probe: today `--prune-cache` is silently ignored (unknown argv runs the default flow, exit 0,
  nothing listed or deleted — indistinguishable from success); after, the dry run prints the
  exact plan and the execution deletes exactly it. This repo cites its probes, not just its
  diffs. Include the measured anchor: 6 dirs / ~65M stale on 2026-08-16, 5 stale + 1 live.
- **Known, not fixed** — name them; the next audit should not have to find them:
  - Versions newer than live are never pruned (pending-update ambiguity is unresolvable from the
    registry; an orphaned newer dir is kept forever until a later release makes it the
    predecessor).
  - Shared-cache multi-home setups: each home prunes by its own registry only (see "What it
    breaks" (c)); consulting foreign registries was deliberately not built.
  - `--verify` reports the stale count but never prunes; the prune fires on install runs or the
    explicit flag.
  - The retention constant (`CACHE_PRUNE_KEEP = 2`) is stated policy, not a derived number — one
    release of rollback; no measurement exists that says the window should be any other size.
- Release mechanics per `docs/DEVELOPMENT.md`: CHANGELOG → tag → `scripts/install.mjs` (which now
  prunes as part of the run), then re-Get/Update the plugin — a fix that stays only in the repo
  fires in no run.

## Capability routing

The fix-run's plan declares exactly one token, and only because it will actually be loaded:

`routed: skill:test-driven-development`

This is a pure code-logic change and the run's whole method is red-green: load the TDD skill via
the Skill tool in the executor thread, demonstrate criterion 5's red against the unmodified
installer first (the suite must fail with the lib and wiring stashed), then make it green. F5
cross-checks the declaration against hook-witnessed loads, so a declaration without a real load
fails the final wave — declare nothing speculative. No `discovered:`/`generic:` (no find-skills
call is planned) and no `mcp:` declarations (none will be loaded). If a fixture/spawn test fails
in a way two fix attempts do not diagnose, loading `systematic-debugging` is correct — declare it
only if it is actually loaded, after the fact, never in anticipation.

## Estimated size

~90-120 lines in `scripts/lib/cache-prune.mjs` (registry resolution reuse, semver compare, plan
computation, containment and skip rules — no I/O deletion); ~40-60 lines in
`scripts/install.mjs` (flag, exclusive mode with exit codes, default-run final step,
`--verify` line, usage block); ~180-220 lines of new test (`scripts/cache-prune.test.mjs`): the
fixture builder, the ten case families, byte-identity hashing, and the spawn integration. Patch
release; it may ride the v0.6 line with other non-security items but never shares a release with
01, 03, or 04.
