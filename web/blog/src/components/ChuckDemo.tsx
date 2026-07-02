/**
 * Free Chuck demo: drag the oven air temperature and watch the real chef cycle
 * through all five states. `ChefStage` and the state machine are the exact
 * kiosk components, reused via the @frontend alias — the blog's Chuck is the
 * dashboard's Chuck.
 */
import { useState } from "preact/hooks";
import { ChefStage } from "@frontend/chef/ChefStage";
import { manifest, type ChefState } from "@frontend/chef/manifest";
import { selectState } from "@frontend/chef/state-machine";
import { celsiusToFahrenheit } from "@frontend/temp";

const STATE_LABEL: Record<ChefState, string> = {
  frozen: "Frozen",
  thawing: "Thawing",
  active: "Active",
  hot: "Hot",
  very_hot: "Very Hot",
};

// Slider covers a cold oven (20°C ≈ 68°F) up past the very-hot band so readers
// can reach transcendence (280°C ≈ 536°F). Starts cold at the far left.
const MIN_C = 20;
const MAX_C = 280;

export function ChuckDemo() {
  const [tempC, setTempC] = useState(MIN_C);
  const sample = { t: new Date(0).toISOString(), temp_c: tempC };
  const state = selectState(tempC, null, manifest);

  return (
    <div class="card demo">
      <div class="demo__chuck">
        <ChefStage latest_sample={sample} />
      </div>
      <div class="demo__controls">
        <div class="demo__read">
          <span class="demo__tempf">{Math.round(celsiusToFahrenheit(tempC))}°F</span>
          <span class="demo__state" data-state={state}>{STATE_LABEL[state]}</span>
        </div>
        <input
          class="slider"
          type="range"
          min={MIN_C}
          max={MAX_C}
          step={1}
          value={tempC}
          aria-label="Oven air temperature"
          onInput={(e) => setTempC(Number((e.target as HTMLInputElement).value))}
        />
        <div class="demo__hint">
          Drag the oven air temperature · frozen → thawing → active → hot → very&nbsp;hot. A 4°
          dead-band keeps Chuck from flickering on a noisy reading.
        </div>
      </div>
    </div>
  );
}
