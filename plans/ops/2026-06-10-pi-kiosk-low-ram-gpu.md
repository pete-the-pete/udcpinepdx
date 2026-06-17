# Pi kiosk: blank-white screen on the Pi Zero 2 W

**Date:** 2026-06-10
**Subsystem:** ops (kiosk)
**Status:** fix applied to `pi/kiosk-launcher.sh`. Amends
[2026-05-27-pi-boot-to-kiosk.md](./2026-05-27-pi-boot-to-kiosk.md).

## Symptom

After boot, the kiosk showed a **blank white screen** instead of the dashboard.
The labwc session, the kiosk-launcher loop, and Chromium were all running; the
Mac backend was healthy and the Pi firmware was posting samples (`204`s). The
device was **idle** — CPU ~99% idle, all Chromium processes asleep on benign
waits, no GPU/OOM errors in the kernel log. So Chromium loaded the page HTML
and then *parked* without ever running the app's JavaScript.

## Root cause — two stacked, launch-level problems

Neither is in our code, the server, the network, or the web fonts. Both are
properties of running desktop Chromium on a 512 MB **Raspberry Pi Zero 2 W**.

1. **Low-RAM warning dialog.** Raspberry Pi OS wraps `chromium` in a shell
   script (`/usr/bin/chromium`) that, on devices with `MemTotal < 1 GB`, pops a
   modal dialog: *"It is not recommended to run Chromium on devices with less
   than 1GB of RAM. [Cancel] [Launch anyway]"*. In `--kiosk` mode there is no
   one to click "Launch anyway", so the real browser never starts and the
   window stays blank. The wrapper exposes a flag to skip it: `--no-memcheck`.

2. **EGL/GPU init failure.** With the dialog skipped, the GPU process died
   during initialization:

   ```
   eglCreateContext ES 3.0 failed with error EGL_BAD_ATTRIBUTE. ES version fallback is disabled.
   gl::init::CreateGLContext failed
   Exiting GPU process due to errors during initialization
   ```

   leaving an unpainted (white) compositor surface. Forcing software rendering
   with `--disable-gpu` sidesteps the broken EGL path entirely.

## How it was found

A controlled probe: stop the launcher, launch Chromium at a trivial local
test page (no fonts, no network) via a detached `systemd --user` transient unit
(robust against SSH drops), and screenshot the framebuffer with `grim`. The
test page surfaced the RAM dialog — proving the block was at Chromium-launch
level, not app- or network-specific. Adding `--no-memcheck` then exposed the
EGL error; adding `--disable-gpu` produced a fully booted dashboard
(`/api/auth/exchange` → `/api/state` → `/api/stream` all `200`, live temperature
rendered).

## Fix

In `pi/kiosk-launcher.sh`, launch Chromium with both flags:

```sh
chromium --no-memcheck --disable-gpu \
  --kiosk --noerrdialogs --disable-infobars --no-first-run \
  --app="$URL"
```

The crash-loop guard already in the launcher remains the backstop if Chromium
still exits for other reasons.

## Deploy

```sh
make pi-kiosk-on PI_HOST=mrgrumpy@mrgrumpy.local
```

This re-copies `kiosk-launcher.sh` and respawns the session. Verify with a
`grim` screenshot, or check the backend log for the Pi's `GET /api/stream 200`.

## Notes / follow-ups

- Software rendering is fine for this near-static dashboard. If CPU headroom
  later matters, investigate a working hardware-GL path (e.g. `--use-gl=egl`
  with a fixed driver/`config.txt`, or `--use-angle=…`) instead of `--disable-gpu`.
- The crash-loop backoff in the launcher (3 exits / 30 s → 30 s sleep) was
  *not* the issue here — Chromium wasn't crash-looping, it was parked. No change
  needed there.

---

# Amendment 2026-06-16: blank white returns on Chromium 149

**Status:** fixed in `pi/kiosk-launcher.sh`.

## Symptom

After an unattended `apt full-upgrade` (Chromium **147 → 148 → 149**, kernel
**6.12 → 6.18**, labwc **0.9.2 → 0.9.7**, mesa/libcamera), the kiosk went blank
white again. The `--no-memcheck --disable-gpu` fix above was still deployed and
correct — so this was a *new* regression, not the old bug returning.

## Root cause — the board is too slow to start multi-process Chromium

This time it was **not** GPU. Chromium 149 launches healthy: no memory dialog,
**no EGL/GPU errors at all**, the renderer runs, and DevTools `Page.navigate`
renders the full dashboard perfectly (proven via `Page.captureScreenshot`). The
page, JS, renderer, and GPU are all fine — and a *warm* navigation always works.
Only the **cold-start `--app` navigation at boot** fails to paint.

The log (`--enable-logging=stderr`) names it:

```
INFO:  Terminating current process after 15 seconds with no connection.
ERROR: Network service crashed or was terminated, restarting service.
```

The Pi Zero 2 W is so CPU/RAM-starved at cold boot that the **browser process
can't wire up its child processes within Chromium's internal 15 s Mojo-IPC
connection timeout**. The network-service child gives up waiting and
self-terminates; that kills the in-flight `--app` navigation, and Chromium never
retries → a permanent blank page. (Same multi-process IPC starvation that makes
`--headless=new` fail with zygote errors on this board.)

This was a **heisenbug**: `--enable-logging=stderr --v=1` slowed startup enough
that the handshake beat the timeout, so verbose-logging boots "worked" while
quiet boots went blank — which sent the early investigation chasing GPU,
profile, SwiftShader, and keyring red herrings.

## Fix

The single load-bearing flag added to the `chromium` line in
`pi/kiosk-launcher.sh`:

- **`--single-process`** *(the fix)* — run the browser, renderer, GPU, and
  network code in one process. No child processes means no Mojo-IPC handshake
  and nothing to time out, so the boot navigation commits every time. Fine for
  a single static dashboard, and lighter on RAM. The launcher's crash-loop
  guard is the backstop if the one process dies.

Supporting flags (quality-of-life / hardening, not the core fix):

- **`--password-store=basic`** — don't use the GNOME login keyring for the Safe
  Storage key. Stops the per-boot "unlock keyring" **password prompt** (which a
  keyboard-attached boot shows, and which can itself block). Key lives in the
  profile instead; fine since the kiosk holds only a LAN session cookie.
- **`--disable-background-networking --disable-component-update`** — a kiosk on
  one LAN dashboard needs none of Chromium's first-run traffic; removing it
  trims startup load and SD churn.
- **`--user-data-dir=/tmp/udcpine-kiosk-profile`**, wiped before each launch —
  small, upgrade-proof profile.

SwiftShader (`--use-angle=swiftshader`), tried during the investigation, was
**dropped**: plain `--disable-gpu` software rendering paints fine once
`--single-process` lets the nav commit.

## How it was found

A controlled, evidence-first probe after many blind flag guesses (GPU,
SwiftShader, ephemeral profile, keyring) each failed to fix the blank screen:

1. Attach DevTools to the live (non-headless) browser over a temporary
   `--remote-debugging-port`; `Page.navigate` + `Page.captureScreenshot` proved
   the renderer was perfect and the page simply never navigated at boot —
   relocating the bug from "rendering" to "startup".
2. Notice verbose logging made it boot but quiet runs didn't → a timing race.
   Re-run with **error-only** `--enable-logging=stderr` (minimal slowdown) to
   reproduce the failure *and* capture it: the "15 seconds with no connection"
   child-process timeout and network-service termination.
3. `--single-process` removes the multi-process startup entirely → fixed.

> Note: `--headless=new` is **broken** on this board (same IPC starvation,
> zygote errors), so headless rendering is not a usable diagnostic here — drive
> the real browser.

> Security: the `--remote-debugging-port`/`--remote-allow-origins=*` flags used
> during diagnosis are an unauthenticated debug surface and were **removed**
> before commit. They must never ship in the kiosk launcher.

## Deploy / verify

```sh
make pi-kiosk-on PI_HOST=mrgrumpy@mrgrumpy.local
```

Verify the kiosk boots straight to the dashboard with **no** keyring prompt and
no blank screen (`grim` screenshot, or watch the physical display).

> Be patient: `--single-process` software rendering on the Pi Zero 2 W takes
> **~2 minutes** from session start to first paint. The screen sits on the
> desktop/blank during that window — that's normal cold-boot slowness, not a
> failure. It boots once and stays up.
