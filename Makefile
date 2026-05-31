.DEFAULT_GOAL := help

include shared/Makefile.include
include web/backend/Makefile.include
include web/frontend/Makefile.include
include firmware/Makefile.include

.PHONY: help build codegen test lint dev serve e2e db-reset

help:
	@echo "Available targets:"
	@echo "  build      install all workspace deps (bun + uv)"
	@echo "  codegen    regenerate shared/generated/ from Zod sources"
	@echo "  test       run all test suites"
	@echo "  lint       run all linters"
	@echo "  dev        run Flask + Vite together (Ctrl-C stops both)"
	@echo "  serve      build the SPA + serve it from Flask on the LAN (Pi kiosk)"
	@echo "  e2e        run Playwright end-to-end tests (boots both servers)"
	@echo "  db-reset   delete the local dev SQLite database"
	@echo "  pi-build      sync firmware deps for deploy (run on Mac)"
	@echo "  pi-deploy     rsync firmware/ to PI_HOST and restart the service"
	@echo "  pi-logs       tail journald for udcpine-firmware on PI_HOST"
	@echo "  pi-kiosk-on   deploy kiosk config + activate fullscreen dashboard  (PI_HOST=user@host.local)"
	@echo "  pi-kiosk-off  remove kiosk autostart + return Pi to normal desktop  (PI_HOST=user@host.local)"

build:
	bun install
	cd shared && uv sync
	cd web/backend && uv sync

codegen: shared-codegen

test: shared-test web-backend-test

lint: shared-lint web-backend-lint web-frontend-lint

dev:
	@echo "Starting Flask (:5001) and Vite (:5173)…"
	@$(MAKE) -j2 web-backend-run web-frontend-dev

serve: web-frontend-build web-backend-serve

e2e: web-frontend-e2e

db-reset: web-backend-db-reset
