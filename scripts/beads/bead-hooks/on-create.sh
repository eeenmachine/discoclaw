#!/usr/bin/env bash
# on-create.sh — Create Discord thread for a bead.
# Usage: on-create.sh <bead-id> [--tags tag1,tag2]
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source "$SCRIPT_DIR/lib.sh"

if [[ $# -lt 1 ]]; then
  echo "Usage: on-create.sh <bead-id> [--tags tag1,tag2]" >&2
  exit 1
fi

bead_id="$1"; shift
tags_arg=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tags) tags_arg="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

bead_json=$(get_bead_json "$bead_id")
if [[ -z "$bead_json" || "$bead_json" == "null" ]]; then
  log "Bead not found: $bead_id"; exit 1
fi

has_no_thread=$(echo "$bead_json" | jq -r '(.labels // []) | index("no-thread") != null')
if [[ "$has_no_thread" == "true" ]]; then
  log "Bead $bead_id has label no-thread; skipping."; exit 0
fi

thread_id=$(get_thread_id "$bead_json")
if [[ -n "$thread_id" ]]; then
  log "Bead $bead_id already linked to thread $thread_id."; exit 0
fi

require_discord_token || exit 0
[[ -z "$BEADS_FORUM_ID" ]] && { log "DISCOCLAW_BEADS_FORUM not set"; exit 1; }

title=$(echo "$bead_json" | jq -r '.title // "Untitled"')
status=$(echo "$bead_json" | jq -r '.status // "open"')
priority=$(format_priority "$(echo "$bead_json" | jq -r '.priority // empty')")
description=$(truncate_message "$(echo "$bead_json" | jq -r '.description // "No description"')" 1800)
thread_name=$(build_thread_name "$bead_id" "$title" "$status")

message="**Priority:** $priority
**Status:** $status

$description"
[[ -n "$MENTION_USER_ID" ]] && message="<@$MENTION_USER_ID>

$message"

# --- Tag resolution ---
TAG_MAP="$SCRIPT_DIR/tag-map.json"
applied_tag_ids="[]"

if [[ -z "$tags_arg" && -x "$SCRIPT_DIR/auto-tag.sh" ]]; then
  full_desc=$(echo "$bead_json" | jq -r '.description // ""')
  tags_arg=$("$SCRIPT_DIR/auto-tag.sh" "$title" "$full_desc" 2>/dev/null) || tags_arg=""
  [[ -n "$tags_arg" ]] && log "Auto-tagged $bead_id: $tags_arg"
fi

if [[ -n "$tags_arg" && -f "$TAG_MAP" ]]; then
  tag_ids=()
  IFS=',' read -ra tag_names <<< "$tags_arg"
  for tag_name in "${tag_names[@]}"; do
    tag_name=$(echo "$tag_name" | tr -d '[:space:]')
    tag_id=$(jq -r --arg t "$tag_name" '.[$t] // empty' "$TAG_MAP" 2>/dev/null)
    [[ -n "$tag_id" ]] && tag_ids+=("$tag_id") || log "Warning: Unknown tag '$tag_name'"
  done
  if [[ ${#tag_ids[@]} -gt 0 ]]; then
    applied_tag_ids=$(printf '%s\n' "${tag_ids[@]}" | head -5 | jq -R . | jq -s .)
  fi
fi

mention_json="[]"
[[ -n "$MENTION_USER_ID" ]] && mention_json="[\"$MENTION_USER_ID\"]"

payload=$(jq -n \
  --arg name "$thread_name" \
  --arg content "$message" \
  --argjson mentions "$mention_json" \
  --argjson tags "$applied_tag_ids" \
  '{name: $name, message: {content: $content, allowed_mentions: {users: $mentions}}} + (if ($tags | length) > 0 then {applied_tags: $tags} else {} end)')

response=$(curl -s -X POST "https://discord.com/api/v10/channels/$BEADS_FORUM_ID/threads" \
  -H "Authorization: Bot $DISCORD_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$payload")

thread_id=$(echo "$response" | jq -r '.id // empty')
if [[ -n "$thread_id" && "$thread_id" != "null" ]]; then
  bd update "$bead_id" --external-ref "discord:$thread_id" >/dev/null 2>&1 || true
  log "Created thread $thread_id for $bead_id"
  if [[ -n "$tags_arg" ]]; then
    IFS=',' read -ra tag_names <<< "$tags_arg"
    for tag_name in "${tag_names[@]}"; do
      tag_name=$(echo "$tag_name" | tr -d '[:space:]')
      bd label add "$bead_id" "tag:$tag_name" >/dev/null 2>&1 || true
    done
  fi
else
  err=$(echo "$response" | jq -r '.message // empty')
  log "Failed to create thread for $bead_id: ${err:-unknown error}"
  exit 1
fi
