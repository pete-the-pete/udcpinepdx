import { z } from "zod";
import { FiringSchema } from "./firing.ts";
import { SampleSchema } from "./sample.ts";
import { PizzaSchema } from "./pizza.ts";

/**
 * Snapshot DTO returned by GET /api/state. Carries everything the dashboard
 * needs to render "what's happening right now" in a single fetch:
 *   - the firing (null when the oven is idle between sessions),
 *   - the most recent thermocouple reading (null before sensord first reports),
 *   - the active pizza (null between pizzas).
 *
 * SSE pushes `LiveEvent` values that incrementally update the fields of this
 * snapshot client-side.
 */
export const LiveStateSchema = z.object({
  firing: FiringSchema.nullable(),
  latest_sample: SampleSchema.nullable(),
  active_pizza: PizzaSchema.nullable(),
});

export type LiveState = z.infer<typeof LiveStateSchema>;
