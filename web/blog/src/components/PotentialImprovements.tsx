/**
 * The recurring closing section every firing writeup ends on: what to try next
 * time. Standard heading so it reads the same across entries; pass the notes as
 * children, or leave empty for a "to come" placeholder while a post is a stub.
 */
import type { ComponentChildren } from "preact";

export function PotentialImprovements({ children }: { children?: ComponentChildren }) {
  return (
    <section class="improvements">
      <h2>Potential Improvements</h2>
      {children ?? <p class="improvements__todo">Notes to come.</p>}
    </section>
  );
}
