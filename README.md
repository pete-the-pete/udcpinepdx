# udcpinepdx

A custom insulated door for a wood-fired chiminea pizza oven, instrumented
with a Raspberry Pi for live temperature readout, session stopwatch, remote
session logging, and (stretch) an inward-facing camera for watching the pie.

This repository is the **software** side of the project: firmware for the Pi,
a backend API, a web dashboard, and the shared schemas that keep them all
honest. The physical door build (materials, cutting, fitment) is tracked as
documentation under [`plans/hardware/`](plans/hardware/).

## Status

**Bootstrap.** The repo exists, conventions are set, no code has been written
yet. Every subsystem (firmware, backend, web, shared, ops) will get its own
plan in [`plans/`](plans/) before any source lands.

## Learning goals

This project doubles as a learning vehicle. Design decisions are made with
these goals in mind — if a choice is a wash on the merits, the one that
teaches more wins:

1. Harnessing Claude to do extensive work autonomously.
2. Raspberry Pi and home electronics: display controller, Wi-Fi, multi-device
   communication.
3. Security and access.
4. End-to-end type safety from database → API → frontend — and across the
   Python/TypeScript boundary to the Pi firmware.
5. Customizing and leveraging Claude Code (skills, hooks, measuring and
   minimizing token spend).
6. GitHub to its full potential (Actions, branch protection, issues,
   releases, environments).

## Architecture sketch

- **Pi firmware** — Python only. Drives the OLED/LCD, reads the thermocouple,
  owns the camera (if added), and uploads session data to the backend over
  HTTPS or MQTT. No local webserver. The physical display is the local UI.
- **Backend** — TypeScript, tRPC + Zod. Receives session data from Pi,
  stores it, exposes an authenticated API to the web dashboard.
- **Web** — TypeScript, consumes the backend's tRPC router. Live session
  view, history, dashboards.
- **Shared** — A single JSON Schema source of truth for every message on
  the wire. Codegen emits Zod schemas (for TS) and Pydantic models (for
  Python), so both sides of the Pi/backend boundary runtime-validate the
  same contract. This is how "end-to-end type safety" extends across the
  language boundary without running Node on the Pi.
- **Ops** — GitHub Actions, branch protection, Dependabot, secrets hygiene.

## Where to start reading

1. [`CLAUDE.md`](CLAUDE.md) — project conventions every Claude Code session
   in this repo should follow.
2. [`plans/README.md`](plans/README.md) — how plans are organized.
3. [`plans/2026-04-13-bootstrap.md`](plans/2026-04-13-bootstrap.md) — why
   things are set up the way they are.

Source directories (`firmware/`, `backend/`, `web/`, `shared/`) do not exist
yet. They will appear as their corresponding plans in [`plans/`](plans/) are
written and executed.
