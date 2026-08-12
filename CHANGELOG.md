# Changelog

All notable changes to ZOdyssey are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added — `record-final-artifact.mjs`, the missing trusted writer (2026-08-12)

`.zcode/reviews/` is deliberately not bookkeeping, so no agent can `Write` there — that is what makes a review artifact unforgeable. The review lane has had a trusted writer since W7-2 (`record-momus-artifact.mjs`); the **final wave never got one**, so `record-final-wave.mjs` demanded F2/F4 artifacts from a directory nothing in the toolchain could write. The shakedown run had to place them out-of-band through an MCP terminal.

- `record-final-artifact.mjs <repo> <slug> <F2|F4> [--nonce N] [--from <file>]` — places the artifact, stamps provenance, and **does not consume the nonce** (that stays with `record-final-wave`, which sha-binds it to the artifact bytes). SEC-6 parity: `--from` is refused under `plans/`/`notepads/`; `.zcode/staging/` and stdin are the intended paths.
- It **rejects an unrecognized verdict at write time**. `record-final-wave` resolves anything ambiguous to `missing` and fails closed, which is correct but arrives after the nonce is spent.

### Fixed — a failed F1 no longer burns the F2/F4 nonces

F2/F4 nonces are one-time, and `consumeFinalNonce` spent them even when F1 had already failed and the call could not reach `pass`. Observed cost in the shakedown: F1 tripped on stray untracked files (an MCP tool's session state inside the repo), which burned both nonces, so fixing that trivial problem required **re-dispatching both reviewers purely to mint replacements**. When F1 has already failed, F2/F4 are now recorded as `not_evaluated` and their nonces are left intact for the retry. Not a weakening: `not_evaluated` is not `passed`, so the call still fails — it just stops setting fire to the evidence chain on its way out.

### Fixed — `acceptance[id].pass` was always false

It was gated on `todos[id].status === 'done'`. That closed a real mid-verify race (pass must not flip true after criterion N while N+1..M are unrun) but used the wrong proxy: the natural call order is verify-then-done, so **every successfully verified todo recorded `pass: false`**. The shakedown saw `verify.history` 4/4 passed, `todos.verified: true`, and `acceptance.pass: false`. A field that is always false is worse than an absent one — a resuming orchestrator reads it as "not accepted" and redoes finished work.

Now derived from completeness instead of status: the plan's declared criteria count for that todo is compared against what actually ran, so `pass` is true only when **every declared criterion ran and passed** — independent of call order, with the race still closed. `criteria_run` / `criteria_declared` are recorded alongside. Falls back to the old status gate when the plan cannot be read, rather than assuming completeness from an unknown denominator.

### Fixed — two failures found by the first end-to-end shakedown run (2026-08-12)

Both survived every unit test in the repo, because both are properties of how the pieces combine rather than of any single piece. Neither is reachable by testing a gate in isolation.

- **SEC-M7b — a prohibition GRANTED access.** `declaredScopeForRun` harvested backtick-quoted paths from the whole `## Scope` section, and a plan-level `### Must NOT have` subsection lives *inside* `## Scope`. So the sentence ``- `src/unrelated.js` MUST NOT be touched by any todo.`` added that file to the declared set. **The scope gate inverted: the more emphatically a plan forbade a file, the more certainly it authorised writing to it.** Caught live — a shakedown probe expecting a scope violation was ALLOWED. SEC-M7 had fixed only the per-todo `Must NOT do` case and missed the plan-level subsection. Prohibition content (`### Must NOT` / `### Out of scope` / `### Never` subsections, and inline must-not lines) is now stripped before the harvest; positive Scope mentions still widen scope, which is asserted explicitly so the fix cannot over-correct into "Scope grants nothing".

- **SEC-6b — phase 3 was deadlocked under a gated Bash.** Reaching `execute` requires `review.verdict === OKAY`, which only `record-review.mjs` sets, which requires an artifact from `record-momus-artifact.mjs`, which takes the verdict via `--from` or stdin. Pre-OKAY every route was closed: SEC-6 refuses `--from` under `plans/` and `notepads/`; the Write gate allowed **only** `plans/` and `notepads/`; and any stdin pipe contains a metacharacter, so it is not a trusted-script invoke and falls through to the write-capable gate, which blocks pre-OKAY. **No gated run could leave phase 3 at all.**

  It hid because the Bash gate was deleted from v0.1.1 through v0.3.1. SEC-6 landed 2026-08-04 while the gate was off, so the two were never armed together until the gate was restored on 2026-08-11 — restoring a dormant guard woke a deadlock that had been latent the whole time. `.zcode/staging/` is now bookkeeping: writable pre-OKAY and accepted as a `--from` source. It is not a security boundary on its own — SEC-6's real value is keeping the verdict out of the dirs the *planner* writes, and the artifact's actual protection is the hook-minted nonce plus the sha binding.

Also recorded from the same run: F1 in `record-final-wave.mjs` derives `declared` from `Files:` only and never harvested `## Scope`, so the hook and F1 disagreed about what was in scope — a file granted by the Scope harvest would pass the hook and then fail F1. Narrowing the harvest brings them closer; making them share one implementation is still open.

### Security — the Bash write-gate was deleted a SECOND time and shipped in v0.2.0

`e57b01b` (PR #1, the v0.2.0 cycle) replaced ~170 lines of Bash gate with `if (isBash) exit(0);`, re-breaking the exact fix `433c037` (v0.1.2) had made two releases earlier and published a post-mortem about. **Three independent external audits ran on v0.2.0 and none of them noticed.**

This matters beyond one file. Every other enforcement — the review gate, scope isolation, the plan-sha tamper guard, the file-lock ledger — lives on the `isEdit` branch. With Bash ungated, `sed -i`, `cat >`, `python -c`, and `git checkout --` walk past all four. The "enforcement delta" that is this project's stated reason to exist was honour-system again, while `README.md` and `install.mjs` continued to advertise it as code-enforced. `ZODYSSEY_UNGATE_BASH` survived in four documentation locations and **zero lines of executable code**, and `install.mjs:450` wrote that false claim into every user's `AGENTS.md` at install time.

- **Restored** the full v0.1.2 gate: read-only passthrough, trusted-script allowlist, OKAY-verdict requirement, SEC-4 plan-sha tamper guard, SEC-H5 per-target scope check, and the `ZODYSSEY_UNGATE_BASH=1` opt-out.
- **Fixed a layout deadlock the restored code would have introduced.** v0.1.2 resolved `SCRIPTS_DIR` from `<PROJECT_DIR>/skills/…` or `~/.zcode/skills/…`. Under v0.3.x's plugin-cache layout neither exists in a user repo, so `isTrustedScriptInvoke` would have failed closed, blocked every `record-review.mjs` call pre-OKAY, and made the OKAY verdict unreachable — the gate deadlocking the pipeline it protects. Now resolved self-relative via `import.meta.url`, correct in every layout.
- **Closed a hostile-repo trust hole that predates the regression.** The `<PROJECT_DIR>/skills/odyssey/scripts` fallback trusted a path inside the repo *being audited*; a hostile repo shipping that directory got its scripts allowlisted past the gate. Both path guesses removed.
- **Added `hooks/pre-tool.bash-gate.test.mjs`** (22 assertions), demonstrated failing 11/22 against the broken hook before being accepted. Audits check the diff in front of them; nothing was re-checking invariants from two releases back. This is that check.

### Added — the final wave now judges content, not ceremony

- **F2/F4 parse the review verdict.** They previously confirmed a path, existence, and a nonce, then set `passed: true` without opening the artifact — one reading `{"verdict":"REJECT","blockers":["completely broken"]}` passed both. The verdict is now read from a JSON `verdict` field or a `VERDICT: APPROVE|REJECT` line. **Ambiguous or absent resolves to `missing` and fails** — an unknown verdict must never close a gate. Prose mentioning the words is not a verdict.
- **F1 checks the converse.** It only ever computed `actual \ declared` (scope creep), so an EMPTY diff passed vacuously — a hole this file's own SEC-H1 comment conceded. A plan that declares files against an empty diff now fails, and `declared_untouched` is recorded as evidence.
- **F1 enforces test integrity.** Deleted test files, net-negative test-file line counts, and newly added `skip`/`only`/`xfail` markers now fail F1. Weakening a test is the cheapest way to turn a failing acceptance criterion green, and a test file listed in the plan's `Files:` was *in scope*, so F1 waved it through while the suite went quietly hollow. No other OSS orchestrator implements this (verified against omo, prime-agent, spec-kit, SWE-agent, Cline/Roo, claude-flow).
- **Notepads are append-only.** `if (bookkeeping) exit(0)` let any agent replace a notepad wholesale in any phase. Notepads are what F1–F4 read: verdicts were nonce-bound and sha-anchored while the evidence behind them stayed writable by the party being judged. `Write` over an existing notepad is now blocked; `Edit` and new-file creation are unaffected.
- **Test files are read-only during `verify`/`final`.** Scoped to those phases deliberately — during `execute`, writing tests is the work (this project mandates TDD). Once criteria are being executed, editing a test moves the goalposts rather than meeting them. Measured exploitation rates for exactly this behaviour: 76% (GPT-5), 46% (Claude Opus 4.1) on ImpossibleBench, where restricting access drops it to near zero and prompting does not help.

### Fixed — claims that had no implementation behind them

- **The verify transition guard now exists.** `record-verify.mjs:9-10` had asserted since it was written that "a todo cannot reach `done` without verify evidence (enforced by record-todo.mjs's transition guard, added alongside this)". It was never written. `record-todo.mjs` now refuses `done` (exit `7`) unless `state.verify.history` carries passing records for that todo, with `--force-done` as an auditable escape that stamps `forced: true`. The guard reads `verify.history` rather than `acceptance[]` because `record-verify` only sets `acceptance[id].pass` once the todo is already `done` — gating on that would deadlock rather than break the circularity.
- **`probe-toolchain.mjs` is wired in.** It had **zero callers** anywhere, yet two consumers depend on the `toolchain.json` it writes: `post-tool.mjs`'s post-edit lint arm and `parse-plan.mjs`'s toolchain-aware criterion lint. Both were shipped, documented, and dead. Now invoked from `scaffold.mjs` at run creation — in code rather than as a SKILL.md instruction, since a conductor prompt is the kind of "enforcement" this project exists to replace.
- **`harness.mjs` stops reporting unrunnable seeds as ready.** Readiness was `!seed.repo.includes("REPLACE_WITH")`, but the seeds carried a different placeholder, so the sentinel never matched: `--list` printed ✓ for every seed while each run died on `cpSync` ENOENT. Readiness is now `existsSync(seed.repo)`, which cannot drift out of sync with reality, and a run where every seed skipped exits non-zero instead of reporting a clean summary having measured nothing.
- **`install.mjs --verify` compares the deployed hook against the repo.** It verified each hook *parses at the cached path* and never asked whether the cached bytes were your bytes — reporting 18/18 green on 2026-08-11 while the deployed `pre-tool.mjs` was a commit behind. That is the v0.3.0 failure mode (the verified artifact is not the running artifact) surviving into v0.3.1's rewritten verify.

### Added — the three gates `MEASUREMENT.md` promised and never had

- **`scripts/regression-gate.mjs` — pass-to-pass.** Snapshots the pre-existing suite as the run enters `execute` (wired into `set-phase.mjs`, the one moment a truthful "before" reading exists), re-runs at `--check`, and blocks `done` if a suite that was green goes red. Nothing in the pipeline had ever run the repo's own tests: F1 checks which *files* changed, verify runs the todo's *own* planner-authored criteria, and neither can see a change that satisfied its criteria while breaking twelve unrelated tests. Deliberately coarse — the enforceable signal is the suite exit code, not parsed test names, because name parsing is runner-specific and brittle in exactly the way `harness.mjs`'s sentinel check was. A suite that was **already red** before the run never fails the gate, and a repo with no test command records `inert`; a gate that punishes inherited breakage or blocks bare repos is one that gets switched off.
- **`scripts/check-imports.mjs` — hallucinated dependencies.** Flags imports that resolve against neither the repo's declared dependencies nor `node_modules` (JS/TS ESM + CJS) or `requirements`/`pyproject` (Python). Offline by construction: "does this resolve *here*" is both stricter than a registry lookup (a real package that isn't a dependency is still a broken import) and never flaky, and a check that needs the network dies in CI. Across 576,000 generated samples, **19.7% of recommended packages do not exist**, and the invented names recur across runs — which is what makes registering them a workable supply-chain attack.
- **Acceptance criteria must be executable (`parse-plan --lint`).** The old test was `!/\b(npm|node|…)\b|[\/.]|[\|>]/.test(c)` — an alternation binding looser than it reads, so **any string containing a `.` or a `/` counted as executable**. `- GET /healthz returns 200 {ok:true}` passed. `- The endpoint returns 200.` passed. Since the planner also authors the criteria and momus explicitly declines to judge them, that regex was the entire quality bar on the pipeline's own exam. Criteria must now *begin* with a recognized command, and — when `toolchain.json` declares one — **at least one criterion per todo must invoke the repo's real test command**, anchoring one point of the exam to something the planner did not author.

### Added — prime-agent's stall detector (the 4th primitive)

- **`record-verify.mjs` refuses to re-run a criterion against an unchanged workspace** (exit `10`). Ported from prime-agent's `captureGitWorktreeSnapshot` (`core/autonomous.ts`) — the one primitive left on the table after v0.2.0's fit study that needs no daemon.

  The loop it breaks: a criterion fails → the executor is dispatched to fix it → it returns having changed nothing that matters → verify re-runs the identical command against an identical workspace → identical failure → repeat to the cap. Failed agentic attempts burn roughly 3.5× the steps of successful ones, and this shape is much of why: the harness could not distinguish "tried again" from "tried again with something different". The stall is counted so the attempt cap still converges, and the run reports what happened instead of spinning invisibly.

  Fingerprint = tracked status + tracked diff + untracked file **contents**. Content matters because `git status --porcelain` lists untracked files by name only, so hashing names alone would call a genuine fix a stall. `.zcode/` is excluded: it holds this run's own state and the verify artifacts the script writes on every invocation, so including it made the fingerprint change by construction — the detector would have passed its first tests and then never fired in a real user repo, which does not gitignore `.zcode/`. Non-git repos stay inert; `--no-stall-check` overrides.

### Added — release gate

- **`scripts/smoke-gate.mjs`** — automates every part of "is enforcement live" that can be automated (registration, manifest hooks, cached-vs-repo sha, orphan sweep, direct-invoke proof that the deployed hook blocks) and scaffolds the one irreducible manual check: a live ZCode session attempting a pre-OKAY edit. `/usr/bin/zcode` is a compiled binary, so `${CLAUDE_PLUGIN_ROOT}` resolution and manifest-hook honouring are **not statically decidable by any auditor** — only a live session settles it.
- **`docs/ROADMAP.md`** — the evidence-ranked plan these changes come from, including which claims were verified first-hand and which are relayed.

### Note on the pattern

Five findings in this release share one shape: **a check that cannot detect the class of failure it exists for.** `--verify` checked paths, not liveness. Three audits checked diffs, not standing invariants. `harness.mjs --list` checked a sentinel that never matched. `v0.3.0-verdict.json` was 0 bytes and still read as "audited". F2/F4 checked that a reviewer was summoned, not what it said. Each new check above was demonstrated failing against the broken code before being accepted.

## [0.3.1] — 2026-08-11

### Fixed — enforcement was dead: orphaned hooks after the marketplace install (the v0.3.0 regression)

The v0.3.0 installer wrote the 4 enforcement hooks into `~/.zcode/cli/config.json` pointing at `cache/local/zodyssey/0.3.0/…`. Installing via the ZCode marketplace (the supported path) cached the plugin at `cache/<marketplace>/zodyssey/0.3.0/` instead — so every hook spawn resolved a now-empty path and failed silently. The plugin itself loaded (skill/agents/commands resolved), but the enforcement gate — the entire point of the project — was offline. `install.mjs --verify` missed it because it checked files/paths/registration but not whether ZCode's loader actually accepted the hand-written `installed_plugins.json` entry.

### Changed — hooks are now manifest-declared (never orphan again)

The 4 hooks moved **out of `config.json` and into `.zcode-plugin/plugin.json`** under a `hooks` field, using `${CLAUDE_PLUGIN_ROOT}/skills/odyssey/hooks/<name>.mjs` for the script paths. ZCode resolves the template var to wherever the plugin is cached, so the hooks track the cache location automatically — the path can never go stale. Plugin hooks also **auto-enable the hook runner**, so no `config.json` surgery is required at all. The matchers, events (`PreToolUse`/`PostToolUse`/`Stop`/`UserPromptSubmit`), timeouts, and the gate logic (`pre-tool.mjs` — untouched) are identical to v0.3.0.

### Changed — `install.mjs` no longer fights ZCode's registries

The installer stopped hand-writing `installed_plugins.json` (the v0.3.0 bug source: `marketplace:"local"` wasn't in `known_marketplaces.json` so the loader skipped the entry) and stopped writing hooks into `config.json`. New responsibilities:

- **Marketplace bootstrap** — verifies `marketplace.json` exists, reports whether the plugin is installed, and prints the exact GUI steps if not. Never hand-writes the registry.
- **Purge** — pre-v0.3.0 top-level pollution (unchanged).
- **Migrate v0.3.0 orphaned hooks** — sweeps every ZOdyssey hook ref out of `config.json` (they're manifest-driven now; any copy is pollution that would keep firing-and-failing). Idempotent; config.json backed up first.
- **MCP registration** — the 5 pipeline MCPs still go into `config.json`'s `mcp.servers` (gated on each backend being on PATH). MCPs deliberately stay out of the manifest's `mcpServers` field because plugin-manifest MCPs are namespaced `plugin:zodyssey:<server>`, which would rename every tool the conductor references by its bare name.
- **AGENTS.md / eval / superpowers** — unchanged.

The `--phase copy|purge|hooks` sub-phase flags are removed (the installer is now a single idempotent shot). `--verify` now resolves the install path dynamically from `installed_plugins.json` (instead of assuming `cache/local/…`), checks the manifest declares the 4 hooks + each hook script parses at the cached path, and confirms no orphaned hooks remain in `config.json`.

### Upgrade path

`git pull && node scripts/install.mjs` (re-purges + migrates the v0.3.0 hook orphans + refreshes MCPs), then **Settings → Plugin Management → Discover → Update** on zodyssey to refresh the cached plugin copy (so the new manifest with hooks takes effect). Start a new ZCode session.

### Not in this release

No pipeline-semantic changes — only how the gate is *registered* changed. The single-seam namespaced-dispatch matcher (`pre-tool.mjs`) is untouched (no security audit needed). The 8-phase state machine, hook event types, matchers, and exit codes are identical to v0.3.0.

## [0.3.0] — 2026-08-11

### BREAKING — ZOdyssey is now a proper ZCode plugin (`zodyssey:` namespaced)

ZOdyssey no longer pollutes `~/.zcode/skills/`, `~/.zcode/agents/`, or `~/.zcode/commands/` with top-level copies. It installs as a local plugin under the ZCode plugin cache, and every component is namespaced `zodyssey:` (derived from `.zcode-plugin/plugin.json:name`):

- Skill `odyssey` → dispatchable as **`zodyssey:odyssey`** (also still loadable bare, mirroring `superpowers:brainstorming`).
- The 8 repo agents → dispatchable as **`zodyssey:metis`**, **`zodyssey:prometheus`**, **`zodyssey:momus`**, **`zodyssey:sisyphus-junior`**, **`zodyssey:explore`**, **`zodyssey:librarian`**, **`zodyssey:oracle`**, **`zodyssey:multimodal-looker`**.
- The `/orchestrate` and `/orchestrate-consult` commands now declare `skills: zodyssey:odyssey` in their frontmatter.

Component `name:` frontmatter stays **bare** (the namespace is derived from `plugin.json:name`, not the file's `name:` field) — only the *dispatch* references changed. External references (`prompt-master`, `premortem`, `superpowers:*`, `feature-dev:code-reviewer`, `code-architect`, `code-explorer`) are untouched.

### Migration — finish active runs before upgrading

**Finish any active orchestration runs before upgrading.** Existing `<repo>/.zcode/state/<slug>.json` files that record bare agent names in their dispatch history are **NOT auto-migrated** (decision: document, don't migrate — option C). All known prior runs are terminal, so this is a documentation concern, not a data-loss one. The v0.3.0 installer's purge phase removes the pre-0.3.0 top-level copies (`~/.zcode/skills/odyssey/`, the stale `~/.zcode/skills/odyssey.bak.1786309084/`, the 8 `~/.zcode/agents/*.md`, and `~/.zcode/commands/orchestrate*.md`) — back up `~/.zcode/` first if you want a rollback path.

### Changed — `install.mjs` rewritten as three idempotent phases

The installer is restructured into three explicit, independently re-runnable phases, each safe to run alone:

1. **Copy + register:** `cpSync` the repo tree (`skills/`, `agents/`, `commands/`, `.zcode-plugin/`, `scripts/`, `docs/`, `README.md`, `CHANGELOG.md`, `LICENSE`) into `~/.zcode/cli/plugins/cache/local/zodyssey/0.3.0/`, then upsert a `zodyssey@local` entry in `~/.zcode/cli/plugins/installed_plugins.json` (shaped like the existing `superpowers@claude-plugins-official` entry: `{id, name, marketplace:"local", version, installPath, installedAt, updatedAt, scope:"user", source:"local"}`; idempotent — updates `updatedAt` + `installPath` if the entry exists, else appends).
2. **Purge pre-0.3.0 pollution:** remove the old top-level copies listed under Migration above. Each `rmSync` is guarded by `existsSync` and scoped to ZOdyssey-owned names only; absent entries are skipped silently.
3. **Rewrite `config.json` hooks:** point each hook's `script:` at the new cache path (`<cache>/skills/odyssey/hooks/<name>.mjs`). MCP registration, the `AGENTS.md` block merge, eval-dir init, and superpowers detection are preserved. `--verify` checks the cache paths + the `installed_plugins.json` entry + that no top-level `~/.zcode/skills/odyssey/` remains; `--uninstall` removes the cache dir + the registration + the config hooks.

Every path is derived from `os.homedir()` — **no hardcoded `/home/...` or literal `~`** anywhere in the installer. Portable to any machine (proven by a fresh-`HOME=` clone test that seeds pre-0.3.0 pollution, runs the installer, and asserts the cache tree is grep-clean).

### Fixed — hooks + scripts resolve their own paths via `import.meta.url`

Pre-0.3.0, `consult.mjs` and several sibling scripts joined `env.HOME` with `.zcode/skills/odyssey/...` to locate the auditor prompt and sibling scripts — correct only when the skill lived at the top-level install path, broken once it moved into the plugin cache. These now resolve relative to the script's own location via ESM `import.meta.url` (e.g. `new URL("../references/auditor-prompt.md", import.meta.url)`), so they work from any install path. The `ZCAP_CAPS_MD` env override in `resolve-capabilities.mjs` is preserved (tests rely on it); only the default fallback changed. `hooks/*.mjs` were already portable (env-driven project dir + relative ESM for the sibling `find-run.mjs` + state-dir-relative repo root) — confirmed unchanged by the cache move.

### Fixed — single-seam namespaced-dispatch matching in `pre-tool.mjs`

The review-gate nonce chain depends on `pre-tool.mjs` recognizing the dispatched sub-agent by name. After namespacing, a `Task(subagent_type="zodyssey:momus")` dispatch would have silently failed the bare `=== "momus"` comparison → nonce never minted → review verdict unrecordable → full run deadlock. Fixed at a single seam: the matcher normalizes `subagent` at extraction by stripping a leading `zodyssey:` prefix (scoped — it does **not** strip `feature-dev:`, which is external), so every existing bare-string comparator (`=== "momus"`, `=== "oracle"`, the `READONLY_AGENTS` / `PLANNER_AGENTS` `Set`s) keeps working unchanged. `code-reviewer` / `feature-dev:code-reviewer` handling is untouched.

### Not in this release

No pipeline-semantic changes — names and install paths only; the 8-phase state machine, hook event types, matchers, and exit codes are identical. No new dependencies (still zero npm deps). No auto-migration of in-flight runs (documented above).

## [0.2.0] — 2026-08-11

### Added — prime-agent adaptation (3 of 9 primitives borrowed)

Studied [PrimeIntellect-ai/prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) and adapted the borrowable ideas. Decision: **adapt-ideas** (NOT adopt-as-is) — 6 of 9 primitives require a long-lived daemon ZOdyssey doesn't have; only 3 fit the synchronous single-session model.

- **`scripts/compact.mjs`** — OPTIONAL pre-final-wave notepad compactor (borrows prime-agent primitive #8). Deterministic, $0, additive: concatenates each notepad (truncated ~40 lines, `## <name>` headers) into a single `_compact-brief.md` the F1–F4 sub-agents consume instead of the full doc set. Never modifies source notepads.
- **SEC-1s bounded-recursion guard** (`hooks/pre-tool.mjs`) — new ADDITIVE dispatch-gate enforcement branch, a sibling to SEC-1 (the review-nonce gate). Blocks a `Task()` dispatch whose prompt/message payload embeds a serialized nested tool invocation — both the generic `{\"tool_name\":\"Task\",...}` shape AND the Claude/ZCode-native `{\"type\":\"tool_use\",\"name\":\"Task\"}` shape. Defense-in-depth behind the harness tool-grant boundary (sub-agents aren't granted the Task tool at all); catches prompt-injection attempts that try to coerce a downstream agent into emitting a forged tool call.
- **`state.acceptance` + `state.notepad_pointers`** — new OPTIONAL resume-format fields (SEC-7 candidate, format-only — no daemon). `acceptance[id] = {pass, at, evidence}` per verified todo; `notepad_pointers[id] = path` for inherited context. Backward-compatible (older state loads fine; consumers use `|| {}`).
- **`status.mjs` consumer** — surfaces the new fields in `--json` (`acceptance`, `notepad_pointers`, `verified_count`) and human mode (gated `verified: N passed · M notepad(s) linked` line, only when fields have content — byte-identical backward compat).
- **`ZODYSSEY_RECURSION_CAP`** env var (default 1; reserved for a future real depth counter — today the SEC-1s guard is a payload-pattern match).
- **sisyphus-junior admission-only-handle return contract** + process-isolation trust model docs — formalizes the existing fan-out/fan-in shape as `{status, files-changed, acceptance-evidence, notepad-path}` (the trust-equivalent of prime-agent's `rlm(...)` admission handle) and documents verbatim that the sub-agent process boundary is lifecycle containment, NOT a security sandbox.

### Changed
- `SKILL.md` — phase-6 documents the optional compaction step; context-economy section names `.zcode/notepads/<slug>/<id>.md` as load-bearing working memory; resume section consumes the new fields (skip `acceptance[id].pass === true` todos, read `notepad_pointers[id]` for context, run `status.mjs` to orient).
- `record-verify.mjs` — populates the new state fields on every verify.
- `references/scripts.md` — documents `compact.mjs` + the new state fields + `status.mjs`'s `--json` output + the full `record-verify` flag set.

### Fixed (audit-driven — 3 independent external audits)
- **record-verify.mjs mid-verify race** — `acceptance[todoId].pass` now gated on `todos[todoId].status === 'done'` (previously flipped true after criterion N while N+1..M were still unrun; a resuming orchestrator could prematurely skip the todo).
- **sisyphus-junior.md capability-routing contradiction** — rewrote the pre-existing "delegate to further sisyphus-junior dispatches" line (sub-agents cannot dispatch; they request through the orchestrator).
- **pre-tool.mjs ledger leak** — moved the SEC-1s recursion guard BEFORE the parallel-cap ledger push so a blocked dispatch never consumes an in-flight slot until TTL.
- **pre-tool.mjs SEC-1s regex** — extended to also catch the Claude/ZCode-native `name:`-shape (the previously-documented false-negative is now CLOSED); block message reframed to honestly say "payload-pattern match" rather than "recursion depth bound".

### Security posture
- **No existing SEC-1..6 member weakened.** The SEC-1s guard is additive, a sibling to SEC-1.
- **Three independent external audits** (Claude Opus 5, manual `claude -p` payload): round 1 ACCEPT with 6 advisories → fixed → round 2 REJECT (scripts.md signature stale) → fixed (PR #2) → round 3 ACCEPT clean.
- **Honest residual limit:** the SEC-1s regex matches literal JSON spellings — escaped (backslash-quoted) or single-quote variants still slip past. Accepted as defense-in-depth; the primary control remains the harness tool-grant boundary.

### Not in this release (parked — require a daemon runtime layer)
5 prime-agent primitives need a long-lived supervisor process ZOdyssey doesn't have. Deferred until/unless SEC-7 is authorized as a real enforcement member with a daemon runtime:
- daemon-backed session survival, persistent goals, the three heartbeat surfaces, agent-to-agent messaging, autonomous mode.

## [0.1.3] — 2026-08-10

Installer now covers all pipeline dependencies, not just hooks.

### Added
- **Installer registers the 5 pipeline MCPs** in `~/.zcode/cli/config.json`'s `mcp.servers`: `memory`, `sequential-thinking`, `codegraph`, `chrome-devtools`, `zai-mcp-server`. Each is gated on its backend being on PATH — if the binary isn't installed, the MCP is skipped with a hint instead of writing a dead config entry that would error on every session. The 4 npx-backed MCPs auto-install on first spawn; `codegraph` and `zai-mcp-server` print install pointers if missing.
- **`--verify` mode**: `node scripts/install.mjs --verify` health-checks the install — Node version, each hook script exists + parses + is registered, each pipeline MCP is registered AND its backend is resolvable, core skills + agents present, superpowers plugin detected. Exits `0` on pass, `1` on any failure (CI-usable). Tells you exactly what's missing and how to fix it.
- **Superpowers detection**: the installer detects whether the [`superpowers`](https://github.com/obra/superpowers) plugin (source of most routed skills — `tdd`, `systematic-debugging`, `writing-plans`, `brainstorming`, `premortem`, etc.) is installed, and prints a pointer if not. ZOdyssey works without it (the 3 shipped capsules cover the load-bearing cases); the conductor just can't reach the full routed set until you install it. The installer does NOT auto-install a third-party plugin — that's the user's call.
- **`--uninstall` now removes the MCPs too** (was: hooks + files only).

### Changed
- **INSTALL.md** rewritten with a 6-step "what the installer does" section, a `--verify` section, and a collapsible manual-checks appendix.
- **README Prerequisites** Path B step 4 now shows the `--verify` invocation and mentions MCP registration.

## [0.1.2] — 2026-08-10

Public-default security fix. Restores the Bash write-gate that v0.1.1's verbatim mirror had deleted, so the public repo ships with the "secure by default" posture the README advertises.

### Fixed
- **Bash write-gate restored in the public copy.** v0.1.1 mirrored the installed hook verbatim, which had `if (isBash) exit(0);` — the gate deleted outright (the original author's personal `ZODYSSEY_UNGATE_BASH=1` setup, accepted locally 2026-08-08). That made the public README's "Secure by default; `ZODYSSEY_UNGATE_BASH=1` disables" claim false: v0.1.1 shipped an insecure default to other users. The full v0.1.0 Bash-gate logic is now back in `hooks/pre-tool.mjs` (escape hatch + `isTrustedScriptInvoke` allowlist + OKAY-verdict gate + plan-sha tamper guard + per-target scope check). Users who want the ungated behavior set `ZODYSSEY_UNGATE_BASH=1` in their environment — identical runtime effect, honest default for everyone else.

  > **This fix did not hold.** `e57b01b` (PR #1, the v0.2.0 cycle) deleted the gate again — the same ~170 lines, the same `if (isBash) exit(0);` — so releases v0.2.0 through v0.3.1 shipped without it, and the entry above described a state that had not been true since. Restored again in [Unreleased], this time with `hooks/pre-tool.bash-gate.test.mjs` behind it so a third deletion fails CI rather than a release. Read this entry as history, not as a description of any released version between v0.1.2 and v0.3.1.

### Changed
- **DESIGN §12 item 7** (trivial-gate): marked `done` (was `partial`). v0.1.1's `UserPromptSubmit` hook code-enforces it; the manifest and §12 prose now reflect that. The enforcement-hooks manifest row also lists the 4th hook.

### Note
This fix addresses a public-release integrity problem introduced in v0.1.1. The enhancement work itself (v0.1.1) is unchanged. No behavior change for users who never set `ZODYSSEY_UNGATE_BASH`; users who relied on v0.1.1's ungated default must now set the env var explicitly.

## [0.1.1] — 2026-08-10

Pipeline accuracy + enforcement hardening. Validated a ~30-proposal enhancement backlog against the live codebase, shipped 20 todos across 5 blast-radius-ordered waves. All 42 `.mjs` files syntax-clean, 12 test suites pass, the run's own plan passes the new extended lint.

### Added
- **Toolchain probe** (`scripts/probe-toolchain.mjs`): detects test runner / package manager / lint command → writes `.zcode/toolchain.json`. Foundation for the toolchain-aware lint, post-edit diagnostics, and coverage delta. Handles bare repos (no `package.json`).
- **Structured verdict schema** (`scripts/lib/verdict-schema.mjs`): centralizes the three verdict lanes (review `OKAY/REJECT`, consult `ACCEPT/REJECT`, final `pass/fail`) + the duplicated review default `{round,max_rounds,verdict,history}` that was drift-prone across `scaffold.mjs` + `record-review.mjs`. Fail-closed `normalizeConsultVerdict` preserves the `.includes("ACCEPT")` false-positive fix.
- **Capabilities autogen + drift check** (`scripts/resolve-capabilities.mjs --drift-check`): generates `~/.zcode/capabilities.lock.json` from the live inventory and flags routes that name missing/extra capabilities. The routing table's "intelligence" is now self-maintaining.
- **Pre-execution plan audit** (`scripts/consult.mjs --plan-audit`): the independent external-CLI verifier, previously post-done only, now runs pre-execution at the cheapest fix point. Opt-in, for architecture intent.
- **Multi-auditor consult** (`scripts/consult.mjs --multi-auditor`): ports `judge.mjs`'s double-judge + `>0.15` disagreement flag to the consult lane; disagreements surface to a human instead of auto-looping and are recorded to memory for recall.
- **Trivial-gate `UserPromptSubmit` hook** (`hooks/user-prompt-submit.mjs`): warning-only heuristic that deflects one-line fixes away from the full pipeline. Closes the v0.1.0 "Known limitation" that the trivial gate was prompt-only. Override with "force orchestrate".
- **Post-edit diagnostics arm** (`hooks/post-tool.mjs`): when an executor edits a file in execute/verify/final phases, auto-runs the `lint_cmd` (from `toolchain.json`) scoped to the edited file and injects failures back. Turns verify into the second line of defense. Uses `spawnSync(argv, {shell:false})` — no shell-injection surface.
- **Review-round residual cap** (`hooks/pre-tool.mjs`): blocks a new momus dispatch when `state.review.round >= max_rounds`, closing the REJECT→replan residual (the OKAY path was already capped in `record-review.mjs`).
- **Untrusted-content lint** (`scripts/lint-untrusted.mjs`): scans plan text for prompt-injection patterns (`ignore previous instructions`, `system:` directive prefix, `<function=` tool-call bait, prose `rm -rf`) and exits 6. Wired into `parse-plan --lint` so a plan carrying payloads cannot pass the review gate. Spares backticked acceptance-criteria commands (legit).
- **Flake detection** (`scripts/record-verify.mjs --flake-check`): runs each acceptance command twice; disagreement marks the criterion `flaky` (distinct state, exit 7 — not passed, not failed, surfaced to human). Opt-in.
- **Coverage delta** (`scripts/coverage-delta.mjs`): reads `toolchain.json` to know your coverage tool, parses the coverage report for changed files, reports the delta as verify-phase evidence. Graceful no-op in bare repos.
- **Skill capsules** (`scripts/build-capsules.mjs`): compiles `tdd`, `debugging`, `executing-plans` into deterministic ≤200-word capsules for sub-agent dispatch context (sub-agents can't load skills). Loud-fail if any capsule exceeds 200 words.
- **Codegraph impact-derived Files** (`scripts/codegraph-impact.mjs`): shells `codegraph explore` for given symbols, emits the impacted file set so planners can derive declared `Files:` from real impact. Graceful no-op when no `.codegraph/`.
- **F3 executable UI wiring** (`references/f3-ui-verify.md`): documents the chrome-devtools + zai-mcp-server sequence for executable UI verification, feeding `record-final-wave.mjs --f3-checklist`.
- **Adversarial review panel** (`references/momus-prompt.md` + `agents/oracle.md`): momus now reviews through three lens-diverse refutations (correctness, scope, verification-rigor), oracle takes a distinct design-level lens. Majority rules.
- **Eval dashboard** (`scripts/dashboard.mjs`): renders `results.jsonl` + `judged.jsonl` into a markdown scorecard (per-seed win-rate, mean overall judge score, score-over-time).
- **Memory schema bridge** (`scripts/lib/memory-schema.mjs`): couples the MCP graph store and the per-repo `outcomes.jsonl` store with `validateOutcome` / `validateGraphEntity` / `outcomeToGraphEntity`. `recall-outcomes.mjs` now validates + skips malformed lines instead of crashing.

### Fixed
- **`hooks/stop.mjs` undefined `STATE_DIR`**: line 36 referenced an undeclared identifier, throwing `ReferenceError` on every Stop hook before the checkpoint logic ran. Resume checkpointing was silently broken on all prior runs. Removed the redundant guard (the `findActiveRuns` null-check already handles the no-active-run case).
- **PostToolUse matcher dead-code** (caught by F2 post-verify): v0.1.0's `"Task|Agent"` matcher meant the new post-edit diagnostics arm never fired for Edit/Write/MultiEdit. Installer + existing configs widened to `"Task|Agent|Edit|Write|MultiEdit"`.

### Changed
- **Installer registers 4 hooks** (was 3): adds `UserPromptSubmit`; widens `PostToolUse` matcher to include the edit tools.
- **`parse-plan --lint` extended** (additive): adds toolchain-aware acceptance-criteria checks + the untrusted-content injection scan on top of the existing shell-token / slop / empty-Files / path-grammar checks.

### Not in this release (deferred)
- Worktree isolation, seed growth 18→50 + omo cross-eval, real model routing — see the run report for the per-item rationale.

## [0.1.0] — 2026-08-09

First public release. Extracted from a personal ZCode orchestration setup that has been iterated on through ~20 security/operational audit rounds (see `docs/` for the design and measurement docs).

### Added
- **The enforcement gate** (`skills/odyssey/hooks/pre-tool.mjs`): the review gate, scope-isolation boundary (fail-closed), file-lock ledger, parallel-cap counter, and secure-by-default Bash write-gate. This is the core delta over prompt-convention orchestrators.
- **The 8-phase pipeline conductor** (`skills/odyssey/SKILL.md`): prime → triage → consult → plan → review → execute → verify → final-wave.
- **The cast of 8 sub-agents** (`agents/`): `metis` (consult), `prometheus` (plan), `momus` (review), `sisyphus-junior` (execute), plus read-only `explore`, `librarian`, `oracle`, `multimodal-looker`.
- **Slash commands** (`commands/`): `/orchestrate` (run + resume + status), `/orchestrate-consult` (external audit).
- **Evidence-chain scripts** (`scripts/`): `record-review`, `record-momus-artifact`, `record-todo`, `record-verify`, `record-final-wave`, `record-capability` — nonce + plan-sha binding so OKAY/F2/F4 verdicts are non-forgeable.
- **Eval harness** (`scripts/harness.mjs` + `judge.mjs` + `seed.jsonl`): LLM-as-judge scoring of completed runs.
- **External consult gate** (`scripts/consult.mjs`): hands plan + diff to an independent Claude CLI for ACCEPT/REJECT, with auto-remediation loop.
- **Installer** (`scripts/install.mjs`): copy + register hooks + merge AGENTS.md, idempotent, zero npm dependencies.
- **Docs**: `DESIGN.md` (full design), `ADAPT.md` (porting to omo / other harnesses), `INSTALL.md` (config + troubleshooting), plus `ECOSYSTEM_GRAPH.md`, `MEASUREMENT.md`, `RESUME.md`, `deep-audit-prompt.md`.

### Security posture
- Bash gate ships **secure by default** (write-capable Bash gated like Edit). `ZODYSSEY_UNGATE_BASH=1` restores the original author's ungated personal setup for users who want minimum friction and accept the tradeoff.
- Scope boundary **fails closed** on unreadable or empty plans.
- Review verdict + final-wave evidence is **non-forgeable** against executor agents (nonce + sha + recorder-only writes). The documented residual limit is the orchestrator adversary (a malicious orchestrator-level prompt), which is out of scope for v1.

### Known limitations
- **Single harness.** The reference implementation targets ZCode. The pattern is portable (see `docs/ADAPT.md`).
- **Single-executor per todo.** Parallel multi-executor team mode (mailbox + worktrees) is designed but deferred to v2.
- **Single connected model.** Model routing is designed in (`category` field) but reduces to effort/variant selection until a second provider is wired.
- **Trivial-gate is prompt-guided, not hook-enforced.** The triage step that deflects one-line fixes away from the full pipeline is in the conductor prompt; a future `UserPromptSubmit` hook will make it code-enforced.

### Provenance
Pipeline shape and agent cast modeled on [omo](https://github.com/code-yeongyu/oh-my-openagent). Enforcement layer (the 4-5 hooks) is the differentiator. Research grounding in `docs/DESIGN.md §0 + §15`.
