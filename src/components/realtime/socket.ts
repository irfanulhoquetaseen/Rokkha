import type { Socket } from "socket.io-client";
import type { LiveClientEvents, LiveServerEvents, ReservationChangedEvent, StockChangedEvent } from "@/lib/realtime-types";
import { backoffDelay } from "./backoff";

// One shared Socket.io connection per tab, created on first use. `socket.io-client` is pulled in
// with a dynamic import() so it lands in its own chunk, never in a page's first-load JS (Finder
// budget). Rooms are ref-counted: two islands on the same room do not unsubscribe each other.
// The server forgets rooms on reconnect, so every `connect` re-subscribes all held rooms and only
// then notifies islands to refetch their snapshot (no gap between snapshot and live events).
// The handshake carries the session cookie, so login/logout must call resetLiveSocket().

export type LiveSocket = Socket<LiveServerEvents, LiveClientEvents>;
export type LiveState = "connecting" | "connected" | "reconnecting";
export type LiveSnapshot = { state: LiveState; denied: ReadonlySet<string> };

const ACK_TIMEOUT_MS = 5000;
const JOIN_ATTEMPTS = 3;
const FIRST_CONNECT_GRACE_MS = 5000;
const STABLE_CONNECTION_MS = 10_000;
/** Manual reconnects after a server kick / rejected handshake before giving up (until `online` or a reset). */
const MAX_MANUAL_RECONNECTS = 3;

let socketPromise: Promise<LiveSocket> | null = null;
let current: LiveSocket | null = null;
let snapshot: LiveSnapshot = { state: "connecting", denied: new Set() };
let everConnected = false;
let offline = false;
let resetting = false;
let epoch = 0; // bumped on every connect/disconnect: stale async work checks it and stops
let manualReconnects = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let stableTimer: ReturnType<typeof setTimeout> | null = null;
const rooms = new Map<string, number>();
const storeListeners = new Set<() => void>();
const readyListeners = new Set<() => void>();
type EventListeners = { stock: (s: StockChangedEvent) => void; reservation: (r: ReservationChangedEvent) => void };
const eventListeners = new Set<EventListeners>();

function emitStore(next: LiveSnapshot): void {
  snapshot = next;
  for (const l of storeListeners) l();
}

function setState(state: LiveState): void {
  if (snapshot.state !== state) emitStore({ ...snapshot, state });
}

function setDenied(room: string, denied: boolean): void {
  if (snapshot.denied.has(room) === denied) return;
  const next = new Set(snapshot.denied);
  if (denied) next.add(room);
  else next.delete(room);
  emitStore({ ...snapshot, denied: next });
}

export function getLiveSnapshot(): LiveSnapshot {
  return snapshot;
}

export function subscribeLiveStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => storeListeners.delete(listener);
}

/** Called after every (re)connect once all held rooms are re-subscribed. */
export function onLiveReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

export function onLiveEvents(listeners: EventListeners): () => void {
  eventListeners.add(listeners);
  return () => eventListeners.delete(listeners);
}

export function isLiveConnected(): boolean {
  return current?.connected === true;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Subscribe with ack. A timed-out ack is retried with backoff while the same connection lives;
 * a denial (`ok: false`) or exhausted retries marks the room as denied so islands can fall back.
 */
async function join(socket: LiveSocket, room: string, joinEpoch: number): Promise<void> {
  for (let attempt = 0; attempt < JOIN_ATTEMPTS; attempt++) {
    if (epoch !== joinEpoch || !socket.connected) return;
    try {
      const ack = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck("subscribe", { room });
      if (epoch !== joinEpoch) return;
      if (!ack.ok) console.warn(`[live] subscribe ${room} denied: ${ack.code}`);
      setDenied(room, !ack.ok);
      return;
    } catch {
      await wait(backoffDelay(attempt, 500, 2000));
    }
  }
  if (epoch === joinEpoch && socket.connected) {
    console.warn(`[live] subscribe ${room} timed out`);
    setDenied(room, true);
  }
}

/** New handshake now (picks up the current cookie, skips socket.io's backoff). */
function reconnectNow(socket: LiveSocket): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  resetting = true;
  socket.disconnect(); // emits "disconnect" synchronously; `resetting` keeps the banner off
  resetting = false;
  socket.connect();
}

/** socket.io does not retry after a server kick or a rejected handshake: retry a few times, slowly. */
function scheduleManualReconnect(socket: LiveSocket): void {
  if (offline || reconnectTimer || manualReconnects >= MAX_MANUAL_RECONNECTS) return;
  const delay = backoffDelay(manualReconnects, 1000, 2000);
  manualReconnects++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!socket.connected) socket.connect();
  }, delay);
}

export function getLiveSocket(): Promise<LiveSocket> {
  if (socketPromise) return socketPromise;
  const created = import("socket.io-client").then(({ io }) => {
    const socket: LiveSocket = io({ path: "/socket.io" });
    current = socket;
    offline = navigator.onLine === false;
    if (offline) setState("reconnecting");
    const firstConnectTimer = setTimeout(() => {
      if (snapshot.state === "connecting") setState("reconnecting");
    }, FIRST_CONNECT_GRACE_MS);

    socket.on("stock:changed", (s) => {
      for (const l of eventListeners) l.stock(s);
    });
    socket.on("reservation:changed", (r) => {
      for (const l of eventListeners) l.reservation(r);
    });

    socket.on("connect", async () => {
      const myEpoch = ++epoch;
      everConnected = true;
      clearTimeout(firstConnectTimer);
      if (stableTimer) clearTimeout(stableTimer);
      stableTimer = setTimeout(() => (manualReconnects = 0), STABLE_CONNECTION_MS);
      await Promise.all([...rooms.keys()].map((room) => join(socket, room, myEpoch)));
      if (myEpoch !== epoch || !socket.connected) return; // a newer connection took over
      setState("connected");
      for (const l of readyListeners) l();
    });
    socket.on("disconnect", (reason) => {
      epoch++;
      if (stableTimer) clearTimeout(stableTimer);
      if (resetting) return;
      setState(everConnected || offline ? "reconnecting" : "connecting");
      if (reason === "io server disconnect") scheduleManualReconnect(socket);
    });
    socket.on("connect_error", () => {
      setState("reconnecting");
      if (!socket.active) scheduleManualReconnect(socket); // handshake rejected by middleware
    });

    window.addEventListener("offline", () => {
      offline = true;
      setState("reconnecting"); // socket.io's own reconnection keeps running
    });
    window.addEventListener("online", () => {
      offline = false;
      manualReconnects = 0;
      if (socket.connected) setState("connected");
      else reconnectNow(socket);
    });
    return socket;
  });
  created.catch(() => {
    socketPromise = null; // chunk failed to load (flaky network): let the next mount retry
  });
  socketPromise = created;
  return created;
}

/**
 * Re-handshake so the server sees the current session cookie. Call after login, signup and
 * logout (soft navigations keep the tab's socket alive). The connect handler re-joins all rooms
 * and fires the snapshot refetches.
 */
export function resetLiveSocket(): void {
  const socket = current;
  if (!socket) return; // not created yet: its first handshake will use the current cookie
  manualReconnects = 0;
  if (snapshot.denied.size > 0) emitStore({ ...snapshot, denied: new Set() });
  reconnectNow(socket);
}

/**
 * Ref-counted subscribe (synchronous count; join emitted now when connected, else by the next
 * `connect`). Resolves once the newly joined rooms are acked.
 */
export async function acquireRooms(list: readonly string[]): Promise<void> {
  const fresh: string[] = [];
  for (const room of list) {
    const n = rooms.get(room) ?? 0;
    rooms.set(room, n + 1);
    if (n === 0) fresh.push(room);
  }
  const socket = current;
  if (socket?.connected) await Promise.all(fresh.map((room) => join(socket, room, epoch)));
}

export function releaseRooms(list: readonly string[]): void {
  for (const room of list) {
    const n = rooms.get(room) ?? 0;
    if (n > 1) {
      rooms.set(room, n - 1);
      continue;
    }
    rooms.delete(room);
    setDenied(room, false);
    if (current?.connected) current.emit("unsubscribe", { room });
  }
}
