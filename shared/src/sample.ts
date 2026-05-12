import { z } from "zod";

/**
 * One thermocouple reading from the hearth. Sampled at 1 Hz on the Pi;
 * `latest_sample` on LiveState is the most recent of these.
 */
export const SampleSchema = z.object({
  t: z.string().datetime({ offset: true }),
  temp_f: z.number(),
});

export type Sample = z.infer<typeof SampleSchema>;
