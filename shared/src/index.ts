import { FiringSchema } from "./firing.ts";
import { SampleSchema } from "./sample.ts";
import { PizzaSchema } from "./pizza.ts";
import { LiveStateSchema } from "./live-state.ts";

export { FiringSchema, SampleSchema, PizzaSchema, LiveStateSchema };
export type { Firing } from "./firing.ts";
export type { Sample } from "./sample.ts";
export type { Pizza } from "./pizza.ts";
export type { LiveState } from "./live-state.ts";

/**
 * Registry of every top-level schema. The codegen walks this object;
 * every entry becomes a $defs entry in generated/schemas/all.json,
 * and a Pydantic class in generated/pydantic/__init__.py.
 */
export const ALL_SCHEMAS = {
  Firing: FiringSchema,
  Sample: SampleSchema,
  Pizza: PizzaSchema,
  LiveState: LiveStateSchema,
} as const;
