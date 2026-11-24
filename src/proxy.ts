import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { requireHospitalAccess, requireReservationOwner, requireRole } from "@/server/auth/guards";
import { SESSION_COOKIE, validateSessionToken } from "@/server/auth/session";
import { firstAidGuideExists } from "@/server/finder/search";
import { hospitalExists } from "@/server/reservations/queries";
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
    if (pathname.startsWith("/hospitals/")) return await hospitalGate(req, pathname);
    if (pathname === "/reservations" || pathname.startsWith("/reservations/")) return await reservationsGate(req, pathname);
    if (pathname === "/admin" || pathname.startsWith("/admin/")) return await adminGate(req, pathname);
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

/** /hospitals/<id or slug> (public): 404 unless that hospital exists. */
async function hospitalGate(req: NextRequest, pathname: string) {
  const m = /^\/hospitals\/([^/]+)\/?$/.exec(pathname);
  if (!m) return notFound(req);
  let key: string;
  try {
    key = decodeURIComponent(m[1]!);
  } catch {
    return notFound(req);
  }
  return (await hospitalExists(key)) ? NextResponse.next() : notFound(req);
}

async function sessionUser(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  return token ? validateSessionToken(token) : null;
}

function toLogin(req: NextRequest, pathname: string) {
  const login = new URL("/login", req.url);
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

/** /reservations (any signed-in user) and /reservations/<id> (owner or admin; anything else is a real 404). */
async function reservationsGate(req: NextRequest, pathname: string) {
  const user = await sessionUser(req);
  if (!user) return toLogin(req, pathname);
  if (pathname === "/reservations" || pathname === "/reservations/") return NextResponse.next();

  const m = /^\/reservations\/([^/]+)\/?$/.exec(pathname);
  if (!m) return notFound(req);
  let id: string;
  try {
    id = decodeURIComponent(m[1]!);
  } catch {
    return notFound(req);
  }
  if (id.length > 64) return notFound(req);
  await requireReservationOwner(user, id); // AppError (audited AUTHZ_DENIED) → 404 in proxy()
  return NextResponse.next();
}

async function staffGate(req: NextRequest, pathname: string) {
  const user = await sessionUser(req);
  if (!user) return toLogin(req, pathname);

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

/** /admin and /admin/*: ADMIN role required; signed-in non-admins get audited NOT_FOUND (404). */
async function adminGate(req: NextRequest, pathname: string) {
  const user = await sessionUser(req);
  if (!user) return toLogin(req, pathname);
  await requireRole(user, "ADMIN"); // AppError (audited AUTHZ_DENIED) → 404 in proxy()
  return NextResponse.next();
}

export const config = {
  matcher: ["/staff", "/staff/:path*", "/first-aid/:condition", "/hospitals/:hospital", "/reservations", "/reservations/:path*", "/admin", "/admin/:path*"],
};
