// plan-path.mjs — the ONE shared plan_path reader-side resolver (project-isolation audit
// 2026-08-20, finding I3).
//
// Before this module, every reader site did its own `st.plan_path || join(<repo>, ".zcode",
// "plans", "<slug>.md")` — 13 expressions across 11 sites — and NONE of them checked that the
// absolute, state-persisted plan_path actually resolves inside the run's own repo. A state
// whose plan_path points into a sibling repo (reachable downstream of I1's mis-selection, or
// by authoring a state file — the marker's identity excludes plan_path) made the FOREIGN plan
// this project's scope authority: its Files: judged local edits and its declared filenames
// leaked into block messages.
//
// Every reader now routes through resolvePlanPath(st, repoRoot):
//   · plan_path absent/empty            → the repo's default plan path, no violation (the
//     plain fallback — old states without the field behave exactly as before).
//   · plan_path contained in repoRoot   → byte-identical passthrough (both sides normalized
//     inside containedIn, repo-path.mjs's rule: never compare two paths unless both went
//     through resolvePath — symlink spellings of the same file must not fake a violation).
//   · plan_path resolving elsewhere     → the default plan path PLUS the named violation.
//     Callers MUST fail closed on it: the hook blocks with an EMPTY declared scope (the
//     unreadable-plan semantics — a foreign plan must block, never widen, and its filenames
//     must never reach the message), and every trusted script exits non-zero with this reason.
//
// The helper only chooses WHICH plan file is opened. It does not touch the SEC-4 plan-sha
// tamper guard: the sha is still re-hashed against whatever plan is legitimately read.

import { join } from "node:path";
import { containedIn } from "./repo-path.mjs";

// The named reason shared by every reader site. Deliberately carries NO path from the foreign
// side — the block/exit message must not leak the foreign plan's location or contents.
export const PLAN_PATH_VIOLATION =
  "plan_path isolation violation: state.plan_path is set but resolves outside this run's repo — " +
  "a foreign plan must never become this project's scope authority (project-isolation audit I3)";

// resolvePlanPath(st, repoRoot) → { planPath, violation }
//   st       — the run's state object (only .slug and .plan_path are read).
//   repoRoot — the run's OWN repo root: pathResolve(RUN_STATE_DIR, "..", "..") in the hook
//              (per-call — selection may have swapped the governing run), repoAbs/repo in the
//              trusted scripts. Normalization happens inside containedIn, so a relative root
//              resolves against cwd exactly like the join() fallback always did.
export function resolvePlanPath(st, repoRoot) {
  // The single sanctioned `plan_path ||` fallback in the codebase — audit I3: this used to be
  // 13 inline copies, none of which checked containment.
  const defaultPath = join(repoRoot, ".zcode", "plans", `${st && st.slug}.md`);
  const planPath = st && st.plan_path || defaultPath;
  const violation = st && st.plan_path && !containedIn(st.plan_path, repoRoot) ? PLAN_PATH_VIOLATION : null;
  // On violation the returned path is the DEFAULT, never the foreign one: a caller that
  // ignored the flag still opens its own repo's plan, never the sibling's bytes.
  return { planPath: violation ? defaultPath : planPath, violation };
}
