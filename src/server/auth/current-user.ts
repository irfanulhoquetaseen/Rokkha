import { cache } from "react";
import { cookies } from "next/headers";
import { SESSION_COOKIE, validateSessionToken, type SessionUser } from "@/server/auth/session";

/** The signed-in user for this request (from the session cookie), or null. Memoized per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? validateSessionToken(token) : null;
});

/** Resolve the user from a Request's Cookie header (for route handlers; independent of Next's request scope). */
export async function getUserFromRequest(req: Request): Promise<SessionUser | null> {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) {
      const token = part.slice(i + 1).trim();
      return token ? validateSessionToken(token) : null;
    }
  }
  return null;
}
