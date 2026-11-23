import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { requireHospitalAccess } from "@/server/auth/guards";
import { SESSION_COOKIE, validateSessionToken } from "@/server/auth/session";
import { firstLiveHospitalId } from "@/server/resources/queries";

/**
 * Request-time gate for the staff console. The pages stream behind <Suspense>, so once rendering
 * starts the status is already 200: a real 307 (login) / 404 (foreign hospital) must be decided here,
 * before rendering. This is an early check only — the pages and API routes still enforce access.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await validateSessionToken(token) : null;

  if (!user) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (pathname === "/staff" || pathname === "/staff/") {
    let target: string | null = null;
    if (user.role === "HOSPITAL_STAFF") target = user.hospitalId;
    else if (user.role === "ADMIN") target = await firstLiveHospitalId();
    return target ? NextResponse.redirect(new URL(`/staff/hospitals/${encodeURIComponent(target)}`, req.url)) : notFound(req);
  }

  const m = /^\/staff\/hospitals\/([^/]+)\/?$/.exec(pathname);
  if (m) {
    try {
      await requireHospitalAccess(user, decodeURIComponent(m[1]!)); // audits AUTHZ_DENIED on failure
    } catch (e) {
      if (e instanceof AppError || e instanceof URIError) return notFound(req);
      throw e;
    }
    return NextResponse.next();
  }

  return notFound(req); // no other /staff/* routes exist
}

/** Render the app's not-found page with a real 404 status (the rewrite target matches no route). */
function notFound(req: NextRequest) {
  return NextResponse.rewrite(new URL("/_staff-not-found", req.url), { status: 404 });
}

export const config = { matcher: ["/staff", "/staff/:path*"] };
