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

/**
 * Image URLs for an entry, in filename (chronological) order. Pass
 * `exclude` to drop specific source filenames (e.g. ["01.jpg"]) — matched by
 * basename, so it's robust even if the gallery is regenerated.
 */
export function galleryFor(entry: string, opts?: { exclude?: string[] }): string[] {
  const prefix = `./galleries/${entry}/`;
  const exclude = new Set(opts?.exclude ?? []);
  return Object.entries(modules)
    .filter(([path]) => path.startsWith(prefix))
    .filter(([path]) => !exclude.has(path.slice(prefix.length)))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, url]) => url);
}
