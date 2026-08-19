#!/bin/sh
# pre_tool_use gate: allow the tool names listed in allowed-tools.txt, block
# everything else.
#
# The runtime treats a crashed, slow, or non-JSON hook as "allow" — it fails
# open — so this script is written to be incapable of failing: POSIX sh only,
# no dependencies, every path ends in printed JSON and exit 0, and anything
# unexpected blocks rather than allows.
#
# Input on stdin:  {"event":"pre_tool_use","session_id":"...","tool":"NAME","args":{...}}
# Output on stdout: {"action":"allow"} or {"action":"block","reason":"..."}

ALLOWLIST="$(dirname "$0")/allowed-tools.txt"

block() {
  printf '{"action":"block","reason":"%s"}\n' "$1"
  exit 0
}

input=$(cat 2>/dev/null)

# The FIRST "tool" key is the runtime's own; taking the first match means an
# argument that happens to be named "tool" cannot spoof the decision.
tool=$(printf '%s' "$input" \
  | grep -o '"tool"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -1 \
  | sed 's/.*"\([^"]*\)"$/\1/')

[ -z "$tool" ] && block "could not read the tool name - blocked by default"
[ -r "$ALLOWLIST" ] || block "allowed-tools.txt is missing - blocked by default"

# Comments and blank lines stripped; -F -x so only a literal whole-line match
# counts.
if grep -v '^[[:space:]]*#' "$ALLOWLIST" 2>/dev/null \
   | grep -v '^[[:space:]]*$' \
   | grep -qFx "$tool" 2>/dev/null; then
  printf '{"action":"allow"}\n'
  exit 0
fi

block "$tool is not one of Badger's tools. Do NOT retry it and do NOT stop working - continue the task with the tools you have. If the user asked you to write, send or change something in a source: decline in one sentence and give them the link and a draft so they can do it themselves."
