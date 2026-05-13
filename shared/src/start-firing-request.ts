import { z } from "zod";

/**
 * POST /api/firing/start body. Empty today, but typed-and-named so that
 * adding fields later (e.g. an oven preset) is a typed schema change
 * picked up by both sides, not a freeform JSON evolution.
 */
export const StartFiringRequestSchema = z.object({}).strict();

export type StartFiringRequest = z.infer<typeof StartFiringRequestSchema>;
