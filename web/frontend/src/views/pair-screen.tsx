/**
 * Shown when the app has no valid session cookie. A genuinely unpaired
 * device cannot mint its own QR (minting is gated) — so this screen only
 * gives instructions. The real pairing paths are:
 *   - open the bootstrap link the server printed to its console, or
 *   - scan a QR shown by an already-paired device.
 */
export function PairScreen() {
  return (
    <main class="hero">
      <div class="hero__ember" aria-hidden="true" />
      <header class="hero__status">
        <span class="hero__id">OVEN · NOT PAIRED</span>
      </header>
      <section class="pair">
        <h1 class="pair__title">This device isn't paired</h1>
        <ol class="pair__steps">
          <li>On the oven's screen, open <b>Pair a phone</b> and scan the QR.</li>
          <li>First device ever? Open the link the server printed in its console.</li>
        </ol>
      </section>
    </main>
  );
}
