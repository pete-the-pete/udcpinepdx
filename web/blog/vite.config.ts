import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";

// Served at the root of the custom domain (upperdeckchimineapizzainnortheastportland.com)
// via GitHub Pages, so the base is "/". (For a project site without a custom
// domain it would need to be "/<repo>/".)
const BASE = "/";

export default defineConfig({
  base: BASE,
  plugins: [preact()],
  resolve: {
    alias: {
      // Reuse the kiosk's real Chuck (and temp helpers) as source, so the
      // blog's chef can never drift from the dashboard's. Vite processes the
      // aliased .tsx + its import.meta.glob sprite loader as first-party code.
      "@frontend": fileURLToPath(new URL("../frontend/src", import.meta.url)),
    },
    // One Preact instance across the blog and the aliased frontend source.
    dedupe: ["preact"],
  },
});
