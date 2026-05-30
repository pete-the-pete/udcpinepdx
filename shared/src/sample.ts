import { z } from "zod";

/**
 * One thermocouple reading from the hearth. Sampled at 1 Hz on the Pi;
 * `latest_sample` on LiveState is the most recent of these.
 *
 * Temperature is degrees Celsius — that's what the MAX6675 reports natively
 * and what the backend stores. The frontend converts to °F at render time.
 */
export const SampleSchema = z.object({
  t: z.string().datetime({ offset: true }),
  temp_c: z.number(),
});

export type Sample = z.infer<typeof SampleSchema>;
