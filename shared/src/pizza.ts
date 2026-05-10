import { z } from "zod";

/**
 * One pizza inside a firing. `seq` is its order within the firing
 * (1 = first pizza of the night). `target_seconds` is the chef's
 * intended cook time; it's a hint for the dashboard, not enforced.
 */
export const PizzaSchema = z.object({
  id: z.number().int().nonnegative(),
  seq: z.number().int().positive(),
  name: z.string().min(1),
  started_at: z.string().datetime({ offset: true }),
  target_seconds: z.number().int().positive(),
});

export type Pizza = z.infer<typeof PizzaSchema>;
