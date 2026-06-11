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
