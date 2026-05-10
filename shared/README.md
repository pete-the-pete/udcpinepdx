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
