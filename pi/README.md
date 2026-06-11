# pi/

Files that configure the Raspberry Pi as a fullscreen dashboard kiosk.
See `plans/ops/2026-05-27-pi-boot-to-kiosk.md` for the full design rationale.

## Bringing the kiosk up (runbook)

The dashboard has **two halves**: the backend runs on the **Mac**, and the Pi
just displays it in fullscreen Chromium. Both must be up.

```sh
# 1. On the Mac — start the server (builds the SPA + serves it on :5001).
#    Run it in a terminal that stays open; the kiosk has no backend without it.
make serve

# 2. On the Mac — activate/deploy the kiosk on the Pi (copies the launcher +
#    autostart, then respawns the graphical session).
make pi-kiosk-on PI_HOST=mrgrumpy@mrgrumpy.local

# Return the Pi to a normal desktop (remove the kiosk autostart):
make pi-kiosk-off PI_HOST=mrgrumpy@mrgrumpy.local
```

The Pi boots → labwc → `kiosk-launcher.sh`, which waits for the Mac backend at
`http://<LAPTOP_HOST>:5001/` and then launches Chromium. If the server isn't
running, the launcher parks in its "waiting for backend" loop and the screen
stays blank until you start it — that is the expected behavior, not a failure.

## Logs

The launcher writes to the system journal under the `udcpine-kiosk` syslog tag:

```sh
journalctl --user -t udcpine-kiosk -f
# or remotely:
ssh mrgrumpy@mrgrumpy.local 'journalctl -t udcpine-kiosk -n 30 --no-pager'
```

Grab a screenshot of the Pi's screen (Wayland) to see what's actually displayed:

```sh
ssh mrgrumpy@mrgrumpy.local 'XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-0 grim /tmp/screen.png'
scp mrgrumpy@mrgrumpy.local:/tmp/screen.png .
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Screen blank, launcher log stuck at "waiting for backend" | The Mac server isn't running | `make serve` on the Mac |
| **Blank white screen**, launcher says "launching chromium", Pi idle | Pi Zero 2 W low-RAM dialog + broken EGL/GPU | The `--no-memcheck --disable-gpu` flags in `kiosk-launcher.sh` (see `plans/ops/2026-06-10-pi-kiosk-low-ram-gpu.md`). Redeploy with `make pi-kiosk-on`. |
| Login greeter instead of the kiosk | Auto-login chain interrupted (e.g. repeated session restarts) | Log in as `mrgrumpy`, or reboot the Pi |

## Files

| File | Purpose |
|---|---|
| `kiosk-launcher.sh` | Waits for DNS + backend, then launches Chromium in kiosk mode with crash-loop protection. Runs as a labwc autostart entry. Carries the low-RAM/GPU flags this board needs. |
| `labwc/` | labwc autostart template (`autostart.kiosk.template`) rendered by `make pi-kiosk-on` with the correct URL and token. |
