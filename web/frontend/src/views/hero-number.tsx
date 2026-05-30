import { useEffect, useState } from "preact/hooks";
import type { Firing, LiveState } from "@udcpine/shared";
import { endFiring, nextPizza } from "../api";
import { isSampleStale } from "../reduce";
import { PairPhoneOverlay } from "./pair-phone-overlay";

// Wire unit is Celsius; the dashboard renders Fahrenheit for the operator.
function celsiusToFahrenheit(tempC: number): number {
  return tempC * 9 / 5 + 32;
}

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

function formatMS(ms: number): string {
  if (Number.isNaN(ms) || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function HeroNumber({ state, onEnded }: HeroNumberProps) {
  const now = useTick(1000);
  const [stopBusy, setStopBusy] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [pizzaName, setPizzaName] = useState("");
  const [pizzaBusy, setPizzaBusy] = useState(false);
  // `composing` only matters when there IS an active pizza. When there
  // isn't, the form is always shown (state 1). When there is, we toggle
  // between read mode (state 2) and composing (state 3).
  const [composing, setComposing] = useState(false);
  const { firing, latest_sample, active_pizza } = state;

  // When the active pizza changes — either we just submitted and a new
  // one started via SSE, or the firing ended — exit composing mode so the
  // UI returns to read mode (or no-pizza mode) cleanly.
  const activePizzaId = active_pizza?.id ?? null;
  useEffect(() => {
    setComposing(false);
  }, [activePizzaId]);

  const firingElapsed = formatHMS(now - Date.parse(firing.started_at));
  const tempLabel =
    latest_sample !== null
      ? Math.round(celsiusToFahrenheit(latest_sample.temp_c)).toString()
      : "—";
  // Stale = no fresh sample in the last 10 s. A wedged Pi looks identical
  // to an idle oven without this — the indicator makes silence visible.
  const stale = isSampleStale(latest_sample, now);
  const pizzaElapsed =
    active_pizza !== null
      ? formatMS(now - Date.parse(active_pizza.started_at))
      : null;

  async function onStop() {
    setStopBusy(true);
    try {
      await endFiring();
      onEnded();
    } catch {
      setStopBusy(false);
    }
  }

  async function onSubmitPizza(e: Event) {
    e.preventDefault();
    const name = pizzaName.trim();
    if (name.length === 0 || pizzaBusy) return;
    setPizzaBusy(true);
    try {
      await nextPizza(name);
      setPizzaName("");
      // `composing` clears via the activePizzaId effect once SSE lands.
    } finally {
      setPizzaBusy(false);
    }
  }

  const showForm = active_pizza === null || composing;
  const formButtonLabel = active_pizza === null ? "START PIZZA" : "GO";

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

      <section class={`hero__readout${stale ? " hero__readout--stale" : ""}`}>
        <div
          class="hero__num"
          aria-label={
            latest_sample !== null
              ? `hearth at ${tempLabel} degrees fahrenheit${stale ? " — sensor data is stale" : ""}`
              : "hearth temperature unavailable"
          }
        >
          {tempLabel}
        </div>
        <div class="hero__unit">DEGREES FAHRENHEIT</div>
        {latest_sample === null && <div class="hero__delta">awaiting sensor data</div>}
        {stale && <div class="hero__delta hero__delta--stale">sensor stale</div>}
      </section>

      <footer class="hero__pizza-bar">
        {active_pizza !== null && !composing && (
          /* State 2: read mode — card with name + elapsed + NEXT button. */
          <div class="pizza-card">
            <span class="pizza-card__label">NOW BAKING</span>
            <span class="pizza-card__name">{active_pizza.name}</span>
            <span class="pizza-card__elapsed" aria-label="pizza elapsed">
              {pizzaElapsed}
            </span>
            <button
              type="button"
              class="pizza-card__next"
              onClick={() => setComposing(true)}
            >
              NEXT PIZZA →
            </button>
          </div>
        )}

        {active_pizza !== null && composing && (
          /* State 3: composing-next — compact context label above the form. */
          <div class="pizza-current">
            now baking: <b>{active_pizza.name}</b> · {pizzaElapsed}
          </div>
        )}

        {showForm && (
          <form class="pizza-form" onSubmit={onSubmitPizza}>
            <input
              class="pizza-form__input"
              type="text"
              placeholder={active_pizza === null ? "first pizza name" : "next pizza name"}
              value={pizzaName}
              onInput={(e) => setPizzaName((e.target as HTMLInputElement).value)}
              disabled={pizzaBusy}
              aria-label="pizza name"
              autofocus
            />
            <button
              type="submit"
              class="pizza-form__submit"
              disabled={pizzaBusy || pizzaName.trim().length === 0}
            >
              {pizzaBusy ? "…" : formButtonLabel}
            </button>
            {active_pizza !== null && (
              <button
                type="button"
                class="pizza-form__cancel"
                onClick={() => {
                  setPizzaName("");
                  setComposing(false);
                }}
                disabled={pizzaBusy}
              >
                cancel
              </button>
            )}
          </form>
        )}
      </footer>

      {pairing && <PairPhoneOverlay onClose={() => setPairing(false)} />}
    </main>
  );
}
