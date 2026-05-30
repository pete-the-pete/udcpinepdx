import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type { Sample } from "@udcpine/shared";
import { manifest, type ChefState } from "./manifest";
import { selectState } from "./state-machine";
import "./chef.css";

/**
 * Sprite sheets are bundled assets. The glob keeps the engine agnostic to
 * which states the art track has shipped — it renders whatever exists.
 */
const sheetUrls = import.meta.glob("../assets/chef/chef_*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function sheetFor(state: ChefState): string | undefined {
  for (const [path, url] of Object.entries(sheetUrls)) {
    if (path.endsWith(`/chef_${state}.png`)) return url;
  }
  return undefined;
}

/**
 * `steps(n)` cannot read a CSS variable and frame counts are per-state, so
 * the frame-cycling keyframes are generated from the manifest at runtime.
 * States with `frames === 1` need no cycle and are skipped — under the v1
 * skeleton that is every state, so this currently injects nothing.
 */
let keyframesInjected = false;
function injectCycleKeyframes(): void {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const rules: string[] = [];
  for (const [state, spec] of Object.entries(manifest.states)) {
    if (spec.frames > 1) {
      rules.push(
        `@keyframes chef-cycle-${state} {` +
          " from { background-position-x: 0%; }" +
          " to { background-position-x: 100%; } }",
      );
    }
  }
  if (rules.length === 0) return;
  const el = document.createElement("style");
  el.dataset.chef = "cycle-keyframes";
  el.textContent = rules.join("\n");
  document.head.appendChild(el);
}

/**
 * The css_animation catalogue. The manifest declares a name per state; this
 * map defines what each name means — a CSS animation on the sprite, and
 * optionally decoration (steam wisps). Transform (shiver/jig), filter (glow),
 * and background-position (frame cycle) are distinct properties, so a state's
 * sprite animation always composes with the cycle without conflict.
 */
interface ChefEffect {
  sprite: string;
  steam?: boolean;
  aura?: boolean;
}

const CHEF_EFFECTS: Record<string, ChefEffect> = {
  shiver: { sprite: "chef-shiver 0.18s ease-in-out infinite" },
  jig: { sprite: "chef-jig 0.72s ease-in-out infinite" },
  heat: { sprite: "chef-hot-glow 1.3s ease-in-out infinite", steam: true },
  transcendence: {
    sprite:
      "chef-transcend 16s linear infinite, chef-trippy-filter 12s linear infinite",
    aura: true,
  },
};

/**
 * The renderer seam. A future Approach B canvas renderer can replace this
 * unit without touching the state machine or the widget's mode logic.
 */
function ChefSprite({ state }: { state: ChefState }) {
  const spec = manifest.states[state];
  const effect = spec.css_animation
    ? CHEF_EFFECTS[spec.css_animation]
    : undefined;
  const url = sheetFor(state);
  const style: JSX.CSSProperties = {
    backgroundImage: url ? `url("${url}")` : "none",
  };

  const animations: string[] = [];
  if (spec.frames > 1) {
    const fps = spec.fps ?? 8;
    style.backgroundSize = `${spec.frames * 100}% 100%`;
    animations.push(
      `chef-cycle-${state} ${spec.frames / fps}s steps(${spec.frames}) infinite`,
    );
  } else {
    style.backgroundSize = "100% 100%";
  }
  if (effect) animations.push(effect.sprite);
  if (animations.length > 0) style.animation = animations.join(", ");

  return (
    <div class="chef__stage">
      {effect?.aura && (
        <div class="chef__aura" aria-hidden="true">
          <span class="chef__halo" />
          <span class="chef__halo" />
          <span class="chef__halo" />
        </div>
      )}
      {effect?.steam && (
        <div class="chef__steam" aria-hidden="true">
          <span class="chef__wisp" />
          <span class="chef__wisp" />
          <span class="chef__wisp" />
        </div>
      )}
      <div class="chef__sprite" style={style} aria-hidden="true" />
    </div>
  );
}

interface ChefWidgetProps {
  latest_sample: Sample | null;
}

/**
 * The pizza chef screensaver: a two-mode widget shown during a firing.
 * Compact in a corner of the dashboard; click to take over the screen.
 */
export function ChefWidget({ latest_sample }: ChefWidgetProps) {
  const [mode, setMode] = useState<"compact" | "expanded">("compact");
  const prevState = useRef<ChefState | null>(null);

  useEffect(() => {
    injectCycleKeyframes();
  }, []);

  // Wire unit is °C; we convert to °F at the very end for the on-screen
  // label so the operator reads American units. The state machine itself
  // is metric — that's what the manifest declares and the thermocouple
  // reports.
  const tempC = latest_sample?.temp_c ?? null;
  const state = selectState(tempC, prevState.current, manifest);
  prevState.current = state;
  const tempF = tempC !== null ? tempC * 9 / 5 + 32 : null;

  if (mode === "compact") {
    return (
      <div
        class="chef chef--compact"
        role="button"
        tabIndex={0}
        aria-label={`pizza chef — ${state} — click to expand`}
        onClick={() => setMode("expanded")}
      >
        <ChefSprite state={state} />
      </div>
    );
  }

  return (
    <div
      class="chef chef--expanded"
      role="button"
      tabIndex={0}
      aria-label="pizza chef — click to collapse"
      onClick={() => setMode("compact")}
    >
      <ChefSprite state={state} />
      <div class="chef__temp">
        {tempF !== null ? `${Math.round(tempF)}°F` : "—"}
      </div>
    </div>
  );
}
