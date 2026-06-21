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
  /**
   * ISO timestamp of the active firing's FIRST pizza (its `started_at`), or
   * null while the oven is lit but no pizza has started yet ("warming up").
   * Derived server-side from pizza rows; drives idle→warm-up→cooking routing
   * and survives a kiosk reload (the /api/state snapshot only carries the
   * *active* pizza, which can't distinguish warm-up from between-pizzas).
   */
  cooking_started_at: z.string().datetime({ offset: true }).nullable(),
});

export type LiveState = z.infer<typeof LiveStateSchema>;
