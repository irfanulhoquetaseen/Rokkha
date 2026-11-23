import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit/audit";
import { resetDb } from "../support/db";

describe("audit", () => {
  beforeEach(resetDb);
  it("writes a row with JSON before/after", async () => {
    await audit({ action: "STOCK_CHANGE", entityType: "ResourceStock", entityId: "x", before: { available: 3 }, after: { available: 2 }, ip: "1.2.3.4" });
    const rows = await prisma.auditLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "STOCK_CHANGE", before: { available: 3 }, after: { available: 2 }, ip: "1.2.3.4", actorUserId: null });
  });
  it("works inside a transaction and rolls back with it", async () => {
    await prisma.$transaction((tx) => audit({ action: "LOGIN_FAILED", entityType: "User" }, tx));
    expect(await prisma.auditLog.count()).toBe(1);
    await prisma.$transaction(async (tx) => { await audit({ action: "LOGOUT", entityType: "User" }, tx); throw new Error("x"); }).catch(() => {});
    expect(await prisma.auditLog.count()).toBe(1);
  });
});
