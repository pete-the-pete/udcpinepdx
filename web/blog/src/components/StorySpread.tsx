/**
 * One alternating photo/text module — a mini magazine spread. Photo on the left
 * by default; `flip` puts it on the right. The module breaks out wider than the
 * text column so each side has room. Stacks (photo first) on narrow screens.
 */
import type { ComponentChildren } from "preact";

export function StorySpread({
  src,
  caption,
  alt,
  flip = false,
  onZoom,
  children,
}: {
  src: string;
  caption: string;
  alt: string;
  flip?: boolean;
  onZoom?: () => void;
  children: ComponentChildren;
}) {
  return (
    <section class="spread" data-flip={flip ? "true" : "false"}>
      <figure class="spread__media">
        <button class="spread__zoom" onClick={onZoom} aria-label="Enlarge photo">
          <img src={src} alt={alt} loading="lazy" />
        </button>
        <figcaption>{caption}</figcaption>
      </figure>
      <div class="spread__text">{children}</div>
    </section>
  );
}
