import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";

// Static blog deployed to GitHub Pages at /<repo>/. The base must match the
// project path so hashed asset URLs resolve.
const BASE = "/udcpinepdx/";

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
