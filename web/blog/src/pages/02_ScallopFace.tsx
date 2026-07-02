/**
 * Entry — "Mr. Grumpy's Fire Mouth." Content from web/blog/assets/mr-grumpy/Mr.md.
 * Photos are alternating left/right story spreads; the rest go in a closing
 * contact sheet. They share one lightbox.
 *
 * The photos are all of the chiminea rig (there are none of the pizza itself —
 * "I forgot to take any pictures"), so captions describe the oven, not the pie.
 * 01.jpg (the top-down chamber shot) is excluded — not right for this page.
 */
import { useState } from "preact/hooks";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { Hero } from "../components/Hero";
import { StorySpread } from "../components/StorySpread";
import { PhotoLightbox } from "../components/PhotoLightbox";
import { PotentialImprovements } from "../components/PotentialImprovements";
import { galleryFor } from "../galleries";

const ALT = "Scallop face!";

export function ScallopFace() {
  // 02..07 in order → indices 0..5 (01.jpg dropped).
  const pics = galleryFor("scallop-face");
  const [lb, setLb] = useState<number | null>(null);
  const contact = [0, 1, 2]; // the photos not used as the hero (2) or spreads (1, 5)

  return (
    <div class="wrap">
      <SiteHeader />

      <article class="post">
        <header class="post-hero">
          <div class="eyebrow">Attempt 11 · no eyebrows</div>
          <h1>Another Attempt</h1>
        </header>
        <Hero
          src={pics[0]!}
          alt={ALT}
          caption='No we have it framed in corten'
          onZoom={() => setLb(0)}
        />

        
        <p>
        Not much documentation this time. Minor improvement was to remove the eyebrows.
        </p>

        <PotentialImprovements />

        <div class="gallery gallery--contact">
          {contact.map((i) => (
            <button class="gallery__thumb" key={i} onClick={() => setLb(i)}>
              <img src={pics[i]} alt={`${ALT} — photo ${i + 1}`} loading="lazy" />
            </button>
          ))}
        </div>

      </article>

      <SiteFooter />
      <PhotoLightbox images={pics} index={lb} alt={ALT} onClose={() => setLb(null)} onIndex={setLb} />
    </div>
  );
};