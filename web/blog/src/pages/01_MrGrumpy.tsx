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

const ALT = "Mr. Grumpy's Fire Mouth";

export function MrGrumpy() {
  // 02..07 in order → indices 0..5 (01.jpg dropped).
  const pics = galleryFor("mr-grumpy");// , { exclude: ["01.jpg"] });
  const [lb, setLb] = useState<number | null>(null);
  const contact = [0, 3, 4]; // the photos not used as the hero (2) or spreads (1, 5)

  return (
    <div class="wrap">
      <SiteHeader />

      <article class="post">
        <header class="post-hero">
          <div class="eyebrow">Attempt 10 · the first post</div>
          <h1>Mr. Grumpy's Fire Mouth</h1>
        </header>
        <Hero
          src={pics[2]!}
          alt={ALT}
          caption='A paver and bricks makes a "door"!'
          onZoom={() => setLb(2)}
        />
        <p class="dropcap">
          One of the the main characteristics of a pizza oven is supposed to get super hot to achieve the perfect balance of a crispy, blistered crust and a soft, chewy interior.
          Most wood fired pizza ovens achieve with thick insulating walls, a large internal space, and maybe a door. Then you burn wood in the over for a while to get things really hot before cooking pizza.
          A more convenient option would be an off the shelf option engineered to provide high heat without all the mass of wood fired oven, i.e. thin steel walls in a tight space that blasts the pizza from all sides with even/consistent gas or electric heat that can be conveniently switch ON (and turned OFF) when you're done...and maybe a door.
          <br /><br />
          The chiminea neither mass nor technology to help qualify it as a pizza (or any type, really) oven. It has thin terracotta walls, a tiny burn chamber, the cooking area is <em>directly</em> above an inconsistent heat source, ash gets everywhere, and there is a <b>giant</b> opening where'd you'd really want a door...and yet...it sure seems like you could cook pizza if you solve those challenges.
        </p>


        <h2>We are gonna make pizza</h2>
        <p class="dropcap">
          The 10th attempt is the first post. A lot has been learned to get here (100% improvement each time™!). Evidence shows that the chiminea CAN, technically, cook pizza. Now it is time to perfect the this process given the "oven" we have.

          This time attempts to solve the biggest current problem; cooking temperature and heat retention. The thing can get hot, but it requires a ton of wood to get there. It's also crazy uneven heat, we end up with burnt and soggy pizzas, and the whole thing cools down so quickly it takes forever to get it back up to temp (whatever that temp might be, i don't have a way to measure it).

          So this attempt has:
          <ul>
            <li>a pizza stone</li>
            <li>a curved paver for a door</li>
            <li>bricks everywhere! (for heat retention)</li>
          </ul>
        </p>

        <StorySpread
          src={pics[1]!}
          alt={ALT}
          caption='A paver and bricks makes a "door"!'
          flip={false}
          onZoom={() => setLb(1)}
        >
          <p>
            Closing off the upper-deck opening to trap as much heat as I
            could — cap on, and let it run for hours. It was also raining.
          </p>
        </StorySpread>


        <StorySpread
          src={pics[5]!}
          alt={ALT}
          caption="Inside the chamber — the cooking stone over a bright firebox. Pizza stone is on top of the factory made terracota sone."
          flip={true}
          onZoom={() => setLb(5)}
        >
          <p>
            The rain (and also some test splashes) boiled away to steam almost instantly! Proof that the door is really working, look at the streaks!
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

        <h2>The learnings</h2>
        <p>
          It went OK. It definitely got hot — but not <em>really</em> hot. Still, the pizza wasn't
          watery like other times (simple toppings help a lot), the crust had a nice texture and was
          only mildly dark on the bottom, and — the big win — it actually cooked, in a reasonable
          amount of time, without me fussing with the fire the whole time.
        </p>

        <PotentialImprovements>
          <p>Things went so much better this time...i'm not sure what to think.</p>
        </PotentialImprovements>

        <h3 class="contact-head">More from the firing</h3>
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
}
