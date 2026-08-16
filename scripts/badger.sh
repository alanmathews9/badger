#!/usr/bin/env bash
# Run Badger without letting the runtime litter the history.
#
# gitagent auto-commits on every invocation and there is no flag to stop it:
#   - ensureRepo()       "Scaffold gitagent agent" / "Initial commit"
#   - the voice web UI   "auto-save before new chat"
# Nine of those accumulated in one session. By phase 3 it would be ninety.
#
# This wrapper records HEAD, runs gitagent, then collapses any commits the
# runtime made back into the working tree with a SOFT reset — no file content
# is ever discarded, the changes simply become staged again so a human writes
# the real commit message.
#
# It deliberately does NOT touch commits made by the `memory` or `skill_learner`
# tools: those carry meaningful messages and are part of the agent's history.
# If any unrecognised commit appears, the wrapper leaves everything alone and
# says so.
#
#   ./scripts/badger.sh                 # REPL
#   ./scripts/badger.sh -p "question"   # single shot
#   ./scripts/badger.sh --voice         # web UI on :3333

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# Commit subjects the runtime generates on its own. Anything else is real work.
is_runtime_noise() {
  case "$1" in
    "Scaffold gitagent agent"|"Initial commit"|"auto-save before new chat") return 0 ;;
    *) return 1 ;;
  esac
}

before=$(git rev-parse HEAD 2>/dev/null) || {
  echo "not a git repo — running without commit protection" >&2
  exec gitagent -d . "$@"
}

gitagent -d . "$@"
status=$?

after=$(git rev-parse HEAD 2>/dev/null)
[ "$before" = "$after" ] && exit $status

# Inspect every commit the run produced.
noise_count=0
keep_count=0
while IFS= read -r subject; do
  if is_runtime_noise "$subject"; then
    noise_count=$((noise_count + 1))
  else
    keep_count=$((keep_count + 1))
    echo "  keeping: $subject" >&2
  fi
done < <(git log --format=%s "$before..$after")

if [ "$keep_count" -gt 0 ]; then
  echo "" >&2
  echo "$keep_count meaningful commit(s) in this run — history left untouched." >&2
  echo "Review with: git log --oneline $before..HEAD" >&2
  exit $status
fi

if [ "$noise_count" -gt 0 ]; then
  git reset --soft "$before"
  echo "" >&2
  echo "Collapsed $noise_count runtime auto-commit(s). Your changes are staged," >&2
  echo "not lost — commit them with a real message when you're ready:" >&2
  echo "  git status" >&2
fi

exit $status
