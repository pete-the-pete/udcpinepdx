.DEFAULT_GOAL := help

include shared/Makefile.include

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

codegen: shared-codegen

test: shared-test

lint: shared-lint
