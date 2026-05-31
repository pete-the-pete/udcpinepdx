#!/usr/bin/env bash
# Args: $1 = full URL including ?t=<token>
set -u
URL="$1"
HOST=$(printf '%s\n' "$URL" | awk -F/ '{print $3}' | awk -F: '{print $1}')
log() { logger -t udcpine-kiosk "$*"; }

crash_streak=0
crash_window_start=0

while true; do
  # Stage 1: hostname resolves
  if ! getent hosts "$HOST" >/dev/null 2>&1; then
    log "waiting for hostname $HOST to resolve"
    until getent hosts "$HOST" >/dev/null 2>&1; do sleep 1; done
    log "hostname $HOST resolved"
  fi
  # Stage 2: backend reachable
  if ! curl -fsS --max-time 2 "http://${HOST}:5001/api/state" >/dev/null 2>&1; then
    log "waiting for backend at $HOST:5001"
    until curl -fsS --max-time 2 "http://${HOST}:5001/api/state" >/dev/null 2>&1; do
      sleep 1
    done
    log "backend reachable"
  fi
  # Stage 3: launch and block
  log "launching chromium"
  chromium --kiosk --noerrdialogs --disable-infobars --no-first-run \
    --app="$URL"
  exit_at=$(date +%s)
  # Crash-loop guard: if Chromium exits >3 times within 30s, back off 30s
  # and log once. Otherwise relaunch quietly after 2s. Keeps journald sane
  # during an OOM crash-loop on the low-RAM Pi.
  if (( exit_at - crash_window_start > 30 )); then
    crash_window_start=$exit_at
    crash_streak=1
  else
    crash_streak=$((crash_streak + 1))
  fi
  if (( crash_streak > 3 )); then
    log "chromium crash-loop ($crash_streak exits in $((exit_at - crash_window_start))s); backing off 30s"
    sleep 30
    crash_streak=0
    crash_window_start=0
  else
    sleep 2
  fi
done
