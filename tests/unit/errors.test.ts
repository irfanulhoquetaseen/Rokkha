import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError, ERROR_STATUS, toErrorBody, type ErrorCode } from "@/lib/errors";

const expected: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, NOT_FOUND: 404, CONFLICT: 409, SOLD_OUT: 409,
  INVALID_TRANSITION: 409, LIMIT_REACHED: 409, RATE_LIMITED: 429, INTERNAL: 500,
};

describe("errors", () => {
  it.each(Object.entries(expected))("%s -> %i with bilingual default", (code, status) => {
    expect(ERROR_STATUS[code as ErrorCode]).toBe(status);
    const { status: s, body } = toErrorBody(new AppError(code as ErrorCode));
    expect(s).toBe(status);
    expect(body.error.code).toBe(code);
    expect(body.error.message.bn.length).toBeGreaterThan(0);
    expect(body.error.message.en.length).toBeGreaterThan(0);
  });
  it("keeps custom message and details", () => {
    const { body } = toErrorBody(new AppError("CONFLICT", { bn: "ক", en: "x" }, { a: 1 }));
    expect(body.error).toEqual({ code: "CONFLICT", message: { bn: "ক", en: "x" }, details: { a: 1 } });
  });
  it("maps ZodError to 400 with details", () => {
    const r = z.object({ a: z.string() }).safeParse({});
    if (r.success) throw new Error("unreachable");
    const { status, body } = toErrorBody(r.error);
    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual([{ path: "a", message: expect.any(String) }]);
  });
  it("hides unknown errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = toErrorBody(new Error("db exploded"));
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("db exploded");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
