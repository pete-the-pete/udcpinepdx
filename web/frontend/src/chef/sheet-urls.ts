/**
 * Vite sprite-sheet glob. Lives in its own module so tests can mock it
 * without needing `import.meta.glob` support in Bun.
 */
export const sheetUrls = import.meta.glob("../assets/chef/chef_*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
