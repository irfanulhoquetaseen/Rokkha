import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, parseBody } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { requireUser } from "@/server/auth/guards";
import { staffTransition } from "@/server/reservations/transition";

// Shape only; staffTransition enforces the reason rule (required, 3–300 chars, for reject).
const bodySchema = z.object({
  action: z.enum(["checkIn", "reject", "complete"]),
  reason: z.string().max(1000).optional(),
});

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<{ reservationId: string }> }) => {
    const { reservationId } = await ctx.params;
    // Authenticate before parsing: an anonymous request is 401 whatever its body looks like.
    const user = requireUser(await getUserFromRequest(req));
    const body = await parseBody(req, bodySchema);
    const reservation = await staffTransition(user, reservationId, body.action, body.reason);
    return NextResponse.json({ reservation }, { headers: { "Cache-Control": "no-store" } });
  },
  { mutation: true },
);
