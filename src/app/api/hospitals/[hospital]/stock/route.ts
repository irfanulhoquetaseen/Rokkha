import { NextResponse } from "next/server";
import { apiHandler } from "@/server/http/api-handler";
import { getHospitalStock } from "@/server/reservations/queries";

// Public (no session): the snapshot a client refetches on (re)connect. Never cached — it is live stock.
export const GET = apiHandler(async (_req: Request, ctx: { params: Promise<{ hospital: string }> }) => {
  const { hospital } = await ctx.params;
  const data = await getHospitalStock(hospital);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
});
