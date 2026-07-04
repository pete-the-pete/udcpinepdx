# Plan: Public maker blog — "Firing № 1: Chuck & the Data"

Tracking issue: #70

## Context

The kiosk is in a good spot and we just had our first successful firing
(3h05m, 8,547 thermocouple samples, 7 named pizzas across 14 logged slots).
We want to start sharing the project as a **public maker blog** — friends +
internet, "look what I built," communal and learning-in-public. People come
over, we make pizzas, and we've been figuring it out together. It must be
hostable from **GitHub Pages** (static, no backend).

It's a multi-entry blog. **Entry #1 emphasizes Chuck** (the animated chef
mascot) **and the data** from firing #1, with two interactive pieces:

1. A **free Chuck demo** — drag a temperature slider, push Chuck through all 5
   states (frozen → thawing → active → hot → very_hot, incl. transcendence).
2. An **interactive firing chart** — the real curve with pizza markers, hover
   tooltips, and a **scrubber that drives Chuck** off the actual reading at
   that moment in the timeline.

The real data is honest and messy, and we **show both raw and cleaned**: a
1023.75 °C reading that is an open-thermocouple fault, and 14 "pizza" slots
where several are gaps (`Null`) or session notes ("Bricks removed below
stone", "Overdue null"). Surfacing the mess *is* the maker story.

## Decisions

- **Build/deploy:** new **`web/blog`** Bun-workspace package (Vite + Preact),
  deployed to GitHub Pages via a new Actions workflow.
- **Chart:** **hand-rolled SVG** in Preact (no chart dependency).
- **Data source:** **export script reading the backend SQLite** (verified
  populated: firing 1, 8,547 samples, 14 pizzas in `web/backend/udcpine.db`).
- **Editorial:** **raw + cleaned** via a toggle shared by the chart and the
  results list.
- **Design direction:** **Warm Editorial** — refined food-magazine: cream
  paper, espresso ink, one terracotta accent, Fraunces display + Newsreader
  body + Spline Sans Mono for data. Chosen from 5 interactive mockups.

## Reuse (do NOT reimplement)

| Need | Reuse | Path |
|---|---|---|
| Chuck rendering + state machine | `ChefStage`, `selectState`, `manifest`, sprites, `chef.css` | `web/frontend/src/chef/*`, `web/frontend/src/assets/chef/*` |
| Temp °C→°F | `celsiusToFahrenheit` | `web/frontend/src/temp.ts` |
| Wire types | `Sample` | `@udcpine/shared` |
| DB read | `Store.samples()` / `Store.pizzas()` (validated Pydantic models) | `web/backend/src/udcpine_backend/store.py` |

The blog reuses the kiosk's Chuck via a Vite **resolve alias** (`@frontend` →
`../frontend/src`), processed as first-party source — so the blog's chef and
the dashboard's chef are the same code and can't drift. `resolve.dedupe:
["preact"]` keeps one Preact instance; `tsconfig` adds `"types":
["vite/client"]` so the chef's `import.meta.glob` sprite loader typechecks.

## What was built

- **Data pipeline:** `web/backend/scripts/export_firing.py` (uv, stdlib only)
  reads a firing through `Store`, LTTB-downsamples to ~600 points (preserving
  peaks), re-injects the single fault sample flagged `fault: true`, classifies
  each slot `pizza | gap | note`, and writes `web/blog/data/firing-1.json`. The
  editorial layer (`web/blog/data/firing-1.curation.json`, hand-authored:
  title, dek, `note_seqs`, fault caption, pizza blurbs) is read by the script
  for classification and by the blog for copy. Re-runnable per firing via
  `make web-blog-data [FIRING=n]`.
- **Package:** `web/blog` (Vite + Preact). `base: "/udcpinepdx/"` for the
  Pages project path; **hash routing** (`#/firing-1`) so Pages needs no SPA
  rewrite; a post registry (`src/posts/index.ts`) drives the index + routing so
  new entries are one record + one page.
- **Pages/components:** `pages/Home`, `pages/FiringOne`; `ChuckDemo` (slider →
  `ChefStage`), `FiringChart` (SVG curve + markers + tooltip + scrubber →
  `ChefStage`), `PizzaResults` + `ModeToggle` (raw/clean), `SiteChrome`.
  Warm Editorial tokens in `src/styles/theme.css`, layout/chart in `blog.css`.
- **Deploy:** `.github/workflows/pages.yml` builds `web/blog` and publishes via
  `upload-pages-artifact` + `deploy-pages` (paths-filtered to the blog, the
  reused chef source, and shared). `Makefile` gains `web-blog-build/lint/dev/
  data`; `web-blog-lint` is wired into `make lint` (and thus CI).

## Notes / deviations from the original sketch

- Export script lives in **`web/backend/scripts/`** (not `web/blog/scripts/`)
  because it needs the backend's uv env to import `Store` + the Pydantic
  models; output still lands in `web/blog/data/`.
- Fonts load from **Google Fonts** (matching the existing frontend's
  `index.html`), not self-hosted — simplest for v1; revisit if we want zero
  runtime fetch.

## One-time setup (needs Pete / repo admin)

GitHub repo **Settings → Pages → Source = "GitHub Actions."** The workflow
can't enable Pages itself. Site URL will be
`https://pete-the-pete.github.io/udcpinepdx/`.

## Verification

- `make web-blog-data` regenerates the JSON deterministically (601 pts, 7
  pizzas, clean peak 472 °C / 882 °F, raw peak 1023.75 °C).
- `cd web/blog && bun run lint` (tsc) and `bun run build` both pass; all 5
  sprites bundle (proving the chef alias reuse) — ~45 kB JS.
- Built `dist` served under `/udcpinepdx/` resolves assets + JS; hash routes
  work. Rendered page verified via headless Chrome: hero, animating Chuck,
  slider, stats, the curve with pizza bands + scrubber + chart-side chef, and
  the results list all render in the Warm Editorial direction.
- Remaining human check: click through the slider, scrubber, and Raw/Cleaned
  toggle live (`make web-blog-dev`).

## Out of scope (v1)

Static only (no runtime backend); Preact pages (no markdown CMS yet); no
comments/analytics/custom domain.
