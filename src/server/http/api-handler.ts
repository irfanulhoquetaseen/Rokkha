import { connection, NextResponse } from "next/server";
import type { ZodType } from "zod";
import { AppError, toErrorBody } from "@/lib/errors";
import { isSameOrigin } from "./origin";

export function apiHandler<C>(
  fn: (req: Request, ctx: C) => Promise<Response>,
  opts?: { mutation?: boolean },
): (req: Request, ctx: C) => Promise<Response> {
  return async (req, ctx) => {
    try {
      await connection();
      if (opts?.mutation && !isSameOrigin(req.headers)) {
        throw new AppError("VALIDATION_ERROR", { bn: "অনুরোধের উৎস সঠিক নয়", en: "Invalid request origin" });
      }
      return await fn(req, ctx);
    } catch (err) {
      const { status, body } = toErrorBody(err);
      return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
    }
  };
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

export function clientIp(headers: Headers): string | null {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}
