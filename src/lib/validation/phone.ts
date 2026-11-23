import { z } from "zod";
import { common } from "@/lib/i18n/common";

/** Strip spaces/dashes/parens; +880 / 880 prefix -> 0. */
export function normalizeBdPhone(raw: string): string {
  const s = raw.replace(/[\s\-()]/g, "");
  if (s.startsWith("+880")) return "0" + s.slice(4);
  if (s.startsWith("880")) return "0" + s.slice(3);
  return s;
}

export const bdPhoneSchema = z
  .string()
  .transform(normalizeBdPhone)
  .pipe(z.string().regex(/^01[3-9]\d{8}$/, { message: common.phoneInvalid.en }));
