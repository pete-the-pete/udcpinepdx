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
  # Stage 2: backend reachable.
  # Probe the SPA root (/), not /api/* — every /api/* route requires auth
  # and 401s on a fresh launcher boot, which would loop forever under
  # `curl -f`. `make serve` always builds the SPA before starting Flask,
  # so / returning 200 is the right "ready to hand a URL to Chromium" signal.
  if ! curl -fsS --max-time 2 "http://${HOST}:5001/" >/dev/null 2>&1; then
    log "waiting for backend at $HOST:5001"
    until curl -fsS --max-time 2 "http://${HOST}:5001/" >/dev/null 2>&1; do
      sleep 1
    done
    log "backend reachable"
  fi
  # Stage 3: launch and block
  log "launching chromium"
  # Ephemeral profile: a fresh --user-data-dir every launch. Keeps the profile
  # small (no accumulated cache) on the low-RAM board and means a Chromium
  # upgrade can never leave a stale per-profile cache behind. Wiped *before*
  # launch so it self-heals even if the script was killed mid-run.
  profile=/tmp/udcpine-kiosk-profile
  rm -rf "$profile"
  # Flags tuned for a low-RAM board (Pi Zero 2 W, 512 MB) running desktop
  # Chromium in kiosk mode. See plans/ops/2026-06-10-pi-kiosk-low-ram-gpu.md.
  #   --no-memcheck : Raspberry Pi OS wraps chromium in a script that pops a
  #     blocking "not recommended … less than 1GB of RAM" dialog on every
  #     launch. In --kiosk nobody can click "Launch anyway", so the browser
  #     never navigates and the screen stays blank white. This skips it.
  #   --single-process : THE fix for the Chromium-149 blank-white kiosk. The
  #     board is too slow to wire up Chromium's multi-process architecture
  #     within its internal 15 s child-process IPC timeout: at cold boot the
  #     network-service child times out waiting for a Mojo connection from the
  #     browser and self-terminates ("Terminating ... after 15 seconds with no
  #     connection" → "Network service crashed or was terminated"), which kills
  #     the in-flight --app navigation and leaves a permanent blank page. One
  #     process means no IPC handshake and nothing to time out; the boot nav
  #     commits every time. Fine for a single static dashboard, and lighter on
  #     RAM. (The crash-loop guard below is the backstop if the one process
  #     dies.)
  #   --disable-gpu : force software rendering. The board's hardware EGL/GLES
  #     path is unreliable across Chromium upgrades and isn't needed for this
  #     near-static dashboard. (Plain software rendering is enough — no
  #     SwiftShader/ANGLE override required once --single-process is in play.)
  #   --password-store=basic : do NOT use the GNOME login keyring (Secret
  #     Service) for Chromium's "Safe Storage" key. On a fresh profile Chromium
  #     asks gnome-keyring to unlock the password-protected login keyring and
  #     pops a modal unlock dialog — a prompt on every boot (and a block if no
  #     keyboard is attached). basic keeps the key in a file in the profile
  #     instead. Acceptable here: the kiosk stores only a LAN session cookie,
  #     and the profile is ephemeral (wiped every boot) anyway.
  #   --disable-background-networking / --disable-component-update : a kiosk on
  #     one LAN dashboard needs none of Chromium's first-run traffic (component
  #     downloads, update pings, optimization-guide fetches). Disabling it
  #     removes that startup storm and saves RAM/CPU/SD churn on the low-RAM
  #     board.
  #   --user-data-dir : the ephemeral profile described above.
  #
  # Redirect Chromium's stdout/stderr to /dev/null: inherited from the labwc
  # autostart those fds are an undrained pipe, and a chatty Chromium can block
  # on a full write buffer. /dev/null never blocks. (Swap for a real file when
  # debugging.)
  chromium --no-memcheck --disable-gpu \
    --single-process \
    --disable-background-networking --disable-component-update \
    --password-store=basic \
    --user-data-dir="$profile" \
    --kiosk --noerrdialogs --disable-infobars --no-first-run \
    --app="$URL" >/dev/null 2>&1
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
