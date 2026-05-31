import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import { LiveEventSchema, type LiveState } from "@udcpine/shared";
import { applyEvent } from "./reduce";
import { RECONNECT_STEP_KEY } from "./views/reconnecting-overlay";

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

export type ConnectionState = "connected" | "reconnecting";

/**
 * 3-second debounce before flipping `connectionState` to "reconnecting"
 * while the browser is silently auto-reconnecting (readyState=CONNECTING).
 * A CLOSED readyState short-circuits this and flips immediately. See the
 * plan's "SSE error debounce" decision.
 */
const RECONNECT_DEBOUNCE_MS = 3000;

/**
 * Subscribe to /api/stream and fold incoming LiveEvents into local state.
 * The caller seeds initial state from a prior /api/state fetch — we don't
 * re-fetch on reconnect (documented as a known limitation in the plan).
 *
 * Returns both the folded LiveState and a `connectionState` flag the UI
 * uses to render a reconnecting overlay during outages.
 */
export function useLiveState(initial: LiveState): {
  state: LiveState;
  connectionState: ConnectionState;
} {
  const [state, dispatch] = useReducer(reducer, initial);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connected");
  // Pending debounce timer for the CONNECTING-for-3s threshold.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    dispatch({ kind: "reset", state: initial });
    setConnectionState("connected");

    const clearDebounce = () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };

    const es = new EventSource("/api/stream");
    es.onmessage = (e) => {
      // Any message proves the stream is healthy — cancel any pending
      // "you've been CONNECTING for 3s" flip and snap back to connected.
      // Also clear the persisted backoff step so the ReconnectingOverlay
      // resets to step 0 if the connection drops again.
      clearDebounce();
      try { sessionStorage.removeItem(RECONNECT_STEP_KEY); } catch { /* quota/private */ }
      setConnectionState("connected");
      try {
        const raw = JSON.parse(e.data);
        dispatch({ kind: "event", raw });
      } catch (err) {
        console.warn("dropping non-JSON SSE event", err);
      }
    };
    es.onerror = () => {
      // Browser EventSource auto-reconnects with exponential backoff while
      // readyState === CONNECTING (1). Only flip the UI after the outage
      // has persisted past the debounce window, or immediately if the
      // browser has given up (readyState === CLOSED).
      if (es.readyState === EventSource.CLOSED) {
        clearDebounce();
        setConnectionState("reconnecting");
        return;
      }
      if (debounceRef.current === null) {
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          setConnectionState("reconnecting");
        }, RECONNECT_DEBOUNCE_MS);
      }
    };
    return () => {
      clearDebounce();
      es.close();
    };
  }, [initial]);

  return { state, connectionState };
}
