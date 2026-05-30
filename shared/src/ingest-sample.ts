import { z } from "zod";

/**
 * The request body for `POST /api/ingest/sample` — what the Pi firmware
 * (or any LAN producer) sends when publishing a thermocouple reading.
 *
 * `t` is optional; when absent the server stamps the sample with its own
 * clock. This keeps the firmware simple — no need for a synced wall clock —
 * while still allowing a producer with a trustworthy clock to be authoritative.
 *
 * Temperature is Celsius end-to-end on the wire; the frontend converts
 * to °F at render time.
 */
export const IngestSampleRequestSchema = z.object({
  temp_c: z.number(),
  t: z.string().datetime({ offset: true }).optional(),
});

export type IngestSampleRequest = z.infer<typeof IngestSampleRequestSchema>;
