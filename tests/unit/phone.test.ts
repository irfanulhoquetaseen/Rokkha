import { describe, expect, it } from "vitest";
import { bdPhoneSchema, normalizeBdPhone } from "@/lib/validation/phone";

describe("phone", () => {
  it.each(["01711111111", "+8801711111111", "880 1711-111111"])("normalizes %s", (raw) => {
    expect(normalizeBdPhone(raw)).toBe("01711111111");
    expect(bdPhoneSchema.parse(raw)).toBe("01711111111");
  });
  it.each(["01211111111", "0171111111", "017111111111", "abc"])("rejects %s", (raw) => {
    expect(bdPhoneSchema.safeParse(raw).success).toBe(false);
  });
});
