/**
 * A simple responsive photo grid with a click-to-enlarge lightbox. No
 * dependencies — the lightbox is a fixed overlay with keyboard nav (←/→/Esc).
 */
import { useEffect, useState } from "preact/hooks";

export function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % images.length));
      else if (e.key === "ArrowLeft")
        setOpen((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, images.length]);

  if (images.length === 0) return null;

  return (
    <>
      <div class="gallery">
        {images.map((src, i) => (
          <button class="gallery__thumb" key={src} onClick={() => setOpen(i)}>
            <img src={src} alt={`${alt} — photo ${i + 1}`} loading="lazy" />
          </button>
        ))}
      </div>

      {open !== null && (
        <div class="lightbox" onClick={() => setOpen(null)}>
          <button class="lightbox__close" aria-label="Close">×</button>
          <button
            class="lightbox__nav lightbox__nav--prev"
            aria-label="Previous"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((i) => (i === null ? i : (i - 1 + images.length) % images.length));
            }}
          >
            ‹
          </button>
          <img class="lightbox__img" src={images[open]} alt={`${alt} — photo ${open + 1}`} onClick={(e) => e.stopPropagation()} />
          <button
            class="lightbox__nav lightbox__nav--next"
            aria-label="Next"
            onClick={(e) => {
              e.stopPropagation();
              setOpen((i) => (i === null ? i : (i + 1) % images.length));
            }}
          >
            ›
          </button>
          <div class="lightbox__count">{open + 1} / {images.length}</div>
        </div>
      )}
    </>
  );
}
