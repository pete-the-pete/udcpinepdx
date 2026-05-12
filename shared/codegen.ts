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
//
// We make a SINGLE call to zodToJsonSchema with all schemas registered as
// `definitions`. When the function encounters one of these schemas as a nested
// property (e.g. FiringSchema inside LiveStateSchema), it emits a $ref pointing
// at the sibling $defs entry instead of inlining the object. This keeps the
// bundle compact AND lets datamodel-code-generator reuse a single Pydantic
// class per type, instead of generating anonymous duplicates (LatestSample,
// ActivePizza, etc.) for each inlined occurrence.
//
// The first arg is a dummy wrapper schema we discard; we only keep $defs.
const generated = zodToJsonSchema(ALL_SCHEMAS.Firing, {
  definitions: ALL_SCHEMAS as unknown as Record<string, never>,
  target: "jsonSchema7",
  $refStrategy: "root",
  definitionPath: "$defs",
  basePath: ["#"],
});

const defs = (generated as { $defs?: Record<string, unknown> }).$defs ?? {};

const bundle = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "udcpine wire types",
  $defs: defs,
};

writeFileSync(OUT_FILE, JSON.stringify(bundle, null, 2) + "\n", "utf8");
console.log(`wrote ${OUT_FILE} with ${Object.keys(defs).length} schema(s)`);
