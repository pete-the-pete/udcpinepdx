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
