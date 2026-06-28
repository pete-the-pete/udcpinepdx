/**
 * The post registry. The home index and routing are driven by this list, so
 * adding the next entry is one record (and, for a photo-led entry, just a
 * folder under web/blog/assets/<slug>/ + `make web-blog-galleries`).
 */
import type { ComponentType } from "preact";
import { FiringOne } from "../pages/FiringOne";
import { MrGrumpy } from "../pages/MrGrumpy";
import { GalleryPage } from "../pages/GalleryPage";

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
    title: "The night the oven finally got hot",
    date: "2026-06-21",
    dek: "Three hours, one fire, seven pizzas — and a temperature trace that tells the whole story.",
    Component: FiringOne,
  },
  {
    slug: "scallop-face",
    title: "Scallop Face",
    date: "2024-07-12",
    dek: "A pizza night, in photos.",
    Component: () => (
      <GalleryPage
        eyebrow="Field notes"
        title="Scallop Face"
        entry="scallop-face"
        intro="Photos from this one — the write-up is still to come."
      />
    ),
  },
  {
    slug: "a-new-location",
    title: "A New Location",
    date: "2023-11-28",
    dek: "Trying the oven somewhere new.",
    Component: () => (
      <GalleryPage
        eyebrow="Field notes"
        title="A New Location"
        entry="a-new-location"
        intro="Photos from this one — the write-up is still to come."
      />
    ),
  },
  {
    slug: "pizzas",
    title: "Pizzas",
    date: "2022-07-02",
    dek: "A run of pies.",
    Component: () => (
      <GalleryPage
        eyebrow="Gallery"
        title="Pizzas"
        entry="pizzas"
        intro="A handful of pies from the early days."
      />
    ),
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
