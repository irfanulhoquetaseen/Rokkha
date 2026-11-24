import { NextResponse } from "next/server";
import { apiHandler } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { requireUser } from "@/server/auth/guards";
import { cancelReservation } from "@/server/reservations/transition";

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<{ reservationId: string }> }) => {
    const { reservationId } = await ctx.params;
    const user = requireUser(await getUserFromRequest(req));
    const reservation = await cancelReservation(user, reservationId);
    return NextResponse.json({ reservation }, { headers: { "Cache-Control": "no-store" } });
  },
  { mutation: true },
);
