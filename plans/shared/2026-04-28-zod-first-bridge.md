# Shared Schema Bridge — Plan (Zod-first)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the shared schema bridge so every wire message between the Flask backend and the Preact frontend (and, later, the Python firmware) is defined once in Zod and runtime-validated on both sides via auto-generated Pydantic v2.

**Architecture:** Zod schemas in `shared/src/` are the single source of truth. `shared/codegen.ts` derives a **bundled JSON Schema** (one file, every type under `$defs`) into `shared/generated/schemas/all.json`. `datamodel-code-generator` reads that bundle and emits a single Pydantic module at `shared/generated/pydantic/__init__.py`. Contract tests on both sides round-trip fixture JSON through Zod and Pydantic to catch drift. CI runs the full pipeline and fails if outputs are dirty.

**Tech Stack:**
- **Monorepo:** bun workspaces (`package.json` at repo root, `"workspaces": ["shared"]`).
- **TS side:** TypeScript 6.x, Zod, `zod-to-json-schema`, **`bun test`** (built-in, no Vitest), **oxlint**, `tsc --noEmit`.
- **Python side:** Python 3.11+, Pydantic v2, `datamodel-code-generator`, pytest, ruff. Managed by `uv`.
- **Driver:** top-level `Makefile` orchestrates `make build | codegen | test | lint`.
- **Tool versions pinned** via `.bun-version` and `.python-version` files at repo root; CI reads from these.
- **Pre-commit / pre-push hooks** via the `pre-commit` framework: fast lints on commit, codegen-diff + tests on push.
- **CI:** GitHub Actions runs codegen, asserts `git diff --exit-code` is clean, then runs both test suites.

**Conscious revisions to the bootstrap plan:**
- Bootstrap said *"single JSON Schema source of truth in shared/."* This plan reverses authorship: **Zod is the source of truth**, JSON Schema is a derived artifact. Reason: Zod is more expressive and authoring it is significantly more pleasant. Cost: TS becomes the canonical author-time format, fine because TS already runs on every consumer except firmware (firmware never authors schemas, only consumes generated Pydantic).
- Bootstrap mentioned `quicktype` as a candidate. Rejected: `datamodel-code-generator` produces more ergonomic Pydantic v2; `zod-to-json-schema` is the most mature Zod → JSON Schema path.
- Bootstrap left the package manager open. **bun** for TS, **uv** for Python.

**Authoring discipline (the cost of Zod-first):**
Not every Zod feature survives the JSON Schema → Pydantic round-trip. Stick to **structural** validation:

- ✅ Allowed: `.object()`, `.array()`, `.string()`, `.number()`, `.boolean()`, `.literal()`, `.enum()`, `.nullable()`, `.optional()`, `.union()`, `.discriminatedUnion()`, `.omit()`, `.pick()`, `.partial()`, `.extend()`, `.merge()`, `.lazy()` for recursion, plain JSON-Schema-expressible constraints (`.min()`, `.max()`, `.regex()`).
- ❌ Banned in `shared/src/`: `.transform()`, `.refine()` with arbitrary predicates that don't map to a JSON Schema keyword, `.brand()`. These features have no JSON Schema equivalent and silently won't reach Python. If a consumer needs them, they apply them to schemas *imported* from `shared/`, in their own code.

This is enforced by code review for now. A custom oxlint or pre-commit rule could mechanize it later if drift becomes a real problem; not building that today (YAGNI).

**Scope of this plan:**
- Bootstrap monorepo workspace tooling (bun + uv) and version pinning.
- Stand up `shared/` as both a TS and a Python package (cohabitating in one directory by deliberate choice — see "Open question" below).
- Implement codegen pipeline end-to-end.
- Ship one canary wire type (`Firing`) through the full pipeline as proof of life.
- Contract tests on both sides for the canary.
- Pre-commit + pre-push hook setup.
- CI workflow that gates the whole thing.

**Out of scope:**
- Authoring the rest of the wire types from the live-dashboard spec — those land in Product 1's plan as needed (each new type is a tiny edit to `shared/src/` plus regen).
- Publishing `shared/` as an npm or PyPI package — local-only consumption via workspace + path.
- A linter rule that mechanically forbids `.transform()`/`.refine()`/`.brand()` in `shared/src/` — review-enforced for now.

**Open question for the user (defaulted, push back if wrong):**
- **Cohabitation of TS + Python in one `shared/` directory.** Default kept here. Alternative is `shared/typescript/` + `shared/python/` for stricter separation. I lean cohabitation because authoring + generation + consumption are all tightly coupled and splitting them adds depth without buying anything important. If you want them split, we restructure now before any code lands.

---

## File Structure

```
udcpinepdx/
├── package.json                            (NEW — workspace root)
├── Makefile                                (NEW — top-level driver)
├── .bun-version                            (NEW — single line, e.g. 1.1.30)
├── .python-version                         (NEW — single line, e.g. 3.11.9)
├── .pre-commit-config.yaml                 (NEW — pre-commit + pre-push hooks)
├── .github/workflows/ci.yml                (NEW — CI for shared/)
├── shared/
│   ├── package.json                        (NEW — TS package: zod, zod-to-json-schema)
│   ├── tsconfig.json                       (NEW — modern strict config, TS 6.x)
│   ├── pyproject.toml                      (NEW — uv-managed; pydantic, datamodel-code-generator)
│   ├── README.md                           (NEW — pipeline + discipline + how to add types)
│   ├── codegen.ts                          (NEW — Zod → bundled JSON Schema)
│   ├── Makefile.include                    (NEW — codegen + test sub-targets)
│   ├── .oxlintrc.json                      (NEW — oxlint config)
│   ├── src/
│   │   ├── index.ts                        (NEW — barrel + ALL_SCHEMAS registry)
│   │   └── firing.ts                       (NEW — canary Zod schema)
│   ├── generated/                          (GENERATED — committed; reviewed in PRs)
│   │   ├── .gitattributes                  (NEW — linguist-generated=true)
│   │   ├── schemas/
│   │   │   └── all.json
│   │   └── pydantic/
│   │       └── __init__.py
│   └── tests/
│       ├── __init__.py
│       ├── contract.test.ts                (NEW — bun test, Zod side)
│       ├── test_contract.py                (NEW — pytest, Pydantic side)
│       └── fixtures/
│           └── firing/
│               ├── valid/{active,ended}.json
│               └── invalid/{missing-status,bad-status}.json
└── .gitignore                              (MODIFY — node_modules, .venv, .ruff_cache, etc.)
```

**Why generated outputs are committed:** Two large benefits — (1) consumers `import` shared types without running codegen, (2) PR reviewers see exactly what wire shape changed. The `.gitattributes` `linguist-generated=true` collapses the diff in GitHub's UI.

---

## Task 1: Initialize bun workspace + version pinning

**Files:**
- Create: `package.json`, `.bun-version`, `.python-version`
- Modify: `.gitignore`

- [ ] **Step 1: Verify bun and uv are installed and pick exact versions**

Run: `bun --version` (record the version, e.g. `1.1.30`).
Run: `uv --version` (record the version, but uv version doesn't pin Python — that's `.python-version`).
Run: `python3 --version` (record, e.g. `3.11.9`).

If any tool is missing:
- bun: install per https://bun.sh
- uv: `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Python 3.11: `uv python install 3.11.9`

- [ ] **Step 2: Pin tool versions**

Write `.bun-version`:
```
1.1.30
```
(Use the version you recorded in Step 1.)

Write `.python-version`:
```
3.11.9
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "udcpinepdx",
  "private": true,
  "workspaces": ["shared"],
  "scripts": {
    "lint": "bun run --filter '*' lint",
    "test": "bun run --filter '*' test"
  }
}
```

- [ ] **Step 4: Update `.gitignore`**

Append (only entries not already present):
```
# Node / bun
node_modules/
dist/
.bun/
*.log
bun-debug.log*

# Python
.venv/
__pycache__/
*.pyc
.pytest_cache/
.ruff_cache/

# Editor / OS
.DS_Store
.vscode/
.idea/
```

- [ ] **Step 5: Verify**

Run: `bun install`
Expected: completes cleanly; creates `bun.lock` at repo root. (No workspace packages exist yet, so install is mostly a no-op.)

- [ ] **Step 6: Commit**

```bash
git add package.json .bun-version .python-version .gitignore bun.lock
git commit -m "chore(shared): initialize bun workspace + pin tool versions"
```

---

## Task 2: Create `shared/` TS package skeleton

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`

- [ ] **Step 1: Write `shared/package.json`**

```json
{
  "name": "@udcpine/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "codegen": "bun run codegen.ts",
    "test": "bun test tests",
    "lint": "oxlint . && tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0",
    "zod-to-json-schema": "^3.23.0"
  },
  "devDependencies": {
    "@types/bun": "^1.1.0",
    "oxlint": "^0.10.0",
    "typescript": "^6.0.0"
  }
}
```

(If TypeScript 6.x is not yet available on npm at execution time, fall back to `^5.6.0` and bump later — note in the commit if so.)

- [ ] **Step 2: Write `shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2024"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["bun"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "codegen.ts"],
  "exclude": ["node_modules", "generated"]
}
```

- [ ] **Step 3: Install**

Run from repo root: `bun install`
Expected: pulls down zod, zod-to-json-schema, oxlint, typescript, @types/bun. No errors.

- [ ] **Step 4: Commit**

```bash
git add shared/package.json shared/tsconfig.json bun.lock
git commit -m "chore(shared): scaffold TS package (TS6, oxlint, bun test)"
```

---

## Task 3: Author the canary Zod schema (`Firing`)

**Files:**
- Create: `shared/src/firing.ts`
- Create: `shared/src/index.ts`

- [ ] **Step 1: Write `shared/src/firing.ts`**

```typescript
import { z } from "zod";

/**
 * A firing is one heat-up-to-cool-down cycle of the oven.
 * Pizzas are children of a firing (added in a later plan).
 */
export const FiringSchema = z.object({
  id: z.number().int().nonnegative(),
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).nullable(),
  status: z.enum(["active", "ended"]),
});

export type Firing = z.infer<typeof FiringSchema>;
```

- [ ] **Step 2: Write `shared/src/index.ts`**

```typescript
import { FiringSchema } from "./firing.ts";

export { FiringSchema };
export type { Firing } from "./firing.ts";

/**
 * Registry of every top-level schema. The codegen walks this object;
 * every entry becomes a $defs entry in generated/schemas/all.json,
 * and a Pydantic class in generated/pydantic/__init__.py.
 */
export const ALL_SCHEMAS = {
  Firing: FiringSchema,
} as const;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd shared && bun x tsc --noEmit`
Expected: PASS (no type errors). oxlint config doesn't exist yet, so `bun --filter @udcpine/shared run lint` will fail on the oxlint half — that's fine, the lint config lands in Task 10.

- [ ] **Step 4: Commit**

```bash
git add shared/src/
git commit -m "feat(shared): canary Firing Zod schema"
```

---

## Task 4: Implement Zod → bundled JSON Schema codegen

**Files:**
- Create: `shared/codegen.ts`

- [ ] **Step 1: Write `shared/codegen.ts`**

```typescript
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ALL_SCHEMAS } from "./src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "generated", "schemas");
const OUT_FILE = join(OUT_DIR, "all.json");

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// Bundle every registered schema under $defs in a single JSON Schema document.
// Cross-references between top-level types resolve via $ref to #/$defs/<Name>.
const bundle: Record<string, unknown> = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "udcpine wire types",
  $defs: {},
};

const defs = bundle["$defs"] as Record<string, unknown>;

for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
  // zod-to-json-schema produces a {$ref, definitions} shape when given a name;
  // we lift the named definition out and store it directly under $defs.
  const generated = zodToJsonSchema(schema, {
    name,
    target: "jsonSchema7",
    $refStrategy: "root",
    definitionPath: "$defs",
  });
  // The generated object has shape: { $ref: "#/$defs/<name>", $defs: { <name>: {...} } }
  // Pull the inner definition out.
  const inner =
    (generated as { $defs?: Record<string, unknown> }).$defs?.[name] ?? generated;
  defs[name] = inner;
}

writeFileSync(OUT_FILE, JSON.stringify(bundle, null, 2) + "\n", "utf8");
console.log(`wrote ${OUT_FILE} with ${Object.keys(defs).length} schema(s)`);
```

**Future-extension note (in a comment in the file too):** when more than one schema lands in `ALL_SCHEMAS` and they cross-reference, verify the bundle's `$ref` paths resolve. zod-to-json-schema's `$refStrategy: "root"` with `definitionPath: "$defs"` is the right setting; if it produces relative refs that `datamodel-code-generator` can't follow, switch to inlining (set `$refStrategy: "none"`) or post-process the bundle.

- [ ] **Step 2: Run the codegen**

Run from repo root: `cd shared && bun run codegen.ts`
Expected: prints `wrote .../shared/generated/schemas/all.json with 1 schema(s)`.

- [ ] **Step 3: Inspect the output**

Read: `shared/generated/schemas/all.json`
Expected: a JSON object with `$defs.Firing` containing `properties.id`, `properties.started_at`, `properties.ended_at`, `properties.status`, and `required: ["id", "started_at", "ended_at", "status"]`.

If the shape is off (e.g. `Firing` ends up at the top level instead of under `$defs`), adjust the lift-out logic in `codegen.ts` based on what `zod-to-json-schema` actually emitted.

- [ ] **Step 4: Add a `.gitattributes` for the generated tree**

Write `shared/generated/.gitattributes`:
```
* linguist-generated=true
```

- [ ] **Step 5: Commit**

```bash
git add shared/codegen.ts shared/generated/.gitattributes shared/generated/schemas/all.json
git commit -m "feat(shared): zod-to-json-schema codegen (bundled all.json)"
```

---

## Task 5: Bootstrap `shared/` Python package with uv

**Files:**
- Create: `shared/pyproject.toml`
- Create: `shared/generated/pydantic/__init__.py` (placeholder)

- [ ] **Step 1: Write `shared/pyproject.toml`**

```toml
[project]
name = "udcpine-shared"
version = "0.0.0"
description = "Shared wire types for udcpinepdx — generated from Zod sources"
requires-python = ">=3.11"
dependencies = [
  "pydantic>=2.7,<3",
]

[dependency-groups]
dev = [
  "datamodel-code-generator>=0.25.0",
  "pytest>=8.0",
  "ruff>=0.4",
]

[tool.uv]
package = true

[tool.hatch.build.targets.wheel]
packages = ["generated/pydantic"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.ruff]
target-version = "py311"
line-length = 100
extend-exclude = ["generated"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Create placeholder for the generated package**

Write `shared/generated/pydantic/__init__.py`:
```python
# Generated package — do not edit. Regenerate with `make codegen`.
```

- [ ] **Step 3: Sync the venv**

Run: `cd shared && uv sync`
Expected: creates `shared/.venv/`, installs pydantic, datamodel-code-generator, pytest, ruff. No errors.

- [ ] **Step 4: Commit**

```bash
git add shared/pyproject.toml shared/generated/pydantic/__init__.py shared/uv.lock
git commit -m "chore(shared): scaffold Python package with uv"
```

---

## Task 6: Wire `datamodel-code-generator` + Makefile orchestration

**Files:**
- Create: `shared/Makefile.include`
- Create: `Makefile` (top-level)

- [ ] **Step 1: Write `shared/Makefile.include`**

```make
SHARED_DIR := shared

.PHONY: shared-codegen-ts shared-codegen-py shared-codegen shared-test-ts shared-test-py shared-test shared-lint

shared-codegen-ts:
	cd $(SHARED_DIR) && bun run codegen.ts

shared-codegen-py: shared-codegen-ts
	cd $(SHARED_DIR) && uv run datamodel-codegen \
	  --input generated/schemas/all.json \
	  --input-file-type jsonschema \
	  --output generated/pydantic/__init__.py \
	  --output-model-type pydantic_v2.BaseModel \
	  --use-double-quotes \
	  --target-python-version 3.11 \
	  --use-schema-description \
	  --enum-field-as-literal all \
	  --disable-timestamp
	@# Re-add the "do not edit" banner that datamodel-codegen overwrites.
	@printf '# Generated package — do not edit. Regenerate with `make codegen`.\n%s\n' "$$(cat $(SHARED_DIR)/generated/pydantic/__init__.py)" > $(SHARED_DIR)/generated/pydantic/__init__.py.tmp
	@mv $(SHARED_DIR)/generated/pydantic/__init__.py.tmp $(SHARED_DIR)/generated/pydantic/__init__.py

shared-codegen: shared-codegen-py

shared-test-ts:
	cd $(SHARED_DIR) && bun test tests

shared-test-py:
	cd $(SHARED_DIR) && uv run pytest

shared-test: shared-test-ts shared-test-py

shared-lint:
	cd $(SHARED_DIR) && bun run lint
	cd $(SHARED_DIR) && uv run ruff check .
```

- [ ] **Step 2: Write top-level `Makefile`**

```make
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
```

- [ ] **Step 3: Run codegen end-to-end**

Run: `make codegen`
Expected:
- `shared/generated/schemas/all.json` regenerated.
- `shared/generated/pydantic/__init__.py` now contains a `class Firing(BaseModel)` with fields `id`, `started_at`, `ended_at`, `status`. The "do not edit" banner is preserved at the top.

- [ ] **Step 4: Inspect Pydantic output**

Read: `shared/generated/pydantic/__init__.py`
Expected:
- Top of file has the "do not edit" banner.
- A `class Firing(BaseModel)` with `id: int`, `started_at: datetime`, `ended_at: Optional[datetime]` (or `datetime | None`), `status: Literal["active", "ended"]`.

If the field types look wrong, adjust the `datamodel-codegen` flags. Useful flags: `--use-standard-collections`, `--use-union-operator`, `--field-constraints`, `--use-schema-description`.

- [ ] **Step 5: Verify import works**

Run: `cd shared && uv run python -c "from generated.pydantic import Firing; print(Firing.model_fields.keys())"`
Expected: `dict_keys(['id', 'started_at', 'ended_at', 'status'])`.

**Naming-collision note:** the package is called `generated.pydantic` (a sub-namespace of `generated/`), not bare `pydantic`. This deliberately avoids the collision with the third-party `pydantic` library. Tests in Task 9 use the same import path.

- [ ] **Step 6: Commit**

```bash
git add Makefile shared/Makefile.include shared/generated/pydantic/__init__.py
git commit -m "feat(shared): jsonschema-to-pydantic codegen + Makefile"
```

---

## Task 7: Add canary fixtures (Firing valid + invalid)

**Files:**
- Create: `shared/tests/fixtures/firing/valid/active.json`
- Create: `shared/tests/fixtures/firing/valid/ended.json`
- Create: `shared/tests/fixtures/firing/invalid/missing-status.json`
- Create: `shared/tests/fixtures/firing/invalid/bad-status.json`

- [ ] **Step 1: Write `shared/tests/fixtures/firing/valid/active.json`**

```json
{
  "id": 1,
  "started_at": "2026-04-28T18:00:00-07:00",
  "ended_at": null,
  "status": "active"
}
```

- [ ] **Step 2: Write `shared/tests/fixtures/firing/valid/ended.json`**

```json
{
  "id": 2,
  "started_at": "2026-04-28T18:00:00-07:00",
  "ended_at": "2026-04-28T20:14:33-07:00",
  "status": "ended"
}
```

- [ ] **Step 3: Write `shared/tests/fixtures/firing/invalid/missing-status.json`**

```json
{
  "id": 3,
  "started_at": "2026-04-28T18:00:00-07:00",
  "ended_at": null
}
```

- [ ] **Step 4: Write `shared/tests/fixtures/firing/invalid/bad-status.json`**

```json
{
  "id": 4,
  "started_at": "2026-04-28T18:00:00-07:00",
  "ended_at": null,
  "status": "smoldering"
}
```

- [ ] **Step 5: Commit**

```bash
git add shared/tests/fixtures/
git commit -m "test(shared): firing fixtures (valid + invalid)"
```

---

## Task 8: bun test contract test (TS / Zod side)

**Files:**
- Create: `shared/tests/contract.test.ts`

- [ ] **Step 1: Write `shared/tests/contract.test.ts`**

```typescript
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_SCHEMAS } from "../src/index.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");

function loadFixtures(typeLower: string, kind: "valid" | "invalid"): [string, unknown][] {
  const dir = join(FIXTURES, typeLower, kind);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f): [string, unknown] => [f, JSON.parse(readFileSync(join(dir, f), "utf8"))]);
}

describe("contract: Zod parses fixtures", () => {
  for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
    const lower = name.toLowerCase();

    for (const [filename, payload] of loadFixtures(lower, "valid")) {
      it(`${name} accepts ${filename}`, () => {
        const result = schema.safeParse(payload);
        if (!result.success) {
          throw new Error(`unexpected rejection: ${JSON.stringify(result.error.issues, null, 2)}`);
        }
        expect(result.success).toBe(true);
      });
    }

    for (const [filename, payload] of loadFixtures(lower, "invalid")) {
      it(`${name} rejects ${filename}`, () => {
        const result = schema.safeParse(payload);
        expect(result.success).toBe(false);
      });
    }
  }
});
```

- [ ] **Step 2: Run the test suite**

Run: `make shared-test-ts`
Expected: 4 tests, all PASS (2 valid accepted, 2 invalid rejected).

If FAIL: confirm fixture paths match `Firing.toLowerCase() === "firing"`.

- [ ] **Step 3: Commit**

```bash
git add shared/tests/contract.test.ts
git commit -m "test(shared): bun test contract test (zod side)"
```

---

## Task 9: pytest contract test (Python / Pydantic side)

**Files:**
- Create: `shared/tests/__init__.py`
- Create: `shared/tests/test_contract.py`

- [ ] **Step 1: Write `shared/tests/__init__.py`**

Empty file.

- [ ] **Step 2: Write `shared/tests/test_contract.py`**

```python
"""Contract tests: Pydantic accepts every valid fixture and rejects every invalid one."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from generated.pydantic import Firing

FIXTURES = Path(__file__).parent / "fixtures"

# Map each Pydantic model to its fixture directory name.
MODELS = {
    "firing": Firing,
}


def _load(type_lower: str, kind: str) -> list[tuple[str, dict]]:
    folder = FIXTURES / type_lower / kind
    return [
        (f.name, json.loads(f.read_text()))
        for f in sorted(folder.glob("*.json"))
    ]


@pytest.mark.parametrize(
    "type_lower,filename,payload",
    [(t, fn, p) for t in MODELS for fn, p in _load(t, "valid")],
)
def test_valid_fixture_parses(type_lower: str, filename: str, payload: dict) -> None:
    model = MODELS[type_lower]
    instance = model.model_validate(payload)
    # Round-trip equivalence — emit JSON, re-parse, expect Pydantic equality.
    # Direct `json.dumps == fixture` would fail on datetime normalization differences.
    re_parsed = model.model_validate(json.loads(instance.model_dump_json()))
    assert re_parsed == instance


@pytest.mark.parametrize(
    "type_lower,filename,payload",
    [(t, fn, p) for t in MODELS for fn, p in _load(t, "invalid")],
)
def test_invalid_fixture_rejected(type_lower: str, filename: str, payload: dict) -> None:
    model = MODELS[type_lower]
    with pytest.raises(ValidationError):
        model.model_validate(payload)
```

- [ ] **Step 3: Run pytest**

Run: `make shared-test-py`
Expected: 4 tests, all PASS.

If `from generated.pydantic import Firing` fails with `ModuleNotFoundError`, confirm:
- `shared/generated/__init__.py` exists. (If not, create an empty one.)
- `shared/generated/pydantic/__init__.py` exports `Firing` (datamodel-code-generator should have placed `class Firing` directly in this file).
- pytest is being invoked with the `shared/` cwd so `generated/` is importable.

- [ ] **Step 4: Add `shared/generated/__init__.py` if it was missing**

Write (only if Step 3 needed it):
```python
# Generated namespace — do not edit. Regenerate with `make codegen`.
```

- [ ] **Step 5: Commit**

```bash
git add shared/tests/__init__.py shared/tests/test_contract.py shared/generated/__init__.py
git commit -m "test(shared): pytest contract test (pydantic side)"
```

---

## Task 10: oxlint config

**Files:**
- Create: `shared/.oxlintrc.json`

- [ ] **Step 1: Write `shared/.oxlintrc.json`**

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": {
    "correctness": "error",
    "suspicious": "warn"
  },
  "ignorePatterns": [
    "generated/**",
    "node_modules/**",
    ".venv/**",
    "dist/**"
  ]
}
```

- [ ] **Step 2: Run lint**

Run: `make lint`
Expected: PASS for both TS (`oxlint .` + `tsc --noEmit`) and Python (`ruff check .`). If oxlint complains about the `$schema` path on first run because the schema file isn't installed where the path points, drop the `$schema` field — it's only an editor hint.

- [ ] **Step 3: Commit**

```bash
git add shared/.oxlintrc.json
git commit -m "chore(shared): oxlint config"
```

---

## Task 11: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  shared:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version-file: .python-version

      - name: Install uv
        uses: astral-sh/setup-uv@v3
        with:
          enable-cache: true

      - name: Install workspace deps
        run: make build

      - name: Regenerate codegen outputs
        run: make codegen

      - name: Verify codegen is up to date
        run: |
          if ! git diff --exit-code -- shared/generated; then
            echo "::error::Codegen outputs are out of date. Run 'make codegen' locally and commit."
            exit 1
          fi

      - name: Lint
        run: make lint

      - name: Test
        run: make test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(shared): codegen verification + tests"
```

- [ ] **Step 3: Verify CI runs (after merge / push)**

Pushing requires explicit user confirmation per project safety rails — **stop here and ask the user before pushing.** After they approve and the push happens, open the GitHub Actions tab and confirm the `CI / shared` job passes end-to-end. Fix any failures locally and push a follow-up; do not work around CI.

---

## Task 12: README — pipeline, discipline, how to add types

**Files:**
- Create: `shared/README.md`

- [ ] **Step 1: Write `shared/README.md`**

````markdown
# `shared/` — Wire-type bridge between TypeScript and Python

This package owns every wire type that crosses a boundary in udcpinepdx
(Flask ↔ browser SPA, and eventually Flask ↔ Pi firmware). Authored in
**Zod**, runtime-validated on both sides via auto-generated Pydantic v2.

## Pipeline

```
src/*.ts           ──bun run codegen──▶   generated/schemas/all.json   ──datamodel-code-generator──▶   generated/pydantic/__init__.py
(source of truth)                          (bundled JSON Schema)                                        (consumed by Python)
```

Generated outputs live under `generated/` and are committed. CI regenerates
on every PR and fails if the diff is non-empty. The `.gitattributes` flag
collapses generated files in GitHub diffs.

## Consuming `shared/`

Each Zod source file exports both the schema (runtime validator) and the
inferred type (compile-time). The TS package's `main` and `types` both
point at `./src/index.ts`, so importers get raw `.ts` — no build step is
needed for `shared/` itself. bun and Vite handle workspace `.ts` imports
natively.

### Frontend (TypeScript / Preact) — uses Zod directly

**1. Compile-time types for props, state, function signatures.**

```typescript
import type { Firing, FiringState } from "@udcpine/shared";

function FiringHeader({ firing }: { firing: Firing }) {
  return <h1>Firing #{firing.id}</h1>;
}

const [state, setState] = useState<FiringState | null>(null);
```

**2. Validating REST responses.**

```typescript
import { FiringStateSchema } from "@udcpine/shared";

const r = await fetch("/api/state");
const state = FiringStateSchema.parse(await r.json());
// `state` is inferred as FiringState and validated at runtime.
```

**3. Validating SSE events** (TS narrows the discriminated union by `type`).

```typescript
import { LiveEventSchema } from "@udcpine/shared";

const es = new EventSource("/api/stream");
es.onmessage = (e) => {
  const result = LiveEventSchema.safeParse(JSON.parse(e.data));
  if (!result.success) {
    console.error("malformed event", result.error);
    return;
  }
  switch (result.data.type) {
    case "sample":         handleSample(result.data); break;
    case "pizza_started":  handlePizzaStarted(result.data); break;
    // ...
  }
};
```

**4. Constructing typed request bodies.**

```typescript
import { StartPizzaRequestSchema, type StartPizzaRequest } from "@udcpine/shared";

const body: StartPizzaRequest = {};
StartPizzaRequestSchema.parse(body);  // optional self-check before send
await fetch("/api/pizza/start", { method: "POST", body: JSON.stringify(body) });
```

### Backend (Python / Flask) — uses generated Pydantic

```python
from generated.pydantic import Firing, StartPizzaRequest
from pydantic import ValidationError

@app.post("/api/pizza/start")
def start_pizza():
    try:
        StartPizzaRequest.model_validate(request.get_json())
    except ValidationError as e:
        return e.errors(), 400
    # ... domain logic ...
    return Firing(...).model_dump_json()
```

### What this buys end-to-end

- **Rename a field in `src/`, run `make codegen`, push.** Backend rejects
  old-shape requests via `ValidationError`; frontend rejects old-shape
  responses via Zod; CI contract tests fail if fixtures weren't updated.
  No silent corruption.
- **Change Zod source but forget `make codegen`.** CI's
  `git diff --exit-code` step fails. Pre-push hook catches it before push.
- **Frontend uses a field the backend never defined.** TypeScript fails
  at compile time because the type doesn't have that field.
- **Author-time funnel is one-way:** Zod source is upstream of JSON Schema,
  which is upstream of Pydantic. There is exactly one place to edit a wire
  shape.

## Authoring discipline

**Zod features that survive the round-trip to Pydantic:**

✅ `.object()`, `.array()`, `.string()`, `.number()`, `.boolean()`, `.literal()`,
`.enum()`, `.nullable()`, `.optional()`, `.union()`, `.discriminatedUnion()`,
`.omit()`, `.pick()`, `.partial()`, `.extend()`, `.merge()`, `.lazy()`,
`.min()`/`.max()`/`.regex()` constraints.

❌ Banned in `src/`: `.transform()`, `.refine()` with custom predicates,
`.brand()`. These have no JSON Schema equivalent and won't reach the Python
side. If a consumer needs them, apply them to schemas *imported from this
package*, in the consumer's own code.

This discipline is enforced by code review. A linter rule may mechanize
it later if drift becomes a real problem.

## Adding a new wire type

1. Author `src/<name>.ts` exporting `<Name>Schema` and the inferred type.
2. Add it to `ALL_SCHEMAS` in `src/index.ts`.
3. Add fixtures under `tests/fixtures/<name-lower>/{valid,invalid}/`
   (at least one of each).
4. Add the model to the `MODELS` dict in `tests/test_contract.py`.
5. Run `make codegen test`. Commit `src/`, `tests/`, and the regenerated `generated/`.

## Local commands

```bash
make build       # install bun + uv deps
make codegen     # regenerate generated/
make test        # run both contract suites
make lint        # oxlint + tsc + ruff
```
````

- [ ] **Step 2: Run the full pipeline once more end-to-end**

Run: `make build && make codegen && make lint && make test`
Expected: all PASS, `git status` shows no diff under `shared/generated/`.

- [ ] **Step 3: Commit**

```bash
git add shared/README.md
git commit -m "docs(shared): README explaining the bridge"
```

---

## Task 13: Pre-commit + pre-push hooks

**Files:**
- Create: `.pre-commit-config.yaml`

**Goals:**
- **Pre-commit (must be fast, <2s):** ruff format/check, oxlint, tsc.
- **Pre-push (slower, OK to take a few seconds):** `make codegen` + diff check, `make test`.

This way you can commit broken code mid-thought, but the repo guarantees nothing broken reaches `origin`.

- [ ] **Step 1: Install pre-commit (pinned)**

Run: `uv tool install 'pre-commit==4.0.1'`

Why pinned: matches the rest of the plan's "pin everything" discipline. Use whatever stable version is current at execution time; pin the exact version in the command so re-running the bootstrap is deterministic. Upgrade later via `uv tool upgrade pre-commit` and update this line.

Why `uv tool install` (not `uv add`): `uv tool install` puts pre-commit on PATH globally via uv's shim dir, like `pipx install`. `uv add` would install into `shared/.venv` only, where git hooks can't find it. Pre-commit is repo-wide tooling, not a `shared/` dependency.

Expected: `pre-commit` is on PATH. Verify: `pre-commit --version` prints `4.0.1` (or whatever you pinned).

- [ ] **Step 2: Write `.pre-commit-config.yaml`**

```yaml
repos:
  # Fast, runs on every commit
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.6.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  - repo: local
    hooks:
      - id: oxlint
        name: oxlint (shared/)
        entry: bash -c 'cd shared && bun run --silent oxlint .'
        language: system
        types_or: [ts, tsx, javascript]
        pass_filenames: false

      - id: tsc-shared
        name: tsc --noEmit (shared/)
        entry: bash -c 'cd shared && bun x tsc --noEmit'
        language: system
        types_or: [ts, tsx]
        pass_filenames: false

  # Slow, runs only on push
  - repo: local
    hooks:
      - id: codegen-up-to-date
        name: shared codegen up-to-date
        entry: bash -c 'make codegen && git diff --exit-code -- shared/generated'
        language: system
        stages: [pre-push]
        pass_filenames: false

      - id: tests
        name: shared tests
        entry: make test
        language: system
        stages: [pre-push]
        pass_filenames: false
```

- [ ] **Step 3: Install the hooks**

Run: `pre-commit install --install-hooks && pre-commit install --hook-type pre-push`
Expected: hooks installed under `.git/hooks/pre-commit` and `.git/hooks/pre-push`.

- [ ] **Step 4: Test the pre-commit path**

Make a tiny edit (e.g. add a trailing newline to `shared/README.md`), `git add`, `git commit -m "test"`. Hooks should run; the test commit should succeed.

Then revert the test commit: `git reset --soft HEAD~1 && git checkout -- shared/README.md`.

- [ ] **Step 5: Test the pre-push path (locally, without pushing)**

Run: `pre-commit run --hook-stage pre-push --all-files`
Expected: codegen up-to-date check and tests both PASS.

- [ ] **Step 6: Commit the config**

```bash
git add .pre-commit-config.yaml
git commit -m "chore(shared): pre-commit + pre-push hooks"
```

---

## Task 14: Final integration verification

**Files:** none (verification only).

- [ ] **Step 1: Cold-start verification**

From a clean shell:
```bash
make build
make codegen
make lint
make test
```
Expected: every step PASSes, `git status` shows no diff anywhere, including `shared/generated/`.

- [ ] **Step 2: Drift detection sanity check**

Edit `shared/src/firing.ts` and rename a field (e.g. `id` → `firing_id`). Run `make codegen`. Confirm:
- `shared/generated/schemas/all.json` shows the rename.
- `shared/generated/pydantic/__init__.py` shows the rename.
- `bun test` and `pytest` both fail because fixtures still use `id`.

Revert the experiment: `git checkout -- shared/`.

- [ ] **Step 3: Done**

No commit.

---

## Self-review checklist

- [ ] Every file in the file structure has a creating task.
- [ ] No "TBD", "TODO", or "implement later" in any task body.
- [ ] Pydantic import path in `tests/test_contract.py` (`from generated.pydantic import Firing`) matches the layout produced by Task 6.
- [ ] Fixture directory names (`firing/`) match what `contract.test.ts` and `test_contract.py` expect (`Firing.toLowerCase()`).
- [ ] CI workflow runs `make build`, `make codegen`, diff check, `make lint`, `make test` in that order.
- [ ] CI uses `bun-version-file: .bun-version` and `python-version-file: .python-version` (no floating `latest`).
- [ ] All commit messages follow repo style (`feat(scope):` / `chore(scope):` / `test(scope):` / `ci(scope):` / `docs(scope):`).
- [ ] Pre-push hook covers what CI covers, so local push gates ≈ remote CI gates.
- [ ] Banned-Zod-feature discipline is documented in README and explicitly listed.
- [ ] Pinned tool versions (`.bun-version`, `.python-version`) exist and are referenced from CI.
