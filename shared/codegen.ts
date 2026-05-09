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
// Future-extension note: when more than one schema lands in ALL_SCHEMAS and
// they cross-reference, verify the bundle's $ref paths resolve.
// zod-to-json-schema's $refStrategy: "root" with definitionPath: "$defs" is
// the right setting; if it produces refs datamodel-code-generator can't
// follow, switch to inlining ($refStrategy: "none") or post-process.
const bundle: Record<string, unknown> = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "udcpine wire types",
  $defs: {},
};

const defs = bundle["$defs"] as Record<string, unknown>;

for (const [name, schema] of Object.entries(ALL_SCHEMAS)) {
  // zod-to-json-schema produces a {$ref, $defs} shape when given a name;
  // we lift the named definition out and store it directly under $defs.
  const generated = zodToJsonSchema(schema, {
    name,
    target: "jsonSchema7",
    $refStrategy: "root",
    definitionPath: "$defs",
  });
  const inner =
    (generated as { $defs?: Record<string, unknown> }).$defs?.[name] ?? generated;
  defs[name] = inner;
}

writeFileSync(OUT_FILE, JSON.stringify(bundle, null, 2) + "\n", "utf8");
console.log(`wrote ${OUT_FILE} with ${Object.keys(defs).length} schema(s)`);
