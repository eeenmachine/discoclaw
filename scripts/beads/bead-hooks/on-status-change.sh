#!/usr/bin/env bash
# on-status-change.sh — Update Discord thread emoji/name for a bead.
# Usage: on-status-change.sh <bead-id>
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib.sh"

[[ $# -lt 1 ]] && { echo "Usage: on-status-change.sh <bead-id>" >&2; exit 1; }

bead_id="$1"
bead_json=$(get_bead_json "$bead_id")

[[ -z "$bead_json" || "$bead_json" == "null" ]] && { log "Bead not found: $bead_id"; exit 1; }

thread_id=$(get_thread_id "$bead_json")
[[ -z "$thread_id" ]] && { log "Bead $bead_id has no Discord thread; skipping."; exit 0; }

require_discord_token || exit 0

title=$(echo "$bead_json" | jq -r '.title // "Untitled"')
status=$(echo "$bead_json" | jq -r '.status // "open"')
thread_name=$(build_thread_name "$bead_id" "$title" "$status")

was_state=$(ensure_unarchived "$thread_id")

payload=$(jq -n --arg name "$thread_name" '{name: $name}')
response=$(curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
  -H "Authorization: Bot $DISCORD_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$payload")

if echo "$response" | jq -e '.id' >/dev/null 2>&1; then
  log "Updated thread name for $bead_id"
else
  err=$(echo "$response" | jq -r '.message // empty')
  log "Failed to update thread name for $bead_id: ${err:-unknown error}"
  [[ "$was_state" == "was_archived" ]] && curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
    -H "Authorization: Bot $DISCORD_TOKEN" -H "Content-Type: application/json" -d '{"archived": true}' >/dev/null 2>&1
  exit 1
fi

# Re-archive if it was archived before (and status isn't active)
if [[ "$was_state" == "was_archived" && "$status" != "open" && "$status" != "in_progress" ]]; then
  curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
    -H "Authorization: Bot $DISCORD_TOKEN" -H "Content-Type: application/json" -d '{"archived": true}' >/dev/null 2>&1
  log "Re-archived thread for $bead_id"
fi
