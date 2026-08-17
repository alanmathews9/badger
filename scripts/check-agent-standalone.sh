#!/bin/sh
# Prove that Badger is still an agent-shaped git repo.
#
# The thesis of GAP is that the agent IS a git repo: agent.yaml, SOUL.md,
# RULES.md, skills/, tools/, hooks/. Badger also ships a product on top of it —
# a server and a web UI under app/ — and the risk of keeping both in one
# repository is that the boundary quietly rots until the agent can no longer be
# cloned and run on its own.
#
# So this does not assert the boundary, it tests it, twice:
#
#   1. statically — nothing under the agent may reference app/
#   2. dynamically — copy ONLY the agent files somewhere else and run a tool
#
# The dependency is meant to be strictly one-way. app/ reaches up into tools/;
# nothing reaches down into app/.
#
#   npm run check:agent
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

# Everything the GAP runtime reads. If this list grows, the agent grew.
#
# memory/ is in here because the spec puts it there: the `standard` profile is
# RULES.md, skills/, knowledge/, memory/, tools/. `memory` is also in the
# allowlist both callers pass, so it is a live capability, not scaffolding.
AGENT="agent.yaml SOUL.md RULES.md skills tools hooks memory"

fail() {
  printf '  ✗ %s\n' "$1"
  exit 1
}

printf 'checking the agent/product boundary in %s\n\n' "$ROOT"

# ── 1. Static: the agent must not know the product exists ──────────────────
printf '1. no agent file references app/\n'
if grep -rn --exclude-dir=node_modules -e '\.\./app/' -e '"app/' -e "'app/" $AGENT 2>/dev/null; then
  fail "an agent file reaches into app/ — the dependency must point the other way"
fi
printf '  ok — nothing under %s mentions app/\n\n' "$(echo $AGENT | tr ' ' ',')"

# ── 2. Dynamic: the agent must run with the product deleted ────────────────
printf '2. the agent runs with app/ absent\n'
SANDBOX=$(mktemp -d)
trap 'rm -rf "$SANDBOX"' EXIT

for path in $AGENT; do
  [ -e "$path" ] || fail "missing agent file: $path"
  cp -R "$path" "$SANDBOX/"
done
[ -f .env ] && cp .env "$SANDBOX/"

# node_modules is symlinked, not copied — it is large and this is read-only.
#
# It is also the reason the repository has a package.json at the root at all.
# tools/scripts/_github.mjs imports @composio/core, so the AGENT itself has an
# npm dependency; that manifest serves the whole repo rather than belonging to
# app/. An agent with `runtime: node` tools cannot avoid this, and it is why
# node_modules at the root is not product spill.
ln -s "$ROOT/node_modules" "$SANDBOX/node_modules"

if [ -e "$SANDBOX/app" ]; then
  fail "app/ leaked into the agent-only copy"
fi

OUT=$(echo '{"query":"halden","kind":"issue","limit":1}' | node "$SANDBOX/tools/scripts/search.mjs" 2>&1) || true

case "$OUT" in
  *"match(es)"*)
    printf '  ok — github_search returned results with no app/ present\n\n'
    ;;
  *"ERROR"*|*"No matches"*)
    # A credentials or network failure is not a boundary failure. Say which.
    printf '  ! the tool ran but did not retrieve:\n'
    printf '%s\n' "$OUT" | sed 's/^/      /' | head -4
    printf '  the boundary holds (it loaded and executed); the failure is elsewhere\n\n'
    ;;
  *)
    printf '%s\n' "$OUT" | sed 's/^/      /' | head -6
    fail "the agent could not run without app/"
    ;;
esac

printf 'the agent stands alone. app/ is a consumer, not a component.\n'
