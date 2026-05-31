import {
  FiringSchema,
  LiveStateSchema,
  PairingTokenSchema,
  PizzaSchema,
  type Firing,
  type LiveState,
  type PairingToken,
  type Pizza,
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
 * sessionStorage key used to persist a successful bootstrap/pairing token
 * across `window.location.reload()` (e.g. the ReconnectingOverlay's auto-
 * reload). Backend AuthStore is in-memory, so a Flask restart invalidates
 * every cookie — keeping the token here lets the boot effect re-exchange
 * and recover without operator action. See the plan's
 * "Reload-survives-restart" decision for the full reasoning.
 */
export const BOOTSTRAP_TOKEN_KEY = "udcpine.bootstrapToken";

function safeSessionStorage(): Storage | null {
  // Tests / non-browser contexts may not have window.sessionStorage. Be
  // defensive rather than throwing during the api boot path.
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getStashedToken(): string | null {
  return safeSessionStorage()?.getItem(BOOTSTRAP_TOKEN_KEY) ?? null;
}

export function clearStashedToken(): void {
  safeSessionStorage()?.removeItem(BOOTSTRAP_TOKEN_KEY);
}

/**
 * Exchange a pairing token (from a ?t= URL param, a scanned QR, or the
 * server's bootstrap link) for a session cookie. Resolves true on success.
 *
 * On success the token is stashed in sessionStorage so a post-reload boot
 * can recover from a backend restart (see BOOTSTRAP_TOKEN_KEY).
 */
export async function exchangeToken(token: string): Promise<boolean> {
  const res = await fetch("/api/auth/exchange", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (res.ok) {
    safeSessionStorage()?.setItem(BOOTSTRAP_TOKEN_KEY, token);
  }
  return res.ok;
}

/**
 * Mint a one-shot pairing token (caller must already be paired). Returns
 * the token plus the server's LAN IP, so the QR can point a phone at a
 * reachable address rather than the kiosk's `localhost`.
 */
export async function mintPairingToken(): Promise<PairingToken> {
  const res = await fetch("/api/auth/pairing", { method: "POST" });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`/api/auth/pairing returned ${res.status}`);
  const parsed = PairingTokenSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`/api/auth/pairing contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function nextPizza(name: string): Promise<Pizza> {
  const res = await fetch("/api/pizza/next", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`/api/pizza/next returned ${res.status}`);
  const parsed = PizzaSchema.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(`/api/pizza/next contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}
