#!/usr/bin/env bash
# bd-wrapper.sh — Intercept bd commands and route through hook-aware scripts.
# Install: alias bd="$DISCOCLAW_DIR/scripts/beads/bd-wrapper.sh"
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REAL_BD=$(command -v bd)

[[ $# -eq 0 ]] && exec "$REAL_BD"

subcommand="$1"
shift

case "$subcommand" in
  create|new)  exec "$SCRIPT_DIR/bd-new.sh" "$@" ;;
  q)           exec "$SCRIPT_DIR/bd-quick.sh" "$@" ;;
  close)       exec "$SCRIPT_DIR/bd-close-archive.sh" "$@" ;;
  update)      exec "$SCRIPT_DIR/bd-update.sh" "$@" ;;
  *)           exec "$REAL_BD" "$subcommand" "$@" ;;
esac
