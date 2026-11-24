import type { ReservationStatus } from "@/generated/prisma/enums";
import type { StockSnapshot } from "@/server/reservations/stock";
import { getIO } from "./io";

// Emitters for committed changes. Callers invoke these only after `$transaction` resolves,
// so a client never sees a change that was rolled back. No-ops without a socket server
// (tests, seed scripts).

export function publishStock(s: StockSnapshot): void {
  getIO()?.to(["finder", `hospital:${s.hospitalId}`, `staff:${s.hospitalId}`]).emit("stock:changed", s);
}

/** No personal data on the wire: staff refetch their queue, owners refetch their reservation. */
export type ReservationEventPayload = {
  id: string; status: ReservationStatus; version: number; hospitalId: string; expiresAt: Date;
};

export function publishReservation(r: ReservationEventPayload): void {
  const payload: ReservationEventPayload = {
    id: r.id, status: r.status, version: r.version, hospitalId: r.hospitalId, expiresAt: r.expiresAt,
  };
  getIO()?.to([`reservation:${r.id}`, `staff:${r.hospitalId}`]).emit("reservation:changed", payload);
}
