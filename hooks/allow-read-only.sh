#!/bin/sh
# pre_tool_use gate: allow only the exact tool names in allowed-tools.txt.
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
#   * Anything unexpected — unparseable input, missing allowlist, empty tool
#     name — blocks rather than allows.
#
# Input on stdin:  {"event":"pre_tool_use","session_id":"...","tool":"NAME","args":{...}}
# Output on stdout: {"action":"allow"} or {"action":"block","reason":"..."}

ALLOWLIST="$(dirname "$0")/allowed-tools.txt"

block() {
  # Keep the reason on one line and quote-free; it is interpolated into JSON.
  printf '{"action":"block","reason":"%s"}\n' "$1"
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

[ -z "$tool" ] && block "could not determine tool name from hook input - blocked by default"
[ -r "$ALLOWLIST" ] || block "allowlist file missing or unreadable - blocked by default"

# Strip comments and blank lines first, then match -F literal and -x whole-line,
# so no partial match, regex metacharacter, or empty pattern can ever match.
if grep -v '^[[:space:]]*#' "$ALLOWLIST" 2>/dev/null \
   | grep -v '^[[:space:]]*$' \
   | grep -qFx "$tool" 2>/dev/null; then
  printf '{"action":"allow"}\n'
  exit 0
fi

block "$tool is not in Badger's read-only allowlist. Badger reads and reports; it never writes. Tell the user what you would have done and give them the link so they can do it themselves."
