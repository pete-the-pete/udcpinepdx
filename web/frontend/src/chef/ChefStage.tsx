import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact";
import type { Sample } from "@udcpine/shared";
import { manifest, type ChefState } from "./manifest";
import { selectState } from "./state-machine";
import { sheetUrls } from "./sheet-urls";
import "./chef.css";

function sheetFor(state: ChefState): string | undefined {
  for (const [path, url] of Object.entries(sheetUrls)) {
    if (path.endsWith(`/chef_${state}.png`)) return url;
  }
  return undefined;
}

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

function ChefSprite({ state }: { state: ChefState }) {
  const spec = manifest.states[state];
  const effect = spec.css_animation ? CHEF_EFFECTS[spec.css_animation] : undefined;
  const url = sheetFor(state);
  const style: JSX.CSSProperties = {
    backgroundImage: url ? `url("${url}")` : "none",
  };
  const animations: string[] = [];
  if (spec.frames > 1) {
    const fps = spec.fps ?? 8;
    style.backgroundSize = `${spec.frames * 100}% 100%`;
    animations.push(`chef-cycle-${state} ${spec.frames / fps}s steps(${spec.frames}) infinite`);
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

interface ChefStageProps {
  latest_sample: Sample | null;
}

/**
 * The reusable Chuck core: maps a reading to a state (with hysteresis) and
 * renders the animated sprite. Shared by ChefWidget (dashboard), IdleScreen,
 * and WarmingUpScreen.
 */
export function ChefStage({ latest_sample }: ChefStageProps) {
  const prevState = useRef<ChefState | null>(null);
  useEffect(() => {
    injectCycleKeyframes();
  }, []);
  const tempC = latest_sample?.temp_c ?? null;
  const state = selectState(tempC, prevState.current, manifest);
  prevState.current = state;
  return <ChefSprite state={state} />;
}
