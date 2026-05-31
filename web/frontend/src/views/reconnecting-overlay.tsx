import { useEffect, useState } from "preact/hooks";

/**
 * Backoff (in ms) before the overlay auto-reloads the page. Capped at 10s.
 * Sequence: 1s, 2s, 5s, 10s, 10s, … — the cap keeps a permanently-down
 * backend from spamming reloads while still recovering quickly from a
 * brief restart. See the plan's "Failure modes" table.
 */
const RELOAD_BACKOFF_MS = [1000, 2000, 5000, 10000];

function backoffAt(step: number): number {
  const idx = Math.min(step, RELOAD_BACKOFF_MS.length - 1);
  // RELOAD_BACKOFF_MS is a non-empty literal; the index is bounded above.
  return RELOAD_BACKOFF_MS[idx] ?? RELOAD_BACKOFF_MS[RELOAD_BACKOFF_MS.length - 1]!;
}

/**
 * Fullscreen overlay shown while the SSE stream is unreachable. Reloads
 * the page on a bounded backoff and offers a manual "Reload now" escape
 * for an operator who wants to skip the wait. After `window.location.reload`
 * the boot effect in app.tsx re-exchanges the sessionStorage token, so a
 * laptop reboot recovers without operator action.
 */
export function ReconnectingOverlay() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const delay = backoffAt(step);
    const id = setTimeout(() => {
      // Bumping step first means an early re-render (if it happened) would
      // schedule the next, longer delay. In practice `reload()` replaces
      // the page so this state never matters past the first fire.
      setStep((s) => s + 1);
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
