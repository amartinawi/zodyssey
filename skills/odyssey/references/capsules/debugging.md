# debugging capsule (for sub-agent dispatch)

Iron law: NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. Symptom fixes are failure.

Phase 1 — Root cause (before any fix): read error messages and stack traces completely; reproduce reliably (exact steps — if not reproducible, gather more data, don't guess); check recent changes (git diff, commits, deps, config); in multi-component systems, instrument each component boundary to prove WHERE it breaks before analyzing; trace bad values to their source; fix at the source, not the symptom.

Phase 2 — Pattern: find similar working code in the codebase; read any reference completely (don't skim); list every difference between working and broken; understand dependencies and assumptions.

Phase 3 — Hypothesis: state one specific hypothesis ("X is root cause because Y"); test the smallest change, one variable at a time; if it fails, form a NEW hypothesis — never stack fixes on a failed one.

Phase 4 — Implementation: write a failing test reproducing it; apply ONE fix for the root cause (no drive-by changes); verify it passes and nothing else broke.

Stop-condition: after 3+ failed fixes, STOP — that signals a wrong architecture, not a missed bug. Question the fundamentals; do not attempt fix #4.
