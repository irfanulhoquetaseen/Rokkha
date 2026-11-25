import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("parses quoted commas, escaped quotes, CRLF, and UTF-8 BOM", () => {
    const csv = '\uFEFFslug,nameEn,address\r\nh1,"Care, ""General""","Road 1, Dhaka"\n';
    expect(parseCsv(csv)).toEqual([
      ["slug", "nameEn", "address"],
      ["h1", 'Care, "General"', "Road 1, Dhaka"],
    ]);
  });

  it("rejects unterminated quotes", () => {
    expect(() => parseCsv('a,b\n"unclosed,2')).toThrow();
  });
});
