import { useEffect, useState } from "preact/hooks";
import type { LiveState } from "@udcpine/shared";
import { fetchState } from "./api";
import { HeroNumber } from "./views/hero-number";

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; state: LiveState }
  | { kind: "error"; message: string };

export function App() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((state) => {
        if (!cancelled) setLoad({ kind: "ok", state });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (load.kind === "loading") return <main class="hero"><div class="hero__delta">loading…</div></main>;
  if (load.kind === "error") return <main class="hero"><div class="hero__delta">error: {load.message}</div></main>;
  return <HeroNumber state={load.state} />;
}
