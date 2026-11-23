import { describe, expect, it } from "vitest";
import { assertTestDatabaseUrl } from "../support/test-db-guard";

describe("assertTestDatabaseUrl", () => {
  it("accepts a URL whose database name ends in _test", () => {
    const url = "postgresql://u:p@host:5432/jibonsetu_test";
    expect(assertTestDatabaseUrl(url)).toBe(url);
  });

  it("accepts _test with query params", () => {
    const url = "postgresql://u:p@host:5432/jibonsetu_test?sslmode=require";
    expect(assertTestDatabaseUrl(url)).toBe(url);
  });

  it("refuses when the URL is missing", () => {
    expect(() => assertTestDatabaseUrl(undefined)).toThrow(/DATABASE_URL_TEST is not set/);
  });

  it("refuses the production database name", () => {
    expect(() => assertTestDatabaseUrl("postgresql://u:p@host:5432/railway")).toThrow(/must end in "_test"/);
  });

  it("refuses names that merely contain _test", () => {
    expect(() => assertTestDatabaseUrl("postgresql://u:p@host:5432/my_test_prod")).toThrow(/must end in "_test"/);
  });

  it("refuses unparseable URLs", () => {
    expect(() => assertTestDatabaseUrl("not a url")).toThrow();
  });
});
