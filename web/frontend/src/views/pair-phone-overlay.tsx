import { useEffect, useState } from "preact/hooks";
import QRCode from "qrcode";
import { mintPairingToken } from "../api";

interface PairPhoneOverlayProps {
  onClose: () => void;
}

/**
 * Overlay shown from the authed dashboard. Mints a one-shot pairing token
 * and renders a QR for a phone to scan.
 *
 * The QR host is the server's detected LAN IP, NOT window.location.host:
 * the kiosk browser is usually opened at `localhost`, and a QR pointing a
 * phone at `localhost` would send it to its own loopback. The port and
 * protocol still come from window.location (correct as-is in dev).
 */
export function PairPhoneOverlay({ onClose }: PairPhoneOverlayProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    mintPairingToken()
      .then(({ token, lan_ip }) => {
        const port = window.location.port ? `:${window.location.port}` : "";
        const url = `${window.location.protocol}//${lan_ip}${port}/?t=${encodeURIComponent(token)}`;
        return QRCode.toDataURL(url, { width: 320, margin: 2 });
      })
      .then((png) => {
        if (!cancelled) setDataUrl(png);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div class="overlay" onClick={onClose}>
      <div class="overlay__card" onClick={(e) => e.stopPropagation()}>
        <h2 class="overlay__title">Pair a phone</h2>
        <p class="overlay__hint">Scan with your phone's camera</p>
        {dataUrl !== null && <img class="overlay__qr" src={dataUrl} alt="pairing QR code" />}
        {dataUrl === null && err === null && <p class="overlay__hint">minting…</p>}
        {err !== null && <p class="overlay__err">error: {err}</p>}
        <button type="button" class="overlay__close" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
