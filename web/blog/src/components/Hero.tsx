/**
 * A large lead image for the top of a post — the first photo, given real
 * presence. Spans the content column, click to zoom. `ratio` (a CSS
 * aspect-ratio) and `objectPosition` let you tune the crop per image; the
 * lightbox always shows the full frame.
 */
export function Hero({
  src,
  alt,
  caption,
  ratio = "3 / 2",
  objectPosition = "center",
  onZoom,
}: {
  src: string;
  alt: string;
  caption?: string;
  ratio?: string;
  objectPosition?: string;
  onZoom?: () => void;
}) {
  return (
    <figure class="hero-figure">
      <button class="hero-figure__zoom" onClick={onZoom} aria-label="Enlarge photo">
        <img src={src} alt={alt} style={{ aspectRatio: ratio, objectPosition }} />
      </button>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
