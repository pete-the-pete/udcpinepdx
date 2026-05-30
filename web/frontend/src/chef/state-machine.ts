import type { ChefManifest, ChefState } from "./manifest";

/**
 * Dead-band width: temperature must move this far past an edge to switch.
 * Degrees Celsius — picked at roughly half the smallest band width (50–60°C)
 * so the chef does not flap on a noisy thermocouple sitting on an edge.
 */
export const HYSTERESIS_C = 4;

interface Band {
  state: ChefState;
  low: number;
  high: number;
}

function buildBands(manifest: ChefManifest): Band[] {
  return (Object.keys(manifest.states) as ChefState[]).map((state) => {
    const [low, high] = manifest.states[state].temp_c;
    return {
      state,
      low: low ?? -Infinity,
      high: high ?? Infinity,
    };
  });
}

/** Distance from a temperature to a band's [low, high) interval (0 if inside). */
function distance(tempC: number, band: Band): number {
  if (tempC < band.low) return band.low - tempC;
  if (tempC >= band.high) return tempC - band.high;
  return 0;
}

function nearestBand(tempC: number, bands: Band[]): Band {
  return bands.reduce((best, b) =>
    distance(tempC, b) < distance(tempC, best) ? b : best,
  );
}

/**
 * Map an oven temperature (°C) to a chef state. Pure — no DOM, no Preact.
 *
 *  1. Null sample → the coldest state (a dark oven is cold).
 *  2. Band lookup: edges are [low, high) — low inclusive, high exclusive.
 *  3. Hysteresis: stay in `prevState` while still within its band widened
 *     by HYSTERESIS_C, so the chef does not flap on a band edge.
 *  4. Missing-state clamp: a temperature in a band with no shipped sheet
 *     resolves to the nearest band that does have one.
 */
export function selectState(
  tempC: number | null,
  prevState: ChefState | null,
  manifest: ChefManifest,
): ChefState {
  const bands = buildBands(manifest);
  if (bands.length === 0) throw new Error("chef manifest has no states");

  if (tempC === null) {
    return bands.reduce((a, b) => (b.low < a.low ? b : a)).state;
  }

  if (prevState !== null) {
    const prev = bands.find((b) => b.state === prevState);
    if (
      prev &&
      tempC >= prev.low - HYSTERESIS_C &&
      tempC < prev.high + HYSTERESIS_C
    ) {
      return prevState;
    }
  }

  const exact = bands.find((b) => tempC >= b.low && tempC < b.high);
  return (exact ?? nearestBand(tempC, bands)).state;
}
