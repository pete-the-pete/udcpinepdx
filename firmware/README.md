# udcpine-firmware

Python service that runs on the Raspberry Pi, reads the oven thermocouple,
and POSTs samples to the Flask backend over the LAN at 1 Hz.

## Hardware

### Wiring — MAX6675 to Raspberry Pi

| MAX6675 pin | Pi pin (physical) | Pi pin (BCM) | Notes |
|---|---|---|---|
| VCC | 1 or 17 | — | 3.3 V — **not 5 V** |
| GND | 6, 9, 14, 20, 25, 30, 34, or 39 | — | Any ground |
| SCK | 23 | GPIO 11 | SPI clock |
| CS  | 24 | GPIO 8  | SPI CE0 |
| SO  | 21 | GPIO 9  | SPI MISO |

The K-type thermocouple probe plugs into the screw terminals on the MAX6675
breakout board (yellow `+`, red `−` for ANSI; check your probe — colour
codes vary by region).

### ⚠️ Cold-junction warning — read this before mounting

The MAX6675 IC sits on the breakout board, not at the probe tip. The IC's
operating range tops out around **85 °C ambient**. In a chiminea this is
the most likely v1 failure mode.

- **Only the K-type probe wire enters the firebox.** The breakout board
  stays *outside* the insulated door, in ambient air.
- Route the probe lead through a strain-relieved penetration; mount the
  breakout board somewhere the door's exterior surface temperature stays
  comfortably below 85 °C during a full burn.
- **Symptom of failure:** if readings drift upward when the oven is hot
  but the probe is cool (e.g. you pull the probe out and the number keeps
  climbing for a minute), the cold-junction IC is cooking. Re-mount further
  from the heat.

## First-time setup on the Pi

This is a hands-on runbook, not a script. Pete will be at the device for
the wiring anyway, so the steps that need physical access aren't
automated.

Modern Pi OS images do not ship with a default `pi` user — the login
username is set in Pi Imager at flash time. Substitute your actual
username for `<user>` in the examples below; the host shown is
`<user>@<host>.local`.

### 1. Enable SPI

```sh
sudo raspi-config        # → Interface Options → SPI → Enable
# or equivalently, add the following to /boot/config.txt and reboot:
#   dtparam=spi=on
```

After reboot, verify `/dev/spidev0.0` and `/dev/spidev0.1` exist:

```sh
ls -l /dev/spidev*
```

### 2. Create the service user

```sh
sudo useradd --system --create-home --shell /usr/sbin/nologin udcpine
sudo usermod -aG spi,gpio udcpine
```

Confirm the `spi` group can read `/dev/spidev0.0`:

```sh
ls -l /dev/spidev0.0
# expect group `spi` with `rw`
```

If your Pi OS image only grants `gpio` (some images do), either add the
`udcpine` user to that group too, or add a udev rule:

```sh
echo 'SUBSYSTEM=="spidev", GROUP="spi", MODE="0660"' \
  | sudo tee /etc/udev/rules.d/50-spi.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

### 3. Provision the install directory

```sh
sudo mkdir -p /opt/udcpine-firmware
sudo chown udcpine:udcpine /opt/udcpine-firmware
```

### 3b. Re-own the install directory for deploy access

`make pi-deploy` rsyncs as your login user, while the systemd unit runs
as `udcpine`. Make the directory owner-writable by you and
group-readable by the service user, with the setgid bit so new files
inherit the right group:

```sh
sudo chown -R <user>:udcpine /opt/udcpine-firmware
sudo chmod -R 2770 /opt/udcpine-firmware
```

### 3c. Install `uv` system-wide

`uv sync` runs on the Pi every deploy (the Mac never builds the venv —
the platform is wrong). Install once into `/usr/local/bin` so any user
can find it:

```sh
curl -LsSf https://astral.sh/uv/install.sh \
  | sudo env UV_INSTALL_DIR=/usr/local/bin sh
uv --version  # confirm
```

### 3d. Allow passwordless restart of the firmware service

`make pi-deploy` ends with `sudo systemctl restart udcpine-firmware`
over a non-interactive ssh; without NOPASSWD scoped to that one
command, the deploy hangs.

```sh
echo '<user> ALL=(root) NOPASSWD: /bin/systemctl restart udcpine-firmware' \
  | sudo tee /etc/sudoers.d/udcpine-deploy
sudo chmod 440 /etc/sudoers.d/udcpine-deploy
```

### 4. Install the systemd unit

The unit file lives in this repo at `firmware/systemd/udcpine-firmware.service`.
Copy it once (subsequent updates land via `make pi-deploy`, which only
restarts the existing unit):

```sh
# From your Mac, one-off scp:
scp firmware/systemd/udcpine-firmware.service <user>@<host>.local:/tmp/

# On the Pi:
sudo mv /tmp/udcpine-firmware.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable udcpine-firmware
```

Edit the `ExecStart` line in the unit file to point at the right backend
URL (the laptop's LAN IP, port 5001).

### 5. First deploy from the Mac

```sh
make pi-deploy PI_HOST=<user>@<host>.local
```

This runs `uv lock` locally (platform-independent), rsyncs `firmware/`
source to `/opt/udcpine-firmware/`, then runs `uv sync --frozen` on
the Pi to build the venv with platform-correct wheels, and restarts
the service.

### 6. Watch the logs

```sh
make pi-logs PI_HOST=<user>@<host>.local
```

You should see one POST per second and `204` responses from Flask.

## Day-to-day workflow

| Action | Command (from Mac) |
|---|---|
| Push a code change to the Pi | `make pi-deploy PI_HOST=<user>@<host>.local` |
| Watch live logs | `make pi-logs PI_HOST=<user>@<host>.local` |
| Restart without redeploying | `ssh <user>@<host>.local sudo systemctl restart udcpine-firmware` |
| Stop the service | `ssh <user>@<host>.local sudo systemctl stop udcpine-firmware` |

## Testing without a Pi

The firmware ships a `--simulate` flag that generates synthetic samples
in place of reading the SPI bus, so the full pipeline can be exercised
end-to-end on a laptop:

```sh
cd firmware
uv run udcpine-firmware --simulate --server http://localhost:5001
```
