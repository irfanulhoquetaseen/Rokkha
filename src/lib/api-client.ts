import type { ErrorBody } from "@/lib/errors";

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ErrorBody["error"]; network?: false }
  | { ok: false; network: true };

const isErrorBody = (v: unknown): v is ErrorBody =>
  typeof v === "object" && v !== null && typeof (v as ErrorBody).error?.code === "string";

/**
 * Tiny JSON client for the app's own API (same origin, so the browser sends the session cookie and
 * Origin header). Never throws: a dropped connection is `{ ok: false, network: true }`, and a non-JSON
 * or foreign-shaped error body becomes INTERNAL with the HTTP status.
 */
export async function requestJson<T>(
  method: "GET" | "POST",
  url: string,
  body?: unknown,
  opts: { idempotencyKey?: string } = {},
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    res = await fetch(url, {
      method, headers, cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, network: true };
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: res.status, data: json as T };
  if (isErrorBody(json)) return { ok: false, status: res.status, error: json.error };
  return {
    ok: false, status: res.status,
    error: { code: "INTERNAL", message: { bn: "কিছু ভুল হয়েছে, আবার চেষ্টা করুন", en: "Something went wrong, please try again" } },
  };
}

export function postJson<T>(url: string, body?: unknown, opts: { idempotencyKey?: string } = {}): Promise<ApiResult<T>> {
  return requestJson<T>("POST", url, body ?? {}, opts);
}

export function getJson<T>(url: string): Promise<ApiResult<T>> {
  return requestJson<T>("GET", url);
}
