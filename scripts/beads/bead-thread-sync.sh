#!/bin/bash
# bead-thread-sync.sh — Sync beads with Discord threads (4-phase safety net).
# Run via cron or on-demand. Primary sync is via bd-new/bd-update/bd-close hooks.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/bead-hooks/lib.sh"

require_discord_token || exit 1
TOKEN="$DISCORD_TOKEN"
[[ -z "$BEADS_FORUM_ID" ]] && { log "DISCOCLAW_BEADS_FORUM not set"; exit 1; }

beads_json=$(bd list --json 2>/dev/null || echo "[]")

#############################################
# PART 1: Create threads for beads without them
#############################################
beads_needing_threads=$(echo "$beads_json" | jq -c '
  [.[] | select(
    .status != "closed" and
    .status != "done" and
    ((.labels // []) | map(select(. == "no-thread")) | length == 0) and
    ((.external_ref // "") | startswith("discord:") | not)
  )]
')

needs_thread_count=$(echo "$beads_needing_threads" | jq 'length')

if [ "$needs_thread_count" -gt 0 ]; then
  echo "Found $needs_thread_count beads needing threads"
  while read -r bead; do
    [ -z "$bead" ] && continue
    id=$(echo "$bead" | jq -r '.id')
    title=$(echo "$bead" | jq -r '.title')
    status=$(echo "$bead" | jq -r '.status')
    priority=$(format_priority "$(echo "$bead" | jq -r '.priority // "P3"')")
    description=$(echo "$bead" | jq -r '.description // "No description"')

    thread_name=$(build_thread_name "$id" "$title" "$status")

    message="**Priority:** $priority
**Status:** $status

$description"
    [[ -n "$MENTION_USER_ID" ]] && message="<@$MENTION_USER_ID>

$message"

    echo "  Creating thread for $id: $title"

    mention_json="[]"
    [[ -n "$MENTION_USER_ID" ]] && mention_json="[\"$MENTION_USER_ID\"]"

    payload=$(jq -n \
      --arg name "$thread_name" \
      --arg content "$message" \
      --argjson mentions "$mention_json" \
      '{name: $name, message: {content: $content, allowed_mentions: {users: $mentions}}}')
    response=$(curl -s -X POST "https://discord.com/api/v10/channels/$BEADS_FORUM_ID/threads" \
      -H "Authorization: Bot $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$payload")

    thread_id=$(echo "$response" | jq -r '.id // empty')
    if [ -n "$thread_id" ] && [ "$thread_id" != "null" ]; then
      echo "    Created thread $thread_id"
      bd update "$id" --external-ref "discord:$thread_id" 2>/dev/null || true
    else
      echo "    Failed: $(echo "$response" | jq -r '.message // "unknown error"')"
    fi
    sleep 1
  done < <(echo "$beads_needing_threads" | jq -c '.[]')
fi

#############################################
# PART 2: Fix status/label mismatches
#############################################
echo "Checking for status/label mismatches..."
while read -r bead; do
  [ -z "$bead" ] && continue
  id=$(echo "$bead" | jq -r '.id')
  labels=$(echo "$bead" | jq -r '.labels | join(", ")')
  echo "  $id: blocking label ($labels) but status=open, fixing..."
  bd update "$id" --status blocked 2>/dev/null || true
done < <(echo "$beads_json" | jq -c '.[] | select(
  .status == "open" and
  ((.labels // []) | any(test("^(waiting|blocked)-")))
)')

#############################################
# PART 3: Sync emoji status for existing threads
#############################################
echo "Checking thread emoji sync..."
updated=0
beads_json=$(bd list --json 2>/dev/null || echo "[]")

while read -r bead; do
  [ -z "$bead" ] && continue
  id=$(echo "$bead" | jq -r '.id')
  status=$(echo "$bead" | jq -r '.status')
  title=$(echo "$bead" | jq -r '.title')
  thread_id=$(echo "$bead" | jq -r '.external_ref | sub("discord:"; "")')

  expected_name=$(build_thread_name "$id" "$title" "$status")

  thread_info=$(curl -s "https://discord.com/api/v10/channels/$thread_id" \
    -H "Authorization: Bot $TOKEN" 2>/dev/null || echo '{}')
  current_name=$(echo "$thread_info" | jq -r '.name // empty')

  [ -z "$current_name" ] && continue

  if [ "$current_name" != "$expected_name" ]; then
    echo "  $id: Updating: $current_name -> $expected_name"
    was_state=$(ensure_unarchived "$thread_id")
    curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
      -H "Authorization: Bot $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"name\": $(echo "$expected_name" | jq -R .)}" >/dev/null
    if [ "$was_state" = "was_archived" ] && [ "$status" != "closed" ] && [ "$status" != "done" ]; then
      sleep 0.3
      curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
        -H "Authorization: Bot $TOKEN" -H "Content-Type: application/json" -d '{"archived": true}' >/dev/null
    fi
    ((updated++)) || true
    sleep 0.5
  fi
done < <(echo "$beads_json" | jq -c '.[] | select(.external_ref != null and (.external_ref | startswith("discord:")))')

echo "Emoji sync complete. Updated $updated thread(s)."

#############################################
# PART 4: Archive threads for closed beads
#############################################
echo "Checking for closed beads with unarchived threads..."
all_beads=$(bd list --all --json 2>/dev/null || echo "[]")
archived=0

while read -r bead; do
  [ -z "$bead" ] && continue
  id=$(echo "$bead" | jq -r '.id')
  title=$(echo "$bead" | jq -r '.title')
  thread_id=$(echo "$bead" | jq -r '.external_ref | sub("discord:"; "")')

  thread_info=$(curl -s "https://discord.com/api/v10/channels/$thread_id" \
    -H "Authorization: Bot $TOKEN" 2>/dev/null || echo '{}')
  is_archived=$(echo "$thread_info" | jq -r '.thread_metadata.archived // "false"')
  current_name=$(echo "$thread_info" | jq -r '.name // empty')

  [ -z "$current_name" ] && continue

  expected_name=$(build_thread_name "$id" "$title" "closed")

  if [ "$is_archived" != "true" ] || [ "$current_name" != "$expected_name" ]; then
    echo "  $id: Fixing closed bead thread"
    ensure_unarchived "$thread_id" >/dev/null
    curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
      -H "Authorization: Bot $TOKEN" -H "Content-Type: application/json" \
      -d "{\"name\": $(echo "$expected_name" | jq -R .)}" >/dev/null
    sleep 0.3
    curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
      -H "Authorization: Bot $TOKEN" -H "Content-Type: application/json" -d '{"archived": true}' >/dev/null
    ((archived++)) || true
    sleep 0.5
  fi
done < <(echo "$all_beads" | jq -c '.[] | select(
  (.status == "closed" or .status == "done") and
  .external_ref != null and
  (.external_ref | startswith("discord:"))
)')

echo "Archive cleanup complete. Archived $archived thread(s)."
echo "{\"needs_threads\": $needs_thread_count, \"updated_emojis\": $updated, \"archived\": $archived}"
