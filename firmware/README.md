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

### 4. Install the systemd unit

The unit file lives in this repo at `firmware/systemd/udcpine-firmware.service`.
Copy it once (subsequent updates land via `make pi-deploy`, which only
restarts the existing unit):

```sh
# From your Mac, one-off scp:
scp firmware/systemd/udcpine-firmware.service pi@<host>:/tmp/

# On the Pi:
sudo mv /tmp/udcpine-firmware.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable udcpine-firmware
```

Edit the `ExecStart` line in the unit file to point at the right backend
URL (the laptop's LAN IP, port 5001).

### 5. First deploy from the Mac

```sh
make pi-deploy PI_HOST=pi@<host>
```

This runs `uv sync --frozen` locally, then rsyncs `firmware/` to
`/opt/udcpine-firmware/` and restarts the service.

### 6. Watch the logs

```sh
make pi-logs PI_HOST=pi@<host>
```

You should see one POST per second and `204` responses from Flask.

## Day-to-day workflow

| Action | Command (from Mac) |
|---|---|
| Push a code change to the Pi | `make pi-deploy PI_HOST=pi@<host>` |
| Watch live logs | `make pi-logs PI_HOST=pi@<host>` |
| Restart without redeploying | `ssh pi@<host> sudo systemctl restart udcpine-firmware` |
| Stop the service | `ssh pi@<host> sudo systemctl stop udcpine-firmware` |

## Testing without a Pi

The firmware ships a `--simulate` flag that generates synthetic samples
in place of reading the SPI bus, so the full pipeline can be exercised
end-to-end on a laptop:

```sh
cd firmware
uv run udcpine-firmware --simulate --server http://localhost:5001
```
