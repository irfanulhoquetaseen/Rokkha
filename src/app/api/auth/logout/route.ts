import { NextResponse } from "next/server";
import { clearSessionCookie, readSessionToken } from "@/server/auth/cookie";
import { logout } from "@/server/auth/service";
import { apiHandler, clientIp } from "@/server/http/api-handler";

export const POST = apiHandler(
  async (req) => {
    // Server-side invalidation first: the session row is deleted, so the old token is dead even if replayed.
    await logout(await readSessionToken(), { ip: clientIp(req.headers) });
    await clearSessionCookie();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  },
  { mutation: true },
);
