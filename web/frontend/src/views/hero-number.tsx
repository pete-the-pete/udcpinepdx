import type { Firing } from "@udcpine/shared";

interface HeroNumberProps {
  firing: Firing;
}

function formatElapsed(startedAtIso: string): string {
  const ms = Date.now() - Date.parse(startedAtIso);
  if (Number.isNaN(ms) || ms < 0) return "0:00:00";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function HeroNumber({ firing }: HeroNumberProps) {
  const elapsed = formatElapsed(firing.started_at);
  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />

      <header class="hero__status">
        <span class="hero__id">
          FIRING #{firing.id.toString().padStart(3, "0")} · {firing.status.toUpperCase()} {elapsed}
        </span>
        <span class="hero__live">
          <span class="hero__dot" aria-hidden="true" />
          LIVE
        </span>
      </header>

      <section class="hero__readout">
        <div class="hero__num" aria-label="hearth temperature unavailable">—</div>
        <div class="hero__unit">DEGREES FAHRENHEIT</div>
        <div class="hero__delta">awaiting sensor data</div>
      </section>

      <footer class="hero__pizza">
        <span class="hero__pizza-label">NOW BAKING</span>
        <span class="hero__pizza-name">no pizza</span>
        <div class="hero__pizza-timer">
          <span class="hero__pizza-elapsed-label">ELAPSED</span>
          <span class="hero__pizza-elapsed">—</span>
        </div>
      </footer>
    </main>
  );
}
