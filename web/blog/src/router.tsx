/**
 * Tiny hash router. GitHub Pages has no SPA rewrite, so hash routes
 * (`#/firing-1`) work with zero server config. Routes resolve from the post
 * registry, so new entries need no router changes.
 */
import { useEffect, useState } from "preact/hooks";
import { Home } from "./pages/Home";
import { postBySlug } from "./posts";

function currentSlug(): string {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return hash.trim();
}

export function Router() {
  const [slug, setSlug] = useState(currentSlug());
  useEffect(() => {
    const onChange = () => {
      setSlug(currentSlug());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  if (slug === "") return <Home />;
  const post = postBySlug(slug);
  if (post) {
    const Page = post.Component;
    return <Page />;
  }
  return <Home />;
}
