export function isSameOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  if (!origin) return false;
  const expected = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!expected) return false;
  try {
    return new URL(origin).host === expected;
  } catch {
    return false;
  }
}
