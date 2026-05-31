# pi/

Files that configure the Raspberry Pi as a fullscreen dashboard kiosk.
See `plans/ops/2026-05-27-pi-boot-to-kiosk.md` for the full design rationale.

## Deploy targets

```sh
# Activate fullscreen kiosk mode (copies autostart + systemd unit, reboots):
make pi-kiosk-on PI_HOST=user@host.local

# Remove kiosk autostart and return the Pi to a normal desktop:
make pi-kiosk-off PI_HOST=user@host.local
```

## Logs

The launcher writes to the system journal under the `udcpine-kiosk` syslog tag:

```sh
journalctl --user -t udcpine-kiosk -f
```

## Files

| File | Purpose |
|---|---|
| `kiosk-launcher.sh` | Waits for DNS + backend, then launches Chromium in kiosk mode with crash-loop protection. Runs as a labwc autostart entry. |
| `labwc/` | labwc autostart template (`autostart.kiosk.template`) rendered by `make pi-kiosk-on` with the correct URL and token. |
