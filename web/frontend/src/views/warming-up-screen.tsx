import { useEffect, useState } from "preact/hooks";
import type { Firing, Sample } from "@udcpine/shared";
import { endFiring, nextPizza } from "../api";
import { formatHearthTempF } from "../temp";
import { ChefStage } from "../chef/ChefStage";

interface WarmingUpScreenProps {
  firing: Firing;
  latestSample: Sample | null;
  /** Called after start-first-pizza or cancel, so the app can re-route. */
  onAction: () => void;
}

function useTick(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatMS(ms: number): string {
  if (Number.isNaN(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Warm-up screen: the fire is lit, no pizza yet. Watch Chuck thaw with the
 * live temperature and an elapsed timer; name and start the first pizza, or
 * cancel a false start (which ends the firing back to idle).
 */
export function WarmingUpScreen({ firing, latestSample, onAction }: WarmingUpScreenProps) {
  const now = useTick(1000);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const elapsed = formatMS(now - Date.parse(firing.started_at));
  const canStart = name.trim().length > 0 && !busy && !cancelBusy;

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (!canStart) return;
    setBusy(true);
    try {
      await nextPizza(name.trim());
      onAction();
    } catch {
      // On success the screen routes away (unmounts); only re-enable the
      // form if the pizza failed to start. Mirrors onCancel below.
      setBusy(false);
    }
  }

  async function onCancel() {
    if (cancelBusy) return;
    setCancelBusy(true);
    try {
      await endFiring();
      onAction();
    } catch {
      setCancelBusy(false);
    }
  }

  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />
      <header class="hero__status">
        <span class="hero__id">WARMING UP · {elapsed}</span>
        <button
          type="button"
          class="hero__stop"
          onClick={onCancel}
          disabled={cancelBusy}
          aria-label="cancel firing"
        >
          {cancelBusy ? "…" : "CANCEL"}
        </button>
      </header>

      <section class="idle">
        <div class="idle__chef">
          <ChefStage latest_sample={latestSample} />
          <output class="idle__temp" aria-label="current hearth temperature">
            {formatHearthTempF(latestSample?.temp_c ?? null)}
          </output>
        </div>
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
            {busy ? "STARTING…" : "START FIRST PIZZA"}
          </button>
        </form>
        <p class="idle__caption">name your first pizza when the hearth is hot</p>
      </section>
    </main>
  );
}
