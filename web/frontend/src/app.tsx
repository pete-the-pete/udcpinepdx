import { useEffect, useState } from "preact/hooks";
import type { Firing } from "@udcpine/shared";
import { fetchState } from "./api";
import { HeroNumber } from "./views/hero-number";

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; firing: Firing }
  | { kind: "error"; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((firing) => {
        if (!cancelled) setState({ kind: "ok", firing });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === "loading") return <main class="hero"><div class="hero__delta">loading…</div></main>;
  if (state.kind === "error") return <main class="hero"><div class="hero__delta">error: {state.message}</div></main>;
  return <HeroNumber firing={state.firing} />;
}
