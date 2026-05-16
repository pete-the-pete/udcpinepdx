import {
  FiringSchema,
  LiveStateSchema,
  type Firing,
  type LiveState,
} from "@udcpine/shared";

/**
 * Fetch the current dashboard snapshot. Validates against the shared Zod
 * schema; throws on network or contract violations.
 */
export async function fetchState(): Promise<LiveState> {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error(`/api/state returned ${res.status}`);
  const json = (await res.json()) as unknown;
  const parsed = LiveStateSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`/api/state contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function startFiring(): Promise<Firing> {
  const res = await fetch("/api/firing/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`/api/firing/start returned ${res.status}`);
  const json = (await res.json()) as unknown;
  const parsed = FiringSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`/api/firing/start contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function endFiring(): Promise<Firing> {
  const res = await fetch("/api/firing/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`/api/firing/stop returned ${res.status}`);
  const json = (await res.json()) as unknown;
  const parsed = FiringSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`/api/firing/stop contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}
