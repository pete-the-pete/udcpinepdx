# Real-sensor deps + Pi-side sync (deploy strategy amendment)

Subsystem: firmware + ops. Amends decisions in
`plans/2026-05-27-real-thermocouple.md` discovered during hardware bring-up.

## Context

Bring-up on `mrgrumpy.local` exposed two bugs in the merged thermocouple
firmware:

1. `firmware/src/udcpine_firmware/sensor.py` imports `adafruit_max6675`,
   `board`, `busio`, `digitalio` for `RealSensor`, but
   `firmware/pyproject.toml` only declares `requests`. The systemd unit
   would `ImportError` the moment it tried to instantiate a real sensor.
   Compounding this: **Adafruit doesn't publish a CircuitPython MAX6675
   library** (they only ship MAX31855/56), so the original plan's
   library choice never existed on PyPI. We pivot to reading raw SPI
   via `spidev` — MAX6675's wire protocol is one 16-bit big-endian read,
   ~10 lines of Python, no Blinka stack. Also better aligned with
   learning goal #2 (RPi + electronics).
2. `firmware/Makefile.include` runs `uv sync --frozen` on the **Mac** and
   then rsyncs the resulting `.venv/` to the Pi. Even after adding the
   Adafruit stack, the Mac can't install Linux-arm64-only wheels
   (`RPi.GPIO`, `Adafruit-Blinka`), and a Mac venv wouldn't run on the
   Pi regardless.

The fix is to move the dependency sync to the Pi itself. The Mac becomes
purely a source-shipping host; the Pi resolves and installs its own
platform-correct wheels. This also matches how production Pi deploys
actually work — and is the more instructive path per Pete's learning
goals (real Linux package mgmt, no cross-compile pretending).

Live state confirmed this session:
- `udcpine` system user exists on the Pi, in `spi`+`gpio` groups.
- `/opt/udcpine-firmware/` exists, owned `udcpine:udcpine`.
- `/etc/systemd/system/udcpine-firmware.service` installed, enabled,
  inactive. `ExecStart` already points at
  `http://Lawljegrens-M1.local:5001`.
- Pi has Python 3.13.5 at `/usr/bin/python3`. `uv` is not installed.

## Decisions

- **Dependency declaration:** add `spidev>=3.6,<4` to
  `firmware/pyproject.toml` with a `sys_platform == 'linux'` marker so
  Mac `uv lock`/`uv sync` skip it cleanly. `RealSensor` is rewritten
  to call `spi.xfer2([0, 0])` directly and parse the 16-bit word.
- **Lock on Mac, install on Pi.** `uv lock` is platform-independent and
  runs fine on the Mac; `uv sync` happens exclusively on the Pi during
  deploy. `uv.lock` is committed.
- **Install `uv` on the Pi system-wide** at `/usr/local/bin/uv` so both
  the deploy user (`mrgrumpy`) and the service user (`udcpine`) see it
  on PATH without env munging. One-time setup; lives in the README
  runbook, not the Makefile.
- **Permission model:** retain dedicated `udcpine` service user for
  defense-in-depth on the systemd side, but re-own
  `/opt/udcpine-firmware/` as `mrgrumpy:udcpine` mode `2770` (setgid).
  Deploy user writes; service user reads+executes via group; new files
  inherit `udcpine` group via setgid. Eliminates sudo from rsync and
  `uv sync` — the only sudo left in deploy is `systemctl restart`.
- **Sudo for restart:** add a sudoers drop-in granting `mrgrumpy`
  NOPASSWD on exactly `/bin/systemctl restart udcpine-firmware`. Tight
  scope; documented in the README runbook. Without it, every deploy
  blocks on a password prompt and the Makefile breaks.
- **README accuracy:** drop the `pi@<host>` assumption (modern Pi OS
  has no default `pi` user; example becomes `<user>@<host>.local`).

## File changes

| Path | Change |
|---|---|
| `firmware/pyproject.toml` | add `spidev>=3.6,<4 ; sys_platform == 'linux'` to `dependencies` |
| `firmware/src/udcpine_firmware/sensor.py` | rewrite `RealSensor` to use `spidev` directly (16-bit SPI read, parse word) |
| `firmware/uv.lock` | regenerated via `uv lock` (Mac) |
| `firmware/Makefile.include` | rewrite `pi-build`/`pi-deploy` (see below) |
| `firmware/README.md` | new "Install uv" step; sudoers drop-in step; permission re-chown step; drop `pi@` from examples |
| `Makefile` (root) | help text for `pi-build` updated if behavior changes |

### `firmware/Makefile.include` shape

```make
FIRMWARE_DIR := firmware
PI_HOST ?=

.PHONY: pi-build pi-deploy pi-logs _pi-require-host

_pi-require-host:
	@if [ -z "$(PI_HOST)" ]; then \
		echo "PI_HOST is required, e.g. make pi-deploy PI_HOST=mrgrumpy@mrgrumpy.local"; \
		exit 2; \
	fi

# Locks deps; safe to run on any platform. No venv built locally.
pi-build:
	cd $(FIRMWARE_DIR) && uv lock

pi-deploy: _pi-require-host pi-build
	rsync -a --delete \
		--exclude '__pycache__' --exclude '.pytest_cache' \
		--exclude 'tests' --exclude '.venv' \
		$(FIRMWARE_DIR)/ $(PI_HOST):/opt/udcpine-firmware/
	ssh $(PI_HOST) 'cd /opt/udcpine-firmware && uv sync --frozen && sudo systemctl restart udcpine-firmware'

pi-logs: _pi-require-host
	ssh $(PI_HOST) 'journalctl -u udcpine-firmware -f'
```

### README additions (firmware/README.md)

Insert between current steps 3 and 4:

> **3b. Re-own the install directory for deploy access**
> ```sh
> sudo chown -R mrgrumpy:udcpine /opt/udcpine-firmware
> sudo chmod -R 2770 /opt/udcpine-firmware
> ```
> The setgid bit (`2`) makes new files inherit the `udcpine` group, so
> the service user can read everything `make pi-deploy` writes.

> **3c. Install `uv` system-wide**
> ```sh
> curl -LsSf https://astral.sh/uv/install.sh \
>   | sudo env UV_INSTALL_DIR=/usr/local/bin sh
> uv --version  # confirm
> ```

> **3d. Allow passwordless restart of the firmware service**
> ```sh
> echo 'mrgrumpy ALL=(root) NOPASSWD: /bin/systemctl restart udcpine-firmware' \
>   | sudo tee /etc/sudoers.d/udcpine-deploy
> sudo chmod 440 /etc/sudoers.d/udcpine-deploy
> ```
> Scoped to the one command `make pi-deploy` needs. Without this,
> deploys hang on a sudo password prompt.

Plus: replace `pi@<host>` with `<user>@<host>.local` in all examples,
and call out that modern Pi OS sets the username at flash time.

## Out of scope

- Removing the `udcpine` service user in favor of running as `mrgrumpy`
  (rejected: defense-in-depth is cheap).
- Cross-arch `uv sync` on the Mac with sysroot tricks.
- General passwordless sudo on the Pi.

## Verification

End-to-end on real hardware (the work this whole plan unblocks):

1. `cd firmware && uv lock` on the Mac — succeeds, `uv.lock` now
   references adafruit-circuitpython-max6675 and transitives.
2. From repo root: `make pi-deploy PI_HOST=mrgrumpy@mrgrumpy.local`.
   Expect: rsync output, `uv sync` output on the Pi (first run
   downloads + builds wheels for Adafruit stack on aarch64), service
   restart with no password prompt.
3. `make pi-logs PI_HOST=mrgrumpy@mrgrumpy.local` — expect one POST
   per second, `204` responses from Flask. Also expect to see the
   service successfully constructing `RealSensor` (no ImportError) and
   `Lawljegrens-M1.local:5001` reachable from the Pi.
4. Start backend on Mac: `cd web/backend && UDCPINE_MOCK_SENSOR=0 make
   serve`. Confirm `/api/state.latest_sample` reflects the Pi's
   readings.
5. Cup the K-type probe — dashboard hero number rises within a few
   seconds. Release — falls back.
6. Open thermocouple test (disconnect probe momentarily): service
   logs `SensorError` and skips, no crash, no SSE disruption.

## Plan amendment trail

Original deploy decision in `plans/2026-05-27-real-thermocouple.md`
section "Decisions locked in this session" said:
"Build on the Mac, rsync to the Pi." That decision survives in spirit
— the Mac is still the canonical source — but the *binary* build
moves to the Pi. This plan supersedes the venv-rsync mechanism while
preserving the original architecture (Pi as deploy target, no local
webserver, samples over HTTP).
