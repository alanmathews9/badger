#!/bin/sh
# pre_tool_use gate: block the exact tool names in blocked-tools.txt, allow
# everything else — the runtime's builtins included.
#
# This is the inverse of the allowlist that lived here before 2026-08-19. The
# posture changed with the decision to run the framework unconstrained: the
# agent's whole tool surface is open by default, and this list names only the
# things it must never do — write to a source. A tool not on the list runs.
#
# The runtime FAILS OPEN in three separate ways — a non-zero exit, a crash, a
# 10s timeout, or any non-JSON on stdout all get treated as "allow"
# (dist/hooks.js: "Hook errors don't block execution by default"). So this
# script is written to be incapable of failing:
#
#   * POSIX sh only. No jq, no bash-isms, nothing that might be missing on a
#     bare VPS. jq in particular is NOT safe to depend on here — if it were
#     absent, every tool call would be permitted.
#   * Every path ends in a printed JSON object and exit 0.
#
# One asymmetry worth knowing, inherent to a blocklist: a name that cannot be
# parsed or a missing list file now ALLOWS (the default is open), where the
# allowlist blocked. The real write protection for sources therefore lives a
# layer down, in tools/scripts/ — the Composio session enables read-only
# actions and the tool scripts can call nothing else. This hook is the second
# net, and the place a deliberate write capability would be carved out of
# when capability phase 3 arrives.
#
# Input on stdin:  {"event":"pre_tool_use","session_id":"...","tool":"NAME","args":{...}}
# Output on stdout: {"action":"allow"} or {"action":"block","reason":"..."}

BLOCKLIST="$(dirname "$0")/blocked-tools.txt"

allow() {
  printf '{"action":"allow"}\n'
  exit 0
}

input=$(cat 2>/dev/null)

# Extract the FIRST "tool" key. It is emitted before "args" (hooks.js builds
# the object in that order), so taking the first match means a caller cannot
# spoof the decision by passing an argument that happens to be named "tool".
tool=$(printf '%s' "$input" \
  | grep -o '"tool"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -1 \
  | sed 's/.*"\([^"]*\)"$/\1/')

# Open by default: no name recovered or no list means nothing to block on.
[ -z "$tool" ] && allow
[ -r "$BLOCKLIST" ] || allow

# Strip comments and blank lines first, then match -F literal and -x whole-line,
# so no partial match, regex metacharacter, or empty pattern can ever match.
if grep -v '^[[:space:]]*#' "$BLOCKLIST" 2>/dev/null \
   | grep -v '^[[:space:]]*$' \
   | grep -qFx "$tool" 2>/dev/null; then
  printf '{"action":"block","reason":"%s"}\n' \
    "$tool writes to a source, and Badger reads sources without changing them. Do NOT retry it and do NOT stop working. Continue the task with your other tools. If the user actually asked you to write, send or change something: decline in one sentence and give them the link and the draft so they can do it themselves."
  exit 0
fi

allow
