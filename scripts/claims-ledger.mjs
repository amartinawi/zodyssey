// claims-ledger.mjs — the hand-maintained claim→assertion coverage registry (item 08).
//
// Each row binds ONE documented claim (documented_at) to the executable assertion that defends
// it (asserted_by + marker). scripts/check-claims.mjs re-verifies every binding mechanically;
// scripts/check-claims.test.mjs pins the row floor and the five incident ids so this registry
// cannot silently die. Run: node scripts/check-claims.mjs   (exit 0 = every row resolves).
//
// AUTHORING RULES (binding — read before adding or editing a row):
// 1. SINGLE-LINE MARKERS ONLY. A marker must occur, byte-for-byte, within a single line of its
//    asserted_by file. A marker that wraps across two comment lines can NEVER resolve: the
//    VERSION-CONSISTENCY row's original marker ("documented-but-unenforced invariant") wrapped
//    lines 15-16 of scripts/version-consistency.test.mjs — present by eye, unmatchable by
//    includes(). Verify every marker with a real  grep -n "<marker>" <asserted_by>  before
//    writing the row — never by eye.
// 2. AT MOST 12 ROWS. "Deliberately small — 8–12 load-bearing claims. An exhaustive registry
//    rots" (docs/ROADMAP.md:160). Nine rows today. Do not chase exhaustive README / DESIGN §6 /
//    SKILL.md coverage; a row must earn its place by being load-bearing.
// 3. THE DEGRADATION RULE. A red row goes green only by (a) re-binding it to a real assertion,
//    or (b) editing the documented_at doc to stop making the claim — in the same diff. Never by
//    deleting the row, weakening the checker, or suppressing the finding (there is no flag).
// 4. THE CHECK-ANCHORS BLIND SPOT. A marker is a content claim, not a citation. check-anchors.mjs
//    verifies that cited path:line anchors exist; it could never have caught this registry's
//    founding failure — a marker string that looked present but wrapped two lines. Anchor
//    liveness and marker presence are different checks; this registry needs both to hold.
//
// Fields: id (unique SCREAMING-KEBAB; the checker's failure lines name it) · claim (what the
// doc says) · documented_at (path:line where the claim is STATED — liveness-checked only;
// drift within the file is tolerated, a deleted doc is not) · asserted_by (the file that
// PROVES it, repo-root-relative or absolute — never prose/.md) · marker (a literal single-line
// string in asserted_by — the binding) · kind ("suite" = discovered by run-tests.mjs |
// "release-gate" = release cadence, file + marker only) · note (optional context).

export const CLAIMS = [
  {
    id: "BASH-GATE-REGRESSION",
    claim: "the Bash write-gate's regression suite fails if the gate is deleted a third time",
    documented_at: "AGENTS.md:43",
    asserted_by: "skills/odyssey/hooks/pre-tool.bash-gate.test.mjs",
    marker: "silently deleted TWICE",
    kind: "suite",
    note: "v0.1.1/v0.2.0 deletions; run this suite after every pre-tool.mjs edit",
  },
  {
    id: "GATE-SURFACE-INVARIANTS",
    claim: "the audit-found gate-surface invariants stay tested (§6, the enforcement layer)",
    documented_at: "docs/DESIGN.md:245",
    asserted_by: "skills/odyssey/hooks/pre-tool.gate-surface.test.mjs",
    marker: "the v0.4.1 audit found UNTESTED",
    kind: "suite",
  },
  {
    id: "VERSION-CONSISTENCY",
    claim: "the three release manifests cannot disagree (v0.3.2 shipped uninstallable)",
    documented_at: "docs/DEVELOPMENT.md:43",
    asserted_by: "scripts/version-consistency.test.mjs",
    marker: "the exact class this repo keeps being bitten by",
    kind: "suite",
    note: "marker amended 2026-08-19: the original \"documented-but-unenforced invariant\" wraps lines 15-16 of the asserted_by file and can never resolve as a single line",
  },
  {
    id: "SMOKE-GATE-LIVE",
    claim: "the release gate checks enforcement liveness before a release",
    documented_at: "docs/DEVELOPMENT.md:76",
    asserted_by: "scripts/smoke-gate.mjs",
    marker: "is enforcement actually live",
    kind: "release-gate",
    note: "release-gate rows verify file + marker only; their cadence is this row's contract, not the checker's",
  },
  {
    id: "DEPLOY-SURFACE-COVERAGE",
    claim: "the drift gate compares everything the deployer deploys (one recursive definition)",
    documented_at: "CHANGELOG.md:395",
    asserted_by: "scripts/deploy-surface.test.mjs",
    marker: "must compare everything the deployer deploys",
    kind: "suite",
    note: "documented_at re-anchored to the [0.5.0] entry; the impl doc's 26af48b shorthand appears nowhere in CHANGELOG",
  },
  {
    id: "EDIT-PATH-CONTAINMENT",
    claim: "post-OKAY, no Edit-family path skips the scope gate (the item-01 escape is closed)",
    documented_at: "docs/impl/01-edit-path-containment-escape.md:98",
    asserted_by: "skills/odyssey/hooks/pre-tool.scope.test.mjs",
    marker: "post-OKAY Edit to a target outside both roots is BLOCKED",
    kind: "suite",
  },
  {
    id: "CHECKS-WIRED-AT-TRANSITIONS",
    claim: "the item-02 checks fire from phase transitions; findings block done; absent capability records inert",
    documented_at: "docs/impl/02-wire-zero-caller-checks.md:110",
    asserted_by: "skills/odyssey/scripts/set-phase.check-wiring.test.mjs",
    marker: "records inert (capability absent, never a block)",
    kind: "suite",
  },
  {
    id: "NONCE-MINTER-EXACT",
    claim: "only declared minter types mint the nonce lanes (lookalikes dispatch but mint nothing)",
    documented_at: "docs/impl/03-nonce-lane-minter-allowlist.md:77",
    asserted_by: "skills/odyssey/hooks/pre-tool.gate-surface.test.mjs",
    marker: "dispatches but mints NO review nonce (lookalike)",
    kind: "suite",
    note: "marker is static text inside a template literal in the suite source; includes() matches source bytes",
  },
  {
    id: "UNGATED-CALLS-RECORDED",
    claim: "every ZODYSSEY_UNGATE_BASH=1 call under an active run leaves a ledger row",
    documented_at: "docs/impl/04-ungate-bash-record-or-retire.md:86",
    asserted_by: "skills/odyssey/hooks/pre-tool.bash-gate.test.mjs",
    marker: "The hatch must testify: every ungated call leaves a ledger row",
    kind: "suite",
  },
];
