import { useState } from "preact/hooks";
import type { Sample } from "@udcpine/shared";
import { formatHearthTempF } from "../temp";
import { ChefStage } from "./ChefStage";
import "./chef.css";

interface ChefPanelProps {
  latest_sample: Sample | null;
}

/**
 * Chuck as an inline centerpiece for the idle and warm-up screens: the
 * animated sprite with the ambient temperature beneath it. Click to take
 * Chuck over the whole screen; click again to collapse. (The cooking
 * dashboard uses ChefWidget, the corner-docked variant of the same idea.)
 */
export function ChefPanel({ latest_sample }: ChefPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const tempC = latest_sample?.temp_c ?? null;

  if (expanded) {
    return (
      <div
        class="chef chef--expanded"
        role="button"
        tabIndex={0}
        aria-label="pizza chef — click to collapse"
        onClick={() => setExpanded(false)}
      >
        <ChefStage latest_sample={latest_sample} />
        <div class="chef__temp">{formatHearthTempF(tempC)}</div>
      </div>
    );
  }

  return (
    <div
      class="idle__chef"
      role="button"
      tabIndex={0}
      aria-label="pizza chef — click to expand"
      onClick={() => setExpanded(true)}
    >
      <ChefStage latest_sample={latest_sample} />
      <output class="idle__temp" aria-label="current hearth temperature">
        {formatHearthTempF(tempC)}
      </output>
    </div>
  );
}
