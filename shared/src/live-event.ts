import { z } from "zod";
import { FiringSchema } from "./firing.ts";
import { PizzaSchema } from "./pizza.ts";

/**
 * Payload of one SSE message on /api/stream. Discriminated by `type`.
 * The frontend uses a discriminated-union switch to narrow each variant.
 */
export const LiveEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sample"),
    t: z.string().datetime({ offset: true }),
    temp_f: z.number(),
  }),
  z.object({
    type: z.literal("firing_started"),
    firing: FiringSchema,
  }),
  z.object({
    type: z.literal("firing_ended"),
    firing_id: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("pizza_started"),
    pizza: PizzaSchema,
  }),
  z.object({
    type: z.literal("pizza_ended"),
    pizza: PizzaSchema,
  }),
]);

export type LiveEvent = z.infer<typeof LiveEventSchema>;
export type SampleEvent = Extract<LiveEvent, { type: "sample" }>;
