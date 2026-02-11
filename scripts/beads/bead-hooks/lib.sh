#!/usr/bin/env bash
# lib.sh — Shared utilities for bead Discord hooks (discoclaw port).
# Config via env vars; source .env or export before calling.
set -euo pipefail

BEADS_FORUM_ID="${DISCOCLAW_BEADS_FORUM:-}"
GUILD_ID="${DISCORD_GUILD_ID:-}"
MENTION_USER_ID="${DISCOCLAW_BEADS_MENTION_USER:-}"

log() {
  echo "$*" >&2
}

require_discord_token() {
  if [[ -z "${DISCORD_TOKEN:-}" ]]; then
    log "Warning: DISCORD_TOKEN not set."
    return 1
  fi
  return 0
}

get_bead_json() {
  local bead_id="$1"
  bd show "$bead_id" --json 2>/dev/null | jq -c '.[0]' 2>/dev/null || true
}

get_thread_id() {
  local bead_json="$1"
  local ext_ref
  ext_ref=$(echo "$bead_json" | jq -r '.external_ref // empty')
  if [[ "$ext_ref" =~ ^discord:([0-9]+)$ ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo ""
  fi
}

get_emoji() {
  case "$1" in
    "open") echo "🟢" ;;
    "in_progress") echo "🟡" ;;
    "blocked") echo "⚠️" ;;
    "closed") echo "☑️" ;;
    *) echo "🟢" ;;
  esac
}

format_priority() {
  local priority="$1"
  if [[ -z "$priority" || "$priority" == "null" ]]; then
    priority="3"
  fi
  if [[ "$priority" =~ ^P ]]; then
    priority="${priority#P}"
  fi
  echo "P${priority}"
}

short_title() {
  local title="$1"
  local max_len=80

  if [[ -z "$title" || "$title" == "null" ]]; then
    title="Untitled"
  fi

  if [[ ${#title} -gt $max_len ]]; then
    echo "${title:0:$max_len}…"
  else
    echo "$title"
  fi
}

build_thread_name() {
  local bead_id="$1"
  local title="$2"
  local status="$3"

  local emoji short name
  emoji=$(get_emoji "$status")
  short=$(short_title "$title")
  local short_id="${bead_id#*-}"
  name="$emoji [$short_id] $short"

  if [[ ${#name} -gt 100 ]]; then
    name="${name:0:99}…"
  fi

  echo "$name"
}

ensure_unarchived() {
  local thread_id="$1"
  local info archived
  info=$(curl -s -H "Authorization: Bot $DISCORD_TOKEN" \
    "https://discord.com/api/v10/channels/$thread_id" 2>/dev/null)
  archived=$(echo "$info" | jq -r '.thread_metadata.archived // "false"')
  if [[ "$archived" == "true" ]]; then
    log "Thread $thread_id is archived; unarchiving for update..."
    curl -s -X PATCH "https://discord.com/api/v10/channels/$thread_id" \
      -H "Authorization: Bot $DISCORD_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"archived": false}' >/dev/null 2>&1
    sleep 0.5
    echo "was_archived"
  else
    echo "was_active"
  fi
}

truncate_message() {
  local text="$1"
  local max_len="$2"

  if [[ ${#text} -gt $max_len ]]; then
    echo "${text:0:$max_len}…"
  else
    echo "$text"
  fi
}
