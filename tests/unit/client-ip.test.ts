import { describe, expect, it } from "vitest";
import { clientIp } from "@/server/http/api-handler";

const h = (o: Record<string, string>) => new Headers(o);
describe("clientIp", () => {
  it("uses right-most hop", () => expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("10.0.0.1"));
  it("ignores spoofed left entries", () => expect(clientIp(h({ "x-forwarded-for": "evil, 5.6.7.8" }))).toBe("5.6.7.8"));
  it("garbage only -> null", () => expect(clientIp(h({ "x-forwarded-for": "evil, nope" }))).toBeNull());
  it("falls back to x-real-ip", () => expect(clientIp(h({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9"));
  it("invalid x-real-ip -> null", () => expect(clientIp(h({ "x-real-ip": "zzz" }))).toBeNull());
  it("accepts IPv6", () => expect(clientIp(h({ "x-forwarded-for": "1.1.1.1, 2001:db8::1" }))).toBe("2001:db8::1"));
});
