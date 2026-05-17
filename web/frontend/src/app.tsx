import { useEffect, useState } from "preact/hooks";
import type { LiveState } from "@udcpine/shared";
import { exchangeToken, fetchState, UnauthorizedError } from "./api";
import { useLiveState } from "./use-live-state";
import { HeroNumber } from "./views/hero-number";
import { IdleScreen } from "./views/idle-screen";
import { PairScreen } from "./views/pair-screen";

type Boot =
  | { kind: "loading" }
  | { kind: "ok"; initial: LiveState }
  | { kind: "unpaired" }
  | { kind: "error"; message: string };

/** Read a ?t= pairing token from the URL, then strip it from history. */
function takeUrlToken(): string | null {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("t");
  if (token !== null) {
    window.history.replaceState({}, "", window.location.pathname);
  }
  return token;
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // If we arrived via a QR / bootstrap link, exchange the token first.
      const token = takeUrlToken();
      if (token !== null) await exchangeToken(token);
      try {
        const initial = await fetchState();
        if (!cancelled) setBoot({ kind: "ok", initial });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) setBoot({ kind: "unpaired" });
        else setBoot({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  if (boot.kind === "loading") return <main class="hero"><div class="hero__delta">loading…</div></main>;
  if (boot.kind === "unpaired") return <PairScreen />;
  if (boot.kind === "error") return <main class="hero"><div class="hero__delta">error: {boot.message}</div></main>;

  return <Live initial={boot.initial} onAction={() => setNonce((n) => n + 1)} />;
}

function Live({ initial, onAction }: { initial: LiveState; onAction: () => void }) {
  const state = useLiveState(initial);
  if (state.firing === null) return <IdleScreen onStarted={onAction} />;
  return <HeroNumber state={{ ...state, firing: state.firing }} onEnded={onAction} />;
}
