/**
 * The post registry. The home index and routing are driven by this list, so
 * adding the next entry is one record (and, for a photo-led entry, just a
 * folder under web/blog/assets/<slug>/ + `make web-blog-galleries`).
 */
import type { ComponentType } from "preact";
import { FiringOne } from "../pages/04_FiringOne";
import { MrGrumpy } from "../pages/01_MrGrumpy";
import { ScallopFace } from "../pages/02_ScallopFace";
import { ANewLocation } from "../pages/03_ANewLocation";

export interface Post {
  slug: string;
  title: string;
  /** ISO date (YYYY-MM-DD). The index lists newest first. */
  date: string;
  dek: string;
  Component: ComponentType;
}

export const posts: Post[] = [
  {
    slug: "firing-1",
    title: "A new door!",
    date: "2026-06-21",
    dek: "Three hours, one fire, seven pizzas — and a temperature trace that tells the whole story.",
    Component: FiringOne,
  },
  {
    slug: "a-new-location",
    title: "A New Location!",
    date: "2023-11-28",
    dek: "Somewhere new.",
    Component: ANewLocation,
  },
  {
    slug: "scallop-face",
    title: "Scallop Face",
    date: "2023-07-12",
    dek: "yep",
    Component: ScallopFace,
  },
  {
    slug: "mr-grumpy",
    title: "Mr. Grumpy's Fire Mouth",
    date: "2022-04-09",
    dek: "The 10th attempt — and the very first post.",
    Component: MrGrumpy,
  },
];

export function postBySlug(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug);
}
