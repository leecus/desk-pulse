#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/electron_app"
RUN_DIR="$ROOT_DIR/.run"
PID_FILE="$RUN_DIR/desk_pulse.pid"

stop_pid() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi

  kill "$pid" 2>/dev/null || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.2
  done

  kill -TERM "$pid" 2>/dev/null || true
  return 0
}

stopped=0

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE")"
  if stop_pid "$pid"; then
    stopped=1
  fi
fi

if pgrep -f "$APP_DIR" >/dev/null 2>&1; then
  pkill -TERM -f "$APP_DIR" 2>/dev/null || true
  for _ in {1..20}; do
    if ! pgrep -f "$APP_DIR" >/dev/null 2>&1; then
      stopped=1
      break
    fi
    sleep 0.2
  done
  if pgrep -f "$APP_DIR" >/dev/null 2>&1; then
    pkill -KILL -f "$APP_DIR" 2>/dev/null || true
    stopped=1
  fi
fi

rm -f "$PID_FILE"

if [[ "$stopped" -eq 1 ]]; then
  echo "Desk Pulse stopped."
else
  echo "Desk Pulse is not running."
fi
