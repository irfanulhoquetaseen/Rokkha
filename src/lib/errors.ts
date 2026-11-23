import { ZodError } from "zod";

export type ErrorCode =
  | "VALIDATION_ERROR" | "UNAUTHENTICATED" | "NOT_FOUND" | "CONFLICT" | "SOLD_OUT"
  | "INVALID_TRANSITION" | "LIMIT_REACHED" | "RATE_LIMITED" | "INTERNAL";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400, UNAUTHENTICATED: 401, NOT_FOUND: 404, CONFLICT: 409, SOLD_OUT: 409,
  INVALID_TRANSITION: 409, LIMIT_REACHED: 409, RATE_LIMITED: 429, INTERNAL: 500,
};

export type Bilingual = { bn: string; en: string };

const DEFAULT_MESSAGES: Record<ErrorCode, Bilingual> = {
  VALIDATION_ERROR: { bn: "প্রদত্ত তথ্য সঠিক নয়", en: "The submitted data is invalid" },
  UNAUTHENTICATED: { bn: "অনুগ্রহ করে লগইন করুন", en: "Please log in" },
  NOT_FOUND: { bn: "খুঁজে পাওয়া যায়নি", en: "Not found" },
  CONFLICT: { bn: "তথ্যটি ইতিমধ্যে পরিবর্তিত হয়েছে", en: "The data conflicts with its current state" },
  SOLD_OUT: { bn: "এই মুহূর্তে পাওয়া যাচ্ছে না", en: "Not available right now" },
  INVALID_TRANSITION: { bn: "এই অবস্থা পরিবর্তন করা যাবে না", en: "This status change is not allowed" },
  LIMIT_REACHED: { bn: "আপনার সীমা শেষ হয়েছে", en: "You have reached the limit" },
  RATE_LIMITED: { bn: "অনেক বেশি চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন", en: "Too many attempts, please try again later" },
  INTERNAL: { bn: "কিছু ভুল হয়েছে, আবার চেষ্টা করুন", en: "Something went wrong, please try again" },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly bilingual: Bilingual;
  readonly details?: unknown;
  constructor(code: ErrorCode, message?: Bilingual, details?: unknown) {
    const b = message ?? DEFAULT_MESSAGES[code];
    super(b.en);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.bilingual = b;
    this.details = details;
  }
}

export type ErrorBody = { error: { code: ErrorCode; message: Bilingual; details?: unknown } };

export function toErrorBody(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    const error: ErrorBody["error"] = { code: err.code, message: err.bilingual };
    if (err.details !== undefined) error.details = err.details;
    return { status: err.status, body: { error } };
  }
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return toErrorBody(new AppError("VALIDATION_ERROR", undefined, details));
  }
  console.error("Unhandled error:", err);
  return toErrorBody(new AppError("INTERNAL"));
}
