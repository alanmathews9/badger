#!/bin/sh
# on_session_start gate: refuse to start if a declared source has no credential.
#
# Why this exists. gitagent's MCP setup is fail-soft: a server that cannot
# connect logs `[mcp:<name>] failed to connect ... skipping` to stderr and the
# agent starts anyway, minus that source. The model is never told. For a
# federated search agent that is a correctness bug, not an inconvenience —
# Badger would answer "nothing on GitHub mentions this" having never reached
# GitHub, and the user would believe it.
#
# Observed for real: with GITHUB_TOKEN empty, ${VAR} interpolation substitutes
# an empty string, github-mcp-server exits with "authentication required", and
# the run continued with zero sources and no visible sign.
#
# So this fails closed. If agent.yaml declares a source, its credential must be
# present and non-empty, or the session does not start. Refusing is always
# better than answering blind. To run with fewer sources, comment the server
# out of agent.yaml AND its line in required-env.txt — deliberately, in both
# places.
#
# Same constraints as the pre_tool_use hook: POSIX sh, no dependencies, always
# exits 0 with valid JSON, because the runtime treats any other outcome as
# "allow" (see NOTES.md §3).

REQUIRED="$(dirname "$0")/required-env.txt"

block() {
  printf '{"action":"block","reason":"%s"}\n' "$1"
  exit 0
}

# No manifest of requirements means nothing to check. Unlike the tool
# allowlist, an absent file here is not a security hole — a missing source
# still cannot leak anything — so allow rather than deadlock the agent.
[ -r "$REQUIRED" ] || { printf '{"action":"allow"}\n'; exit 0; }

missing=""
while IFS= read -r line; do
  case "$line" in
    ''|\#*) continue ;;
  esac

  source_name=${line%%=*}
  var_name=${line#*=}
  [ -z "$source_name" ] || [ -z "$var_name" ] && continue

  # Indirect expansion, POSIX-safe (no ${!var}).
  value=$(eval "printf '%s' \"\${$var_name:-}\"")

  if [ -z "$value" ]; then
    missing="$missing $source_name ($var_name)"
  fi
done < "$REQUIRED"

if [ -n "$missing" ]; then
  block "Declared sources are missing credentials:$missing. The runtime would skip them silently and Badger would report empty results as though it had searched. Set them in .env, or comment the source out of both agent.yaml and hooks/required-env.txt."
fi

printf '{"action":"allow"}\n'
exit 0
