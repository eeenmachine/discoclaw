#!/usr/bin/env bash
# bd-close-archive.sh — Close beads and archive their Discord forum threads.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK_SCRIPT="$SCRIPT_DIR/bead-hooks/on-close.sh"

BEAD_IDS=()
for arg in "$@"; do
  [[ "$arg" == -* ]] && continue
  [[ "$arg" =~ ^[a-z]+-[a-z0-9]+$ ]] && BEAD_IDS+=("$arg")
done

echo "Closing bead(s)..."
bd close "$@"
CLOSE_STATUS=$?
[[ $CLOSE_STATUS -ne 0 ]] && exit $CLOSE_STATUS

if [[ -x "$HOOK_SCRIPT" ]]; then
  for bead_id in "${BEAD_IDS[@]}"; do
    "$HOOK_SCRIPT" "$bead_id" || echo "Warning: Failed to archive Discord thread for $bead_id" >&2
  done
else
  echo "Warning: Hook script not found: $HOOK_SCRIPT" >&2
fi
echo "Done!"
