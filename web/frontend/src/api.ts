import { FiringSchema, type Firing } from "@udcpine/shared";

/**
 * Fetch the current firing state from the Flask backend and validate it
 * against the shared Zod schema. Throws on network errors or contract
 * violations — the dashboard treats both as "data unavailable."
 */
export async function fetchState(): Promise<Firing> {
  const res = await fetch("/api/state");
  if (!res.ok) throw new Error(`/api/state returned ${res.status}`);
  const json = (await res.json()) as unknown;
  const parsed = FiringSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`/api/state contract violation: ${parsed.error.message}`);
  }
  return parsed.data;
}
