"use client";

import { useEffect, useEffectEvent, useMemo, useSyncExternalStore } from "react";
import type { ReservationChangedEvent, StockChangedEvent } from "@/lib/realtime-types";
import {
  type LiveSnapshot, type LiveState, acquireRooms, getLiveSnapshot, getLiveSocket, isLiveConnected, onLiveEvents,
  onLiveReady, releaseRooms, subscribeLiveStore,
} from "./socket";

export type UseLiveOptions = {
  rooms: string[];
  onEvent: {
    "stock:changed"?: (s: StockChangedEvent) => void;
    "reservation:changed"?: (r: ReservationChangedEvent) => void;
  };
  /** Snapshot refetch: runs after every connect (first and re-), once the rooms are joined. */
  onConnect: () => void;
};

const serverSnapshot: LiveSnapshot = { state: "connecting", denied: new Set() };
const getServerSnapshot = () => serverSnapshot;

/**
 * Live island hook. Loads the shared socket after hydration, joins `rooms`, forwards events and
 * calls `onConnect` so the island refetches its snapshot whenever it (re)connects. Callers apply
 * events through a version gate and coalesce refetches. `deniedRooms` lists rooms the server
 * refused (or never acked): the island should fall back to polling or a manual refresh.
 */
export function useLive({ rooms, onEvent, onConnect }: UseLiveOptions): { state: LiveState; deniedRooms: string[] } {
  const snap = useSyncExternalStore(subscribeLiveStore, getLiveSnapshot, getServerSnapshot);
  const roomsKey = rooms.join("|"); // room names never contain "|" (server regex)

  const handleConnect = useEffectEvent(() => onConnect());
  const handleStock = useEffectEvent((s: StockChangedEvent) => onEvent["stock:changed"]?.(s));
  const handleReservation = useEffectEvent((r: ReservationChangedEvent) => onEvent["reservation:changed"]?.(r));

  useEffect(() => {
    const list = roomsKey ? roomsKey.split("|") : [];
    let disposed = false;
    const offEvents = onLiveEvents({ stock: (s) => handleStock(s), reservation: (r) => handleReservation(r) });
    const offReady = onLiveReady(() => handleConnect());
    const wasConnected = isLiveConnected();
    const joined = acquireRooms(list);
    // Already-open socket: no `connect` will come, so refetch once our new rooms are joined.
    if (wasConnected) void joined.then(() => !disposed && handleConnect());
    getLiveSocket().catch(() => {
      // socket chunk failed to load: the island keeps its server-rendered snapshot
    });

    return () => {
      disposed = true;
      offReady();
      offEvents();
      // Deferred so that on a rooms change the next effect acquires first: shared rooms never
      // drop to zero and get unsubscribed/resubscribed.
      queueMicrotask(() => releaseRooms(list));
    };
  }, [roomsKey]);

  const deniedRooms = useMemo(
    () => (roomsKey ? roomsKey.split("|") : []).filter((r) => snap.denied.has(r)),
    [roomsKey, snap.denied],
  );
  return { state: snap.state, deniedRooms };
}
