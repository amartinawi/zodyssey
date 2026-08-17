# Changelog

All notable changes to ZOdyssey are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

The ISNAD-engine adaptation (queue rows 17-20, `docs/impl/17`–`20`): four non-duplicate capabilities ported from a provenance/trust layer, chosen precisely because ZOdyssey already enforces the rest in stronger form.

### Added — fluency-exclusion invariant (ISNAD R8, row 17)
`judge-rubric.test.mjs`, the sixth doc-claim invariant suite: pins the judge rubric to the five `MEASUREMENT.md` §2 dimensions and their weights, denies style/fluency/verbosity terms inside the rubric segment, and pins the auditor's no-style-rejections clause. Paired probe: an injected `Clarity of prose (0.1)` dimension fails the suite on two assertions.

### Added — verification-origin labeling (ISNAD R4, row 18)
Every run-report and `results.jsonl` record now states whether `success` stands on an external audit (`external-audit`, with `consult_rounds`) or in-session verification only (`in-session-only`); the dashboard's Recent-runs table renders a `verify` column, legacy records render `-`. Labeling only — nothing consumes the field as a gate. `run-report.mjs` gains its first test file.

### Added — narrator trust registry (ISNAD R2, row 19)
`registry-report.mjs`: cross-run agent-config reliability mined from external-audit verdicts (ACCEPT after momus OKAY → momus ✓; compliance gap → momus ✗; bug/quality/security gap → executor ✗) and judged criterion results (executor ✓/✗, zodyssey-arm records only). Keys are `sha256(agents/<name>.md)` content hashes — a prompt edit starts a new key at the cold-start prior (structural decay; trust attaches to the configuration, never the model name). Trust is Laplace `(s+1)/(s+m+2)` and n is ALWAYS printed beside it. Global idempotent ledger under `~/.zcode/orchestration/registry/`; consumed advisory-only by metis at consult. Real-data smoke on landing: momus 0.67 (n=4), executor 0.73 (n=9).

### Fixed — judged records no longer hardcode `arm: "zodyssey"` (row 19, A0 rider)
`lib/arm.mjs` derives the arm from the slug suffix (the authoritative source — `harness.mjs` constructs `${seed.id}-${arm}`), shared by `judge.mjs` and `dashboard.mjs` (private copy removed). Baseline runs no longer land in `judged.jsonl` mislabeled. Queue item 09's residual scope (explicit `--arm` instrument channel + baseline-arm automation) unchanged.

### Added — agent citation discipline (ISNAD R5, row 20)
Executor notepads/summaries must cite the `path:line` or command output that witnessed each factual claim; momus blockers must anchor to plan text. Prompt-layer advisory only — the enforcement twins (notepad append-only, test-integrity guard, record-verify executed criteria) already exist.

### Known, not fixed
- Judge-lane registry evidence predates agent hashing and attributes to the *current* config key (`assumed_current_config` marked on rows/entries).
- The registry is consult-fed and starts sparse by design; consult is opt-in.
- Nothing renders narrator trust in `dashboard.mjs` yet.
- Registry ledger idempotence is bounded by the rolling 1000-row cap: evidence aged out past the cap re-appends on re-scan under the same ids (harmless at current volumes).
- `registry-report.mjs --json` emits a wrapper object (`{scanned_repo, …, entries}`), richer than the briefs' "array" phrasing.

## [0.5.2] — 2026-08-15

An independent paired run against v0.5.1 found **no new bypasses** — the first round in four that didn't. What it did confirm is that the remaining surface is no longer pattern-shaped. Two items here are that surface's narrow, structural end; the rest is documented as the queue it is.

### Fixed — direct execution of a path (G-class)

`./deploy.sh`, `/tmp/evil`, `~/bin/evil`, `src/foo.js` and `exec /tmp/evil` all ran as **read-only, pre-OKAY, in any phase**. This is the same severity as the v0.5.1 CRITICAL and no amount of naming interpreters reaches it — *there is no interpreter token to name*. What identifies these is structural: the command **head** is a path, so the shell executes that file with whatever privileges the agent has.

Matched at command position only. A path as an **argument** — `cat ./deploy.sh`, `ls /tmp/evil`, `grep x src/foo.js` — is untouched, because reading a file is not running it and conflating the two would block most ordinary work.

### Fixed — two sed in-place forms the pattern missed (G-class)

`-i\b` missed a clustered short flag (`sed -ni` — no word boundary before the `i`) and the long option (`sed --in-place`). `-i.bak` and `-e … -i` were already caught. An incomplete pattern, not a new binary.

### Known, not fixed — and why the next move is structural

Three rounds of enumeration produced three bypasses; the fourth produced none only because the enumeration questions are exhausted. What remains does not yield to more patterns:

- **F — shell-level escaping splits the token.** `p\ython -c`, `py''thon -c` reach the interpreter while defeating any regex over the raw string, because the *shell* reassembles the token after the gate has read it. Quoted (`"python"`), env-prefixed (`PATH=/tmp python`), and `env`/`command`-wrapped forms are all caught; the escaping forms are not, and cannot be without parsing shell grammar.
- **G — interpreters outside the list.** `gawk`, `mawk`, `pypy`, `perl6`, `raku`, `jshell`, `ts-node`. Adding them is the fourth enumeration round and buys nothing structural: the list is unbounded by construction.
- **H — accepted over-blocks.** Invoking a safe binary by absolute path (`/usr/bin/git status`) is now gated, because "is this path safe to execute" cannot be answered without an allowlist. Asserted in the test suite so it reads as a decision rather than a surprise.

**The terminus is head-allowlist inversion:** classify by the command head against a list of known-safe *heads*, rather than denying known-bad shapes. It subsumes F, G and H at once — an escaped, unlisted, or absolute-path head simply is not on the allowlist. It is deliberately **not** in this release: it inverts the default for every command the gate has ever seen, `npm test` and friends need enumerating on the allow side, and shipping that days after a security deploy trades one risk for a larger one. It wants its own release and its own paired run.

### Verification

Probed against the **deployed** build, not the repo, for every claim. Gate-surface is 98 cases (was 80), including the argument-vs-head controls, the read-only `sed` controls, and the H-class over-block asserted explicitly.

## [0.5.1] — 2026-08-15

A second independent audit of v0.5.0 found the CRITICAL takeover chain **reopened through a different door**, plus ungated waiver flags that reach `done` more cheaply than forging a verdict ever would. v0.5.0's central claim — "`.zcode/state/` now has no unsanctioned write path" — was false, and the marker system rests on it.

### Fixed — CRITICAL: arbitrary code execution classified as read-only (audit-3 #1)

The v0.5.0 sweep added ten write primitives and declared T1-1 closed. It missed the shape that needs no new primitive at all: the two interpreter patterns were **positional**.

- The eval-flag pattern required the eval flag to be the *first* token after the interpreter, so `python -u -c`, `python3 -B -c`, `node --no-warnings -e` and `ruby -w -e` matched nothing.
- The script-indirection pattern explicitly skipped any invocation whose next token starts with `-`, so those same commands fell through it too — as did `python - <<'EOF'`, where the operand is literally `-`.

Chained with the marker key being readable through ungated `cat`, this restores the full forged-run takeover: compute a valid marker, write arbitrary state.

Enumerating flag shapes is what failed twice. Interpreters are now **inverted to an allowlist**, the same posture SEC-2 took for git: any invocation is gated except a bare version/help query. The sanctioned `node <odyssey-script>` path is unaffected — it never relied on classifying as read-only, and `isTrustedScriptInvoke` allows it one step later.

### Fixed — bare redirection disarmed every hook in one command (audit-3 #3)

The redirect pattern required a *word* before the `>`, so a command consisting only of `> .zcode/state/t.json` matched nothing and ran as read-only. That truncates the state file; discovery then fails to parse it, finds no run, and every hook becomes a no-op. `shred` was also absent. The operator is matched wherever it appears now.

### Fixed — F2/F4 artifacts could be written with no dispatch behind them (audit-3 #2)

`record-final-artifact` checked the nonce as `if (nonceArg && pending && …)`: **omitting** `--nonce` skipped the comparison entirely, and a missing pending nonce only printed a warning. Both now refuse.

**The residual is unchanged and is stated here because the apparatus reads stronger than it is:** the nonce proves a reviewer was *dispatched*, not what the reviewer *said*. It lives in `.zcode/state/`, readable by any agent, so an injected executor can wait for the legitimate dispatch, read the nonce, and submit its own verdict bytes under it. Closing that needs the artifact bound to the reviewer's transcript hash — a harness change, not a script change, and it is not done.

### Fixed — waivers that reached `done` more cheaply than forgery (audit-3 #4, #5, #6)

- **`--skip F2,F4,F5`** produced `all_pass: true` and `final.verdict: "pass"` — exactly what `set-phase done` requires — with no phase check, no evidence, and no confirmation. Skipping a security item now requires `--skip-reason`, is recorded in `state.final.waived`, and `done` refuses until acknowledged with `--accept-waivers`. This is **not** authorization: every script is invocable by any agent, so no argv flag authenticates anyone. What it removes is the *silent* path — two deliberate, separately-recorded actions instead of one flag.
- **`set-phase done` blocked only on `status === "regressed"`**, so `toolchain-drift` — regression-gate *refusing to compare* because `toolchain.json` changed, which is precisely how the gate would be neutered — sailed through. The gate refused at the source and failed open at the consumer. A refusal is not a pass.
- **`record-verify` checked only the COUNT of declared criteria, never the content.** `--criterion true --trust-argv --exit-code 0`, repeated as many times as the plan has criteria, marked every acceptance criterion passed with `executed: false`. Undeclared criteria are still recorded but no longer count toward covering the plan, so a fabricated criterion cannot substitute for a declared one.

### Fixed — the round cap didn't agree with the minter about what "momus" is (audit-3 #7)

`subagent === "momus"` guarded the round cap while the nonce minter used segment matching, so `evil:momus` skipped the cap and the pre-dispatch lint, then minted a review nonce. Bounded — `record-review` enforces the cap independently — but it is the one-path-not-its-twin shape v0.5.0 was written to hunt, left in the file by the release that hunted it.

### Fixed — R1/R2/R3, found verifying this release

An independent paired-probe verification of v0.5.1 found the redirect fix had **regressed its own class**.

- **R1 (regression, deploy-blocking).** The first redirect pattern excluded `&` and a digit before the `>`, on the reasoning that they were fd forms. `2> .zcode/state/t.json`, `&> …`, `1> …`, `2>> …` and `exec 3> …` went **BLOCK (0.5.0) → ALLOW (0.5.1)** — one keystroke from the exact command the fix was written for, with the hole and the fix shipping in the same regex. `FD_DUP` already strips descriptor duplication, so a digit still sitting before a `>` is always a real file redirect. `>&` and `>|` are caught now too; neither build ever caught them. `FD_DUP` is also global — a non-global replace left every occurrence after the first in place.
- **R2 (availability regression).** `\b` treats `.` as a word boundary, so `\bsh\b` matched the *extension* in `deploy.sh`, and `cat deploy.sh` / `wc -l build.sh` / `ls *.sh` started blocking in every phase. Interpreter tokens now require **command position** via lookbehind: a filename is not an invocation, while `sh script`, `; sh evil` and `/usr/bin/python3` all still match.
- **R3 (pre-existing, both builds).** `source`, `.`, `curl -o`, `wget`, `sed 'w file'` and `busybox` all passed as read-only — `curl -o /tmp/x` followed by `source /tmp/x` is a two-command ungated arbitrary-execution chain, pre-OKAY, in any phase. The suggestion was to name these as residuals rather than enumerate them, since the honest fix is command-position-aware classification. R2 added exactly that, so they are closed *using* it rather than deferred.

### Changed — interpreter eval is unavailable through Bash during a run

A consequence worth stating rather than leaving to be discovered. `node -e` and `python -c` are gated in every phase, so inspecting run state with `node -e "require('./.zcode/state/…')"` no longer works. Use `dashboard.mjs` (on the trusted-script allowlist), the `Read` tool, or `cat`/`grep` — reads are never gated.

Executable checks belong in **acceptance criteria**, where `record-verify` executes them *and records the result as evidence*, which a Bash one-liner never did. If you want to run an interpreter to prove something works, that is the signal it should be a criterion. SKILL.md documents this and the e2e fixture's checkpoints were repointed.

### Known, not fixed

Named here rather than left for a third audit to find:

- **Nonces are readable from state** (see #2 above). Needs harness-supplied transcript binding.
- **Segment-tolerant matching applies to the nonce minters and the read-only exemption**, so any third-party agent named `*:oracle` / `*:code-reviewer` / `*:momus` gets those lanes. `capability-name.mjs`'s header claims the nonce chain is exempt from the tolerance it introduces; that claim is false in code. The right fix is an allowlist for minters rather than open segment matching.
- **The Edit-path scope gate is skipped for targets outside `PROJECT_DIR`** (`if (rel)` with `rel` empty), while the Bash twin fails closed.
- **New-file classification falls back to lexical path resolution**, so a symlinked in-scope directory can redirect a Write into `.zcode/state/`.
- **Three state writes still do unlocked read-modify-write** (`regression-gate` writeState, the record-verify stall counter, `scaffold --adopt`); the v0.5.0 fix covered the five `record-*` writers only.
- **Deploy verification never content-compares `plugin.json`** — the file that decides which hooks run — and the cache is never pruned of files deleted from the repo.
- **`scaffold --adopt` blesses whatever is on disk**, with no phase/verdict/provenance check.

### Honest summary

v0.5.1 closes every named finding from both audits. The adversarial residual is unchanged in kind: an executor-adversary with prompt injection reaches a forged `done` through whichever of the ungated paths is fixed last. Each round has raised the cost and narrowed the surface; none has eliminated the class, because the trusted-script allowlist gives every agent the same argv surface the operator has.

## [0.5.0] — 2026-08-15

**A security release.** Two independent investigations landed together: a live e2e run surfaced three defects, and a 4-partition adversarial audit of v0.4.1 filed 52 findings (1 CRITICAL, 4 HIGH, 14 MEDIUM, 14 LOW, 19 INFO). Sweeping for the *classes* behind them found systemic siblings — including a second undiscovered SEC-6 bypass and a fail-open defect in a guard shipped in v0.4.1.

Minor-versioned rather than a patch because run state gains a required authenticity marker (a state-contract change) and the Bash gate tightens materially.

### ⚠️ Upgrade order

Run discovery is now authenticated. A run created before v0.5.0 has no marker and **stops being discovered** until adopted once:

```
node <plugin>/skills/odyssey/scripts/scaffold.mjs <repo> <slug> --adopt
```

Adopt any in-flight runs BEFORE deploying, or finish them first. `--adopt` only stamps a state file that already exists; it cannot bless a dropped one.

### Fixed — CRITICAL: forged-run takeover (T1-1, T1-7)

The audit reproduced an end-to-end takeover. Two independent halves, both fixed:

- **Write primitives classified as read-only.** Ten passed `looksReadOnly` and ran pre-OKAY in any phase: `sort -o`, `touch`, `sponge`, `gsed -i`, `crontab`, `scp`, `sftp`, `sqlite3 <db> <sql>`, `at` and `batch`. (`dd`, `truncate`, `xargs` and `busybox sed -i` are also in the pattern list now, but v0.4.1 already blocked all four — they are belt-and-braces, not closed holes. Each of the ten was confirmed by running the same command against both builds: allowed on 0.4.1, blocked on 0.5.0.)
- **Unauthenticated run discovery.** `findActiveRun` trusted ANY parseable `.json` in a state dir, newest `updated_at` winning — so a dropped `decoy.json` carrying `verdict: OKAY` governed the review gate, the scope gate and the tamper guard at once. Discovery now requires an identity-bound marker, applied in `hooks/lib/find-run.mjs` too, since that copy feeds `selectByTarget` and the other two hooks.

The marker's header states plainly what it does *not* buy: with arbitrary read+write as this user, no in-band marker is unforgeable. It makes a *dropped* file inert; the durable control is that `.zcode/state/` now has no unsanctioned write path.

### Fixed — HIGH: the Bash path never got the Edit path's guards (T1-2..T1-6)

Every protection added to the Edit path over three releases had a `sed -i`/redirect twin that walked straight through. `TEST_PATH_RE` had exactly one use in the whole file, inside the Edit branch.

- Notepad clobbering via Bash now blocks; append and new-notepad creation stay allowed.
- `sed -i` / `awk -i` / `tee` push EVERY operand — previously one, so `sed -i 's/a/b/' out-of-scope.js in-scope.js` passed the scope check on the in-scope file and mutated both.
- The verify/final test freeze applies on the Bash path.
- `isState` was computed at two sites, returned, and never used in a conditional: a plan declaring `.zcode/state/` in `Files:` made verdict, phase and acceptance directly editable. v0.4.1's guard covered MCP tools but not the native Edit path.

  The first attempt at this fix armed `isState` on the Edit path **only** — the same one-path-not-its-twin shape as the rest of this section. `quickClassify`, the Bash-path target classifier, did not even compute `isState`, with a comment asserting that was safe "because the Bash path blocks anything non-bookkeeping that isn't in declared scope". Declaring the path in `Files:` is precisely what puts it *in* scope, so `sed -i 's/OKAY/X/' .zcode/state/t.json` was still allowed. Caught by re-verifying the release against 0.4.1 rather than by the suite.
- Rewriting the plan post-OKAY blocks; the tamper guard previously noticed only on the next gated call, after the command had run.

### Fixed — normalized compared against un-normalized (Class B)

Three guards failed OPEN because one side was realpath'd and the other was not: SEC-6 in `record-momus-artifact` (proven bypassed with a relative repo arg), a byte-identical undiscovered clone in `record-final-artifact`, and **the `.zcode/state`/`.zcode/reviews` guard added in v0.4.1**, which realpath'd neither side. All three route through `lib/repo-path.mjs` now, as do the persisted `plan_path`, the three hooks' `PROJECT_DIR`, and `find-run`'s state-dir discovery.

**Docs moved in the same change, deliberately.** `scripts.md` and `SKILL.md` told the conductor to stage verdicts in `.zcode/plans/` — exactly what SEC-6 refuses. That flow worked only *because* the guard was bypassed, so arming it without repointing the docs at `.zcode/staging/` would have recreated the SEC-6b total review-gate deadlock.

### Fixed — capability names compared four different ways (Class C)

- **F5 skill branch** used exact equality, so `skill:test-driven-development` (what `capabilities.md` lists and every plan declares) never matched an observed `skill:superpowers:test-driven-development`. 34 installed skills are plugin-namespaced; this is the failure the live run hit.
- **F5 discovery branch** hard-coded `skill:find-skills` and discarded the declared value, making it UNSATISFIABLE wherever find-skills is namespaced — with no per-plan workaround.
- **F5 mcp branch** tolerated a tool-name suffix but not a plugin prefix, missing `mcp__plugin_<plugin>_<server>__<tool>`.
- **Nonce minters** used bare equality plus one hard-coded special case, so a namespaced reviewer minted nothing and the wave failed later with no hint that the dispatch name was the cause.
- **The dispatch phase gate**, which runs *before* the minters, was bare-set membership (`READONLY_AGENTS.has(subagent)`) with three hard-coded `feature-dev:` entries — the same shape one function earlier. A third-party-namespaced read-only agent was rejected there as an "executor" and never reached the fixed minter, so fixing the minters alone changed nothing observable. Also found by re-verification.
- **drift-check** truncated `Task: zodyssey:<agent>` at the colon and compared namespaced routes against a bare inventory, reporting every real agent as both stale and orphaned.

Matching is segment-tolerant everywhere now: exact wins, else the final name segment. Declaring the bare or the namespaced form both work.

### Fixed — state integrity and injection (T2-1, T2-2, T2-3)

- Five trusted writers fell back to a **non-atomic, unlocked** `writeFileSync` on lock contention, one commented "rather than lose the verdict" — trading a visible failure for a silent last-writer-wins clobber. All five now refuse, as `record-todo` already did.
- `lint-untrusted` masked EVERY nested bullet, so an injected directive in `  - What to do:` was never flagged while identical text at column 0 was — and the nested form is what reaches dispatch prompts. The exemption now tracks field context, so only acceptance-criteria and QA payloads are exempt.
- `regression-gate` ran `toolchain.json`'s `test_cmd` with `shell:true` on the stated basis that the file is machine-derived — but a plan declaring it in `Files:` makes it executor-writable. The toolchain sha is bound at baseline and `--check` fails closed on drift.

### Added — real token accounting

`lib/tokens.mjs` fills run-report's long-standing `tokens_per_todo` placeholder from ZCode's durable telemetry. The rollout JSONL is ephemeral (deleted at session end), so the durable store is the session DB. Three arithmetic rules are encoded because each silently corrupts a total: `inputTokens` already includes `cacheReadTokens`; `model_usage` and `turn_usage` are the same data at different granularity; `retry_count` is not extra requests. Cost is opt-in — this provider is flat-rate and lists `cost: 0` locally, so a dollar figure would be a shadow price rather than a bill.

### Changed — drift detection covered half the deploy surface (T4-4)

`--verify` and smoke-gate compared 3 code trees while `--sync-cache` deploys 6, so a drifted `agents/momus.md` would run a stale reviewer prompt with both gates green. Prompts are enforcement; they are compared now.

Widening the list was not enough. Running `--verify` during this release showed the widened list was still **flat**, so `skills/odyssey/hooks/lib/find-run.mjs` was deployed but never compared — the file that authenticates run discovery, the CRITICAL fix above. The root cause was never the list's contents but that a list existed at all. `scripts/lib/deploy-surface.mjs` now holds one definition that the deployer copies from and both gates walk recursively — every file under a deployed tree, with nothing left to keep in sync by hand. (The earlier fix widened a hard-coded list from 3 directories to 6; the count is deliberately not restated here, because a number in a release note is the same brittle artifact as a list in the code.)

### Tests

32 suites, up from 26. New: `pre-tool.gate-surface.test.mjs` (23 cases ported from the auditor's probes), `sec6-repo-arg.test.mjs` (10 cases), and `deploy-surface.test.mjs`, which asserts *coverage* rather than a blessed list of filenames — a list would be the same bug in test form. `pipeline-integration` now loads a **namespaced** skill and still reaches `done`, so the live F5 failure is regression-locked end to end.

The suite was structurally blind to both classes: all 62 fixtures passed absolute repo paths, and no F5 fixture used a namespaced name — the one that looked namespaced compared two identical strings and would pass with the stripper deleted.

### Fixed — found by the deep verification of this branch

An independent verification pass re-ran every claim against a v0.4.1 worktree and found five more items. Four are defects; one is a reporting flaw.

- **ORCH-2: F5 still failed on a routing line carrying prose.** Segment-tolerant matching fixed the *namespace* half of the live F5 failure and left the other half standing. `norm()` strips ALL whitespace — the tolerance that lets `skill: x` read as one token — so `routed: skill:x — primary; generic fallback` became `skill:x—primary;genericfallback`, a name matching nothing. A plan written the way people actually write them failed F5 with a message about the skill never being observed. New `capabilityToken()` ends the token at the first character a capability name cannot contain, and the parser and the matcher both call it so lint and gate agree on where the token ends.
- **T3-2: momus following her own prompt deadlocked the review gate.** `momus-prompt.md` documents a `VERDICT: OKAY | REJECT` text block; `record-momus-artifact.mjs` accepted strict JSON only and answered a conforming artifact with exit 6. JSON remains the preferred wire form and is tried first; the prose fallback requires an explicit line-anchored `VERDICT:` token and fails closed when the text says both or neither. The parser is shared with `record-final-wave` via `lib/verdict-schema.mjs` rather than duplicated — two copies of a verdict parser is exactly the drift this release exists to stop.
- **ORCH-1: read-only runs were unfinishable.** `--allow-untouched` waived *some* declared files being untouched but never *all* of them, so a run whose diff is legitimately empty — an audit or review that produces a report and changes no declared file — could not reach `done`. The guard exists to stop a *silent* vacuous pass; an explicit operator waiver is not silent, and is now recorded in the artifact as `empty_diff_waived`.
- **ORCH-3:** `.zcode/reports/` was unignored while `.zcode/audits/` was, so future run reports would accumulate as tracked files. Now ignored, with the v0.4.1 report kept by name as this release's provenance.
- **Token figures are now self-describing.** Attribution is scoped by *(repo × window)* and the output named neither, so two readers summarising "the same run" reached 10.8M and 24.3M and both were right. `collectRunTokens` echoes the repo it matched and reports `shares` with the denominator in the key name. A bare percentage is unfalsifiable without its denominator, and these are estimates by construction — `attribution: "time-window"` was always in the output and should be read as a caveat, not decoration.

### Verification method

Every finding was re-verified by running the **identical scenario against both builds** — a worktree at v0.4.1 and this branch — asserting two things, not one: that 0.4.1 behaves as the finding claims (the defect was real), and that 0.5.0 behaves as the fix claims (the remediation landed). 18 findings, 61 paired assertions.

That second direction is what a normal green suite cannot give you, and it earned its cost immediately: it found **two incomplete fixes in this very release** (T1-5 on the Bash path, and the dispatch phase gate above), and corrected an overstated claim — `dd`, `truncate`, `xargs` and `busybox sed -i` were listed as closed holes when v0.4.1 already blocked all four. Three probes also had to be fixed first, each failing on both builds, which is the harness reporting a bad probe rather than a fixed bug.

## [0.4.1] — 2026-08-14

**Security remediation of the v0.4.0 full audit.** The audit found the core property — a non-forgeable OKAY review verdict — broken two independent ways, the flagship F5 routing gate at risk of being inert in production, several softer gate weaknesses, secret-leak / prompt-injection holes in the measurement loop, and a cluster of documentation drift. This release fixes every finding, each security fix shipping with a regression test that fails on the old code.

### Fixed — the two verdict-forge paths (CRITICAL / HIGH)

- **Newline injection through the trusted-script gate (CRITICAL, `pre-tool.mjs`).** `shellSafeForTrustedInvoke` scanned for `;&|` `` ` `` `$<>()` but never rejected a newline, and the operand regex only read the first line — so `node <trusted-script>\n<second-command>` passed the allowlist and the shell ran the second command ungated (`sed` `verdict:OKAY` into state.json, no momus dispatch needed). The scan now rejects any control character (`< 0x20`) before parsing. New cases in `pre-tool.trusted-invoke.test.mjs` prove newline/CR/tab injections stay blocked while quoted metachars still pass.
- **Plan-sha rebind (HIGH, `record-momus-artifact.mjs` + `record-review.mjs`).** The momus artifact recorded no hash of the plan it approved, and `record-review`'s plan-sha check compared a caller-supplied value to the current disk — both agent-controlled. An agent could get a real OKAY on a minimal plan, swap in a scope-widened plan that still lints, and record OKAY bound to it. The recorder now stamps the sha of the plan momus actually read into the consumed-nonce; `record-review` requires a **triple-bind** (argv === what-momus-read === disk). Regression in `pipeline-integration.test.mjs`.

### Fixed — the F5 routing gate and its blind spots

- **Matcher coverage (HIGH, `.zcode-plugin/plugin.json` + `smoke-gate.mjs`).** The PreToolUse/PostToolUse matchers excluded `Skill` and `mcp__*`, so the hook that records F5's evidence never fired for those tools in a real install — the flagship gate could be inert. Both matchers now include `Skill|mcp__.*` (and `dispatch_agent`); smoke-gate asserts matcher coverage so the blind spot can't return silently.
- **Attempt vs load (M7).** The capability observation moved from PreToolUse (fires on tool *attempt*, even for a nonexistent skill) to PostToolUse (fires after a successful load). Pre-tool now records `attempted`; F5 counts only `observed`.
- **Agent routing verified (M4).** `routed: agent:X` was a declaration-only pass. post-tool now records each completed Task dispatch as an observed `agent:<name>` capability, and F5 requires it. `parse-plan --lint` also rejects a `routed:` value that is not `skill:`/`mcp:`/`agent:`-shaped.
- **Stale observations (M5).** F5 ignored phase, so a capability loaded in prime/triage (before the routing decision existed) could satisfy it. F5 now excludes pre-decision phases.

### Fixed — gate hardening

- **MCP / non-native write path (HIGH → H3, `pre-tool.mjs`).** Any tool that is not natively classified (all `mcp__*` and unknown tools) fell through to `exit(0)`. A local-filesystem MCP could write state.json or a `.zcode/reviews/` artifact and forge a verdict ungated. Such tools are now blocked from targeting `.zcode/state` and `.zcode/reviews`; ordinary MCP reads/writes elsewhere are unaffected.
- **Dispatch run-selection (M8).** A `Task(momus)` carried no file target, so run-selection fell back to the globally most-recent run — in a multi-run workspace the nonce could mint into the wrong run and deadlock the intended one. Dispatch now re-selects the run whose repo root encloses the working directory.
- **File-lock owner (M9).** With `agent_id` absent the owner collapsed to `session_id`, identical across parallel executors, so two editing the same file both saw the lock as self-owned. `parent_tool_use_id` (stable per executor, distinct between them) is now preferred.
- **Partial completion (M6, `record-final-wave.mjs`).** F1 computed `declared_untouched` but never gated on it — declaring `Files:[A,B,C]` and touching only A reached `done`. F1 now fails on untouched declared files, waivable with `--allow-untouched` for context-only entries.

### Fixed — the measurement loop

- **Secret redaction (M1, `lib/redact.mjs`).** The redaction regex anchored `.env` to a filename start, so `prod.env` / `staging.env` / `.envrc` / `aws.credentials` leaked verbatim to the external auditor, and a path with a space defeated the hunk-path capture. Extracted to a shared `lib/redact.mjs` with suffix-matching + space-tolerant capture, unit-tested, and imported by consult, judge, and both recall scripts.
- **judge.mjs hardening (M2 + LOW).** The independent eval scorer ingested the agent-authored diff with no DATA-framing and no secret redaction (an agent could inflate its own score with a planted comment and exfiltrate fixture secrets). It now redacts the diff, fences it as DATA, uses the shared EPIPE-tolerant spawn check (`lib/spawn.mjs`), and fails loudly on a missing `run_start_sha` instead of scoring a blank diff.
- **Recall injection (M3, `recall-corrections.mjs` + `recall-outcomes.mjs`).** Agent-influenced criterion/blocker/observation text was replayed verbatim into a later run's Metis prompt. It is now sanitized (control chars stripped) and fenced as untrusted DATA, distinct from the script's own directive.
- **Consult in-scope diff cap (LOW).** The in-scope diff is capped at 200KB to match the out-of-scope discipline.

### Changed — documentation brought back in sync

A sweep corrected drift the audit surfaced: the plan-checkbox-tick instruction that the tamper guard punishes (removed), the purged pre-v0.3.0 `capabilities.md` path three agents still read, the "bash is ungated" claim in `sisyphus-junior.md` (the gate is live), F5 added to every operator-facing final-wave surface, the momus prose-vs-JSON verdict contract, the "hooks in config.json" / "(unreleased)" labels in README, the stale "no CI / no test runner" claims, the non-executable example run, and previously undocumented env vars/flags (`ZODYSSEY_REGRESSION_TIMEOUT_MS`, `CLAUDE_CLI_2`, `scaffold --reset`, `consult --plan-audit`).

### Verification

Full `node --test` green, plus new regression coverage: newline-injection (trusted-invoke), plan-sha rebind (pipeline-integration), F1 partial-completion + `--allow-untouched` (record-final-wave), F5 agent-verified + stale-phase (final-artifact), malformed-`routed:` lint (parse-plan), MCP write-to-`.zcode/state` block (pre-tool.scope), and secret-redaction suffix/space cases (`lib/redact`). Smoke-gate gains a matcher-coverage assertion; version consistent at 0.4.1 across all four declarers.

## [0.4.0] — 2026-08-14

**Routing becomes a default, gated behavior.** Two probe runs proved the conductor hand-rolls from model knowledge: given an AWS Lambda task it ignored the installed `aws-serverless` skill (Task B), and given a Helm-chart gap it never loaded `find-skills` (Task A). v0.3.4's routing rows were passive reference material — a capable model skips the lookup whenever it can do the task from memory, which is most of the time. This release adds the two things that actually change behavior: a hard default in the conductor prompt, and two gates that make skipping routing unable to reach `done`.

### Added — the routing-default gates

- **F5 (behavioral cross-check, `record-final-wave.mjs`):** the plan's routing declaration is cross-checked against `state.capabilities[]` — the hook-witnessed log of real `Skill` / `mcp__*` invocations that `pre-tool.mjs` has recorded all along (with phase stamps, and previously consumed only by the run-report scorecard). `routed: skill:X` requires an observed `skill:X` entry (spacing-normalized); `routed: mcp:S` requires an `mcp__S`-prefixed entry (records keep full tool names); `discovered:` and `generic:` both require an observed `skill:find-skills` — generic is valid only AFTER discovery was attempted. `routed: agent:X` passes declaration-only with an explicit unverifiable note (Task dispatches are not hook-observed — documented limit). A declared-but-never-loaded routing fails the final wave, so a run that hand-rolled past its own declaration cannot reach `done`. `--skip F5` is the escape hatch.
- **`## Capability routing` plan section (scaffold template + parser):** every scaffolded plan now carries a tri-state declaration — `routed: skill:<name>` / `discovered: find-skills` / `generic: <reason>` — with one evidence line. `parse-plan.mjs` extracts the token into `--all` output (placeholders like `<token>`/`<name>` are rejected as non-tokens; the template's option list lives in a parser-stripped comment so an unfilled scaffold cannot false-match), and `--lint` fails without a real token. Because `record-review.mjs` already gates OKAY on a clean lint, the presence gate needed zero new wiring.

### Changed — the conductor prompt makes routing the default

- **`SKILL.md`** gains the binding rule: *routing is the DEFAULT, generic knowledge is the FALLBACK* — scan `capabilities.md` for a fitting installed capability and USE it; if none fits, load `find-skills` and run the ≥1K/official/~100★ quality gate; only then go generic, and only if discovery returned nothing reputable. The rule names the exact Task A/B failure modes and states the gate mechanics, including that the orchestrator must load skills in the **parent thread** (sub-agents can't — trust anchor) because the parent-thread load is what the hook observes and F5 checks.
- **`metis.md`**: the advisory "name the capability in Pre-Analysis Findings" is replaced by a MANDATORY typed `## Capability routing` field in her output contract (the tri-state + one evidence line), marked as enforced.
- **`prometheus.md`**: transcribes Metis's tri-state into the plan's `## Capability routing` section; the section joins the canonical section order (after TL;DR). Burying routing in Verification-strategy prose is explicitly disallowed — it must be its own typed section so the gate can read it.
- **`momus.md`**: a 5th check in her "ONLY THESE" list — routing section PRESENT with a non-vacuous token, framed as a missing-required-section blocker (same class as a missing QA scenario). Deliberately presence-not-quality: routing quality is F5's job at the final wave, and a quality framing would collide with her blocker-finder/approve-by-default identity.
- **`capabilities.md`**: an "enforced, not advisory" callout above the Quick matrix naming both gates and pointing to the SKILL.md rule.

### Honest limits (known, deliberate)

- **F5 proves the `find-skills` SKILL was loaded, not that the actual `npx skills find` search ran.** Closing that needs `pre-tool.mjs`'s Bash branch to recognize + record discovery commands — the load-bearing hook (the bash-gate-deleted-twice file), so it is a separate release with `pre-tool.bash-gate.test.mjs` + `pre-tool.trusted-invoke.test.mjs` run after (tracked as Phase B).
- **`routed: agent:X` is verified by declaration only** — Task dispatches are not in the observed-capabilities log. The declaration's presence was review-gated; the load itself is not hook-witnessed.
- **Over-gating cost (accepted):** every non-trivial standard/architecture task now requires either a routed skill or a `find-skills` load. Trivial tasks still deflect at Phase 0 (no plan is scaffolded) and are unaffected.
- The cwd-anchoring run-resolution bug surfaced by the first Task B attempt (hooks DFS from process cwd, not the declared repo root — misattributing dispatches to a sibling run) is tracked as a separate `fix(hook)`.

### Verification

Full `node --test` **25/25 suites**: `parse-plan` 28/28 (6 new routing cases: missing section, placeholder rejection, three real tokens, `--all` extraction), `final-artifact-and-acceptance` 30/30 (9 new F5 cases: honored/not-honored, spacing normalization, MCP prefix-match, discovered, generic-without-attempt fails, agent note, absent section, skip), `pipeline-integration` 25/25 — a fixture run **reaching `done` through the new gates**, including the hook recording a real `Skill` load as an observed capability, and `pre-tool.trusted-invoke` 35/0 (fixtures updated: the momus pre-dispatch lint now requires routing, proving the gate fires in the hook itself). `node --check` on all touched `.mjs`; smoke-gate enforcement checks pass.

## [0.3.4] — 2026-08-13

Four changes accumulated on main since v0.3.3 — the first real increment of the measurement→improvement loop that v0.3.3's plumbing was built to support, a routing blind-spot fix, a consult diff-base race fix, and a small run-artifact ignore leak.

### Added — correction-signal capture for consult (`recall-corrections.mjs`)

The measurement loop scored every run (`judge.mjs`, `run-report.mjs`) and fed nothing back — the largest adaptation gap surfaced by the task-observer study. v0.3.4 adds the first read-only increment: a sibling to `recall-outcomes.mjs` that mines correction signals from on-disk run state and surfaces a bounded summary to Metis at consult.

- **`recall-corrections.mjs` (NEW):** scans `<repo>/.zcode/state/*.json` for two correction signals — verify-fail (`state.verify.history[].passed === false`) and Momus-REJECT with blockers (`state.review.history[].verdict === 'REJECT' && blockers.length > 0`) — dedups, and prints top-K=5 (recency-first, REJECT > verify-fail) with a `(showing K of N)` footer and closing `Metis:` directive. Defensive reads throughout (`|| []`, `?.`); exit 0/2/3.
- **Scope discipline:** read-only capture only. No part of this loop modifies live skill/agent files — the periodic-improvement-pass is explicitly EXCLUDED (staging-only, future work). Signal 3 (user mid-run corrections) is not recorded on disk today.
- **Wiring:** `agents/metis.md` and `SKILL.md` (phase-1 consult box) now reference BOTH `recall-outcomes` and `recall-corrections` for premortem grounding — `recall-outcomes` was previously documented-but-unwired; this completes it. `references/scripts.md` gains the signature entry.
- **Trusted-invoke regression:** `pre-tool.mjs` is NOT edited — the trusted-script allowlist is realpath-containment based, so the new sibling is auto-trusted. A new regression case in `pre-tool.trusted-invoke.test.mjs` proves it (35/0).

### Changed — route the find-skills capability + external-skill quality discipline

The conductor's routing table had no row for discovering skills the environment does not yet have — only an installed-only `find ~/.zcode -name SKILL.md` walk — and no quality/reputation gate anywhere. The already-installed `find-skills` skill was invisible to the conductor (`grep -rn find-skills skills/` returned zero hits).

- **`capabilities.md`:** new Quick-matrix row — `Discover a skill not yet installed` → `find-skills` (local) / `npx skills find` (external), reinforcing `find ~/.zcode -name SKILL.md` (installed inventory).
- **`SKILL.md`:** a lean external-skill quality bullet after the routing summary — prefer ≥1K installs and official sources (`vercel-labs`, `anthropics`, `microsoft`); be skeptical below ~100 GitHub stars; apply before recommending or auto-using any external skill. (Already-installed local skills are inventory, not reputation.)

Docs/routing only — no hooks, no `SEC-*` interaction. Went through the full pipeline (consult → plan → gated review → execute → verify → final wave) and an independent external audit (`/orchestrate-consult`): ACCEPT, zero gaps.

### Fixed — run-artifact ignore leak

- **`.zcode/staging/` and `.zcode/toolchain.json` leaked past `.gitignore`.** The granular `.zcode/` ignore list never added these two newer run-artifact paths, so a `git add -A` in a repo where `/orchestrate` had run would have staged final-wave intermediates (the f2/f3/f4 JSON, the PR-body draft, the verify script) and resolved toolchain state. Nothing under `.zcode/` is tracked, so plugging the two entries is safe; the granular one-path-per-artifact style is kept over a blanket ignore for now (#12).

### Fixed — consult diff-base race (`audit_head` freeze)

The diff is gathered into a frozen string at T1, but the external auditor can reason about (or, if its tool surface is less locked than `--allowedTools ""` promises, inspect) live HEAD, which may advance past the run's work during the multi-minute call — round 3 of `correction-signal-capture` hit this: PRs merged mid-audit, making the supplied diff look "stale" next to the repo. The auditor's round-3 advisory flagged the race; this closes it.

- **`consult.mjs` (`runPostDoneConsult`) now freezes the audit tip.** It captures `HEAD` as a concrete SHA (`audit_head`) once at gather time; injects an `AUDIT RANGE` section into the prompt naming the exact frozen range `run_start_sha..audit_head` and instructing the auditor to reason about THAT range, not live HEAD; records `run_start_sha` + `audit_head` on each `consult.history` entry for traceability; and after the audit returns, warns if HEAD moved during the round (the verdict still covers the frozen range — the warning tells a human to re-run after the repo settles, so the race is visible rather than silent).
- Validated end-to-end with a stub auditor against a throwaway smoke slug (recorded `audit_head` on the history round; `AUDIT RANGE` section present in the prompt), plus the existing 67 `consult.test.mjs` assertions and the full suite. `pre-tool.mjs` is untouched.

## [0.3.3] — 2026-08-12

A release-plumbing release. **v0.3.2 was tagged uninstallable** — the version lives in three files read by three different consumers and only two were bumped, so the marketplace kept serving 0.3.1 no matter how many times Update was clicked. v0.3.3 supersedes it; there is no reason to install v0.3.2.

The pattern repeated twice more in the same afternoon, both times as *a check that could not detect the class of failure it exists for* — the theme of this entire release series. The drift detector compared 4 hooks and reported green while 4 scripts were stale. The upgrade chain has three hops and tooling covered only the middle one.

### Fixed — release plumbing and a stale duplicate (post-0.3.2)

- **The drift check covered 4 hooks and missed 51 other files.** `smoke-gate` and `--verify` sha-compared only `hooks/`, so on 2026-08-12 both reported green while `consult.mjs`, `scaffold.mjs` and two test files in the running cache were behind the repo — the commits happened to touch scripts rather than hooks. The scripts are not less load-bearing: `record-todo.mjs` holds the verify transition guard, `record-final-wave.mjs` holds F1–F4, `record-verify.mjs` executes the criteria. A stale script runs old enforcement exactly as silently as a stale hook. Both checks now compare all 55 plugin `.mjs` files, verified by drifting `record-todo.mjs` and watching them go red.
- **`--sync-cache` now reports a stale marketplace source.** The upgrade chain is `repo → marketplaces/<name>/ → cache/<mp>/<plugin>/<version>/`. `--sync-cache` handles the second hop; nothing covered the first, and the marketplace clone is what a GUI Update actually reads. A clone one commit behind kept serving the previous version while the repo looked correct throughout — that is what made v0.3.2 appear uninstallable even after `marketplace.json` was fixed. Refreshing it is the marketplace subsystem's job, so this detects, names the file, and prints the one-line `git -C <path> pull --ff-only`.
- **`marketplace.json` was missed in the v0.3.2 bump.** The version lives in three files read by three different consumers — `marketplace.json` (the marketplace, resolving what to install), `.zcode-plugin/plugin.json` (the loader), `package.json` (npm/CI) — and nothing compared them. The tag was pushed, the release published, CI green, and the plugin was **uninstallable at the new version**: clicking Update kept returning 0.3.1, because the marketplace serves what its own index advertises. `scripts/version-consistency.test.mjs` now runs in CI and fails on any disagreement, a non-semver version, a plugin missing from the marketplace index, or a version with no CHANGELOG entry.
- **A third copy in the upgrade chain.** `repo → marketplaces/<name>/ → cache/<mp>/<plugin>/<version>/`. `--sync-cache` handles the second hop; nothing handled the first, so a stale marketplace clone kept serving the old version even after the repo was correct. Both fixes were needed — either alone still yielded 0.3.1.
- **`--sync-cache` cannot complete a version bump, and now says so.** It copies into the *registered* version's directory; the marketplace owns the versioned dir and the registry. Hand-writing `installed_plugins.json` is not the fix — that was the v0.3.0 bug. It now detects the bump, states what it can and cannot do, and reports that an Update is still required.
- **Removed the write-only `state.plan_sha256`.** `scaffold` stamped it; nothing read it. Every consumer — the hook's plan-tamper guard (two sites) and F1's tamper check — uses `state.review.plan_sha256`, which `record-review` re-binds per verdict. So the top-level copy went stale on any plan edit while sitting beside the authoritative field looking equally official. Shakedown round 4 hit the drift and had to work out which one mattered. Same shape as the version number in three files: it does not fail, it waits for someone to read the wrong one.

## [0.3.2] — 2026-08-12

The release where the enforcement layer started being true.

v0.2.0 through v0.3.1 shipped with the Bash write-gate **deleted** — every other enforcement (review gate, scope isolation, plan-sha guard, file locks) lives on the Edit branch, so an ungated `sed -i` walked past all four. Three external audits reviewed v0.2.0 and none noticed. Restoring it exposed a second problem: the final wave proved a reviewer had been *dispatched* and never read what it *said*, so an artifact reading `{"verdict":"REJECT"}` passed both F2 and F4.

Fixing those uncovered a pattern that runs through the whole release — **a check that cannot detect the class of failure it exists for**. `install.mjs --verify` checked paths, not liveness. `harness.mjs --list` matched a sentinel the seeds had stopped using. A 0-byte verdict file still read as "audited". The regression gate was wired into a code path real runs never take. The trusted-script allowlist was corrupting the evidence it existed to protect.

Most of these were found by **running the pipeline end to end**, three times, and fixing what stopped it. Unit tests assert a gate can say *no*; only a real run shows two correct gates combining into something unusable. Round 1 could not complete at all. Round 2 completed but could not reach `done`. Round 3 completed with no out-of-band escapes.

This release also adds the thing whose absence allowed all of it: **CI**. 23 suites, run on every push, on the Node floor the code claims and on current LTS.

### Changed — three ergonomics fixes from shakedown round 3

None of these are correctness bugs. All three cost real time in a live run, and each has now cost it twice.

- **The plan is linted BEFORE momus is dispatched.** `record-review` gates OKAY on a clean `parse-plan --lint`, but that ran at the *end* of the review: momus approved, `record-review` rejected on criteria the parser could have flagged first, fixing them changed the plan-sha, that invalidated the review, and momus had to be dispatched again. A whole review round spent learning something a parser knew before it started. The hook now blocks the dispatch and lists the specific problems. Fails **open** if the lint cannot run — it is an ergonomic guard, and `record-review` still enforces the real gate.
- **`record-momus-artifact`'s `<round>` is optional.** It is 1-indexed while `state.review.round` counts *completed* rounds from 0. That off-by-one cost rounds 1 and 3 a re-dispatch each. Omit it and the round is computed; pass it and a mismatch names both numbers instead of leaving you to work out which end is off. An index convention that has to be explained is one the tool should compute.
- **The failed-final-wave recovery path is documented.** F1 can fail on something still fixable — usually test-integrity — but test files are read-only in `verify`/`final` and the DAG has no `final → execute` edge. The legal route is `final → verify → execute`, restore, then back. It works; nobody would find it under pressure. Now in `references/scripts.md` along with the note that a failed F1 leaves the F2/F4 nonces unconsumed, so the retry needs no re-dispatch.

### Fixed — the trusted-script allowlist rejected quoted data as shell syntax (round 3)

`isTrustedScriptInvoke` tested the whole command for ``; & | ` $ < > ( )`` and refused on any hit — including metacharacters **inside a quoted argument**, where the shell never acts on them.

Round 3 paid for it: `record-verify.mjs --criterion "node -e 'process.exit(0)'"` was blocked over the parens *inside the criterion*. Only 1 of 4 acceptance criteria could be recorded, and the run reached `done` with `acceptance {pass:false, criteria_run:1, criteria_declared:4}`. **A rule written to protect the evidence chain was degrading it**, and it silently excluded most real-world criteria — anything containing `()`, `$`, or nested quotes.

The scan now follows actual shell quoting: unquoted, every metacharacter is live; inside double quotes only `$` and `` ` `` are live; inside single quotes nothing is; backslash escapes are honoured outside single quotes; an unterminated quote is untrusted. 30 assertions, **19 of them injection attempts** — chaining, backgrounding, pipes, redirects, `$()` and backticks both bare and inside double quotes, subshells, escaped-quote-then-chain, unterminated quotes, non-node commands, scripts outside the scripts dir, and path traversal. Loosening a security rule is only defensible if what it exists to stop is still stopped.

### Fixed — a todo could reach `done` with most of its exam unwritten

The verify guard accepted any todo with ≥1 passing record and no failures. Round 3 finished with 1 of 4 declared criteria verified — the state file recorded `criteria_run: 1, criteria_declared: 4` and the gate simply wasn't reading it.

`record-todo` now requires the recorded criteria to cover what the plan declares, using the same source `record-verify` uses for `acceptance[].pass`, so the two cannot disagree. Re-running one criterion three times does not satisfy three declared criteria. Fails **open** on an unreadable plan, keeping the ≥1-passing floor, rather than blocking every run in a repo whose plan cannot be parsed.

### Changed — `Files:` is now the only source of scope (SEC-M7c)

**BREAKING for plans that widened scope in prose.** The `## Scope` prose harvest is deleted. The declared set comes from `Files:` blocks alone, in both the hook and F1.

Its history is the argument. SEC-M7 narrowed a whole-plan harvest to `## Scope` after a prohibition granted access; SEC-M7b then had to strip `Must NOT` subsections *inside* `## Scope` after the same bug reappeared one level down. Two fixes in two days, same shape — because reading paths out of prose cannot distinguish "edit this" from "do not edit this" from "this is what the style looks like".

Shakedown round 2 showed the third case biting: a plan naming `test/text.test.js` as a **style reference** thereby granted write access to it. And F1 never honoured the harvest at all — it derives `declared` from `Files:` only. So a Scope-granted file passed the gate and then *guaranteed* an F1 failure at the end of the run. The gate authorised precisely what the final wave would reject.

A plan that needs a file in scope declares it in `Files:`, which F1 requires anyway. One source, two consumers, no disagreement. This reverses an assertion added earlier the same day; the test now states the new invariant explicitly, including the style-reference case that motivated it.

### Fixed — F1 no longer fails a run for mess it inherited

F1 measures `git diff --name-only <run_start_sha>` ∪ untracked, so a file left modified or untracked *before* the run started landed in `actual`, was absent from `declared`, and failed F1 as a scope violation the run never committed.

Round 2 could not reach `done` because of this: a stale uncommitted pair from the previous run failed F1, and every sanctioned way to clean it — stash, `git checkout --`, editing the files — was blocked by the scope gate, correctly, since those files were out of scope. Committing does not help either, because F1 diffs against `run_start_sha`. The gate and F1 between them made the run unfinishable through any legitimate path.

`scaffold.mjs` now records `state.dirty_at_start` (excluding `.zcode/`), and F1 subtracts it **from the scope-violation calculation only**. Those files stay in `actual`, so `declared_untouched`, the empty-diff check, and test-integrity keep their current meaning — a deleted test cannot be laundered by marking it dirty-at-start, and a file created *during* the run is still scope creep. What F1 ignored is reported as `inherited_dirty_ignored` rather than silently dropped. Absent on older runs, which keep the previous behaviour.

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
