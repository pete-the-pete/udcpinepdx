/** Shared layout for photo-led entries: hero + optional body + a photo gallery. */
import type { ComponentChildren } from "preact";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { Gallery } from "../components/Gallery";
import { galleryFor } from "../galleries";

export function GalleryPage({
  eyebrow,
  title,
  intro,
  entry,
  children,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  entry: string;
  children?: ComponentChildren;
}) {
  const images = galleryFor(entry);
  return (
    <div class="wrap">
      <SiteHeader />
      <article class="post">
        <header class="post-hero">
          <div class="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
        </header>
        {intro ? <p class="post-lede">{intro}</p> : null}
        {children}
        <h2>The photos</h2>
        <Gallery images={images} alt={title} />
      </article>
      <SiteFooter />
    </div>
  );
}
