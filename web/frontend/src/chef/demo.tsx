import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Sample } from "@udcpine/shared";
import { ChefWidget } from "./ChefWidget";
import { manifest, type ChefState } from "./manifest";
import { selectState } from "./state-machine";
import { celsiusToFahrenheit } from "../temp";
import "../styles.css";
import "./demo.css";

// All driving values are degrees Celsius — that's what the manifest and
// the state machine speak. The on-screen °F readout is converted at render
// time so the demo mirrors what the real dashboard shows.
const MIN_C = -20;
const MAX_C = 400;
const SWEEP_STEP_C = 2;
const SWEEP_INTERVAL_MS = 120;

interface BandJump {
  label: string;
  tempC: number;
}

// One quick-jump per manifest band (its midpoint), plus an above-range jump
// that lands past the top band to exercise the missing-state clamp.
const bandJumps: BandJump[] = (() => {
  const jumps: BandJump[] = Object.entries(manifest.states).map(
    ([state, spec]) => {
      const lo = spec.temp_c[0] ?? MIN_C;
      const hi = spec.temp_c[1] ?? MAX_C;
      return { label: state, tempC: Math.round((lo + hi) / 2) };
    },
  );
  jumps.push({ label: "off-scale (clamp)", tempC: 360 });
  return jumps;
})();

function tempInSomeBand(tempC: number): boolean {
  return Object.values(manifest.states).some((spec) => {
    const lo = spec.temp_c[0] ?? -Infinity;
    const hi = spec.temp_c[1] ?? Infinity;
    return tempC >= lo && tempC < hi;
  });
}

function ChefDemo() {
  const [tempC, setTempC] = useState(70);
  const [playing, setPlaying] = useState(false);
  const sweepDir = useRef(1);
  const prevState = useRef<ChefState | null>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setTempC((t) => {
        let next = t + sweepDir.current * SWEEP_STEP_C;
        if (next >= MAX_C) {
          next = MAX_C;
          sweepDir.current = -1;
        } else if (next <= MIN_C) {
          next = MIN_C;
          sweepDir.current = 1;
        }
        return next;
      });
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing]);

  function drive(next: number) {
    setPlaying(false);
    setTempC(next);
  }

  const sample: Sample = { t: new Date().toISOString(), temp_c: tempC };
  // Mirror ChefWidget's internal hysteresis ref so the panel readout matches
  // the widget. They stay in sync because both run selectState over the same
  // temperature sequence in the same order.
  const state = selectState(tempC, prevState.current, manifest);
  prevState.current = state;
  const clamped = !tempInSomeBand(tempC);
  const tempF = Math.round(celsiusToFahrenheit(tempC));

  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />

      <section class="hero__readout">
        <div class="hero__num">{tempF}</div>
        <div class="hero__unit">DEGREES FAHRENHEIT</div>
      </section>

      <ChefWidget latest_sample={sample} />

      <div class="demo-panel">
        <div class="demo-panel__readout">
          {Math.round(tempC)}°C ({tempF}°F) → <strong>{state}</strong>
          {clamped && <span class="demo-panel__clamp"> (clamped)</span>}
        </div>
        <input
          type="range"
          aria-label="oven temperature (°C)"
          min={MIN_C}
          max={MAX_C}
          value={tempC}
          onInput={(e) => drive(Number(e.currentTarget.value))}
        />
        <div class="demo-panel__bands">
          {bandJumps.map((j) => (
            <button key={j.label} type="button" onClick={() => drive(j.tempC)}>
              {j.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setPlaying((p) => !p)}>
          {playing ? "⏸ pause sweep" : "▶ play sweep"}
        </button>
      </div>
    </main>
  );
}

const root = document.getElementById("app");
if (!root) throw new Error("missing #app");
render(<ChefDemo />, root);
