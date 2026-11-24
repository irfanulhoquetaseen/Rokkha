import { isIP } from "node:net";
import { connection, NextResponse } from "next/server";
import type { ZodType } from "zod";
import { AppError, toErrorBody } from "@/lib/errors";
import { isSameOrigin } from "./origin";

export function apiHandler<C>(
  fn: (req: Request, ctx: C) => Promise<Response>,
  opts?: { mutation?: boolean },
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    // Outside the try: during `next build` prerendering connection() rejects on purpose to mark the
    // route dynamic. Catching it here would log a bogus "Unhandled error" and turn it into a 500 body.
    await connection();
    try {
      if (opts?.mutation && !isSameOrigin(req.headers)) {
        throw new AppError("VALIDATION_ERROR", { bn: "অনুরোধের উৎস সঠিক নয়", en: "Invalid request origin" });
      }
      return await fn(req, ctx);
    } catch (err) {
      const { status, body } = toErrorBody(err);
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      const retryAfter = retryAfterSec(err);
      if (retryAfter !== null) headers["Retry-After"] = String(retryAfter);
      return NextResponse.json(body, { status, headers });
    }
  };
}

/** RATE_LIMITED errors carry `details.retryAfterSec`; surface it as the standard Retry-After header. */
function retryAfterSec(err: unknown): number | null {
  if (!(err instanceof AppError) || err.code !== "RATE_LIMITED") return null;
  const sec = (err.details as { retryAfterSec?: unknown } | undefined)?.retryAfterSec;
  return typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? Math.ceil(sec) : null;
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", { bn: "অনুরোধের বডি সঠিক JSON নয়", en: "Request body is not valid JSON" });
  }
  return schema.parse(json);
}

/** Railway's edge appends the real client IP, so trust the right-most XFF entry (left entries are client-controlled). */
export function clientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    return last && isIP(last) ? last : null;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real && isIP(real) ? real : null;
}
