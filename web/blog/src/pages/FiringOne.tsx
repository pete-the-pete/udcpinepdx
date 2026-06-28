/** Entry #1 — "Firing № 1: Chuck & the Data." */
import { useState } from "preact/hooks";
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { ChuckDemo } from "../components/ChuckDemo";
import { FiringChart } from "../components/FiringChart";
import { ModeToggle, PizzaResults } from "../components/PizzaResults";
import { celsiusToFahrenheit } from "@frontend/temp";
import { firing1Curation, firing1Data } from "../data";

export function FiringOne() {
  const [mode, setMode] = useState<"clean" | "raw">("clean");
  const f = firing1Data;
  const pies = f.pizzas.filter((p) => p.kind === "pizza").length;
  const peakF = Math.round(celsiusToFahrenheit(f.clean_max_c));
  const minutes = Math.round(f.duration_s / 60);

  return (
    <div class="wrap">
      <SiteHeader />

      <article class="post">
        <header class="post-hero">
          <div class="eyebrow">Firing № 1</div>
          <h1>{firing1Curation.title}</h1>
          <div class="byline">by Pete &amp; friends</div>
        </header>

        <p class="dropcap">
          For months the chiminea oven was a project on a bench. Then one Saturday we lit it for
          real, gathered everyone around, and let a small animated chef named Chuck read the fire
          for us. Three hours and {pies} pizzas later, we had our first proper firing — and a
          temperature trace that tells the whole story.
        </p>

        <figure>
          <ChuckDemo />
          <figcaption>
            Chuck has five moods, mapped to the oven air temperature with a 4° dead-band so he never
            flickers. Drag him from frozen all the way to transcendence.
          </figcaption>
        </figure>

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

        <h2>Reading the fire</h2>
        <p class="standfirst">
          A thermocouple sampled the air inside the chiminea once a second for three hours straight. Drag across the
          curve to re-live the firing — Chuck reacts to the reading under the playhead.
        </p>

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
      </article>

      <SiteFooter />
    </div>
  );
}
