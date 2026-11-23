import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { checkHealth } from "@/server/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const report = await checkHealth(() => prisma.$queryRaw`SELECT 1`);
  return NextResponse.json(report, {
    status: report.db === "up" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
