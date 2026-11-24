import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { apiHandler, parseBody } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { requireUser } from "@/server/auth/guards";
import { reserveLimiterByUser } from "@/server/auth/rate-limit";
import { reserve } from "@/server/reservations/reserve";
import { idempotencyKeySchema, reserveBodySchema } from "@/server/reservations/schemas";
import { listMyReservations } from "@/server/reservations/queries";

const NO_STORE = { "Cache-Control": "no-store" };

export const POST = apiHandler(
  async (req: Request) => {
    // Authenticate before anything else: anonymous is 401 whatever the key/body look like.
    const user = requireUser(await getUserFromRequest(req));
    // Every attempt counts (even malformed ones), keyed by the session user, never by client input.
    const hit = reserveLimiterByUser.hit(user.id);
    if (!hit.allowed) throw new AppError("RATE_LIMITED", undefined, { retryAfterSec: hit.retryAfterSec });

    const key = idempotencyKeySchema.safeParse(req.headers.get("idempotency-key") ?? "");
    if (!key.success) {
      throw new AppError("VALIDATION_ERROR", { bn: "Idempotency-Key হেডার (UUID) প্রয়োজন", en: "An Idempotency-Key header (UUID) is required" });
    }
    const body = await parseBody(req, reserveBodySchema);
    const { reservation, replayed } = await reserve(user, { idempotencyKey: key.data, body });
    return NextResponse.json({ reservation }, { status: replayed ? 200 : 201, headers: NO_STORE });
  },
  { mutation: true },
);

export const GET = apiHandler(async (req: Request) => {
  const user = await getUserFromRequest(req);
  const page = new URL(req.url).searchParams.get("page");
  const data = await listMyReservations(user, page);
  return NextResponse.json(data, { headers: NO_STORE });
});
