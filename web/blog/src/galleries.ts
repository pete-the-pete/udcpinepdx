/**
 * Optimized gallery images, grouped by entry folder. Vite globs the committed
 * JPEGs under src/galleries/<entry>/ (built from the raw dumps in
 * web/blog/assets/ by `make web-blog-galleries`) and hashes them for caching.
 */
const modules = import.meta.glob("./galleries/*/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Image URLs for an entry, in filename (chronological) order. */
export function galleryFor(entry: string): string[] {
  const prefix = `./galleries/${entry}/`;
  return Object.entries(modules)
    .filter(([path]) => path.startsWith(prefix))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, url]) => url);
}
