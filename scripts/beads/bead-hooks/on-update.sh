#!/usr/bin/env bash
# on-update.sh — Sync updated bead details to Discord thread.
# Usage: on-update.sh <bead-id>
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib.sh"

[[ $# -lt 1 ]] && { echo "Usage: on-update.sh <bead-id>" >&2; exit 1; }

bead_id="$1"
bead_json=$(get_bead_json "$bead_id")

[[ -z "$bead_json" || "$bead_json" == "null" ]] && { log "Bead not found: $bead_id"; exit 1; }

thread_id=$(get_thread_id "$bead_json")
[[ -z "$thread_id" ]] && { log "Bead $bead_id has no Discord thread; skipping."; exit 0; }

require_discord_token || exit 0

title=$(echo "$bead_json" | jq -r '.title // "Untitled"')
status=$(echo "$bead_json" | jq -r '.status // "open"')
priority=$(format_priority "$(echo "$bead_json" | jq -r '.priority // empty')")
description=$(truncate_message "$(echo "$bead_json" | jq -r '.description // "No description"')" 1800)
thread_name=$(build_thread_name "$bead_id" "$title" "$status")

# Update thread name
name_payload=$(jq -n --arg name "$thread_name" '{name: $name}')
curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
  -H "Authorization: Bot $DISCORD_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$name_payload" >/dev/null 2>&1

# Post update message
message="**Update**
**Priority:** $priority
**Status:** $status
**Title:** $title

$description"
message_payload=$(jq -n --arg content "$message" '{content: $content}')
curl -s -X POST "https://discord.com/api/v10/channels/$thread_id/messages" \
  -H "Authorization: Bot $DISCORD_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$message_payload" >/dev/null 2>&1

log "Posted update to thread for $bead_id"
