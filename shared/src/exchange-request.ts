import { z } from "zod";

/**
 * POST /api/auth/exchange body. The token is either the server's bootstrap
 * secret (printed to the console on startup) or a one-shot pairing token
 * minted by an already-paired device.
 */
export const ExchangeRequestSchema = z.object({
  token: z.string().min(1),
});

export type ExchangeRequest = z.infer<typeof ExchangeRequestSchema>;
