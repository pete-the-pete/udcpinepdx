.DEFAULT_GOAL := help

include shared/Makefile.include
include web/backend/Makefile.include
include web/frontend/Makefile.include

.PHONY: help build codegen test lint dev e2e db-reset

help:
	@echo "Available targets:"
	@echo "  build     install all workspace deps (bun + uv)"
	@echo "  codegen   regenerate shared/generated/ from Zod sources"
	@echo "  test      run all test suites"
	@echo "  lint      run all linters"
	@echo "  dev       run Flask + Vite together (Ctrl-C stops both)"
	@echo "  e2e       run Playwright end-to-end tests (boots both servers)"
	@echo "  db-reset  delete the local dev SQLite database"

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

e2e: web-frontend-e2e

db-reset: web-backend-db-reset
