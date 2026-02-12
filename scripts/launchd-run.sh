#!/usr/bin/env bash
# launchd wrapper for DiscoClaw
# Sources .env, sets PATH, then runs the built bot.

set -euo pipefail

DISCOCLAW_DIR="$HOME/discoclaw"
cd "$DISCOCLAW_DIR"

# Source .env (export all vars)
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Ensure node + claude are on PATH
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

exec node dist/index.js
