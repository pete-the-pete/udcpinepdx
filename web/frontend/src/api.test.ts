import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  BOOTSTRAP_TOKEN_KEY,
  clearStashedToken,
  exchangeToken,
  getStashedToken,
} from "./api";

describe("exchangeToken sessionStorage stash", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    window.sessionStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.sessionStorage.clear();
  });

  test("200 response stashes the token under the expected key", async () => {
    globalThis.fetch = mock(
      async () => new Response('{"ok":true}', { status: 200 }),
    ) as unknown as typeof fetch;
    const ok = await exchangeToken("abc");
    expect(ok).toBe(true);
    expect(window.sessionStorage.getItem(BOOTSTRAP_TOKEN_KEY)).toBe("abc");
    expect(getStashedToken()).toBe("abc");
  });

  test("401 response leaves sessionStorage untouched", async () => {
    globalThis.fetch = mock(
      async () => new Response('{"error":"invalid token"}', { status: 401 }),
    ) as unknown as typeof fetch;
    const ok = await exchangeToken("bad");
    expect(ok).toBe(false);
    expect(window.sessionStorage.getItem(BOOTSTRAP_TOKEN_KEY)).toBeNull();
  });

  test("clearStashedToken removes the value", () => {
    window.sessionStorage.setItem(BOOTSTRAP_TOKEN_KEY, "xyz");
    clearStashedToken();
    expect(getStashedToken()).toBeNull();
  });
});
