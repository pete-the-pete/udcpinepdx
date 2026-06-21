import { useEffect, useState } from "preact/hooks";
import type { LiveState } from "@udcpine/shared";
import {
  exchangeToken,
  fetchState,
  getStashedToken,
  UnauthorizedError,
} from "./api";
import { useLiveState } from "./use-live-state";
import { HeroNumber } from "./views/hero-number";
import { IdleScreen } from "./views/idle-screen";
import { PairScreen } from "./views/pair-screen";
import { ReconnectingOverlay } from "./views/reconnecting-overlay";
import { WarmingUpScreen } from "./views/warming-up-screen";

type Boot =
  | { kind: "loading" }
  | { kind: "ok"; initial: LiveState }
  | { kind: "unpaired" }
  | { kind: "reconnecting" }
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
  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Token precedence:
      //   1. ?t= in the URL — fresh QR / bootstrap link, always wins.
      //   2. sessionStorage — survives a window.location.reload() after
      //      the laptop restarts. See "Reload-survives-restart" in the plan.
      //      This is the kiosk-survival path: without it, a backend restart
      //      strips the URL token (already consumed by takeUrlToken) and
      //      leaves the kiosk stuck on <PairScreen/> until manual intervention.
      //
      // After fetchState(), a 401 means the cookie is invalid (backend
      // restarted, AuthStore wiped). If we have a stashed token, retry
      // the exchange ONCE and re-fetch; if that still 401s, the token
      // itself is stale and we fall through to <PairScreen/>.
      const urlToken = takeUrlToken();
      const stashed = getStashedToken();
      // If we got a URL token, exchange it eagerly — that's a fresh QR
      // and the user expects to be paired before fetchState fires.
      // Otherwise, fetchState first and only burn the stashed token on a
      // 401 (the common reload-after-backend-restart path).
      if (urlToken !== null) {
        await exchangeToken(urlToken);
      }
      try {
        const initial = await fetchState();
        if (!cancelled) setBoot({ kind: "ok", initial });
        return;
      } catch (err) {
        if (cancelled) return;
        if (!(err instanceof UnauthorizedError)) {
          // Network error (e.g. backend unreachable after a laptop restart).
          // This IS recoverable — hand off to the reconnecting overlay, which
          // uses its backoff-driven reload to keep retrying.
          setBoot({ kind: "reconnecting" });
          return;
        }
        // 401. Try the stashed token once if we have one and haven't
        // already used it (urlToken === stashed means we just tried it).
        if (stashed !== null && stashed !== urlToken) {
          try {
            await exchangeToken(stashed);
            const initial = await fetchState();
            if (!cancelled) setBoot({ kind: "ok", initial });
            return;
          } catch (retryErr) {
            if (cancelled) return;
            if (!(retryErr instanceof UnauthorizedError)) {
              // Network error on the retry path — same recovery via overlay.
              setBoot({ kind: "reconnecting" });
              return;
            }
            // fall through
          }
        }
        setBoot({ kind: "unpaired" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refetchKey]);

  if (boot.kind === "loading") return <main class="hero"><div class="hero__delta">loading…</div></main>;
  if (boot.kind === "unpaired") return <PairScreen />;
  if (boot.kind === "reconnecting") return <ReconnectingOverlay />;
  if (boot.kind === "error") return <main class="hero"><div class="hero__delta">error: {boot.message}</div></main>;

  return <Live initial={boot.initial} onAction={() => setRefetchKey((n) => n + 1)} />;
}

function Live({ initial, onAction }: { initial: LiveState; onAction: () => void }) {
  const { state, connectionState } = useLiveState(initial);
  const overlay = connectionState === "reconnecting" ? <ReconnectingOverlay /> : null;
  if (state.firing === null) {
    return (
      <>
        <IdleScreen onStarted={onAction} latestSample={state.latest_sample} />
        {overlay}
      </>
    );
  }
  if (state.cooking_started_at === null) {
    return (
      <>
        <WarmingUpScreen firing={state.firing} latestSample={state.latest_sample} onAction={onAction} />
        {overlay}
      </>
    );
  }
  return (
    <>
      <HeroNumber state={{ ...state, firing: state.firing }} onEnded={onAction} />
      {overlay}
    </>
  );
}
