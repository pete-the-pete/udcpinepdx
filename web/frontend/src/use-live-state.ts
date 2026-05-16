import { useEffect, useReducer } from "preact/hooks";
import { LiveEventSchema, type LiveState } from "@udcpine/shared";
import { applyEvent } from "./reduce";

type Action =
  | { kind: "reset"; state: LiveState }
  | { kind: "event"; raw: unknown };

function reducer(state: LiveState, action: Action): LiveState {
  switch (action.kind) {
    case "reset":
      return action.state;
    case "event": {
      const parsed = LiveEventSchema.safeParse(action.raw);
      if (!parsed.success) {
        console.warn("dropping malformed SSE event", parsed.error.message);
        return state;
      }
      return applyEvent(state, parsed.data);
    }
  }
}

/**
 * Subscribe to /api/stream and fold incoming LiveEvents into local state.
 * The caller seeds initial state from a prior /api/state fetch — we don't
 * re-fetch on reconnect (documented as a known limitation in the plan).
 */
export function useLiveState(initial: LiveState): LiveState {
  const [state, dispatch] = useReducer(reducer, initial);

  useEffect(() => {
    dispatch({ kind: "reset", state: initial });
    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data);
        dispatch({ kind: "event", raw });
      } catch (err) {
        console.warn("dropping non-JSON SSE event", err);
      }
    };
    es.onerror = () => {
      // Browser EventSource auto-reconnects with exponential backoff.
    };
    return () => es.close();
  }, [initial]);

  return state;
}
