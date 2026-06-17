import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { App } from "./app";
import { BOOTSTRAP_TOKEN_KEY, UnauthorizedError } from "./api";

/**
 * EventSource needs to be defined for the Live boot path; the actual
 * stream behaviour is exercised in use-live-state.test.ts.
 */
class NoopEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  readyState = 0;
  constructor(public url: string) {}
  close() {}
}

describe("App boot flow", () => {
  let originalES: typeof EventSource;

  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/");
    originalES = globalThis.EventSource;
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      NoopEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      originalES;
  });

  test(
    "no ?t=, stashed token, fetchState 401-then-200 → boots to Live with one exchange",
    async () => {
      window.sessionStorage.setItem(BOOTSTRAP_TOKEN_KEY, "abc");

      // Track fetch calls: first /api/state → 401; exchange("abc") → 200;
      // second /api/state → 200 with idle LiveState.
      let stateCalls = 0;
      let exchangeCalls = 0;
      let exchangeToken: string | null = null;

      const liveStateBody = JSON.stringify({
        firing: null,
        latest_sample: null,
        active_pizza: null,
        cooking_started_at: null,
      });

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/state") {
          stateCalls++;
          if (stateCalls === 1) {
            return new Response('{"error":"unauthorized"}', { status: 401 });
          }
          return new Response(liveStateBody, { status: 200 });
        }
        if (url === "/api/auth/exchange") {
          exchangeCalls++;
          const body = JSON.parse((init?.body as string) ?? "{}");
          exchangeToken = body.token;
          return new Response('{"ok":true}', { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      render(<App />);

      // Idle screen shows the START FIRING button (per IdleScreen).
      await waitFor(
        () => {
          expect(screen.getByRole("button", { name: /start firing/i })).toBeDefined();
        },
        { timeout: 2000 },
      );

      expect(exchangeCalls).toBe(1);
      expect(exchangeToken).toBe("abc");
      // Sanity: the UnauthorizedError class still imports (no dead-code warning).
      expect(new UnauthorizedError().name).toBe("UnauthorizedError");
    },
  );

  test(
    "non-401 network error on fetchState → renders reconnecting overlay (not error screen)",
    async () => {
      // fetchState throws a plain network error (e.g. backend unreachable).
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/state") {
          throw new Error("Failed to fetch");
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      render(<App />);

      await waitFor(
        () => {
          expect(screen.getByText(/Reconnecting to oven/i)).toBeDefined();
        },
        { timeout: 2000 },
      );

      // Must NOT render the "error: ..." dead-end screen.
      expect(screen.queryByText(/^error:/)).toBeNull();
    },
  );

  test(
    "URL token === stashed token → exchangeToken called exactly once (short-circuit on 401 retry)",
    async () => {
      // Both URL and sessionStorage carry the same token "abc".
      // The app exchanges on the URL pass; when fetchState 401s, the stashed ===
      // urlToken check must short-circuit so we don't exchange a second time.
      window.sessionStorage.setItem(BOOTSTRAP_TOKEN_KEY, "abc");
      window.history.replaceState({}, "", "/?t=abc");

      const liveStateBody = JSON.stringify({
        firing: null,
        latest_sample: null,
        active_pizza: null,
        cooking_started_at: null,
      });

      let exchangeCallCount = 0;
      let stateCalls = 0;

      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/state") {
          stateCalls++;
          if (stateCalls === 1) {
            return new Response('{"error":"unauthorized"}', { status: 401 });
          }
          return new Response(liveStateBody, { status: 200 });
        }
        if (url === "/api/auth/exchange") {
          exchangeCallCount++;
          return new Response('{"ok":true}', { status: 200 });
        }
        throw new Error(`unexpected fetch: ${url}`);
      }) as unknown as typeof fetch;

      render(<App />);

      // After the 401 the short-circuit must fire PairScreen (stashed === urlToken),
      // so we get the pair screen — NOT a second exchange call.
      await waitFor(
        () => {
          expect(screen.getByText(/pair/i)).toBeDefined();
        },
        { timeout: 2000 },
      );

      // exchangeToken must have been called exactly once (the URL pass only).
      expect(exchangeCallCount).toBe(1);
    },
  );
});
