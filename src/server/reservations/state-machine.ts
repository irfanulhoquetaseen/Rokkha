import type { ReservationStatus } from "@/generated/prisma/enums";

// Single source of truth for the reservation lifecycle (pure, no I/O).
//   HELD → ARRIVED | CANCELLED (citizen) | EXPIRED (system) | REJECTED (staff, reason required)
//   ARRIVED → COMPLETED
// Every other pair is INVALID_TRANSITION.
export const TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  HELD: ["ARRIVED", "CANCELLED", "EXPIRED", "REJECTED"],
  ARRIVED: ["COMPLETED"],
  CANCELLED: [],
  EXPIRED: [],
  REJECTED: [],
  COMPLETED: [],
};

export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Whether entering `to` gives the held quantity back to the hospital.
 * Released holds always return stock; a completed case returns only non-consumables
 * (a bed is freed on discharge, used blood/antivenom is gone).
 */
export function returnsStock(to: ReservationStatus, consumable: boolean): boolean {
  if (to === "CANCELLED" || to === "EXPIRED" || to === "REJECTED") return true;
  if (to === "COMPLETED") return !consumable;
  return false;
}

export type Actor = { kind: "citizen" | "staff" | "system"; userId: string | null };

export const ACTION_TARGET = {
  cancel: "CANCELLED",
  checkIn: "ARRIVED",
  reject: "REJECTED",
  complete: "COMPLETED",
  expire: "EXPIRED",
} as const satisfies Record<string, ReservationStatus>;
export type ReservationAction = keyof typeof ACTION_TARGET;
