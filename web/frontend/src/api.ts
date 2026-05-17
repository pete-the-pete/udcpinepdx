import {
  FiringSchema,
  LiveStateSchema,
  PairingTokenSchema,
  type Firing,
  type LiveState,
} from "@udcpine/shared";

/** Thrown when a request comes back 401 — the device is not paired. */
export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

export async function fetchState(): Promise<LiveState> {
  const parsed = LiveStateSchema.safeParse(await getJson("/api/state"));
  if (!parsed.success) {
    throw new Error(`/api/state contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function postFiring(path: string): Promise<Firing> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  const parsed = FiringSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`${path} contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export const startFiring = (): Promise<Firing> => postFiring("/api/firing/start");
export const endFiring = (): Promise<Firing> => postFiring("/api/firing/stop");

/**
 * Exchange a pairing token (from a ?t= URL param, a scanned QR, or the
 * server's bootstrap link) for a session cookie. Resolves true on success.
 */
export async function exchangeToken(token: string): Promise<boolean> {
  const res = await fetch("/api/auth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.ok;
}

/** Mint a one-shot pairing token (caller must already be paired). */
export async function mintPairingToken(): Promise<string> {
  const res = await fetch("/api/auth/pairing", { method: "POST" });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`/api/auth/pairing returned ${res.status}`);
  const parsed = PairingTokenSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`/api/auth/pairing contract violation: ${parsed.error.message}`);
  }
  return parsed.data.token;
}
