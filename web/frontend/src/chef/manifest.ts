import manifestData from "../assets/chef/chef.manifest.json";

/** The states the art track has actually shipped sheets for. */
export type ChefState = keyof typeof manifestData.states;

export interface ChefStateSpec {
  frames: number;
  fps: number | null;
  css_animation?: string;
  /** Inclusive low edge, exclusive high edge; null means ±∞. Degrees Celsius. */
  temp_c: (number | null)[];
}

export interface ChefManifest {
  frame_size: number[];
  states: Record<ChefState, ChefStateSpec>;
}

/**
 * The art contract, typed. The assignment itself is the build-time check:
 * a manifest that drifts from `ChefManifest` is a TypeScript error here.
 */
export const manifest: ChefManifest = manifestData;

export const chefStates = Object.keys(manifest.states) as ChefState[];
