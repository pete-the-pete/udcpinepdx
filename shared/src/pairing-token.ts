import { z } from "zod";

/**
 * Response of POST /api/auth/pairing — a freshly minted one-shot pairing
 * token plus the server's LAN IP.
 *
 * `lan_ip` is needed because the kiosk browser is usually opened at
 * `localhost`, and a QR built from `window.location` would then point the
 * phone at its own loopback. The server detects its LAN address; the
 * frontend builds the QR as `<protocol>//<lan_ip>:<port>/?t=<token>`.
 */
export const PairingTokenSchema = z.object({
  token: z.string().min(1),
  lan_ip: z.string().min(1),
});

export type PairingToken = z.infer<typeof PairingTokenSchema>;
