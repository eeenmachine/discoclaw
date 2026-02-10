#!/usr/bin/env bash
# bd-update.sh — Update bead(s) and trigger Discord hook scripts.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK_STATUS="$SCRIPT_DIR/bead-hooks/on-status-change.sh"
HOOK_UPDATE="$SCRIPT_DIR/bead-hooks/on-update.sh"

BEAD_IDS=()
STATUS_CHANGE=0
UPDATE_CHANGE=0

for arg in "$@"; do
  case "$arg" in
    --status|-s|--status=*|--claim) STATUS_CHANGE=1 ;;
    --priority|-p|--priority=*|--description|-d|--description=*|--body-file|--body-file=*|--title|--title=*) UPDATE_CHANGE=1 ;;
  esac
  [[ "$arg" =~ ^[a-z]+-[a-z0-9]+$ ]] && BEAD_IDS+=("$arg")
done

bd update "$@" || exit $?

[[ ${#BEAD_IDS[@]} -eq 0 ]] && exit 0

for bead_id in "${BEAD_IDS[@]}"; do
  [[ $STATUS_CHANGE -eq 1 && -x "$HOOK_STATUS" ]] && "$HOOK_STATUS" "$bead_id" || true
  [[ $UPDATE_CHANGE -eq 1 && -x "$HOOK_UPDATE" ]] && "$HOOK_UPDATE" "$bead_id" || true
done
