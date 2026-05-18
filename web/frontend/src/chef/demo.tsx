import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Sample } from "@udcpine/shared";
import { ChefWidget } from "./ChefWidget";
import { manifest, type ChefState } from "./manifest";
import { selectState } from "./state-machine";
import "../styles.css";
import "./demo.css";

const MIN_F = 0;
const MAX_F = 700;
const SWEEP_STEP_F = 4;
const SWEEP_INTERVAL_MS = 120;

interface BandJump {
  label: string;
  tempF: number;
}

// One quick-jump per manifest band (its midpoint), plus an above-range jump
// that lands in the deferred very_hot band to exercise the missing-state clamp.
const bandJumps: BandJump[] = (() => {
  const jumps: BandJump[] = Object.entries(manifest.states).map(
    ([state, spec]) => {
      const lo = spec.temp_f[0] ?? MIN_F;
      const hi = spec.temp_f[1] ?? MAX_F;
      return { label: state, tempF: Math.round((lo + hi) / 2) };
    },
  );
  jumps.push({ label: "very_hot (clamp)", tempF: 620 });
  return jumps;
})();

function tempInSomeBand(tempF: number): boolean {
  return Object.values(manifest.states).some((spec) => {
    const lo = spec.temp_f[0] ?? -Infinity;
    const hi = spec.temp_f[1] ?? Infinity;
    return tempF >= lo && tempF < hi;
  });
}

function ChefDemo() {
  const [tempF, setTempF] = useState(150);
  const [playing, setPlaying] = useState(false);
  const sweepDir = useRef(1);
  const prevState = useRef<ChefState | null>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setTempF((t) => {
        let next = t + sweepDir.current * SWEEP_STEP_F;
        if (next >= MAX_F) {
          next = MAX_F;
          sweepDir.current = -1;
        } else if (next <= MIN_F) {
          next = MIN_F;
          sweepDir.current = 1;
        }
        return next;
      });
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing]);

  function drive(next: number) {
    setPlaying(false);
    setTempF(next);
  }

  const sample: Sample = { t: new Date().toISOString(), temp_f: tempF };
  const state = selectState(tempF, prevState.current, manifest);
  prevState.current = state;
  const clamped = !tempInSomeBand(tempF);

  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />

      <section class="hero__readout">
        <div class="hero__num">{Math.round(tempF)}</div>
        <div class="hero__unit">DEGREES FAHRENHEIT</div>
      </section>

      <ChefWidget latest_sample={sample} />

      <div class="demo-panel">
        <div class="demo-panel__readout">
          {Math.round(tempF)}°F → <strong>{state}</strong>
          {clamped && <span class="demo-panel__clamp"> (clamped)</span>}
        </div>
        <input
          type="range"
          min={MIN_F}
          max={MAX_F}
          value={tempF}
          onInput={(e) => drive(Number(e.currentTarget.value))}
        />
        <div class="demo-panel__bands">
          {bandJumps.map((j) => (
            <button key={j.label} type="button" onClick={() => drive(j.tempF)}>
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
