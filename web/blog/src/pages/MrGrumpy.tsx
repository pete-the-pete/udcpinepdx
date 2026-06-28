/**
 * Entry — "Mr. Grumpy's Fire Mouth." Content from web/blog/assets/mr-grumpy/Mr.md.
 * Photos are alternating left/right story spreads; the rest go in a closing
 * contact sheet. All seven share one lightbox.
 *
 * The photos are all of the chiminea rig (there are none of the pizza itself —
 * "I forgot to take any pictures"), so captions describe the oven, not the pie.
 */
import { useState } from "preact/hooks";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { StorySpread } from "../components/StorySpread";
import { PhotoLightbox } from "../components/PhotoLightbox";
import { galleryFor } from "../galleries";

const ALT = "Mr. Grumpy's Fire Mouth";

export function MrGrumpy() {
  const photos = galleryFor("mr-grumpy"); // 01..07 → indices 0..6
  const [lb, setLb] = useState<number | null>(null);
  const contact = [1, 3, 5]; // the near-variant "fire coming up" shots

  return (
    <div class="wrap">
      <SiteHeader />

      <article class="post">
        <header class="post-hero">
          <div class="eyebrow">Attempt 10 · the first post</div>
          <h1>Mr. Grumpy's Fire Mouth</h1>
          <div class="byline">by Pete &amp; friends</div>
        </header>

        <p class="standfirst">
          The 10th attempt is the first post. A lot has been learned to get here — but the journey
          continues.
        </p>
        <p class="dropcap">
          The main takeaway: cooking pizza in the upper deck of a chiminea in northeast Portland
          doesn’t <em>really</em> work — but it’s fun to try. A pizza oven is supposed to be screaming
          hot, and the way you get there is thick insulating walls and hours of heat. Mine has thin
          walls and two giant holes in the front that let the heat right out.
        </p>

        <StorySpread
          src={photos[2]!}
          alt={ALT}
          caption="The rig: a paver and bricks sealing the upper deck, cap on to hold the heat."
          flip={false}
          onZoom={() => setLb(2)}
        >
          <p>
            This attempt was all about closing off the upper-deck opening to trap as much heat as I
            could — cap on, and let it run for hours. It was also raining.
          </p>
        </StorySpread>

        <StorySpread
          src={photos[0]!}
          alt={ALT}
          caption="Looking down into the cooking chamber — lava rock and the cooking stone."
          flip={true}
          onZoom={() => setLb(0)}
        >
          <p>
            Up top is the cooking chamber: lava rock for thermal mass and a heavy stone to bake on.
            The whole bet is that if I choke the openings, this little chamber finally gets hot enough
            to cook a pizza.
          </p>
        </StorySpread>

        <h2>The pizza</h2>
        <p>
          The pizza itself was simple, to keep the focus on the chiminea. I made the{" "}
          <a href="https://sugarspunrun.com/the-best-pizza-dough-recipe/" target="_blank" rel="noreferrer">
            dough
          </a>
          , grew the tomatoes in my garden last summer and the basil in my{" "}
          <a href="https://www.clickandgrow.com/products/the-smart-garden-9" target="_blank" rel="noreferrer">
            smart garden
          </a>
          , and turned them into a{" "}
          <a href="https://www.thursdaynightpizza.com/roasted-tomato-pizza-sauce/" target="_blank" rel="noreferrer">
            roasted cherry tomato sauce
          </a>
          . Frozen, the tomatoes taste just as good as fresh — they only get mushy, which is fine for
          sauce. I forgot to photograph the dough, or honestly the finished pie, so every photo here
          is the oven that cooked it.
        </p>

        <StorySpread
          src={photos[6]!}
          alt={ALT}
          caption="Inside the chamber — the cooking stone over a bright firebox."
          flip={false}
          onZoom={() => setLb(6)}
        >
          <p>
            With the fire roaring below, the cooking stone starts to glow. This is the moment it
            actually feels like an oven instead of a fancy fire pit.
          </p>
        </StorySpread>

        <StorySpread
          src={photos[4]!}
          alt={ALT}
          caption="Stone lid off — embers banked in the firebox."
          flip={true}
          onZoom={() => setLb(4)}
        >
          <p>
            Pulling the stone to check the coals. The lower firebox got properly hot; the whole trick
            is getting that heat to climb into the chamber and <em>stay</em> there.
          </p>
        </StorySpread>

        <h2>The recap</h2>
        <p>
          It went OK. It definitely got hot — but not <em>really</em> hot. Still, the pizza wasn’t
          watery like other times (simple toppings help a lot), the crust had a nice texture and was
          only mildly dark on the bottom, and — the big win — it actually cooked, in a reasonable
          amount of time, without me fussing with the fire the whole time.
        </p>

        <h3 class="contact-head">More from the firing</h3>
        <div class="gallery gallery--contact">
          {contact.map((i) => (
            <button class="gallery__thumb" key={i} onClick={() => setLb(i)}>
              <img src={photos[i]} alt={`${ALT} — photo ${i + 1}`} loading="lazy" />
            </button>
          ))}
        </div>
      </article>

      <SiteFooter />
      <PhotoLightbox images={photos} index={lb} alt={ALT} onClose={() => setLb(null)} onIndex={setLb} />
    </div>
  );
}
