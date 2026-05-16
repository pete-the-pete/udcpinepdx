import type { LiveEvent, LiveState } from "@udcpine/shared";

/**
 * Fold one LiveEvent into a LiveState. Pure — no I/O, no time. Each
 * event maps to a single field swap.
 */
export function applyEvent(state: LiveState, event: LiveEvent): LiveState {
  switch (event.type) {
    case "sample":
      return {
        ...state,
        latest_sample: { t: event.t, temp_f: event.temp_f },
      };
    case "firing_started":
      return {
        ...state,
        firing: event.firing,
        latest_sample: null,
      };
    case "firing_ended":
      return {
        ...state,
        firing: null,
        latest_sample: null,
        active_pizza: null,
      };
  }
}
