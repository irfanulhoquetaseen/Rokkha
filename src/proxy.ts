import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { requireHospitalAccess } from "@/server/auth/guards";
import { SESSION_COOKIE, validateSessionToken } from "@/server/auth/session";
import { firstAidGuideExists } from "@/server/finder/search";
import { firstLiveHospitalId } from "@/server/resources/queries";

/**
 * Request-time gate. The pages stream behind <Suspense>, so once rendering starts the status is
 * already 200: a real 307 (login) / 404 (foreign hospital, unknown first-aid code) must be decided
 * here, before rendering. This is an early check only — the pages and API routes still enforce access.
 *
 * If the database is unreachable the proxy must not turn every request into a crash page: it logs the
 * error and lets the request through, where the page/API guards still decide (and error.tsx shows a
 * friendly message with Call 999).
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  try {
    if (pathname.startsWith("/first-aid/")) return await firstAidGate(req, pathname);
    return await staffGate(req, pathname);
  } catch (e) {
    if (e instanceof AppError) return notFound(req);
    // name/code/message only (e.g. AggregateError ECONNREFUSED has an empty message); no request data.
    const info = e instanceof Error ? [e.name, (e as { code?: unknown }).code, e.message].filter(Boolean).join(" ") : String(e);
    console.error("[proxy] check failed, falling through to the page guards:", info);
    return NextResponse.next();
  }
}

const CONDITION_CODE = /^[A-Za-z0-9_-]{1,64}$/;

/** /first-aid/<code>: 404 unless the code is well-formed and a FirstAidGuide exists for it. */
async function firstAidGate(req: NextRequest, pathname: string) {
  const m = /^\/first-aid\/([^/]+)\/?$/.exec(pathname);
  if (!m) return notFound(req);
  let code: string;
  try {
    code = decodeURIComponent(m[1]!);
  } catch {
    return notFound(req); // malformed %-encoding
  }
  if (!CONDITION_CODE.test(code) || !(await firstAidGuideExists(code))) return notFound(req);
  return NextResponse.next();
}

async function staffGate(req: NextRequest, pathname: string) {
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
  return NextResponse.rewrite(new URL("/_proxy-not-found", req.url), { status: 404 });
}

export const config = { matcher: ["/staff", "/staff/:path*", "/first-aid/:condition"] };
