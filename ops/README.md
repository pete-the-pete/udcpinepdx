# Ops

## Running the web app for the Pi (laptop as server)

Until Flask runs on the Pi itself, the laptop hosts the whole web app and the
Pi just opens a URL in its browser. Both must be on the same Wi-Fi.

### How it fits together

In dev (`make dev`) the frontend runs on Vite (`:5173`) with hot reload and
proxies `/api` to Flask (`:5001`) — two servers. For the Pi we don't need hot
reload, so instead Flask serves the **built** SPA from `web/frontend/dist/`
on the same origin as `/api/*`. One server, one URL, no CORS, and the session
cookie attaches automatically.

### Authorizing the Pi (no camera, so no QR pairing)

The Pi can't scan the phone-pairing QR. Instead it uses the **bootstrap
token**, which is reusable and grants a session on visit. Set it to a short,
typeable value:

```sh
export UDCPINE_BOOTSTRAP_TOKEN=1234abcdef
```

On start, Flask prints the kiosk URL, e.g.:

```
🔑  Pair a device:  http://<laptop-host>:5001/?t=1234abcdef
```

### Laptop steps

```sh
export UDCPINE_BOOTSTRAP_TOKEN=1234abcdef
make serve   # builds the SPA, then serves it on 0.0.0.0:5001
```

macOS will prompt once to allow incoming connections — accept it.

Find the laptop's mDNS hostname with `scutil --get LocalHostName` (the Pi
reaches it as `<name>.local`).

### Pi steps

Open Chrome on the Pi and go to (once):

```
http://<laptop-host>.local:5001/?t=1234abcdef
```

The SPA exchanges the token for a 30-day cookie and strips `?t=` from the URL.
**Bookmark the full `?t=` URL as the Pi's homepage** — auth is in-memory, so
after a laptop restart the cookie is gone; reopening the bookmarked URL
silently re-authorizes. (Persisting sessions across restarts is deliberately
out of scope for now.)

### Security note

This is plain HTTP on a home LAN — anyone on the Wi-Fi can read the token in
transit. That's an accepted tradeoff for a kitchen kiosk; it is **not**
internet-safe. To revoke access, change `UDCPINE_BOOTSTRAP_TOKEN` and restart
(this drops every paired device, not just the Pi).
