// spawn.mjs — shared spawn-result classification for external-CLI calls.
//
// Lifted out of consult.mjs (was module-local, so judge.mjs never got the fix and treated a
// spurious EPIPE as fatal — audit LOW/judge-EPIPE). A child that exits 0 with usable output must
// not be lost to an EPIPE on its stdin: EPIPE alone falls through to the status/stdout checks.
//
//   res.status === null  -> killed by signal / never ran            -> fatal
//   res.error is EPIPE    -> child likely still produced output       -> NOT fatal (let caller read)
//   res.error otherwise   -> real spawn failure                        -> fatal
export function isFatalSpawnError(res) {
  if (res.status === null) return true;
  if (!res.error) return false;
  return res.error.code !== "EPIPE";
}
