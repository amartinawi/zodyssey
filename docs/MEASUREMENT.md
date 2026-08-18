# ZOdyssey — Measuring Efficiency & Quality

> How we know the system is working, and whether a change made it better. Grounded in Anthropic's
> published multi-agent eval methodology (end-state evaluation + LLM-as-judge + small seed sets)
> and the token/success correlations from their research-system post.

## 0. The two questions we're actually asking

1. **Efficiency** — "Did it get there cheaply?" (tokens, wall-clock, dispatches, retries)
2. **Quality** — "Did it get to the *right* place?" (correctness, scope-fidelity, no regressions)

A system that's cheap but wrong is failure. A system that's right but 15× the cost is a research
toy. We measure both, and the ratio between them is the headline number.

---

## 1. Efficiency metrics (quantitative — auto-collected from state.json + logs)

> **Corpus hygiene (cutover 2026-08-17).** Until this date, `set-phase.mjs`'s terminal-phase
> auto-append had no notion of provenance, so the repo's own test suite polluted the operator's
> trend log on every run. Stamped contamination: 159/190 = 83.7% synthetic (16 `"slug":"t"` +
> 143 `add-truncate`, measured 2026-08-16 during the v0.6 queue's authoring); 387 records /
> 91.2% (211 + 142, measured 2026-08-17 at cutover — the file compounded with every
> `npm test`). The fix routes declared-synthetic runs to `results.synthetic.jsonl`; the
> **historical synthetic records are retained, not quarantined** — product code must never edit
> the operator's telemetry history — and age out naturally under the 1000-record rolling cap.
> Consequence for readers: any `dashboard.mjs` number drawn from `results.jsonl` before the
> pre-cutover tail fully ages out is computed over a mixed corpus; attribute post-cutover shifts
> to the lane split, not to code changes.

| Metric | What it tells us | Source | Target (v1) |
|---|---|---|---|
| **Tokens consumed** | cost; the variable that correlates with success | provider usage | per-intent budget |
| **Wall-clock time** | latency the user feels | state started_at → done | standard <10min |
| **Sub-agent dispatches** | parallelism efficiency; over-dispatch = waste | state checkpoints | ≤ plan-todo count +2 |
| **Tokens / todo completed** | unit economics | tokens ÷ done todos (telemetry needs Node >= 22.5 via `node:sqlite`; on the engines floor >= 18 the record carries a stamped inert, never a failure) | trending down |
| **Review rounds used** | plan quality (1 = great, 3 = poor) | state.review.round | median 1 |
| **Todo retries** (QA-fail → re-dispatch) | executor accuracy | state.todos[*].attempts | median 0 |
| **Hook blocks triggered** | are gates biting usefully or noise? | ZCode log | low + justified |
| **Checkpoint resumes** | crash/failure recovery frequency | state checkpoints | 0 is best |
| **Dispatches at cap (4)** | parallel saturation | log | some (healthy) |

**The headline efficiency number: tokens-per-successful-todo.** That single ratio captures cost
discipline better than any total. Anthropic found token usage explains ~80% of the variance in
their eval success — so it's the lever that matters most.

**Token population is a health signal (since 0.6.3).** Every appended record's `tokens` is
populated, inert-with-reason (`{inert:true, reason, node_version, at}` — the closed reason set
`bad-args | db-missing | binding-unavailable | db-unreachable | no-usage-in-window`), or
historical (pre-0.5.2 field-absent/null, frozen). The canonical fraction command:

```bash
R=~/.zcode/orchestration/eval/results.jsonl
echo "inert-with-reason: $(grep -c '"inert":true' $R)"
echo "populated:          $(( $(grep -c '"tokens":{' $R) - $(grep -c '"inert":true' $R) ))"
echo "historical-null:    $(grep -c '"tokens":null' $R)"
echo "field-absent:       $(( $(wc -l < $R) - $(grep -c '"tokens"' $R) ))"
```

## 2. Quality metrics (judged — LLM-as-judge + end-state checks)

Because paths are non-deterministic, we judge the **end state**, not the sequence (Anthropic's method).

| Metric | What it tells us | How measured | Target |
|---|---|---|---|
| **Acceptance-criteria pass rate** | did each todo's commands actually pass? | re-run them in verify phase | 100% before "done" |
| **Scope fidelity** | built what was asked, nothing more | F4 (oracle) + judge | no scope creep |
| **Plan compliance** | did execution match the plan? | F1 (conductor diff) | >90% |
| **Code quality** | no regressions introduced | F2 (claude-security + code-reviewer) — **parses the reviewer's verdict as of 2026-08-11; before that it only confirmed a reviewer was dispatched** | 0 new findings |
| **Verification rigor** | were QA scenarios real, not vibes? | judge scores the acceptance criteria | high |
| **Factual accuracy** | no hallucinated APIs/files | judge + explore re-check | high |
| **Verification origin** | does "success" stand on an external audit or in-session checks only? | `run-report.mjs` emits `verify_origin` (`external-audit` \| `in-session-only`) + `consult_rounds` into every results.jsonl record; dashboard's Recent-runs table renders the column | audited where it matters |

> **Honest status of this table (corrected 2026-08-16).** These are targets. Three mechanisms exist
> to serve them, and only one of the three is actually invoked:
>
> - **F1's test-integrity guard** (tests may not be deleted, shortened, or skip-marked) — **enforced.**
>   It runs inside `record-final-wave.mjs`, on the path to `done`.
> - **`regression-gate.mjs`** (pass-to-pass) — **half-wired; the gate has never fired.** The earlier
>   wording here said "enforced at `done`", which was wrong. `--snapshot` is invoked automatically
>   (`set-phase.mjs:339`, `record-review.mjs:295`), but `--check` — the only writer of
>   `status: "regressed"`, the field `set-phase.mjs:131` refuses `done` on — has **zero code
>   callers**. The baseline is taken; the comparison never runs; the refusal reads a field nothing
>   populates.
> - **`check-imports.mjs`** (imports must resolve against the repo's declared dependencies) —
>   **built, never invoked from code.** Its only caller is prose (`references/scripts.md:46`).
>
> All three landed 2026-08-11 as *scripts*. Two of the three were never wired to anything, which is
> why this section previously read as though the targets were met. A mechanism that exists is not a
> mechanism that runs — and this table is exactly where that distinction gets lost, so state which
> is which whenever a row changes.
>
> What they still do **not** cover: the regression gate is suite-level, so it detects "green went
> red", not "47 passing tests became 46 while the suite still exits 0" — per-test granularity
> needs runner-specific parsing that would rot. `check-imports.mjs` verifies a package is
> *declared here*, not that it exists on any registry, and does not check whether an imported
> *symbol* exists within a real package. Nothing type-checks or builds. Treat those as open.
| **LLM-as-judge score (0.0–1.0)** | overall, rubric-weighted | oracle/judge on final diff + success criteria | ≥0.85 |

**Rubric for the judge** (0.0–1.0 each, weighted mean):
- Correctness vs. success criteria (0.4)
- Scope fidelity — only what was asked (0.2)
- Verification rigor — real tests, not assertions (0.2)
- Code quality — no regressions/clutter (0.1)
- Efficiency — tokens/time reasonable for the task (0.1)

## 3. The seed eval set (the ground truth)

Start small — **~20 tasks** across the three intents (Anthropic: "20 datapoints is enough").
You said you have tasks; the harness consumes a simple format:

```jsonc
// ~/.zcode/orchestration/eval/seed.jsonl — one task per line
{
  "id": "std-01",
  "intent": "standard",                       // trivial | standard | architecture
  "prompt": "Add a /healthz endpoint to the Express server + a jest test",
  "repo": "/path/to/throwaway/repo",          // fresh clone per run
  "success_criteria": [                        // judgeable end-state, not path
    "GET /healthz returns 200 {ok:true}",
    "jest test for /healthz exists and passes",
    "no other endpoints changed"
  ],
  "expected_signals": ["npm test exits 0", "route file under src/routes/"]
}
```

Each task is run **fresh** (clean repo copy) and judged blind. The point isn't a benchmark suite
to publish — it's a regression gate: did the last change make things better or worse?

## 4. The measurement loop (per run → aggregate)

```
   one /orchestrate run
            │
            ▼
   ┌────────────────────────────────┐
   │ AUTO-CAPTURE (no extra work)    │
   │ · state.json: phase timings,    │
   │   review rounds, todo attempts  │
   │ · checkpoints: resume events    │
   │ · memory.json: learnings        │
   │ · ZCode log: hook blocks        │
   └────────────┬───────────────────┘
                ▼
   ┌────────────────────────────────┐
   │ RUN-REPORT  (a script we build) │
   │ aggregates one run → a scorecard│
   │ · efficiency metrics            │
   │ · acceptance pass rate          │
   │ · capability-usage summary      │
   └────────────┬───────────────────┘
                ▼
   ┌────────────────────────────────┐
   │ JUDGE  (LLM-as-judge, once)     │
   │ oracle/judge scores the final   │
   │ diff against the rubric (0–1.0) │
   └────────────┬───────────────────┘
                ▼
   ┌────────────────────────────────┐
   │ APPEND to eval/results.jsonl    │  ◄── the trend line (real runs;
   │   (real runs) — or to           │      compare runs over time;
   │   results.synthetic.jsonl       │      spot regressions on changes.
   │   (declared-synthetic runs)     │      Operator lane holds real runs only.
   │ {run_id, task_id, efficiency,   │
   │  quality_score, tokens, time}   │
   │  tokens = totals (populated)    │
   │         | {inert:true, reason,  │
   │           node_version, at}     │
   └────────────────────────────────┘
```

## 5. What "good" looks like — the dashboard we want

```
   ZOdyssey efficiency dashboard (last 20 runs)
   ─────────────────────────────────────────────
   Success rate (done with all F1–F4 passing)   85%  ████████░░
   Median tokens / successful todo             8.2k  ████░░░░░░
   Median wall-clock (standard intent)         6.4m  █████░░░░░
   Review rounds: 1 / 2 / 3                   70/22/8  ███████░░░
   Todo retries (median)                        0    ░░░░░░░░░░
   LLM-judge score (median)                   0.87  █████████░
   Scope-fidelity violations                   2/20 █░░░░░░░░░
   Hook blocks (justified / noise)            14/0  ██░░░░░░░░
   Capability usage: TDD 18 · codegraph 12 · memory-write 9 · sequential-thinking 4
```

That dashboard is the goal. Each row maps to a metric in §1/§2. Build it incrementally — start
with what state.json already gives us, add the judge last.

## 6. Honest limitations of this measurement

1. **Judge variance** — LLM-as-judge isn't perfectly consistent. Mitigate: judge each run twice,
   flag disagreements >0.15 for human review (Anthropic's pattern).
2. **Seed set is small** — 20 tasks has high variance per change. Treat the numbers as directional,
   not statistically tight. Significance comes from trends over many changes, not one delta.
3. **No public benchmark** — we can't claim "beats omo by X%" without running omo on the same set.
   That's a future cross-eval, not v1. For now: relative improvement over our own past runs.
4. **Token attribution** — ZCode's per-agent token accounting may be coarse. We may get session-
   totals, not per-dispatch. Acceptable for v1; refine if it blocks insight.
5. **Quality of success criteria** — garbage in, garbage out. If a task's criteria are weak, the
   judge has nothing to anchor to. The seed set's criteria quality bounds everything.

## 7. Build order (what to actually construct)

1. **`run-report.mjs`** — reads state.json + log, emits a one-run scorecard (JSON + text). The
   foundation; pure aggregation, no judging.
2. **`eval/seed.jsonl`** — your ~20 tasks in the format above. You bring the tasks; I structure them.
3. **`judge.mjs`** — dispatches oracle to score a completed run's diff against the rubric. The
   quality half.
4. **`eval/results.jsonl` + `dashboard.mjs`** — append-only trend log + the dashboard renderer. Two lanes since 2026-08-17: real runs append to `results.jsonl`; runs that declare themselves synthetic at source (`ZODYSSEY_EVAL_LANE=synthetic`, set by the spawning fixture/harness) append to `results.synthetic.jsonl` — identical record format, identical rolling cap, `dashboard.mjs` reads the operator lane unmodified.
5. **(optional) cross-eval** — run omo on the same seed set for the head-to-head number.

Items 1–2 give immediate value (you see efficiency per run). 3 adds quality. 4 gives the trend.
5 is the cherry on top.
