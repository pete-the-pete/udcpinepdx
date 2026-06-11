# Pi boot-to-kiosk (auto-launch dashboard on startup)

> Status: APPROVED design — ready to be decomposed into an implementation plan.

## Context

The laptop-as-server path is done (`plans/2026-05-27-pi-browser-lan.md`, PR
#45): the Pi can load the dashboard at `http://<laptop>:5001/?t=<token>`.
Today that's manual — someone opens Chromium on the Pi and types a URL.
This plan makes the Pi boot straight into a fullscreen Chromium kiosk
pointed at that URL, so a power-cycle brings the dashboard back unattended
(no keyboard, no mouse, no touchscreen taps required).

Reference: YouTube "Launch a webpage or autoplay video on startup —
Raspberry Pi Kiosk / Fake Window" (https://www.youtube.com/watch?v=8KV3KGiNFMw).

### Confirmed live state (verified this session)

- Pi runs **Debian 13 trixie**, kernel 6.12, aarch64, on `mrgrumpy.local`.
- Image is **Pi OS Desktop** — both `labwc` (Wayland) and the legacy
  LXDE/openbox/lxsession stack are installed, and trixie defaults to a
  labwc/Wayland session for the autologin user.
- `mrgrumpy` is auto-logged-in on seat0 (`getty@tty1` drop-in
  `autologin.conf`); the session reports `Type=wayland`, `Active=yes`.
- `/usr/bin/chromium` is present and works (with a "less than 1GB RAM"
  warning we acknowledge but accept).
- Display HDMI-A-1 is connected; a **WaveShare WS170120 touchscreen** is
  attached, with mouse-emulation mapping already configured in the user's
  `~/.config/labwc/rc.xml`. Touch input goes to the dashboard for free.
- `wlopm`, `wlr-randr`, `kanshi`, `swayidle` are all installed but **no
  idle daemon is running** — labwc by itself never blanks the display.
- Pi → Mac mDNS resolution to `Lawljegrens-M1.local` generally works but
  *did hiccup once mid-session*, so the design must tolerate startup races
  where DNS isn't ready yet.
- Backend's bootstrap token is **reusable**
  (`web/backend/src/udcpine_backend/app.py:75-78` —
  `bootstrap = os.environ.get("UDCPINE_BOOTSTRAP_TOKEN") or
  secrets.token_urlsafe(16)`). Setting `UDCPINE_BOOTSTRAP_TOKEN` to a
  stable value makes the kiosk URL permanent.

## Goals

- Pi cold-boots straight to a fullscreen dashboard with zero human input.
- Order-independent: either the Pi or the Mac can come up first; the
  system synchronises itself.
- A laptop reboot during a firing recovers without operator action.
- Toggling between "kiosk mode" and "normal labwc desktop" is one
  command from the Mac.
- All Pi-side configuration is committed in the repo and idempotently
  redeployable. No ssh-and-hand-edit anything.

## Non-goals (v1)

- OS-level watchdog that restarts Chromium if it visually hangs without
  exiting (the SPA reconnect is good enough).
- Per-device tokens / a `kiosks` table backend-side. One Pi, one URL.
- /etc/hosts pin or DHCP reservation for the laptop hostname.
- Hiding the brief labwc background flash before Chromium's first paint.
- Hiding the cursor in kiosk mode (touch-only use; cursor is acceptable).
- A separate `kiosk` Linux user. Single-user (`mrgrumpy`) keeps setup
  cheap and matches Pete's mental model.
- Running Flask as a service on the Mac (`make serve` is the Mac
  entrypoint, by hand, the same as today).

## Architecture

```
[laptop: make serve]                    [Pi: labwc session, autologin mrgrumpy]
  Flask :5001                              ~/.config/labwc/autostart →
  UDCPINE_BOOTSTRAP_TOKEN=<stable> ←-----  ~/bin/kiosk-launcher.sh "<URL>"
  (sourced from web/backend/.env.local)      │
                                             │ poll until hostname resolves +
                                             │ /api/state returns 2xx
                                             ▼
[browser SPA — app.tsx + use-live-state]   chromium --kiosk --app=<URL>
  detects EventSource failure                fullscreen on HDMI-A-1
   → <ReconnectingOverlay>                   (WaveShare touch input enabled
   → window.location.reload() (backoff)       by existing rc.xml touch line)
```

Three independent surfaces, each developable and testable in isolation:

1. **Backend (Mac)** — gitignored `.env.local` + a `make serve` line that
   sources it before launching Flask. Token is just a string.
2. **Frontend (Mac)** — `useLiveState` exposes a `connectionState`; a new
   `<ReconnectingOverlay>` component renders fullscreen when the SSE
   stream dies, with a backoff-driven `window.location.reload()`. Wraps
   `app.tsx`. **`exchangeToken` stashes the token in `sessionStorage`
   on success, and `app.tsx`'s boot effect re-exchanges from
   `sessionStorage` if `fetchState` 401s.** Without this, the post-reload
   recovery dies on backend restart — see "Reload-survives-restart"
   under Decisions below.
3. **Pi** — committed `pi/labwc/autostart.kiosk.template` and
   `pi/kiosk-launcher.sh`; new Makefile targets `pi-kiosk-on` /
   `pi-kiosk-off` deploy and toggle them.

The only contract between the surfaces is the URL string. The token
lives in `web/backend/.env.local`; everything else is derived.

## Components

### File inventory

```
repo/
├── web/backend/
│   ├── .env.example                    # NEW — documents UDCPINE_BOOTSTRAP_TOKEN
│   ├── .env.local                      # NEW (gitignored) — actual token, dev-machine only
│   ├── .gitignore                      # add .env.local
│   └── Makefile.include                # web-backend-serve sources .env.local before flask run
│
├── web/frontend/src/
│   ├── views/reconnecting-overlay.tsx  # NEW — full-screen overlay + manual "Reload now"
│   ├── use-live-state.ts               # expose `connectionState: "connected" | "reconnecting"`
│   ├── api.ts                          # exchangeToken persists token to sessionStorage on success
│   └── app.tsx                         # render <ReconnectingOverlay/> when reconnecting;
│                                       # on 401 from fetchState, retry exchangeToken from sessionStorage
│
├── pi/                                 # NEW dir — canonical Pi configs (committed)
│   ├── labwc/
│   │   └── autostart.kiosk.template    # one line: exec ~/bin/kiosk-launcher.sh "__KIOSK_URL__"
│   └── kiosk-launcher.sh               # retry-until-laptop-reachable loop, exec chromium
│
└── firmware/Makefile.include           # gains 2 targets:
    pi-kiosk-on  PI_HOST=...            # sed UDCPINE_BOOTSTRAP_TOKEN into autostart, scp +
                                        # rsync launcher, restart labwc
    pi-kiosk-off PI_HOST=...            # remove autostart, restart labwc → normal desktop
```

Notes:

- We deliberately do **not** ship a canonical `pi/labwc/rc.xml`. Pete's
  existing rc.xml carries the touchscreen line and we have no reason to
  touch it. (No labwc keybind for exit — see "Decisions" below.)
- The autostart is a **template** with a `__KIOSK_URL__` placeholder so
  the token never lands in git. `pi-kiosk-on` is the only place that
  reads `.env.local` and renders the URL into the deployed autostart.

### `pi/kiosk-launcher.sh`

```sh
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
```

Logging discipline: Stage 1 and Stage 2 each log once on entry and once
on recovery, so a Mac-asleep overnight produces ~2 lines per outage.
The Stage-3 crash-loop guard's "backoff" branch resets the window to 0
on entry, so under steady crashing it fires once per ~36s (3 crashes
@ 2s each + 30s sleep), not per crash — bounded but not silent.

### `pi/labwc/autostart.kiosk.template`

```
/home/__USER__/bin/kiosk-launcher.sh "__KIOSK_URL__" &
```

(No `exec` prefix: labwc's autostart is sourced by `sh`, and `exec foo &`
is contradictory — the `&` already backgrounds, which is what we want.)

`__USER__` and `__KIOSK_URL__` are substituted by `pi-kiosk-on` (the
user is derived from `PI_HOST`'s `<user>@<host>` form). Default labwc
behaviour is "user-level autostart replaces global", so this single line
suppresses the Pi taskbar and file manager that would otherwise clutter
the kiosk.

### Makefile targets (sketch — exact paths follow existing pattern)

```make
LAPTOP_HOST ?= Lawljegrens-M1.local

pi-kiosk-on: _pi-require-host
	@test -f web/backend/.env.local || { \
		echo "web/backend/.env.local missing — write UDCPINE_BOOTSTRAP_TOKEN there first"; \
		exit 2; \
	}
	@USER=$$(echo "$(PI_HOST)" | cut -d@ -f1); \
	 TOKEN=$$(grep -E '^UDCPINE_BOOTSTRAP_TOKEN=' web/backend/.env.local \
	          | cut -d= -f2- | tr -d '\r' | tr -d '"'); \
	 if ! printf '%s' "$$TOKEN" | grep -Eq '^[A-Za-z0-9_-]+$$'; then \
	   echo "UDCPINE_BOOTSTRAP_TOKEN must match ^[A-Za-z0-9_-]+\$$ (no shell-metachars or whitespace)"; \
	   exit 2; \
	 fi; \
	 URL="http://$(LAPTOP_HOST):5001/?t=$$TOKEN"; \
	 sed -e "s|__USER__|$$USER|g" -e "s|__KIOSK_URL__|$$URL|g" \
	   pi/labwc/autostart.kiosk.template > /tmp/autostart.kiosk; \
	 ssh $(PI_HOST) 'mkdir -p ~/bin ~/.config/labwc'; \
	 scp pi/kiosk-launcher.sh $(PI_HOST):~/bin/kiosk-launcher.sh; \
	 ssh $(PI_HOST) 'chmod +x ~/bin/kiosk-launcher.sh'; \
	 scp /tmp/autostart.kiosk $(PI_HOST):~/.config/labwc/autostart; \
	 ssh $(PI_HOST) 'chmod 600 ~/.config/labwc/autostart'; \
	 ssh $(PI_HOST) 'pkill chromium 2>/dev/null; loginctl terminate-user "'"$$USER"'" 2>/dev/null; true'; \
	 echo "waiting for $$USER session to respawn..."; \
	 ssh $(PI_HOST) 'for i in 1 2 3 4 5 6 7 8 9 10; do \
	   loginctl list-sessions --no-legend 2>/dev/null | awk "{print \$$3}" | grep -qx "'"$$USER"'" && exit 0; \
	   sleep 1; \
	 done; \
	 echo "ERROR: '"$$USER"' session did not respawn after terminate-user."; \
	 echo "       Recover with: ssh $(PI_HOST) sudo systemctl restart getty@tty1"; \
	 exit 3'

pi-kiosk-off: _pi-require-host
	@USER=$$(echo "$(PI_HOST)" | cut -d@ -f1); \
	 ssh $(PI_HOST) 'rm -f ~/.config/labwc/autostart; pkill chromium 2>/dev/null; loginctl terminate-user "'"$$USER"'" 2>/dev/null; true'
```

`LAPTOP_HOST` is overridable for the same reasons `PI_HOST` is — it
keeps the Makefile portable if you ever swap or rename the Mac.

The post-terminate respawn poll matters because `sshd` is independent
of seat0: if `loginctl terminate-user` succeeds but logind fails to
re-spawn the autologin session, the Pi sits at a black tty1 with the
kiosk dead — recoverable over SSH but only if the operator *knows* it
happened. The 10s poll + explicit recovery hint converts a silent
brick into a loud failure with a one-line fix.

Session restart uses `loginctl terminate-user`, not `pkill labwc`.
`pkill labwc` is unreliable under getty autologin: getty respawns the
*login shell on tty1*, not the Wayland session — whichever line started
labwc (`exec startlabwc-session` in `.bash_profile`, etc.) has already
returned, so killing labwc tends to drop to a shell rather than a fresh
session. `loginctl terminate-user` tears down the whole user session;
systemd-logind + getty then bring it back from scratch, re-reading
autostart cleanly. Verified-on-hardware status tracked in the risks
section below.

Token-shape validation: the Makefile rejects tokens containing anything
outside `[A-Za-z0-9_-]` before substitution. This avoids sed-delimiter
collisions (`|`, `\`), accidental `&` back-references in the replacement,
URL-breaking whitespace, and CRLF contamination from cross-platform
editors. `openssl rand -hex 32` passes; an operator-chosen token with
punctuation fails fast with a clear message.

Autostart permissions: chmod 600 on the deployed `~/.config/labwc/autostart`
keeps the embedded `?t=<token>` out of other-user reads. The token still
appears in `/proc/<pid>/cmdline` for the chromium process, which on
default Pi OS (no `hidepid=`) is readable not just by other humans but
by daemon users like `avahi`, `cups`, `bluetooth`. Acceptable under the
LAN-trust-boundary model — the same processes could read the token off
the wire anyway — but worth being explicit that "chmod 600" is partial.

## Decisions

### Reload-survives-restart: stash token in sessionStorage

`web/frontend/src/app.tsx:16-23` (`takeUrlToken`) strips `?t=<token>`
from the URL via `history.replaceState` on first load, and
`AuthStore._devices` (`web/backend/src/udcpine_backend/auth_store.py:33-34`)
is in-memory — a `make serve` restart invalidates every cookie. Naive
`window.location.reload()` therefore reloads to a bare `/` with no
token and no valid cookie → 401 → `<PairScreen/>` permanently. The
kiosk would brick on every laptop reboot, defeating the headline goal.

Fix: `exchangeToken` writes the token to `sessionStorage` on success.
The boot effect in `app.tsx` does: try `?t=` from URL → fall back to
`sessionStorage` → call `fetchState`; on `UnauthorizedError`, re-call
`exchangeToken` from `sessionStorage` and retry `fetchState` once
before showing `<PairScreen/>`. `sessionStorage` (not `localStorage`)
is correct here: it persists across `window.location.reload()` and
across crash-relaunches of Chromium in the same kiosk session, but a
truly fresh kiosk deploy (`pi-kiosk-on` → new `loginctl terminate-user`
→ fresh Chromium → fresh session storage) starts from the `?t=` in
the URL, which is what we want.

### SSE error debounce: don't flap on every blip

`EventSource.onerror` fires on every transient hiccup; the browser
sets `readyState=CONNECTING` (1) while it auto-reconnects, and
`CLOSED` (2) only when reconnection has actually given up. The
overlay must not flash on momentary blips or it'll trigger spurious
`window.location.reload()` calls.

Threshold: `connectionState` flips to `"reconnecting"` only after
`readyState === CONNECTING` has persisted for **≥3 seconds**, OR after
`readyState === CLOSED`. It flips back to `"connected"` on the next
`onmessage`. The 3s threshold is the spec; the test for it is in
Tier 1 below.

## Failure modes & recovery

| Failure | Symptom | Recovery | Surface |
|---|---|---|---|
| Laptop reboots / Flask restarts | SSE dies; `/api/state` 401s after reload | SPA detects → `<ReconnectingOverlay>` → backoff (1, 2, 5, 10s, capped) → `window.location.reload()` → boot effect reads token from `sessionStorage` → re-exchange → fresh cookie → live | Frontend |
| mDNS not yet ready at Pi boot | (would be ERR_NAME_NOT_RESOLVED) | Launcher blocks on `getent hosts` before launching Chromium at all | Pi launcher |
| Laptop boots after Pi | (would be ERR_CONNECTION_REFUSED) | Launcher blocks on `curl /api/state` before launching | Pi launcher |
| Chromium crashes (rare; low-RAM) | Blank screen | `while true` loop relaunches after 2s | Pi launcher |
| Operator wants out of kiosk | Need an exit | `make pi-kiosk-off` from Mac | Mac Makefile |

Deliberately not handled in v1: visual Chromium hang (no exit, no SSE
fail) — the SPA reconnect catches enough of this class; a watchdog can
be added later if it bites in practice.

## First-time setup walkthrough

```sh
# --- on the Mac ---
openssl rand -hex 32                                      # generate stable token
cat > web/backend/.env.local <<EOF                        # save it (gitignored)
UDCPINE_BOOTSTRAP_TOKEN=<that-hex-string>
EOF
make serve                                                # start backend with the token
make pi-kiosk-on PI_HOST=mrgrumpy@mrgrumpy.local          # push kiosk config + activate
```

Within a few seconds, the Pi flips to the fullscreen dashboard. No
further manual steps required at any subsequent boot of either device.

### Steady-state cold boot (everyday firing day)

Power-on order does not matter:

- Pi first → labwc starts → `kiosk-launcher.sh` polls forever for the
  laptop. Display shows labwc background while waiting.
- Mac first / Mac later → `make serve` → launcher's next poll succeeds
  → Chromium spawns → dashboard live.

### Shutdown

- Done firing: power-cycle the Pi (or `ssh ... pkill -f kiosk-launcher`
  for a graceful stop). No Pi-side state to corrupt.
- Done with the laptop: `Ctrl-C` on `make serve`. Pi's last paint sticks
  on screen; the reconnect overlay appears within ~15s.

## Verification

### Tier 1 — Automated (CI catches regressions)

**Backend**
- No new Python unit test (sourcing `.env.local` is shell behaviour
  inside the `make` target, not Flask logic — existing
  `test_auth.py::test_exchange_returns_cookie` already covers the
  token-exchange flow). Instead, add a smoke check to the manual
  Tier-2 list: with a known `.env.local` token, `curl
  http://localhost:5001/api/auth/exchange` accepts the token from
  `.env.local` rather than a random one. If this proves brittle we
  can wrap it in a shell test under `web/backend/tests/sh/`.

**Frontend**
- Extend `web/frontend/src/use-live-state.test.ts`:
  - Simulate `EventSource` error with `readyState=CONNECTING`; advance
    mocked timers 2.9s → assert `connectionState === "connected"`
    still; advance to 3.1s → assert `"reconnecting"`. Then dispatch an
    `onmessage` → assert `"connected"` again. (Debounce test.)
  - Simulate `readyState=CLOSED` after `onerror` → assert
    `"reconnecting"` immediately, no 3s wait.
  - With `connectionState === "reconnecting"`, assert reload backoff
    sequence `1s, 2s, 5s, 10s, 10s, …`.
- New `web/frontend/src/views/reconnecting-overlay.test.tsx`:
  renders overlay iff `connectionState === "reconnecting"`; clicking
  "Reload now" calls `window.location.reload`.
- Extend `web/frontend/src/api.test.ts` (or new file):
  `exchangeToken("abc")` on a 200 response writes `"abc"` to
  `sessionStorage`; on non-2xx, sessionStorage is untouched.
- New `web/frontend/src/app.test.tsx`:
  with no `?t=` in URL but `"abc"` in `sessionStorage`, and `fetchState`
  mocked to 401-then-200, asserts `exchangeToken("abc")` is called
  exactly once and the app boots to `Live`, not `PairScreen`.

**E2E** — extend `dashboard.spec.ts` with one new test. Rather than
killing the Playwright `webServer` (Playwright owns its lifecycle and
restart is awkward), add a **test-only** Flask route gated by
`UDCPINE_TEST_HOOKS=1` — `POST /api/_test/break-stream` closes all
open SSE responses and starts 503ing `/api/stream` until
`POST /api/_test/heal-stream`. Test: walk happy path, call break,
assert overlay appears within ~4s (3s debounce + slack), call heal,
assert overlay disappears and temp reading resumes. The reload path
itself is covered by the unit test above; E2E asserts the
overlay-shows / overlay-hides contract.

### Tier 2 — Manual, on real hardware (proof)

Run once after first deploy; rerun after any kiosk-launcher / autostart
change.

```
[ ] make pi-kiosk-on succeeds; chromium fills the WaveShare within ~5s
[ ] No browser chrome, no cursor flicker on tap
[ ] Tap NEXT PIZZA → form responds to touch
[ ] Tap Chef → takeover view → tap → collapses
[ ] sudo reboot the Pi → kiosk comes back unattended within ~30s
[ ] Put the Mac to sleep → ReconnectingOverlay appears within ~15s, persists
[ ] Wake the Mac → page reloads within ~10s; dashboard resumes
[ ] make pi-kiosk-off → Pi returns to normal labwc (panel + filemgr appear)
[ ] make pi-kiosk-on → returns to kiosk
```

### Tier 3 — Edge probes (run when curious / after subtle changes)

```
[ ] Pi powered on before Mac: launcher waits politely
    → journalctl --user -t udcpine-kiosk --since '1 min ago' ≤ 4 lines
[ ] Token rotation: edit .env.local, restart make serve, run make pi-kiosk-on
    → Pi reloads with new token; dashboard live
[ ] Open-thermocouple test (yank a probe lead): the stale indicator is
    existing behaviour from PR #52 (reduce.ts), not new work in this
    plan. Probe asserts that the new ReconnectingOverlay does NOT
    appear for this failure class (sensor stale ≠ backend unreachable).
[ ] After make pi-kiosk-off in a bare labwc session: WaveShare touch
    still works as mouse (existing rc.xml, untouched by our work)
```

## Risks / open questions carried to implementation

- **`logger -t` reliability** in a Wayland user session: confirm during
  implementation that `logger` writes to `journalctl --user` (or to the
  system journal under the user's tag). If not, fall back to writing to
  `~/.cache/udcpine-kiosk.log` with rotation.
- **labwc session restart**: plan now uses `loginctl terminate-user`
  (see Makefile commentary above). The `pi-kiosk-on` target polls for
  the session to respawn within 10s and fails loudly with a
  `systemctl restart getty@tty1` recovery hint if it doesn't — so the
  remote-brick failure mode is converted to a noisy error, not silent.
  If the poll fails repeatedly in practice, the next fallback is
  `loginctl enable-linger`. Do NOT fall back to `pkill labwc`; that's
  the failure mode this change is avoiding.
- **`make serve` env sourcing**: the existing `web-backend-serve` target
  runs `uv run flask …`; adding `set -a; . ./.env.local; set +a;`
  inside the target is the obvious approach, but verify it propagates
  to the `uv run` subshell.

## Decomposition (Pattern B, post-approval)

Three agent-ready tickets, parallel-safe:

1. **Backend + ops** — `.env.local` machinery + `.env.example` +
   `.gitignore` + `make serve` sourcing + Tier-1 backend test.
2. **Frontend** — `connectionState` on `useLiveState` (with the 3s
   debounce) + `<ReconnectingOverlay>` + `sessionStorage` persistence
   in `exchangeToken` + 401-retry-from-sessionStorage in `app.tsx`'s
   boot effect + Tier-1 frontend tests (debounce, reload backoff,
   sessionStorage round-trip, 401-retry) + test-only
   `/api/_test/break-stream` + `/api/_test/heal-stream` routes (gated
   on `UDCPINE_TEST_HOOKS=1`) + E2E reconnect test against them.
3. **Pi configs + Makefile** — `pi/kiosk-launcher.sh` +
   `pi/labwc/autostart.kiosk.template` + `pi-kiosk-on` / `pi-kiosk-off`
   targets. No automated tests; Tier-2 manual checklist is the
   acceptance gate.

Merge order: tickets 1 and 2 are parallel-safe (independent surfaces,
both covered by automated tests). Ticket 3 **lands last** and its PR
must include a Tier-2 checklist paste (or `journalctl --user
-t udcpine-kiosk` excerpt) as evidence the launcher and session-restart
path actually worked on the real Pi. Without that gate, a broken
`kiosk-launcher.sh` or `loginctl` path could sit on `main` indefinitely.
