import type { ChefManifest, ChefState } from "./manifest";

/** Dead-band width: temperature must move this far past an edge to switch. */
export const HYSTERESIS_F = 8;

interface Band {
  state: ChefState;
  low: number;
  high: number;
}

function buildBands(manifest: ChefManifest): Band[] {
  return (Object.keys(manifest.states) as ChefState[]).map((state) => {
    const [low, high] = manifest.states[state].temp_f;
    return {
      state,
      low: low ?? -Infinity,
      high: high ?? Infinity,
    };
  });
}

/** Distance from a temperature to a band's [low, high) interval (0 if inside). */
function distance(tempF: number, band: Band): number {
  if (tempF < band.low) return band.low - tempF;
  if (tempF >= band.high) return tempF - band.high;
  return 0;
}

function nearestBand(tempF: number, bands: Band[]): Band {
  return bands.reduce((best, b) =>
    distance(tempF, b) < distance(tempF, best) ? b : best,
  );
}

/**
 * Map an oven temperature to a chef state. Pure — no DOM, no Preact.
 *
 *  1. Null sample → the coldest state (a dark oven is cold).
 *  2. Band lookup: edges are [low, high) — low inclusive, high exclusive.
 *  3. Hysteresis: stay in `prevState` while still within its band widened
 *     by HYSTERESIS_F, so the chef does not flap on a band edge.
 *  4. Missing-state clamp: a temperature in a band with no shipped sheet
 *     resolves to the nearest band that does have one.
 */
export function selectState(
  tempF: number | null,
  prevState: ChefState | null,
  manifest: ChefManifest,
): ChefState {
  const bands = buildBands(manifest);
  if (bands.length === 0) throw new Error("chef manifest has no states");

  if (tempF === null) {
    return bands.reduce((a, b) => (b.low < a.low ? b : a)).state;
  }

  if (prevState !== null) {
    const prev = bands.find((b) => b.state === prevState);
    if (
      prev &&
      tempF >= prev.low - HYSTERESIS_F &&
      tempF < prev.high + HYSTERESIS_F
    ) {
      return prevState;
    }
  }

  const exact = bands.find((b) => tempF >= b.low && tempF < b.high);
  return (exact ?? nearestBand(tempF, bands)).state;
}
