import { NextResponse } from "next/server";
import { apiHandler } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { getMyReservation } from "@/server/reservations/queries";

export const GET = apiHandler(async (req: Request, ctx: { params: Promise<{ reservationId: string }> }) => {
  const { reservationId } = await ctx.params;
  const reservation = await getMyReservation(await getUserFromRequest(req), reservationId);
  // serverNow: the tracker's countdown clock (a page restored from the router cache has a stale render time).
  return NextResponse.json({ reservation, serverNow: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
});
