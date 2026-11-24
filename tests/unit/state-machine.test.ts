import { describe, expect, it } from "vitest";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { ACTION_TARGET, TRANSITIONS, canTransition, returnsStock } from "@/server/reservations/state-machine";

const ALL: ReservationStatus[] = ["HELD", "ARRIVED", "CANCELLED", "EXPIRED", "REJECTED", "COMPLETED"];
const ALLOWED = new Set(["HELD>ARRIVED", "HELD>CANCELLED", "HELD>EXPIRED", "HELD>REJECTED", "ARRIVED>COMPLETED"]);

describe("reservation state machine", () => {
  it("allows exactly the documented transitions (full 6x6 matrix)", () => {
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(ALLOWED.has(`${from}>${to}`));
      }
    }
  });

  it("terminal states have no outgoing transitions", () => {
    for (const s of ["CANCELLED", "EXPIRED", "REJECTED", "COMPLETED"] as const) expect(TRANSITIONS[s]).toEqual([]);
  });

  it("returnsStock follows the stock-return rules", () => {
    for (const to of ["CANCELLED", "EXPIRED", "REJECTED"] as const) {
      expect(returnsStock(to, true), `${to} consumable`).toBe(true);
      expect(returnsStock(to, false), `${to} non-consumable`).toBe(true);
    }
    expect(returnsStock("COMPLETED", true)).toBe(false);
    expect(returnsStock("COMPLETED", false)).toBe(true);
    expect(returnsStock("ARRIVED", true)).toBe(false);
    expect(returnsStock("ARRIVED", false)).toBe(false);
    expect(returnsStock("HELD", false)).toBe(false);
  });

  it("maps actions to target statuses", () => {
    expect(ACTION_TARGET).toEqual({ cancel: "CANCELLED", checkIn: "ARRIVED", reject: "REJECTED", complete: "COMPLETED", expire: "EXPIRED" });
  });
});
