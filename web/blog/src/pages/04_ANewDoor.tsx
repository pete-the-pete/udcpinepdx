/** Entry #1 — "Firing № 1: Chuck & the Data." */
import { useState } from "preact/hooks";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { ChuckDemo } from "../components/ChuckDemo";
import { FiringChart } from "../components/FiringChart";
import { ModeToggle, PizzaResults } from "../components/PizzaResults";
import { PotentialImprovements } from "../components/PotentialImprovements";
import { celsiusToFahrenheit } from "@frontend/temp";
import { firing1Curation, firing1Data } from "../data";
import { galleryFor } from "../galleries";
import { Hero } from "../components/Hero";
import { PhotoLightbox } from "../components/PhotoLightbox";

const ALT = "A door!";

export function ANewDoor() {
  const [mode, setMode] = useState<"clean" | "raw">("clean");
  const f = firing1Data;
  const pies = f.pizzas.filter((p) => p.kind === "pizza").length;
  const pics = galleryFor("a-new-door");
  const [lb, setLb] = useState<number | null>(null);
  const peakF = Math.round(celsiusToFahrenheit(f.clean_max_c));
  const minutes = Math.round(f.duration_s / 60);

  return (
    <div class="wrap">
      <SiteHeader />

      <article class="post">
        <header class="post-hero">
          <div class="eyebrow">Chuck's Law</div>
          <h1>{firing1Curation.title}</h1>
          <div class="byline">closer and closer to the sun</div>
        </header>

        <Hero
          src={pics[2]!}
          alt={'ceramic fireboard ftw'}
          caption=''
          onZoom={() => setLb(2)}
        />
        <p class="dropcap">
          After <em>years</em> of brainstorming, we finally have a door. Multiple layers of ceramic fiberboard and high temp spray paint.
          Since we have a door, we may as well have a computer and thermo-coupler sample the temperature.
          And since we have a computer...we may as well have a silly animation to indicate the temperature.
        </p>

        <div class="stats">
          <div class="stat">
            <b>{minutes} min</b>
            <span>burn time</span>
          </div>
          <div class="stat">
            <b>{peakF}°F</b>
            <span>peak temp</span>
          </div>
          <div class="stat">
            <b>{pies}</b>
            <span>pizzas</span>
          </div>
          <div class="stat">
            <b>{f.sample_count.toLocaleString()}</b>
            <span>readings</span>
          </div>
        </div>

        <h2>Chuck</h2>
        <p>
          A raspberry pi, dedicated screen, and a thermocouple gave temperature samples inside the chiminea at at 1Hz. 
          The a session starts when we light the fire, chuck gets up to temperature and then we track pizzas.
          A phone is connected via qr-code and sso for easier interaction.
          Drag across the curve to re-live the firing — Chuck reacts to the reading and shows different states depending on the temp.
        </p>

        <figure>
          <ChuckDemo />
          <figcaption>
            Chuck has five moods, mapped to the oven air temperature with a 4° dead-band so he never
            flickers. Drag him from frozen all the way to transcendence.
          </figcaption>
        </figure>

        <figure class="bleed">
          <div class="chart-toolbar">
            <span class="chart-toolbar__hint">Scrub the curve · hover for detail</span>
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
          <FiringChart firing={f} mode={mode} />
          <figcaption>
            {mode === "raw" ? firing1Curation.fault_caption : "Switch to “Raw” for the unedited trace — including a one-sample sensor glitch and the gaps between pies."}
          </figcaption>
        </figure>

        <h2>The Pizzas</h2>
        <p class="standfirst">
          {mode === "raw"
            ? "The full session: seven named pies, plus the gaps and notes from tending the fire."
            : "Seven named pies. Flip the toggle above to “Raw” to see the whole messy night."}
        </p>
        <PizzaResults firing={f} curation={firing1Curation} mode={mode} />

        <h2>The learnings</h2>
        <p>
          With the door in place, the chiminea was actually hot, which meant previous solutions were no longer valid and adjustments needed to be made.
          <ul>
            <li>protecting the device - the rapsberry pi got over heated in the sun and shutdown, it also got overheated from the bottom...and shutdown. We solved the first issue with an umbrella attached to a ladder, and the second issue with a small piece of wood below the device.</li>
            <li>lowering the pizza - bricks had been in place to lift the pizza higher to get more heat on top, and distance between the flames. Now the pizza was cooking too fast for the crust to get properly done, so they had to be removed</li>
            <li>burn larger logs - kindling is used to get the chiminea up to temperature "slowly" so the terracota doesn't crack. Once hot, we can use larger pieces of wood which burn longer and produce a more event heat. Now that its possible to actually know the temperature we can make the transition sooner and reduce temperature swings and finger burns</li>
          </ul>
        </p>

        <PotentialImprovements>
          This was by far the best effort, but to keep up with Chuck's law (100% improvement each time), there are improvements to be made
          <ul>
            <li>alarm(s) on the app to rotate and check the pizza during cooking</li>
            <li>an automatic "between pizzas" mode</li>
            <li>allowing multiple phones to connect to the app</li>
            <li>shielding on the door to protect the paint and material from extreme heat</li>
          </ul>
        </PotentialImprovements>
      </article>

      <SiteFooter />
      <PhotoLightbox images={pics} index={lb} alt={ALT} onClose={() => setLb(null)} onIndex={setLb} />
    </div>
  );
}
