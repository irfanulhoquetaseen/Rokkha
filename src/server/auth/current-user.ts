import { cache } from "react";
import { cookies } from "next/headers";
import { SESSION_COOKIE, validateSessionToken, type SessionUser } from "@/server/auth/session";

/** The signed-in user for this request (from the session cookie), or null. Memoized per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? validateSessionToken(token) : null;
});
