/** A responsive photo grid that opens the shared lightbox (for photo-only entries). */
import { useState } from "preact/hooks";
import { PhotoLightbox } from "./PhotoLightbox";

export function Gallery({ images, alt }: { images: string[]; alt: string }) {
  const [open, setOpen] = useState<number | null>(null);
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
      <PhotoLightbox images={images} index={open} alt={alt} onClose={() => setOpen(null)} onIndex={setOpen} />
    </>
  );
}
