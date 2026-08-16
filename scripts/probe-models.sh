#!/usr/bin/env bash
# Probe which Gemini models the current GEMINI_API_KEY can actually call.
#
# Being in the runtime's model registry and being callable by your key are
# independent facts, and the registry is stale relative to what Google serves.
# Run this whenever the key, the project, or the billing tier changes.
#
#   ./scripts/probe-models.sh
#
# Reads the key from .env the same way the runtime does. Never prints it.

set -u
cd "$(dirname "$0")/.." || exit 1

MODELS=(
  gemini-3-flash-preview
  gemini-flash-latest
  gemini-flash-lite-latest
  gemini-2.5-pro
  gemini-2.5-flash
  gemini-3-pro-preview
  gemini-3.1-pro-preview
  gemini-2.0-flash
)

printf '%-26s %s\n' "MODEL" "RESULT"
printf '%-26s %s\n' "--------------------------" "------"

for m in "${MODELS[@]}"; do
  printf '%-26s ' "$m"
  out=$(gitagent -d . -m "google:$m" -p "say OK" 2>&1)

  if echo "$out" | grep -q '"code":404'; then
    echo "unavailable (404 — closed to this key)"
  elif echo "$out" | grep -q '"code":429'; then
    if echo "$out" | grep -q 'limit: 0'; then
      echo "quota 0 (429 — tier gets none; needs billing)"
    else
      echo "rate limited (429 — retry)"
    fi
  elif echo "$out" | grep -q '"code":400'; then
    echo "bad request (400)"
  elif echo "$out" | grep -qi 'API key not valid'; then
    echo "key rejected"
  elif echo "$out" | grep -qE '"code":[0-9]+'; then
    echo "error $(echo "$out" | grep -oE '"code":[0-9]+' | head -1)"
  else
    echo "WORKS"
  fi
done

echo
echo "Put the best WORKS result in agent.yaml as model.preferred,"
echo "with the next one as fallback. Keep the \"google:\" prefix."
