/** Blog index: project intro + the list of firings (driven by the registry). */
import { SiteFooter, SiteHeader } from "../components/SiteChrome";
import { posts } from "../posts";

export function Home() {
  return (
    <div class="wrap">
      <SiteHeader />

      <section class="home-hero">
        <div class="eyebrow">A wood-fired pizza diary</div>
        <h1>udcpinepdx</h1>
        <p class="home-lede">
          We’re building a custom, instrumented wood-fired pizza oven — and learning electronics,
          fire, and dough as we go. Friends come over, we make pizzas, and a little thermocouple
          chef named Chuck reads the heat. Here’s every firing, warts and all.
        </p>
      </section>

      <section class="post-list">
        {[...posts]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((p) => (
          <a class="post-card" href={`#/${p.slug}`} key={p.slug}>
            <div class="post-card__date">{formatDate(p.date)}</div>
            <h2 class="post-card__title">{p.title}</h2>
            <p class="post-card__dek">{p.dek}</p>
            <span class="post-card__more">Read the entry →</span>
          </a>
        ))}
      </section>

      <SiteFooter />
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
