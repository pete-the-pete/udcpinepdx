import { useState } from "preact/hooks";
import type { Sample } from "@udcpine/shared";
import { startFiring } from "../api";
import { ChefPanel } from "../chef/ChefPanel";
import { PairPhoneOverlay } from "./pair-phone-overlay";

interface IdleScreenProps {
  /** Called after the fire is lit, so the app can route to warm-up. */
  onStarted: () => void;
  /** Latest hearth reading (ambient when idle), or null before the sensor reports. */
  latestSample: Sample | null;
}

/**
 * Idle screen: the oven is cold and inviting. Chuck sits frozen with the
 * ambient temperature, and a single Start fire button lights the firing.
 * The first pizza is named later, on the warm-up screen.
 */
export function IdleScreen({ onStarted, latestSample }: IdleScreenProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  async function onStart() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await startFiring();
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
        <ChefPanel latest_sample={latestSample} />
        <button
          type="button"
          class="idle__start"
          onClick={onStart}
          disabled={busy}
        >
          {busy ? "LIGHTING…" : "START FIRING"}
        </button>
        <p class="idle__caption">light the fire to begin</p>
        {err !== null && <p class="idle__error">error: {err}</p>}
      </section>

      {pairing && <PairPhoneOverlay onClose={() => setPairing(false)} />}
    </main>
  );
}
