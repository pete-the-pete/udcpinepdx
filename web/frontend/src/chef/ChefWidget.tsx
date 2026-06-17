import { useState } from "preact/hooks";
import type { Sample } from "@udcpine/shared";
import { formatHearthTempF } from "../temp";
import { ChefStage } from "./ChefStage";
import "./chef.css";

interface ChefWidgetProps {
  latest_sample: Sample | null;
}

/**
 * The pizza chef screensaver shown on the cooking dashboard. Compact in a
 * corner; click to take over the screen. Rendering + state selection live in
 * ChefStage; this wrapper owns the dashboard's mode/click/temp-label chrome.
 */
export function ChefWidget({ latest_sample }: ChefWidgetProps) {
  const [mode, setMode] = useState<"compact" | "expanded">("compact");
  const tempC = latest_sample?.temp_c ?? null;

  if (mode === "compact") {
    return (
      <div
        class="chef chef--compact"
        role="button"
        tabIndex={0}
        aria-label="pizza chef — click to expand"
        onClick={() => setMode("expanded")}
      >
        <ChefStage latest_sample={latest_sample} />
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
      <ChefStage latest_sample={latest_sample} />
      <div class="chef__temp">{formatHearthTempF(tempC)}</div>
    </div>
  );
}
