import { useEffect, useState } from "preact/hooks";
import type { Firing, LiveState } from "@udcpine/shared";
import { endFiring } from "../api";
import { PairPhoneOverlay } from "./pair-phone-overlay";

interface HeroNumberProps {
  state: LiveState & { firing: Firing };
  onEnded: () => void;
}

function useTick(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatHMS(ms: number): string {
  if (Number.isNaN(ms) || ms < 0) return "0:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function HeroNumber({ state, onEnded }: HeroNumberProps) {
  const now = useTick(1000);
  const [stopBusy, setStopBusy] = useState(false);
  const [pairing, setPairing] = useState(false);
  const { firing, latest_sample } = state;

  const firingElapsed = formatHMS(now - Date.parse(firing.started_at));
  const tempLabel =
    latest_sample !== null ? Math.round(latest_sample.temp_f).toString() : "—";

  async function onStop() {
    setStopBusy(true);
    try {
      await endFiring();
      onEnded();
    } catch {
      setStopBusy(false);
    }
  }

  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />

      <header class="hero__status">
        <span class="hero__id">
          FIRING #{firing.id.toString().padStart(3, "0")} · {firing.status.toUpperCase()} {firingElapsed}
        </span>
        <span class="hero__right">
          <span class="hero__live">
            <span class="hero__dot" aria-hidden="true" />
            LIVE
          </span>
          <button type="button" class="hero__pair" onClick={() => setPairing(true)}>
            PAIR A PHONE
          </button>
          <button
            type="button"
            class="hero__stop"
            onClick={onStop}
            disabled={stopBusy}
            aria-label="stop firing"
          >
            {stopBusy ? "…" : "STOP"}
          </button>
        </span>
      </header>

      <section class="hero__readout">
        <div
          class="hero__num"
          aria-label={
            latest_sample !== null
              ? `hearth at ${tempLabel} degrees fahrenheit`
              : "hearth temperature unavailable"
          }
        >
          {tempLabel}
        </div>
        <div class="hero__unit">DEGREES FAHRENHEIT</div>
        {latest_sample === null && <div class="hero__delta">awaiting sensor data</div>}
      </section>

      {pairing && <PairPhoneOverlay onClose={() => setPairing(false)} />}
    </main>
  );
}
