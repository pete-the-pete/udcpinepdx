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
