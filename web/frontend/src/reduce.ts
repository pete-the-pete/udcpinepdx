import type { LiveEvent, LiveState } from "@udcpine/shared";

/**
 * Fold one LiveEvent into a LiveState. Pure — no I/O, no time.
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
        active_pizza: null,
      };
    case "firing_ended":
      return {
        ...state,
        firing: null,
        latest_sample: null,
        active_pizza: null,
      };
    case "pizza_started":
      return {
        ...state,
        active_pizza: event.pizza,
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
