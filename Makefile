.DEFAULT_GOAL := help

include shared/Makefile.include
include web/backend/Makefile.include

.PHONY: help build codegen test lint

help:
	@echo "Available targets:"
	@echo "  build     install all workspace deps (bun + uv)"
	@echo "  codegen   regenerate shared/generated/ from Zod sources"
	@echo "  test      run all test suites"
	@echo "  lint      run all linters"

build:
	bun install
	cd shared && uv sync
	cd web/backend && uv sync

codegen: shared-codegen

test: shared-test web-backend-test

lint: shared-lint web-backend-lint
