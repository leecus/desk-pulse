#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/electron_app"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/desk_pulse.pid"
LOG_FILE="$RUN_DIR/desk_pulse.log"

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
else
  pid=""
fi

if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
  echo "Desk Pulse is running. PID: $pid"
  echo "Log: $LOG_FILE"
elif pgrep -f "$APP_DIR" >/dev/null 2>&1; then
  echo "Desk Pulse is running. PID file is missing or stale."
  pgrep -f "$APP_DIR" | sed 's/^/PID: /'
  echo "Log: $LOG_FILE"
else
  echo "Desk Pulse is not running."
  echo "Log: $LOG_FILE"
fi
