import { z } from "zod";

/**
 * One pizza inside a firing. `seq` is its order within the firing
 * (1 = first pizza of the night). The chef judges done-ness by eye +
 * temperature; we record start/end times and a name, nothing more.
 */
export const PizzaSchema = z.object({
  id: z.number().int().nonnegative(),
  firing_id: z.number().int().nonnegative(),
  seq: z.number().int().positive(),
  name: z.string().min(1),
  started_at: z.string().datetime({ offset: true }),
  ended_at: z.string().datetime({ offset: true }).nullable(),
});

export type Pizza = z.infer<typeof PizzaSchema>;
