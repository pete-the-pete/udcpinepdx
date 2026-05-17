import { z } from "zod";

/**
 * Response of POST /api/auth/pairing — a freshly minted one-shot pairing
 * token. The frontend builds a QR of `<origin>/?t=<token>` from it.
 */
export const PairingTokenSchema = z.object({
  token: z.string().min(1),
});

export type PairingToken = z.infer<typeof PairingTokenSchema>;
