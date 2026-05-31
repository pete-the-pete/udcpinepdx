import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderHook, act } from "@testing-library/preact";
import type { LiveState } from "@udcpine/shared";
import { useLiveState } from "./use-live-state";

/**
 * Minimal hand-rolled EventSource shim. The hook constructs `new
 * EventSource(...)` so we install our fake on globalThis and grab the
 * single live instance via a side channel. We control onerror/onmessage
 * deliveries by hand, so no real network or browser timing involved.
 */
class FakeEventSource {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSED = 2 as const;
  static instances: FakeEventSource[] = [];

  readyState: 0 | 1 | 2 = FakeEventSource.CONNECTING;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onopen: ((e: Event) => void) | null = null;
  closed = false;

  CONNECTING = FakeEventSource.CONNECTING;
  OPEN = FakeEventSource.OPEN;
  CLOSED = FakeEventSource.CLOSED;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  // Test helpers
  fireError(readyState: 0 | 1 | 2) {
    this.readyState = readyState;
    this.onerror?.(new Event("error"));
  }
  fireMessage(data: unknown) {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }
}

const INITIAL: LiveState = {
  firing: null,
  latest_sample: null,
  active_pizza: null,
};

let originalES: typeof EventSource;
let originalSetTimeout: typeof setTimeout;
let originalClearTimeout: typeof clearTimeout;

// A tiny fake-timers implementation. bun:test doesn't yet ship vitest-style
// vi.useFakeTimers; this is the smallest surface that satisfies the hook
// (setTimeout/clearTimeout). We hijack the globals only for the test that
// needs them and restore them in afterEach.
type Scheduled = { id: number; due: number; fn: () => void };

class FakeClock {
  now = 0;
  next = 1;
  scheduled: Scheduled[] = [];

  install() {
    originalSetTimeout = globalThis.setTimeout;
    originalClearTimeout = globalThis.clearTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      const id = this.next++;
      this.scheduled.push({ id, due: this.now + (ms ?? 0), fn });
      return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id?: number) => {
      this.scheduled = this.scheduled.filter((s) => s.id !== id);
    }) as unknown as typeof clearTimeout;
  }

  restore() {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }

  advance(ms: number) {
    this.now += ms;
    // Run anything due. Be defensive about ordering and re-entrancy.
    while (true) {
      const due = this.scheduled
        .filter((s) => s.due <= this.now)
        .sort((a, b) => a.due - b.due);
      if (due.length === 0) break;
      const next = due[0]!;
      this.scheduled = this.scheduled.filter((s) => s.id !== next.id);
      next.fn();
    }
  }
}

describe("useLiveState connectionState", () => {
  let clock: FakeClock;

  beforeEach(() => {
    originalES = globalThis.EventSource;
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      FakeEventSource as unknown as typeof EventSource;
    FakeEventSource.instances = [];
    clock = new FakeClock();
    clock.install();
  });

  afterEach(() => {
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      originalES;
    clock.restore();
  });

  test("CONNECTING error stays 'connected' until 3s threshold", async () => {
    const { result } = renderHook(() => useLiveState(INITIAL));
    expect(result.current.connectionState).toBe("connected");
    const es = FakeEventSource.instances[0]!;

    await act(async () => {
      es.fireError(FakeEventSource.CONNECTING);
    });
    await act(async () => {
      clock.advance(2900);
    });
    expect(result.current.connectionState).toBe("connected");

    await act(async () => {
      clock.advance(200); // total 3100ms
    });
    expect(result.current.connectionState).toBe("reconnecting");

    await act(async () => {
      es.fireMessage({ type: "sample", t: "2026-04-28T19:46:48-07:00", temp_c: 100 }); // any onmessage cancels + heals
    });
    expect(result.current.connectionState).toBe("connected");
  });

  test("CLOSED error flips to 'reconnecting' immediately (no 3s wait)", async () => {
    const { result } = renderHook(() => useLiveState(INITIAL));
    const es = FakeEventSource.instances[0]!;

    await act(async () => {
      es.fireError(FakeEventSource.CLOSED);
    });
    expect(result.current.connectionState).toBe("reconnecting");
  });

  test("onmessage during pending debounce cancels the flip", async () => {
    const { result } = renderHook(() => useLiveState(INITIAL));
    const es = FakeEventSource.instances[0]!;

    await act(async () => {
      es.fireError(FakeEventSource.CONNECTING);
    });
    await act(async () => {
      clock.advance(1500);
    });
    expect(result.current.connectionState).toBe("connected");

    await act(async () => {
      es.fireMessage({ type: "sample", t: "2026-04-28T19:46:48-07:00", temp_c: 100 });
    });
    // Advancing past the original 3s threshold should NOT flip now —
    // the debounce timer was cancelled by onmessage.
    await act(async () => {
      clock.advance(5000);
    });
    expect(result.current.connectionState).toBe("connected");
  });
});
