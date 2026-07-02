/**
 * Shared full-screen photo viewer. Controlled: the parent owns the open index
 * and the image set, so story spreads and a contact-sheet grid can share one
 * lightbox across a whole post. Keyboard nav: ←/→/Esc.
 */
import { useEffect } from "preact/hooks";

export function PhotoLightbox({
  images,
  index,
  alt,
  onClose,
  onIndex,
}: {
  images: string[];
  index: number | null;
  alt: string;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onIndex((index + 1) % images.length);
      else if (e.key === "ArrowLeft") onIndex((index - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [index, images.length, onClose, onIndex]);

  if (index === null) return null;

  return (
    <div class="lightbox" onClick={onClose}>
      <button class="lightbox__close" aria-label="Close">×</button>
      <button
        class="lightbox__nav lightbox__nav--prev"
        aria-label="Previous"
        onClick={(e) => {
          e.stopPropagation();
          onIndex((index - 1 + images.length) % images.length);
        }}
      >
        ‹
      </button>
      <img
        class="lightbox__img"
        src={images[index]}
        alt={`${alt} — photo ${index + 1}`}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        class="lightbox__nav lightbox__nav--next"
        aria-label="Next"
        onClick={(e) => {
          e.stopPropagation();
          onIndex((index + 1) % images.length);
        }}
      >
        ›
      </button>
      <div class="lightbox__count">
        {index + 1} / {images.length}
      </div>
    </div>
  );
}
