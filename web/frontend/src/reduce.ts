import type { LiveEvent, LiveState, Sample } from "@udcpine/shared";

/**
 * Fold one LiveEvent into a LiveState. Pure — no I/O, no time.
 */
export function applyEvent(state: LiveState, event: LiveEvent): LiveState {
  switch (event.type) {
    case "sample":
      return {
        ...state,
        latest_sample: { t: event.t, temp_c: event.temp_c },
      };
    case "firing_started":
      return {
        ...state,
        firing: event.firing,
        latest_sample: null,
        active_pizza: null,
        cooking_started_at: null,
      };
    case "firing_ended":
      return {
        ...state,
        firing: null,
        latest_sample: null,
        active_pizza: null,
        cooking_started_at: null,
      };
    case "pizza_started":
      return {
        ...state,
        active_pizza: event.pizza,
        // Set only on the FIRST pizza of the firing; later pizzas keep it.
        cooking_started_at: state.cooking_started_at ?? event.pizza.started_at,
      };
    case "pizza_ended":
      // The backend will follow up with a pizza_started if there's a new
      // pizza; we just drop the active one here. If the ended pizza isn't
      // the one we have cached (unlikely), clear anyway — server is truth.
      return {
        ...state,
        active_pizza:
          state.active_pizza !== null && state.active_pizza.id === event.pizza.id
            ? null
            : state.active_pizza,
      };
  }
}

/**
 * Milliseconds threshold past which a `latest_sample` is considered stale.
 * Picked at 10 s — comfortably past the 1 Hz sample cadence, short enough
 * that a wedged Pi shows up on the dashboard within a couple seconds of
 * trouble.
 */
export const STALE_SAMPLE_THRESHOLD_MS = 10_000;

/**
 * Age (in milliseconds) of a sample relative to `nowMs`, or null if there
 * is no sample. Pure; the caller passes `Date.now()` (or a fake clock in
 * tests). Negative ages clamp to 0 — a sample with a future timestamp is
 * obviously not stale.
 */
export function sampleAgeMs(sample: Sample | null, nowMs: number): number | null {
  if (sample === null) return null;
  const t = Date.parse(sample.t);
  if (Number.isNaN(t)) return null;
  return Math.max(0, nowMs - t);
}

/** True when `sample` is older than {@link STALE_SAMPLE_THRESHOLD_MS}. */
export function isSampleStale(sample: Sample | null, nowMs: number): boolean {
  const age = sampleAgeMs(sample, nowMs);
  return age !== null && age > STALE_SAMPLE_THRESHOLD_MS;
}
