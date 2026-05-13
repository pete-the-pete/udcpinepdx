import { useState } from "preact/hooks";
import { startFiring } from "../api";

interface IdleScreenProps {
  onStarted: () => void;
}

export function IdleScreen({ onStarted }: IdleScreenProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick() {
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
      </header>

      <section class="idle">
        <button
          type="button"
          class="idle__start"
          onClick={onClick}
          disabled={busy}
        >
          {busy ? "STARTING…" : "START FIRING"}
        </button>
        <p class="idle__caption">begin a new session</p>
        {err !== null && <p class="idle__error">error: {err}</p>}
      </section>
    </main>
  );
}
