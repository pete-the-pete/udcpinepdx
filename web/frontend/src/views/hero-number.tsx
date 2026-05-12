import { useEffect, useState } from "preact/hooks";
import type { LiveState } from "@udcpine/shared";

interface HeroNumberProps {
  state: LiveState;
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

function formatMS(ms: number): string {
  if (Number.isNaN(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function HeroNumber({ state }: HeroNumberProps) {
  const now = useTick(1000);
  const { firing, latest_sample, active_pizza } = state;

  const firingElapsed = formatHMS(now - Date.parse(firing.started_at));
  const tempLabel =
    latest_sample !== null ? Math.round(latest_sample.temp_f).toString() : "—";
  const pizzaName = active_pizza !== null ? active_pizza.name : "no pizza";

  let pizzaElapsed = "—";
  let pizzaProgress = 0;
  if (active_pizza !== null) {
    const elapsedMs = now - Date.parse(active_pizza.started_at);
    pizzaElapsed = formatMS(elapsedMs);
    pizzaProgress = Math.max(
      0,
      Math.min(1, elapsedMs / (active_pizza.target_seconds * 1000)),
    );
  }

  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />

      <header class="hero__status">
        <span class="hero__id">
          FIRING #{firing.id.toString().padStart(3, "0")} · {firing.status.toUpperCase()} {firingElapsed}
        </span>
        <span class="hero__live">
          <span class="hero__dot" aria-hidden="true" />
          LIVE
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
        {latest_sample === null && (
          <div class="hero__delta">awaiting sensor data</div>
        )}
      </section>

      <footer class="hero__pizza">
        <div class="hero__pizza-name-block">
          <span class="hero__pizza-label">NOW BAKING</span>
          <span class="hero__pizza-name">{pizzaName}</span>
        </div>
        <div class="hero__pizza-timer">
          <span class="hero__pizza-elapsed-label">ELAPSED</span>
          <span class="hero__pizza-elapsed">{pizzaElapsed}</span>
        </div>
        {active_pizza !== null && (
          <div class="hero__pizza-progress" aria-hidden="true">
            <div
              class="hero__pizza-progress-fill"
              style={{ width: `${pizzaProgress * 100}%` }}
            />
          </div>
        )}
      </footer>
    </main>
  );
}
