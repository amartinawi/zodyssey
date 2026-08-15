// capability-name.mjs — one matcher for every declared-vs-observed capability comparison.
//
// WHY THIS EXISTS (audit 2026-08-14, Class C): the same function compared names four different
// ways, and three of them were wrong for real installs.
//   · skill branch     exact equality        -> `skill:test-driven-development` (what capabilities.md
//                                               lists, what plans declare) never matched the observed
//                                               `skill:superpowers:test-driven-development`. 34 of the
//                                               installed skills carry a plugin namespace.
//   · agent branch     stripped ONLY `zodyssey:` -> missed `feature-dev:code-reviewer`
//   · mcp branch       tolerated a tool-name SUFFIX but not a plugin PREFIX, so `mcp:socraticode`
//                      never matched `mcp__plugin_socraticode_socraticode__codebase_search`
//   · discovery branch hard-coded `skill:find-skills`, making it UNSATISFIABLE when find-skills is
//                      installed namespaced — and unlike the others there was no per-plan workaround.
//
// The rule: exact match always wins; otherwise compare the final name segment, so a bare
// declaration matches a namespaced observation and vice versa. Accepted trade (deliberate): two
// plugins exposing the same bare skill name can cross-match. F5 is a routing check, not a security
// boundary — the security gates are the nonce chain and the scope gate.

// Lowercase and strip ALL whitespace (not just trim): plans are hand-written and
// `routed: skill: my-skill` is the same declaration as `routed: skill:my-skill`.
//
// Use this for OBSERVED names, which come from the hook and are always a bare token. For DECLARED
// values, which come from a hand-written plan line, use capabilityToken() below — stripping all
// whitespace welds trailing prose onto the name.
export const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");

// The capability token at the START of a declared routing value, with any trailing prose dropped.
//
// WHY (ORCH-2, found by the v0.5.0 deep verification): routing lines are documentation as much as
// declaration, and people write them that way:
//
//     - `routed: skill:source-command-audit-full — primary; generic fallback if unavailable`
//
// norm() strips ALL whitespace, so that became `skill:source-command-audit-full—primary;genericfallback…`
// — a name that matches nothing. F5 then failed a run that had routed correctly and loaded the
// right skill, with a message about the skill never being observed. That is the exact failure the
// live run hit; segment-tolerant matching fixed the NAMESPACE half of it and left this half.
//
// Two rules, in order:
//   1. collapse whitespace around ":" so `skill: my-skill` still reads as one token (the reason
//      norm() stripped whitespace in the first place — that tolerance is kept);
//   2. take the leading run of name characters, so the token ends at the first space, em dash,
//      comma, semicolon or parenthesis. Capability names never contain those.
export function capabilityToken(value) {
  const s = String(value || "").toLowerCase().replace(/\s*:\s*/g, ":").trim();
  const m = s.match(/^[a-z0-9._:@/_-]+/);
  return m ? m[0].replace(/[.,;:]+$/, "") : "";
}

// The kind prefix of a declared routing value: skill | mcp | agent | null.
export function kindOf(value) {
  const m = norm(value).match(/^(skill|mcp|agent):/);
  return m ? m[1] : null;
}

// Everything after the kind prefix. `skill:superpowers:tdd` -> `superpowers:tdd`
export function bareValue(value) {
  const v = norm(value);
  const i = v.indexOf(":");
  return i === -1 ? v : v.slice(i + 1);
}

// The final `:`-delimited segment — the name without any plugin/namespace qualifier.
export const lastSegment = (name) => {
  const n = norm(name);
  const i = n.lastIndexOf(":");
  return i === -1 ? n : n.slice(i + 1);
};

// Do two skill-or-agent names refer to the same thing, allowing either side to be namespaced?
export function sameName(a, b) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;                       // exact wins
  return lastSegment(na) === lastSegment(nb);       // bare <-> namespaced
}

// Observed MCP capabilities are recorded as the FULL tool name the host reported, which is either
// `mcp__<server>__<tool>` or, for plugin-hosted servers, `mcp__plugin_<plugin>_<server>__<tool>`.
// A declared `mcp:<server>` must match both shapes.
export function matchesMcpServer(declaredServer, observedCapability) {
  const server = norm(declaredServer);
  const obs = norm(observedCapability);
  if (!server || !obs.startsWith("mcp__")) return false;
  const rest = obs.slice("mcp__".length);
  const serverPart = rest.split("__")[0];           // strip the tool-name suffix
  if (serverPart === server) return true;
  // plugin-hosted: `plugin_<plugin>_<server>` — the server is the trailing underscore segment(s).
  return serverPart.endsWith("_" + server) || serverPart.split("_").includes(server);
}

// THE entry point. `declared` is a plan's routing value (`skill:x` / `mcp:x` / `agent:x`);
// `observed` is a string from state.capabilities[].capability.
export function matchesCapability(declared, observed) {
  // Tokenize the DECLARED side first (ORCH-2): the plan line may carry trailing prose, and
  // norm()'s whitespace stripping would weld it onto the name. The observed side needs no
  // tokenizing — it comes from the hook as a bare capability string.
  const token = capabilityToken(declared);
  const kind = kindOf(token);
  const value = bareValue(token);
  const obs = norm(observed);
  if (!kind || !value || !obs) return false;
  if (kind === "mcp") return matchesMcpServer(value, obs);
  // skill / agent: the observation carries the same kind prefix.
  if (!obs.startsWith(kind + ":")) return false;
  return sameName(value, bareValue(obs));
}

// Discovery (`discovered:` / `generic:`) requires an observed find-skills load. Namespace-tolerant
// so a plugin-installed find-skills satisfies it — previously this branch could not be satisfied
// at all on such a host.
export const isFindSkills = (observed) => matchesCapability("skill:find-skills", observed);
