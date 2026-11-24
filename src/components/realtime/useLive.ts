"use client";

import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import type { ReservationChangedEvent, StockChangedEvent } from "@/lib/realtime-types";
import {
  type LiveSocket, type LiveState, acquireRooms, getLiveSocket, getLiveState, onLiveReady, releaseRooms,
  subscribeLiveState,
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

const serverState = (): LiveState => "connecting";

/**
 * Live island hook. Loads the shared socket after hydration, joins `rooms`, forwards events and
 * calls `onConnect` so the island refetches its snapshot whenever it (re)connects. Callers apply
 * events through a version gate and coalesce refetches.
 */
export function useLive({ rooms, onEvent, onConnect }: UseLiveOptions): { state: LiveState } {
  const state = useSyncExternalStore(subscribeLiveState, getLiveState, serverState);
  const roomsKey = rooms.join("|"); // room names never contain "|" (server regex)

  const handleConnect = useEffectEvent(() => onConnect());
  const handleStock = useEffectEvent((s: StockChangedEvent) => onEvent["stock:changed"]?.(s));
  const handleReservation = useEffectEvent((r: ReservationChangedEvent) => onEvent["reservation:changed"]?.(r));

  useEffect(() => {
    const list = roomsKey ? roomsKey.split("|") : [];
    let socket: LiveSocket | null = null;
    let disposed = false;
    let offReady = () => {};
    const stock = (s: StockChangedEvent) => handleStock(s);
    const reservation = (r: ReservationChangedEvent) => handleReservation(r);

    getLiveSocket()
      .then(async (s) => {
        if (disposed) return;
        socket = s;
        s.on("stock:changed", stock);
        s.on("reservation:changed", reservation);
        offReady = onLiveReady(() => handleConnect());
        await acquireRooms(s, list);
        if (!disposed && s.connected) handleConnect(); // mounted on an already-open socket
      })
      .catch(() => {
        // socket chunk failed to load: the island keeps its server-rendered snapshot
      });

    return () => {
      disposed = true;
      offReady();
      if (socket) {
        socket.off("stock:changed", stock);
        socket.off("reservation:changed", reservation);
        releaseRooms(socket, list);
      }
    };
  }, [roomsKey]);

  return { state };
}
