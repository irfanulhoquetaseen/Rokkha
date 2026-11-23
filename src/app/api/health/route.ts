import { connection, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { checkHealth } from "@/server/health";

export async function GET() {
  // Opt out of prerendering (Cache Components): this must hit the DB on every request.
  await connection();
  const report = await checkHealth(() => prisma.$queryRaw`SELECT 1`);
  return NextResponse.json(report, {
    status: report.db === "up" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
