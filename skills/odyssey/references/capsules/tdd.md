# tdd capsule (for sub-agent dispatch)

Iron law: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. If you wrote code before the test, delete it — don't keep it as "reference", don't "adapt" it, delete means delete; implement fresh from tests.

Cycle (Red-Green-Refactor), repeat per behavior:
- RED: write one minimal test for one behavior. Clear name, real code (no mocks unless unavoidable).
- Verify RED (mandatory, never skip): run the test, watch it FAIL. Confirm it fails because the feature is missing. If it passes immediately, you tested existing behavior — fix the test.
- GREEN: write the simplest code that passes. No extra features, no drive-by refactors.
- Verify GREEN (mandatory): run the test, watch it PASS; confirm other tests still pass and output is pristine. If it fails, fix the code, not the test.
- REFACTOR: only after green — remove duplication, improve names, extract helpers. Keep tests green; add no behavior.

Must not: skip "verify RED"; write tests after implementation; add behavior during REFACTOR; keep pre-test code as "reference".

Done means: every new function has a test you watched fail first, minimal code to pass, all green, output clean, edge cases covered.
