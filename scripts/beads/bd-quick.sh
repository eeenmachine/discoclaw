#!/bin/bash
# bd-quick.sh — Quick capture bead + auto Discord thread.
# Usage: bd-quick.sh "title" [--priority P2] [--tags tag1,tag2]
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK_SCRIPT="$SCRIPT_DIR/bead-hooks/on-create.sh"
REAL_BD=$(command -v bd)

bd_args=()
tags_arg=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tags) tags_arg="${2:-}"; shift 2 ;;
    *) bd_args+=("$1"); shift ;;
  esac
done

bead_id=$("$REAL_BD" q "${bd_args[@]}" 2>&1)

if [[ ! "$bead_id" =~ ^[a-z]+-[a-z0-9]+$ ]]; then
  echo "$bead_id" >&2
  exit 1
fi

echo "$bead_id"

if [[ -x "$HOOK_SCRIPT" ]]; then
  hook_args=("$bead_id")
  [[ -n "$tags_arg" ]] && hook_args+=(--tags "$tags_arg")
  "$HOOK_SCRIPT" "${hook_args[@]}" || echo "Warning: Thread creation failed for $bead_id" >&2
fi
