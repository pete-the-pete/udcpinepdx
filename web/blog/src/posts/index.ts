/**
 * The post registry. The home index and routing are driven by this list, so
 * adding the next firing's entry is one record + one page component.
 */
import type { ComponentType } from "preact";
import { FiringOne } from "../pages/FiringOne";

export interface Post {
  slug: string;
  title: string;
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
];

export function postBySlug(slug: string): Post | undefined {
  return posts.find((p) => p.slug === slug);
}
