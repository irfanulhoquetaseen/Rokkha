import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { checkHealth } from "@/server/health";
import { resetDb } from "../support/db";

describe("health check against the real test database", () => {
  beforeEach(resetDb);

  it("connects to a database whose name ends in _test", async () => {
    const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(row.db.endsWith("_test")).toBe(true);
  });

  it("reports db up with a real SELECT 1", async () => {
    const report = await checkHealth(() => prisma.$queryRaw`SELECT 1`);
    expect(report.db).toBe("up");
  });

  it("resetDb empties tables", async () => {
    await prisma.systemHeartbeat.create({ data: { note: "x" } });
    await resetDb();
    expect(await prisma.systemHeartbeat.count()).toBe(0);
  });
});
