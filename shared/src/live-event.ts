import { z } from "zod";
import { FiringSchema } from "./firing.ts";

/**
 * Payload of one SSE message on /api/stream. Discriminated by `type`.
 * The frontend uses a discriminated-union switch to narrow each variant.
 *
 * `pizza_started` and `pizza_ended` are deliberately NOT in this union yet —
 * they land in a future plan. Add them here when pizza state ships, not
 * before, to keep the surface honest.
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
]);

export type LiveEvent = z.infer<typeof LiveEventSchema>;

export type SampleEvent = Extract<LiveEvent, { type: "sample" }>;
