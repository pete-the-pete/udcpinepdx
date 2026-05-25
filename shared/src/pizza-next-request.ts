import { z } from "zod";

/**
 * POST /api/pizza/next body. Atomically ends any currently-active pizza
 * in the firing and starts a new one with the given name.
 */
export const PizzaNextRequestSchema = z.object({
  name: z.string().min(1),
});

export type PizzaNextRequest = z.infer<typeof PizzaNextRequestSchema>;
