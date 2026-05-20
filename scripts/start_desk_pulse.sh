#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/electron_app"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/desk_pulse.pid"
LOG_FILE="$RUN_DIR/desk_pulse.log"
ELECTRON_BIN="$ROOT_DIR/node_modules/.bin/electron"

mkdir -p "$RUN_DIR"

if [[ -f "$PID_FILE" ]]; then
  old_pid="$(cat "$PID_FILE")"
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "Desk Pulse is already running. PID: $old_pid"
    echo "Log: $LOG_FILE"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if pgrep -f "$APP_DIR" >/dev/null 2>&1; then
  echo "Desk Pulse is already running. PID file was missing."
  pgrep -f "$APP_DIR" | head -n 1 > "$PID_FILE"
  echo "PID: $(cat "$PID_FILE")"
  echo "Log: $LOG_FILE"
  exit 0
fi

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Electron is not installed. Run this first:"
  echo "  cd \"$ROOT_DIR\" && npm install"
  exit 1
fi

cd "$APP_DIR"
nohup "$ELECTRON_BIN" "$APP_DIR" >>"$LOG_FILE" 2>&1 &
pid="$!"
echo "$pid" > "$PID_FILE"

echo "Desk Pulse started. PID: $pid"
echo "Log: $LOG_FILE"
