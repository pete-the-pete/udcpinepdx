import { z } from "zod";

/**
 * POST /api/firing/stop body. Empty today; see StartFiringRequest for why
 * it's kept as a named schema rather than an inline {}.
 */
export const EndFiringRequestSchema = z.object({}).strict();

export type EndFiringRequest = z.infer<typeof EndFiringRequestSchema>;
