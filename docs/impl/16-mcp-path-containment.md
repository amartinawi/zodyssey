# 16 — Close the last door to the gate: MCP path containment

Build order **16** · depends-on **01** (shipped, `4bc9dff`) · queue row:
[`docs/impl/00-INDEX.md`](00-INDEX.md) `16 mcp-path-containment` · security-class · patch ·
shipped alone.

This file is a complete, standalone brief. You are assumed competent and to know nothing about this
repo. Verify every anchor against the tree you are standing in before building — the line numbers
below were derived on 2026-08-16, after item 01 landed, and this file moves fast. Do exactly this
one change.

---

## What is broken

Item 01 (`4bc9dff`) closed the post-OKAY Edit-path containment escape. The Bash twin was already
closed. That leaves **exactly one tool class that can still write the enforcement surface from
inside an approved run: a non-native tool, in practice a filesystem MCP.**

The H3 guard at `skills/odyssey/hooks/pre-tool.mjs:1614` catches every tool the gate does not
natively classify, but — before this item — protected only two directories:
`skills/odyssey/hooks/pre-tool.mjs:1660` built `protectedDirs` as the run's `.zcode/state` and
`.zcode/reviews` alone. Its own header says so plainly
(`skills/odyssey/hooks/pre-tool.mjs:1612-1613`): *"a targeted forge-surface guard, not a blanket
MCP block."*

That scope was defensible when Edit and Bash were the load-bearing paths. It is not anymore,
because it is now the only unguarded one.

Measured against the shipped build, one armed post-OKAY run, three tools, the same targets:

| tool | target | exit |
|---|---|---|
| `Edit` | `~/.zcode/cli/config.json` | 2 |
| `Bash` (`tee`) | `~/.zcode/cli/config.json` | 2 |
| **`mcp__fs__write_file`** | `~/.zcode/cli/config.json` | **0** |
| `Edit` | `skills/odyssey/hooks/pre-tool.mjs` (the gate itself) | 2 |
| **`mcp__fs__write_file`** | `skills/odyssey/hooks/pre-tool.mjs` | **0** |
| `mcp__fs__write_file` | the run's own `.zcode/state/t.json` | 2 (H3 holds) |

So the gate-takeover chain — the repo's canonical worst incident, the Bash write-gate deleted twice
(`CHANGELOG.md:631`, `CHANGELOG.md:800`) — is still reachable from inside a normally-approved run,
by changing tool a second time. This is the "one path but not its twin" class
(`CHANGELOG.md:369-379`) at triplet scale: fixed on Edit, fixed on Bash, open on everything else.

## What fixed means

Stated as observable behaviour, not as a diff.

A non-native tool naming a path inside **the enforcement surface** is blocked, in every phase,
exactly as Edit and Bash are. The enforcement surface is a closed set: the plugin's enforcement
subtree — `skills/odyssey/` (the conductor SKILL.md, the hooks, the trusted scripts, and the
verdict-shaping `references/`), `agents/`, `commands/`, `.zcode-plugin/` — the host hook registry,
and the two run-scoped directories H3 already protects.

### Amendment — the install root was too coarse (2026-08-17)

The first implementation protected the whole install root, and that regressed the one topology no
fixture could see: a dev checkout, where the plugin root IS the user's repo. Measured on an armed
run in this repo, every MCP write into the repo exited 2 — an ordinary undeclared doc and the
plan's own DECLARED file included. The suite was blind to it by construction: every fixture runs
the real install's hook against a fresh mkdtemp project dir, so installRoot and PROJECT_DIR are
always disjoint. `pre-tool.scope.test.mjs` now ships a dogfood-topology fixture that copies the
plugin tree into the temp repo and runs the copy, making the two coincide — the only topology
where the boundary is observable.

The boundary is now the enforcement subtree. `skills/odyssey/` is folded whole rather than as
`hooks/` + `scripts/`: the conductor SKILL.md and `references/momus-prompt.md` /
`auditor-prompt.md` are prompts, and prompts are enforcement (the T4-4 principle) — leaving them
outside the set would have kept a verdict-shaping write open via MCP in every install, not just
dogfood ones. The install root remains the derivation anchor (self-relative, below) but not the
protected set; `docs/`, `README.md` and `CHANGELOG.md` inside a checkout stay ordinary.

Every other MCP call is unaffected. A read-only MCP naming an ordinary repo path still passes —
`skills/odyssey/hooks/pre-tool.scope.test.mjs:144` asserts exactly that today and must keep
passing.

### Why a closed set, and not scope parity

The obvious move is to give non-native tools the same rule Edit has: target must be in the plan's
declared `Files:` or bookkeeping. **Do not do this.** The hook cannot tell a write from a read on a
non-native tool — `mcp__fs__write_file` and `mcp__fs__read_file` arrive through the same branch
with the same shape. Applying scope parity would block every read-only MCP that names a path
(codegraph, Context7, any repo-aware server), which is a large availability regression and would
get the guard switched off. The suite already encodes the opposite intent at
`skills/odyssey/hooks/pre-tool.scope.test.mjs:144-147`.

The other tempting move — infer write-capability from the tool name (`*write*`, `*edit*`,
`*create*`) — is failure mode #1, enumerating an unbounded set of names an attacker picks. Reject
it explicitly.

Protecting a **closed set** inverts this correctly. The question "is this path part of the
enforcement surface" has a bounded, knowable answer that does not grow with attacker creativity,
where "is this MCP call a write" does not.

### Resolve the install root self-relatively

`skills/odyssey/hooks/pre-tool.mjs:1089` already establishes the technique for the trusted-script
allowlist: `SCRIPTS_DIR` is derived from `import.meta.url`, so it is correct in a repo checkout, in
the legacy `~/.zcode/skills/` layout, and in the plugin cache, and it cannot drift when the install
layout changes. Derive the protected install root the same way — from the running hook's own
location — rather than guessing paths.

The v0.5.0 note at `skills/odyssey/hooks/pre-tool.mjs:1069-1078` is the warning attached to that
technique: two path *guesses* were removed there because one of them trusted a directory inside the
repo being audited. Do not reintroduce a guess.

## Files

The declared editable set — this becomes the fix-run plan's `Files:` list, verbatim and complete:

- `skills/odyssey/hooks/pre-tool.mjs`
- `skills/odyssey/hooks/pre-tool.scope.test.mjs`

Nothing else. The docs under "Docs to update" belong to the release pass, not the gated run.

## Must NOT do

- **Do not apply declared-scope parity to non-native tools.** See above; it breaks every read-only
  MCP that names a path.
- **Do not infer write-capability from the tool name.** Unbounded by construction.
- **Do not touch the Edit or Bash branches.** Item 01 closed the Edit path
  (`4bc9dff`); both are verified and out of scope here. This change lives entirely inside the
  `if (!isEdit && !isBash && !isDispatch)` block at
  `skills/odyssey/hooks/pre-tool.mjs:1614`.
- **Do not add a pattern to `WRITE_PATTERNS`.** Wrong file, wrong class.
- **Do not widen `protectedDirs` by hard-coding an absolute path you guessed.** Self-relative for
  the install root; a named constant with a stated reason for the host registry.
- Do not change the `strings` collector's depth or cap
  (`skills/odyssey/hooks/pre-tool.mjs:1667-1668`) — that is a separate tuning question and
  widening it here would conflate two changes.

### Constraints carried forward (Step 5, verbatim)

- Zero npm dependencies · Node 18+ built-ins only · synchronous, no daemon
- Graceful no-op when an optional tool is absent
- Every hook is a no-op unless a run is active — this change is inside the active-run path already
- No argv flag authenticates anyone
- Fail closed. An unverifiable state blocks; it never passes.
- A repo-capability check degrades to a recorded `inert`, never a block. *Not applicable — this is
  a containment gate, not a capability check.*

### Anchor-drift reconciliation (carried from the 2026-08-16 amendment)

`scripts/check-anchors.test.mjs` runs inside `node scripts/run-tests.mjs` and content-pins every
`file:line` citation. **This change's exposure: 50 pinned citations point into
`skills/odyssey/hooks/pre-tool.mjs`.** Editing it will redden the suite until they are reconciled.

Procedure, in this order:

1. Make the change and get your own criteria passing.
2. `node scripts/check-anchors.mjs` — every `[drift]` names the citing document, the cited file and
   line, and what that line now holds.
3. **Reconcile each at the source.** Item 01's run did this for 33 citations across 12 documents;
   expect a similar shape, smaller, since this edit is lower in the file than item 01's was.
4. **Only then** `node scripts/check-anchors.mjs --update`.

Running `--update` first re-pins whatever is there, including already-wrong citations, and the
drift becomes invisible.

## Acceptance criteria

Every criterion is an exact command from the repo root plus its expected exit code.

1. `node --check skills/odyssey/hooks/pre-tool.mjs` — expected exit **0**.
2. `node skills/odyssey/hooks/pre-tool.scope.test.mjs` — expected exit **0**, with the new
   assertions included in the printed count.
3. `node skills/odyssey/hooks/pre-tool.bash-gate.test.mjs` — expected exit **0**. Mandatory: it is
   the standing regression suite for the gate that was deleted twice.
4. `node skills/odyssey/hooks/pre-tool.gate-surface.test.mjs` — expected exit **0**, still 98
   cases. This change must not move the Bash gate surface at all.
5. `node scripts/check-anchors.mjs` — expected exit **0** *after* reconciliation and `--update`.
6. `node scripts/run-tests.mjs` — expected exit **0**. Baseline on arrival: 33/33 suites. This
   change adds assertions to an existing suite rather than a new file, so the count stays 33.

### Failure-mode check (Step 6)

1. **Enumeration instead of structure.** The rejected designs are the enumerative ones (tool-name
   heuristics, guessed absolute paths). The chosen design protects a closed set derived from the
   running hook's own location. Enumerating what must be *protected* is bounded; enumerating what
   is *dangerous* is not.
2. **A check that cannot detect the class it exists for.** H3 was exactly this — written to close
   the MCP write hole, scoped to two directories, and therefore blind to the takeover target. The
   paired probe below tests the actual takeover paths, not a proxy.
3. **Ceremony without mechanism.** It is a hook branch on the path to every non-native tool call;
   nothing to invoke.
4. **Self-grading.** No LLM involved; the comparison is path containment.
5. **A fix that reopens its own class.** The risk is over-blocking read-only MCPs into a workflow
   break. Criterion 2 keeps `pre-tool.scope.test.mjs:144-147`'s "normal repo path is ALLOWED"
   assertions green, and the probe table below asserts them explicitly on both builds.

## Paired probe

Both directions, against an armed post-OKAY run. The **before** column is measured on the current
build and is the defect; the **after** column is the contract.

| probe | before | after |
|---|---|---|
| `mcp__fs__write_file` → the running `pre-tool.mjs` | **0** | **2** |
| `mcp__fs__write_file` → `~/.zcode/cli/config.json` | **0** | **2** |
| `mcp__fs__write_file` → a trusted script under `skills/odyssey/scripts/` | **0** | **2** |
| `mcp__fs__write_file` → the run's `.zcode/state/t.json` | 2 | 2 (H3 unchanged) |
| `mcp__fs__write_file` → the run's `.zcode/reviews/x.json` | 2 | 2 (H3 unchanged) |
| `mcp__fs__write_file` → an ordinary repo path (`src/text.js`) | 0 | **0** — must not regress |
| `mcp__codegraph__explore` with no path | 0 | **0** — must not regress |
| `Edit` → the running `pre-tool.mjs` | 2 | 2 (item 01, unchanged) |
| `Bash` `tee` → the running `pre-tool.mjs` | 2 | 2 (unchanged) |
| any of the above with **no active run** | 0 | **0** — the hook stays a no-op |

The last three rows are the ones that catch an over-correction. A change that reddens them has
broken the gate's twin-parity in the other direction.

## What it breaks

- **A filesystem MCP can no longer write the plugin's enforcement subtree.** That is the point.
  If an operator legitimately updates the plugin, they do it outside an active run — the hook is
  a no-op then — or through the installer.
- **Nothing else.** Ordinary MCP calls, read-only servers, and every native path are untouched.
  This narrows one branch of one guard.
- **Not covered, and stated rather than hidden:** a non-native tool can still write ordinary repo
  files outside the plan's declared scope, because the hook cannot tell a write from a read there.
  That is a real residual — it is the isolation gap, not the takeover gap. Closing it needs the
  harness to declare tool write-capability, the same shape of dependency as the nonce-to-transcript
  binding (`CHANGELOG.md:205`). Name it in the CHANGELOG under *Known, not fixed*.

## The class it closes

**"A guard added to one path and not its twin."** The repo's most persistent shape:
`CHANGELOG.md:369-379` documents an entire release of them, and v0.5.0's own re-verification found
two more inside the release that was written to hunt them. Item 01 closed the Edit twin; this
closes the third sibling.

The narrower class: **"a guard whose scope was right when it was written and became wrong when its
neighbours were fixed."** H3 was not defective in v0.4.1 — Edit and Bash were open then, so two
protected directories were a reasonable increment. Fixing the neighbours is what made it the weak
link. Nothing in the repo notices when that happens; the claim ledger
(`docs/impl/08-claim-assertion-coverage-ledger.md`) is the closest thing and it checks coverage,
not relative strength.

**Reopening risk:** a fourth tool class arriving later — a new native tool the gate does not
classify. Mitigate by asserting the protected set from the *default* branch: the probe must include
a tool name the gate has never seen (`SomeFutureTool`) and expect a block on the enforcement
surface. `pre-tool.scope.test.mjs:142` already does this for `.zcode/state`; extend it.

## Docs to update

- `README.md` — the invariant table row for MCP/non-native tools, if one is added; today the table
  has no row for this and arguably should.
- `docs/DESIGN.md §6` — the hook table's non-native row.
- `CHANGELOG.md` — entry shape below, including the *Known, not fixed* residual.
- **Not** `skills/odyssey/references/scripts.md` — no conductor-invoked script changes.

## CHANGELOG entry shape

```markdown
### Fixed — the last tool that could still write the gate

Item 01 closed the post-OKAY Edit-path containment escape; the Bash twin was already closed.
That left one class: a non-native tool. The H3 guard protected the run's `.zcode/state` and
`.zcode/reviews` — correct when it was written, and the weak link once its neighbours were
fixed. Measured on one armed run: `Edit` and `Bash` to `~/.zcode/cli/config.json` both blocked,
`mcp__fs__write_file` to the same path allowed; same split on the running hook itself.

The protected set is now the enforcement subtree — `skills/odyssey/` (conductor prompt, hooks,
trusted scripts, verdict-shaping references), `agents/`, `commands/`, the plugin manifest —
anchored on an install root resolved from the running hook's own location the way the
trusted-script allowlist already resolves `SCRIPTS_DIR`, plus the host hook registry and the two
run-scoped directories. Declared-scope parity was rejected deliberately: the hook cannot tell a
write from a read on a non-native tool, so parity would block every read-only MCP that names a
path. The subtree, not the whole root, because in a dev checkout the install root IS the user's
repo — whole-root protection blocked every MCP write into it, declared files included.

**Known, not fixed:** a non-native tool can still write ordinary repo files outside the plan's
declared scope. That is the isolation gap rather than the takeover gap, and closing it needs the
harness to declare tool write-capability — the same class of dependency as the
nonce-to-transcript binding.

**Known, deliberate:** the boundary is `skills/odyssey/`, not `skills/`. Exactly one skill ships
today, so they are equivalent — but a second skill added under `skills/` lands outside the
enforcement set *by decision, not oversight*. When adding one, decide explicitly whether it
belongs in the set; if it carries a prompt or a script the run trusts, the T4-4 principle says it
does.
```

## Capability routing

```
routed: skill:test-driven-development
```

Non-negotiable for code here, and the paired probe is a red-then-green sequence. Load it in the
parent thread — F5 cross-checks the declaration against hook-witnessed loads, and a sub-agent
cannot load a skill on the orchestrator's behalf. Declare the bare token; matching is
segment-tolerant, but prose after the token breaks the parse.

## Estimated size

~15 lines in the hook (one derived constant, two entries appended to `protectedDirs`), ~60 lines of
new assertions in the existing scope suite, plus the citation reconciliation over 50 pinned
anchors. **Patch release, shipped alone** — it is security-class, and the repo's rule is one
security change per release (`CHANGELOG.md:273`).
