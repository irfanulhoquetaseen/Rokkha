import { describe, expect, it } from "vitest";
import { isSameOrigin } from "@/server/http/origin";

const h = (o: Record<string, string>) => new Headers(o);
describe("isSameOrigin", () => {
  it("same host", () => expect(isSameOrigin(h({ origin: "https://a.com", host: "a.com" }))).toBe(true));
  it("different host", () => expect(isSameOrigin(h({ origin: "https://evil.com", host: "a.com" }))).toBe(false));
  it("missing origin", () => expect(isSameOrigin(h({ host: "a.com" }))).toBe(false));
  it("prefers x-forwarded-host", () => {
    expect(isSameOrigin(h({ origin: "https://pub.com", host: "internal:3000", "x-forwarded-host": "pub.com" }))).toBe(true);
    expect(isSameOrigin(h({ origin: "https://internal:3000", host: "internal:3000", "x-forwarded-host": "pub.com" }))).toBe(false);
  });
  it("invalid origin", () => expect(isSameOrigin(h({ origin: "null", host: "a.com" }))).toBe(false));
});
