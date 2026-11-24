import type { Socket } from "socket.io-client";
import type { LiveClientEvents, LiveServerEvents } from "@/lib/realtime-types";

// One shared Socket.io connection per tab, created on first use. `socket.io-client` is pulled in
// with a dynamic import() so it lands in its own chunk, never in a page's first-load JS (Finder
// budget). Rooms are ref-counted: two islands on the same room do not unsubscribe each other.
// The server forgets rooms on reconnect, so every `connect` re-subscribes all held rooms and only
// then notifies islands to refetch their snapshot (no gap between snapshot and live events).

export type LiveSocket = Socket<LiveServerEvents, LiveClientEvents>;
export type LiveState = "connecting" | "connected" | "reconnecting";

const ACK_TIMEOUT_MS = 5000;

let socketPromise: Promise<LiveSocket> | null = null;
let state: LiveState = "connecting";
let everConnected = false;
let offline = false;
const rooms = new Map<string, number>();
const stateListeners = new Set<() => void>();
const readyListeners = new Set<() => void>();

function setState(next: LiveState): void {
  if (state === next) return;
  state = next;
  for (const l of stateListeners) l();
}

export function getLiveState(): LiveState {
  return state;
}

export function subscribeLiveState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** Called after every (re)connect once all held rooms are re-subscribed. */
export function onLiveReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

async function join(socket: LiveSocket, room: string): Promise<boolean> {
  try {
    const ack = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck("subscribe", { room });
    return ack.ok;
  } catch {
    return false; // ack timeout: the next reconnect retries
  }
}

export function getLiveSocket(): Promise<LiveSocket> {
  if (socketPromise) return socketPromise;
  const created = import("socket.io-client").then(({ io }) => {
    offline = navigator.onLine === false;
    const socket: LiveSocket = io({ path: "/socket.io", autoConnect: !offline });
    if (offline) setState("reconnecting");

    socket.on("connect", async () => {
      everConnected = true;
      await Promise.all([...rooms.keys()].map((room) => join(socket, room)));
      if (!socket.connected) return;
      setState("connected");
      for (const l of readyListeners) l();
    });
    socket.on("disconnect", () => setState(everConnected || offline ? "reconnecting" : "connecting"));

    window.addEventListener("offline", () => {
      offline = true;
      setState("reconnecting");
      socket.disconnect();
    });
    window.addEventListener("online", () => {
      offline = false;
      if (!socket.connected) socket.connect();
    });
    return socket;
  });
  created.catch(() => {
    socketPromise = null; // chunk failed to load (flaky network): let the next mount retry
  });
  socketPromise = created;
  return created;
}

/** Ref-counted subscribe; joins immediately when already connected (else the next `connect` does). */
export async function acquireRooms(socket: LiveSocket, list: readonly string[]): Promise<void> {
  const fresh: string[] = [];
  for (const room of list) {
    const n = rooms.get(room) ?? 0;
    rooms.set(room, n + 1);
    if (n === 0) fresh.push(room);
  }
  if (socket.connected) await Promise.all(fresh.map((room) => join(socket, room)));
}

export function releaseRooms(socket: LiveSocket, list: readonly string[]): void {
  for (const room of list) {
    const n = rooms.get(room) ?? 0;
    if (n > 1) {
      rooms.set(room, n - 1);
      continue;
    }
    rooms.delete(room);
    if (socket.connected) socket.emit("unsubscribe", { room });
  }
}
