#!/usr/bin/env bash
# on-close.sh — Archive Discord thread and post summary for a bead.
# Usage: on-close.sh <bead-id>
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib.sh"

[[ $# -lt 1 ]] && { echo "Usage: on-close.sh <bead-id>" >&2; exit 1; }

bead_id="$1"
bead_json=$(get_bead_json "$bead_id")

[[ -z "$bead_json" || "$bead_json" == "null" ]] && { log "Bead not found: $bead_id"; exit 1; }

thread_id=$(get_thread_id "$bead_json")
[[ -z "$thread_id" ]] && { log "Bead $bead_id has no Discord thread; skipping archive."; exit 0; }

require_discord_token || exit 0

title=$(echo "$bead_json" | jq -r '.title // "Untitled"')
status=$(echo "$bead_json" | jq -r '.status // "closed"')
thread_name=$(build_thread_name "$bead_id" "$title" "$status")

summary=$(echo "$bead_json" | jq -r '.close_reason // empty')
[[ -z "$summary" || "$summary" == "null" ]] && summary="Bead closed."
summary=$(truncate_message "$summary" 1800)
message=$'✅ **Closed**\n'"$summary"

ensure_unarchived "$thread_id" >/dev/null

# Post close summary
message_payload=$(jq -n --arg content "$message" '{content: $content}')
curl -s -X POST "https://discord.com/api/v10/channels/$thread_id/messages" \
  -H "Authorization: Bot $DISCORD_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$message_payload" >/dev/null 2>&1

# Rename (separate from archive to avoid silent skip)
rename_payload=$(jq -n --arg name "$thread_name" '{name: $name}')
curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
  -H "Authorization: Bot $DISCORD_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$rename_payload" >/dev/null

sleep 0.3

# Archive
archive_response=$(curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
  -H "Authorization: Bot $DISCORD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"archived": true}')

if echo "$archive_response" | jq -e '.thread_metadata.archived == true' >/dev/null 2>&1; then
  log "Archived thread for $bead_id"
else
  err=$(echo "$archive_response" | jq -r '.message // empty')
  log "Failed to archive thread for $bead_id: ${err:-unknown error}"
  exit 1
fi
