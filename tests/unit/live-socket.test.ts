import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal stand-in for a socket.io client socket: handlers by event name, a `connected` flag, and
// subscribe acks that always succeed.
class FakeSocket {
  connected = false;
  active = true;
  handlers = new Map<string, ((...a: unknown[]) => unknown)[]>();
  on(ev: string, fn: (...a: unknown[]) => unknown) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]);
    return this;
  }
  async fire(ev: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(ev) ?? []) await fn(...args);
  }
  timeout() {
    return { emitWithAck: async () => ({ ok: true }) };
  }
  emit() {}
  connect() {
    this.connected = true;
    void this.fire("connect");
  }
  disconnect() {
    this.connected = false;
    void this.fire("disconnect", "io client disconnect");
  }
}

let fake: FakeSocket;
vi.mock("socket.io-client", () => ({ io: () => fake }));

beforeEach(() => {
  vi.resetModules();
  fake = new FakeSocket();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());

async function connected() {
  const live = await import("@/components/realtime/socket");
  const ready = vi.fn();
  live.onLiveReady(ready);
  await live.getLiveSocket();
  fake.connected = true;
  await fake.fire("connect");
  expect(ready).toHaveBeenCalledTimes(1);
  expect(live.getLiveSnapshot().state).toBe("connected");
  return { live, ready };
}

describe("live socket: offline → online", () => {
  it("refetches snapshots on `online` even when the socket stayed connected (events may have been lost)", async () => {
    const { live, ready } = await connected();
    window.dispatchEvent(new Event("offline"));
    expect(live.getLiveSnapshot().state).toBe("reconnecting");

    window.dispatchEvent(new Event("online"));
    expect(live.getLiveSnapshot().state).toBe("connected");
    expect(ready).toHaveBeenCalledTimes(2);
  });

  it("reconnects on `online` when the socket dropped, and refetches once the new connection is ready", async () => {
    const { live, ready } = await connected();
    window.dispatchEvent(new Event("offline"));
    fake.connected = false;
    await fake.fire("disconnect", "transport close");

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(live.getLiveSnapshot().state).toBe("connected"));
    expect(ready).toHaveBeenCalledTimes(2);
  });
});
