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

export function FiringOne() {
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
          And since we have a computer...we may as well have a silly personification to indicate the temperature.
        </p>


        <div class="stats">
          <div class="stat">
            <b>{minutes} min</b>
            <span>burn time</span>
          </div>
          <div class="stat">
            <b>{peakF}°F</b>
            <span>peak air temp</span>
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
        <p class="standfirst">
          A thermocouple sampled the air inside the chiminea once a second for three hours straight. Drag across the
          curve to re-live the firing — Chuck reacts to the reading and existsin different states depending on the temp.
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

        <h2>What we baked</h2>
        <p class="standfirst">
          {mode === "raw"
            ? "The full session: seven named pies, plus the gaps and notes from tending the fire."
            : "Seven named pies. Flip the toggle above to “Raw” to see the whole messy night."}
        </p>
        <PizzaResults firing={f} curation={firing1Curation} mode={mode} />

        <PotentialImprovements>
          This was by far the best effort, but there is always room for improvement.
          <ul>
            <li>coming soon...</li>
          </ul>
        </PotentialImprovements>
      </article>

      <SiteFooter />
    </div>
  );
}
