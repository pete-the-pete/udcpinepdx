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

const ALT = "A new location!";

export function ANewLocation() {
  // 02..07 in order → indices 0..5 (01.jpg dropped).
  const pics = galleryFor("a-new-location");
  const [lb, setLb] = useState<number | null>(null);
  const contact = [0, 3, 4]; // the photos not used as the hero (2) or spreads (1, 5)

  return (
    <div class="wrap">
      <SiteHeader />

      <article class="post">
        <header class="post-hero">
          <div class="eyebrow">Attempt 500 · in the jungle</div>
          <h1>A new Location!</h1>
        </header>
        <Hero
          src={pics[2]!}
          alt={ALT}
          caption='Much more PDX amongst the plants'
          onZoom={() => setLb(2)}
        />

        <h2 class="dropcap">The time it almost didn't happen, for real</h2>

        <StorySpread
          src={pics[0]!}
          alt={ALT}
          caption='A near tragedy!'
          flip={false}
          onZoom={() => setLb(1)}
        >
          <p>
            The cool corten steel barriers aren't rated for high winds.
          </p>
        </StorySpread>

        <StorySpread
          src={pics[1]!}
          alt={ALT}
          caption='A near home'
          flip={true}
          onZoom={() => setLb(1)}
        >
          <p>
            Free to stand alone and scorch whatever it wants.
          </p>
        </StorySpread>

        <PotentialImprovements />
      </article>

      <SiteFooter />
      <PhotoLightbox images={pics} index={lb} alt={ALT} onClose={() => setLb(null)} onIndex={setLb} />
    </div>
  );
};