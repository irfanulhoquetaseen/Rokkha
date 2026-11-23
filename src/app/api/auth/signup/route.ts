import { NextResponse } from "next/server";
import { z } from "zod";
import { readSessionToken, setSessionCookie } from "@/server/auth/cookie";
import { signup } from "@/server/auth/service";
import { apiHandler, clientIp, parseBody } from "@/server/http/api-handler";

// Shape only; the auth service applies the real rules (phone format, lengths). Unknown keys
// such as `role` / `hospitalId` are stripped here and again in the service.
const bodySchema = z.object({ name: z.string(), phone: z.string(), password: z.string() });

export const POST = apiHandler(
  async (req) => {
    const input = await parseBody(req, bodySchema);
    // Any pre-signup session is deleted server-side by the service (rotation parity with login).
    const { user, token, expiresAt } = await signup(input, {
      ip: clientIp(req.headers),
      previousToken: await readSessionToken(),
    });
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ user }, { status: 201, headers: { "Cache-Control": "no-store" } });
  },
  { mutation: true },
);
