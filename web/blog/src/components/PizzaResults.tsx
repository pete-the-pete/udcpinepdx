/**
 * The bake log. In "clean" mode it shows the named pizzas; in "raw" it shows
 * the full session — gaps and oven-tending notes included — so the messy real
 * story is one toggle away.
 */
import type { Curation, Firing } from "../data";

export function PizzaResults({
  firing,
  curation,
  mode,
}: {
  firing: Firing;
  curation: Curation;
  mode: "clean" | "raw";
}) {
  const slots = mode === "raw" ? firing.pizzas : firing.pizzas.filter((p) => p.kind === "pizza");

  return (
    <div class="results">
      {slots.map((p) => {
        const blurb = curation.pizza_blurbs[String(p.seq)];
        return (
          <div class={`pcard pcard--${p.kind}`} key={p.seq}>
            <span class="pcard__seq">{String(p.seq).padStart(2, "0")}</span>
            <span class="pcard__body">
              <span class="pcard__name">
                {p.kind === "gap" ? "tending the fire" : p.name}
              </span>
              {p.kind === "pizza" && blurb ? <span class="pcard__blurb">{blurb}</span> : null}
            </span>
            <span class="pcard__cook">{p.cook_min != null ? `${p.cook_min} min` : "—"}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ModeToggle({
  mode,
  onChange,
}: {
  mode: "clean" | "raw";
  onChange: (m: "clean" | "raw") => void;
}) {
  return (
    <div class="seg" role="group" aria-label="Data view">
      <button class={mode === "clean" ? "is-active" : ""} onClick={() => onChange("clean")}>
        Cleaned
      </button>
      <button class={mode === "raw" ? "is-active" : ""} onClick={() => onChange("raw")}>
        Raw
      </button>
    </div>
  );
}
