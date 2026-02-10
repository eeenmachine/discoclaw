#!/bin/bash
# bd-new.sh — Create a bead AND its Discord thread atomically.
# Usage: bd-new.sh [bd new arguments...] [--tags tag1,tag2]
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK_SCRIPT="$SCRIPT_DIR/bead-hooks/on-create.sh"
GUILD_ID="${DISCORD_GUILD_ID:-}"

# Extract --tags from args (pass everything else to bd new)
bd_args=()
tags_arg=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tags) tags_arg="${2:-}"; shift 2 ;;
    *) bd_args+=("$1"); shift ;;
  esac
done

output=$(bd new "${bd_args[@]}" --json 2>&1)
bead_id=$(echo "$output" | jq -r ".id // empty" 2>/dev/null | head -1)

if [[ -z "$bead_id" ]]; then
  echo "Failed to create bead or parse bead ID" >&2
  echo "$output" >&2
  exit 1
fi

title=$(echo "$output" | jq -r '.title // "Untitled"')

if [[ -x "$HOOK_SCRIPT" ]]; then
  hook_args=("$bead_id")
  [[ -n "$tags_arg" ]] && hook_args+=(--tags "$tags_arg")
  "$HOOK_SCRIPT" "${hook_args[@]}" || echo "Warning: Discord thread creation failed for $bead_id" >&2
else
  echo "Warning: Hook script not found: $HOOK_SCRIPT" >&2
fi

thread_ref=$(bd show "$bead_id" --json 2>/dev/null | jq -r '.[0].external_ref // empty')
if [[ "$thread_ref" =~ ^discord:([0-9]+)$ && -n "$GUILD_ID" ]]; then
  thread_id="${BASH_REMATCH[1]}"
  echo "Created bead $bead_id with Discord thread"
  echo "  Title: $title"
  [[ -n "$tags_arg" ]] && echo "  Tags: $tags_arg"
  echo "  Thread: https://discord.com/channels/$GUILD_ID/$thread_id"
else
  echo "Created bead $bead_id (thread creation pending)"
  echo "  Title: $title"
fi
