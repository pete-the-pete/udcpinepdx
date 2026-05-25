import { useState } from "preact/hooks";
import { nextPizza, startFiring } from "../api";
import { PairPhoneOverlay } from "./pair-phone-overlay";

interface IdleScreenProps {
  onStarted: () => void;
}

/**
 * Idle screen. Captures the FIRST pizza name before the firing starts —
 * the temperature stream would otherwise begin filling the dashboard
 * before the user had a chance to record what they're cooking. START is
 * disabled until a name is typed; submission starts the firing AND the
 * first pizza in one user-perceived action (two chained POSTs).
 *
 * Subsequent pizzas use the in-dashboard NEXT PIZZA flow (HeroNumber).
 */
export function IdleScreen({ onStarted }: IdleScreenProps) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  const trimmed = name.trim();
  const canStart = trimmed.length > 0 && !busy;

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (!canStart) return;
    setBusy(true);
    setErr(null);
    try {
      await startFiring();
      // The firing exists; if naming the first pizza fails, we let the
      // user retry from the dashboard's NEXT PIZZA flow. The error surface
      // here is only for the firing-start failure.
      try {
        await nextPizza(trimmed);
      } catch (pizzaErr) {
        // Non-fatal: surface as a transient note; the firing did start.
        console.warn("first-pizza creation failed; user can retry", pizzaErr);
      }
      onStarted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />
      <header class="hero__status">
        <span class="hero__id">OVEN · IDLE</span>
        <button type="button" class="hero__pair" onClick={() => setPairing(true)}>
          PAIR A PHONE
        </button>
      </header>

      <section class="idle">
        <form class="idle__form" onSubmit={onSubmit}>
          <input
            class="idle__name"
            type="text"
            placeholder="first pizza name"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            disabled={busy}
            aria-label="first pizza name"
            autofocus
          />
          <button type="submit" class="idle__start" disabled={!canStart}>
            {busy ? "STARTING…" : "START FIRING"}
          </button>
        </form>
        <p class="idle__caption">name your first pizza, then begin</p>
        {err !== null && <p class="idle__error">error: {err}</p>}
      </section>

      {pairing && <PairPhoneOverlay onClose={() => setPairing(false)} />}
    </main>
  );
}
