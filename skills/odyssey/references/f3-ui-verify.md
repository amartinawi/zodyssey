# F3 — Executable UI Verification Wiring (chrome-devtools + zai-mcp-server)

> **Scope:** F3 is phase 6's manual-QA lane. For UI runs it must be driven by *executable* evidence,
> not self-report. This doc wires two MCPs — **chrome-devtools** (drives the page, screenshots) and
> **zai-mcp-server** (diff/diagnose the screenshot) — into `record-final-wave.mjs --f3-checklist <path>`.
> This run (`enhance-zodyssey-backlog`) is non-UI, so F3 is N/A here; the wiring is general for future
> UI runs.

## The one rule that breaks everything if ignored

**The MCP calls MUST happen in the PARENT (orchestrator/main) thread — NEVER in a sub-agent.**

ZCode sub-agents (zodyssey:sisyphus-junior, zodyssey:momus, etc.) do NOT receive routed MCPs regardless of the
`tools:` frontmatter — see the trust anchor at `references/capabilities.md:12-20`. A dispatched
zodyssey:sisyphus-junior got a fixed set (Bash/Edit/Read/WebFetch/WebSearch/Write + 2 always-on MCPs) and no
`chrome-devtools` / `zai-mcp-server`. So the orchestrator runs the MCP sequence itself, writes the
checklist file itself, and only then calls `record-final-wave.mjs`. If you dispatch the F3 work to a
sub-agent, the MCP tools will simply be absent and the step fails opaquely.

## The real flag (do not invent a bare `--f3`)

`record-final-wave.mjs` accepts **`--f3-checklist <path>`** — NOT `--f3`. Verified at
`scripts/record-final-wave.mjs:10, :15, :29, :36`. The F3 check (`record-final-wave.mjs:372-387`) resolves the path,
requires the file to **exist** and be **non-empty** (`content.trim().length > 0`), and records
`results.F3 = { passed, checklist }`. There is **no JSON parse, no "pass" keyword scan** — the gate
is non-emptiness, and the pass/fail semantics live in whatever *you* write into the checklist. (For
an honest F3 you write per-check pass/fail into the file; see the shape below.)

The script's full F1–F4 CLI (for context, do not change it):

```
record-final-wave.mjs <repo> <slug> [--f2-artifact P --f2-nonce N] \
                                     [--f3-checklist P] \
                                     [--f4-artifact P --f4-nonce N] \
                                     [--skip F2,F4,F5]
```

## The wiring sequence (run this in the PARENT thread)

1. **Navigate + screenshot (chrome-devtools MCP).** Drive the dev URL the run produced:
   - open the page at the dev URL (e.g. `http://localhost:3000/...`),
   - exercise the QA scenario from the plan (clicks, form fills, route changes),
   - capture a screenshot at each meaningful viewport (320 / 768 / 1024 / 1440 px — the
     `skill: ui-ux-pro-max` pre-delivery set).
   Keep the screenshot bytes/file path — zai needs an image.

2. **Diff or diagnose (zai-mcp-server MCP).** Pick by outcome:
   - **`ui_diff_check`** — compare the screenshot against a design reference (the artifact
     `ui-ux-pro-max` produced in phase 2, or a committed `design.png`). This is the happy-path F3
     check: "does the built UI match the design?"
   - **`diagnose_error_screenshot`** — if the page errored, blanked, or threw, run this against the
     screenshot to get a structured diagnosis. This is the failure-path F3 check.
   - Both return a verdict (pass/fail + reason). That verdict IS the F3 evidence.

3. **Write the checklist file.** The zai verdict becomes a small markdown (or JSON) file the
   orchestrator writes to disk — e.g. `<repo>/.zcode/verify/<slug>/f3-checklist.md`. Shape below.
   The file MUST be non-empty (that's all `record-final-wave.mjs` enforces), so put the real
   pass/fail content in it.

4. **Consume into F3.** Call (parent thread):
   ```
   node skills/odyssey/scripts/record-final-wave.mjs <repo> <slug> \
       --f3-checklist <repo>/.zcode/verify/<slug>/f3-checklist.md \
       [--f2-artifact ... --f2-nonce ...] [--f4-artifact ... --f4-nonce ...] [--skip F2,F4,F5]
   ```
   (Script path is relative to the `zodyssey` plugin install root.)
   Exit 0 = all bound F-items pass; exit 6 = at least one failed. The F3 lane in
   `.zcode/verify/<slug>/final-wave.json` records `{ passed, checklist }`.

## Checklist file shape (what `--f3-checklist` consumes)

The script only requires: file exists + non-empty. For an *honest* F3, write one row per check so a
human (or F4/zodyssey:oracle) can audit which assertion failed. Recommended markdown template:

```markdown
# F3 manual-QA checklist — <slug>

Driven by chrome-devtools MCP → zai-mcp-server verdicts (parent thread).
Dev URL: <url> · captured: <ISO timestamp>

| Check | Verdict | Evidence |
|---|---|---|
| Design match (desktop 1440) | pass | ui_diff_check: 0 critical diffs vs design.png |
| Design match (mobile 320) | pass | ui_diff_check: 0 critical diffs |
| Error surface | pass | diagnose_error_screenshot: no error chrome |
| QA scenario end-to-end | pass | chrome-devtools: scenario completed, exit 0 |

Overall: pass
```

JSON equivalent (also valid — pick whichever the run prefers; both satisfy "non-empty"):

```json
{
  "slug": "<slug>",
  "dev_url": "<url>",
  "checks": [
    { "name": "Design match (desktop 1440)", "verdict": "pass", "evidence": "ui_diff_check: 0 critical diffs vs design.png" },
    { "name": "Design match (mobile 320)",   "verdict": "pass", "evidence": "ui_diff_check: 0 critical diffs" },
    { "name": "Error surface",               "verdict": "pass", "evidence": "diagnose_error_screenshot: no error chrome" },
    { "name": "QA scenario end-to-end",      "verdict": "pass", "evidence": "chrome-devtools: scenario completed, exit 0" }
  ],
  "overall": "pass"
}
```

If any row is `fail`, the F3 evidence is honest about it — set the `overall` accordingly and let
`record-final-wave.mjs` exit 6 so the run does NOT reach `done` on a broken UI. The script does not
read the `overall` field; the discipline is yours (and F4/zodyssey:oracle audits it).

## zai-mcp-server tools — which apply to F3

Full set in `cli/config.json`: `ui_to_artifact`, `ui_diff_check`, `diagnose_error_screenshot`,
`extract_text_from_screenshot`, `understand_technical_diagram`, `analyze_data_visualization`,
`analyze_image`.

| Tool | F3 role |
|---|---|
| **`ui_diff_check`** | **PRIMARY (happy path).** Compare built screenshot vs design reference. Verdict = F3 evidence. |
| **`diagnose_error_screenshot`** | **PRIMARY (failure path).** Diagnose a screenshot that errored/blanked/threw. Verdict = F3 evidence. |
| `ui_to_artifact` | Support — turn a screenshot into a structured artifact for downstream diffing. |
| `extract_text_from_screenshot` | Support — verify copy/labels rendered (e.g. form labels, alt-text-equivalent content). |
| `analyze_image` | Generic fallback — describe what's on screen if no design ref exists. |
| `understand_technical_diagram` | Usually N/A — for diagrams/charts in docs, not app UI. |
| `analyze_data_visualization` | N/A for most app UI; use if the page is a chart/dashboard. |

`chrome-devtools` MCP owns the *drive* + *screenshot*; `zai-mcp-server` owns the *judge*. They are
complementary, not redundant — do not substitute one for the other.

## Non-UI runs

If the run's deliverables are non-UI (scripts, docs, hooks — like this `enhance-zodyssey-backlog`
run), F3 is satisfied by an executable shell checklist instead, and the MCP sequence above is
skipped. The `--f3-checklist <path>` consumption is identical; only the file's *content* differs
(shell-command results rather than screenshot verdicts).

## See also

- `references/capabilities.md` — F3 row (around line 95); trust anchor at lines 12–20.
- `scripts/record-final-wave.mjs` — the trusted writer; do not modify, only consume.
- `skill: ui-ux-pro-max` — the F3 *standard* for UI quality (contrast, a11y, responsive set).
- `skill: playwright` — alternative executable-UI path; the QA scenario compiles to a Playwright
  script whose exit code can also feed `--f3-checklist`.
