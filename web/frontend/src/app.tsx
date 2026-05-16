import { useEffect, useState } from "preact/hooks";
import type { LiveState } from "@udcpine/shared";
import { fetchState } from "./api";
import { useLiveState } from "./use-live-state";
import { HeroNumber } from "./views/hero-number";
import { IdleScreen } from "./views/idle-screen";

type Boot =
  | { kind: "loading" }
  | { kind: "ok"; initial: LiveState }
  | { kind: "error"; message: string };

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });

  // Tick this to force a re-fetch + re-mount of the live hook. Used after
  // start/stop to re-prime state cleanly, in case any SSE events were
  // dropped between the POST returning and the next SSE message landing.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchState()
      .then((initial) => {
        if (!cancelled) setBoot({ kind: "ok", initial });
      })
      .catch((err: unknown) => {
        if (!cancelled) setBoot({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (boot.kind === "loading") return <main class="hero"><div class="hero__delta">loading…</div></main>;
  if (boot.kind === "error") return <main class="hero"><div class="hero__delta">error: {boot.message}</div></main>;

  return <Live initial={boot.initial} onAction={() => setNonce((n) => n + 1)} />;
}

function Live({
  initial,
  onAction,
}: {
  initial: LiveState;
  onAction: () => void;
}) {
  const state = useLiveState(initial);
  if (state.firing === null) return <IdleScreen onStarted={onAction} />;
  return <HeroNumber state={{ ...state, firing: state.firing }} onEnded={onAction} />;
}
