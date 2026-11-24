import type { ReservationStatus } from "@/generated/prisma/enums";

// Wire shapes of the server's socket events, safe to import from client code (types only, no
// server modules). Dates arrive JSON-serialised, i.e. as ISO strings.
// Server sources: StockSnapshot (src/server/reservations/stock.ts) and ReservationEventPayload
// (src/server/realtime/publish.ts).

export type StockChangedEvent = {
  id: string;
  hospitalId: string;
  resourceTypeId: string;
  code: string;
  available: number;
  total: number;
  isAvailable: boolean;
  version: number;
  updatedAt: string;
};

export type ReservationChangedEvent = {
  id: string;
  status: ReservationStatus;
  version: number;
  hospitalId: string;
  expiresAt: string;
};

export type LiveServerEvents = {
  "stock:changed": (s: StockChangedEvent) => void;
  "reservation:changed": (r: ReservationChangedEvent) => void;
};

export type SubscribeAck = { ok: true } | { ok: false; code: string };

export type LiveClientEvents = {
  subscribe: (payload: { room: string }, ack: (res: SubscribeAck) => void) => void;
  unsubscribe: (payload: { room: string }) => void;
};
