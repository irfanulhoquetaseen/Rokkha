import { NextResponse } from "next/server";
import { z } from "zod";
import { readSessionToken, setSessionCookie } from "@/server/auth/cookie";
import { login } from "@/server/auth/service";
import { apiHandler, clientIp, parseBody } from "@/server/http/api-handler";

// Shape only; the auth service normalizes/validates the phone and password.
const bodySchema = z.object({ phone: z.string(), password: z.string() });

export const POST = apiHandler(
  async (req) => {
    const input = await parseBody(req, bodySchema);
    // Rotation: the service deletes the pre-login session server-side; the cookie gets a new token.
    const { user, token, expiresAt } = await login(input, {
      ip: clientIp(req.headers),
      previousToken: await readSessionToken(),
    });
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
  },
  { mutation: true },
);
