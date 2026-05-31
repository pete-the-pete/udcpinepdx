import { useEffect, useState } from "preact/hooks";

/**
 * sessionStorage key used to persist the reconnect backoff step across
 * page reloads. Cleared by use-live-state.ts when the connection recovers,
 * so a successful reconnect resets the backoff to step 0.
 */
export const RECONNECT_STEP_KEY = "udcpine.reconnectStep";

/**
 * Backoff (in ms) before the overlay auto-reloads the page. Capped at 10s.
 * Sequence: 1s, 2s, 5s, 10s, 10s, … — the cap keeps a permanently-down
 * backend from spamming reloads while still recovering quickly from a
 * brief restart. See the plan's "Failure modes" table.
 *
 * The step is persisted in sessionStorage so that reloads accumulate through
 * the backoff sequence. Without persistence, window.location.reload() would
 * discard React state and every reload would restart at step 0 (~1Hz).
 */
const RELOAD_BACKOFF_MS = [1000, 2000, 5000, 10000];

function backoffAt(step: number): number {
  const idx = Math.min(step, RELOAD_BACKOFF_MS.length - 1);
  // RELOAD_BACKOFF_MS is a non-empty literal; the index is bounded above.
  return RELOAD_BACKOFF_MS[idx] ?? RELOAD_BACKOFF_MS[RELOAD_BACKOFF_MS.length - 1]!;
}

function readPersistedStep(): number {
  try {
    const raw = sessionStorage.getItem(RECONNECT_STEP_KEY);
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return isNaN(n) || n < 0 ? 0 : n;
  } catch {
    return 0;
  }
}

function writePersistedStep(step: number): void {
  try {
    sessionStorage.setItem(RECONNECT_STEP_KEY, String(step));
  } catch {
    // sessionStorage unavailable (e.g. private mode quota); degrade silently.
  }
}

/**
 * Fullscreen overlay shown while the SSE stream is unreachable. Reloads
 * the page on a bounded backoff and offers a manual "Reload now" escape
 * for an operator who wants to skip the wait. After `window.location.reload`
 * the boot effect in app.tsx re-exchanges the sessionStorage token, so a
 * laptop reboot recovers without operator action.
 *
 * The backoff step survives reloads via sessionStorage (key: RECONNECT_STEP_KEY).
 * use-live-state.ts clears the key when the connection recovers.
 */
export function ReconnectingOverlay() {
  const [step, setStep] = useState(() => readPersistedStep());

  useEffect(() => {
    const delay = backoffAt(step);
    const id = setTimeout(() => {
      const nextStep = step + 1;
      writePersistedStep(nextStep);
      setStep(nextStep);
      window.location.reload();
    }, delay);
    return () => clearTimeout(id);
  }, [step]);

  const nextDelaySec = Math.round(backoffAt(step) / 1000);

  return (
    <div class="reconnecting" role="alert" aria-live="assertive">
      <div class="reconnecting__panel">
        <div class="reconnecting__title">Reconnecting to oven…</div>
        <div class="reconnecting__sub">
          Auto-reload in ~{nextDelaySec}s
        </div>
        <button
          type="button"
          class="reconnecting__btn"
          onClick={() => window.location.reload()}
        >
          Reload now
        </button>
      </div>
    </div>
  );
}
