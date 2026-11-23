/**
 * Post-login redirect target from an untrusted `?next=` value: only same-site relative paths.
 * Rejects absolute / protocol-relative URLs ("//evil", "/\evil") and whitespace/control chars
 * (browsers strip tabs/newlines, so "/\t/evil" would become "//evil").
 */
export function safeNextPath(raw: string | string[] | undefined | null): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || v.length > 512 || !v.startsWith("/")) return "/";
  if (/[\s\\\u0000-\u001f\u007f]/.test(v) || v.startsWith("//")) return "/";
  try {
    const u = new URL(v, "http://jibonsetu.invalid");
    if (u.origin !== "http://jibonsetu.invalid") return "/";
    // Validate the NORMALIZED result: dot segments ("/.//x", "/a/..//x") collapse to "//x",
    // which the browser would treat as a protocol-relative (off-site) URL.
    const out = u.pathname + u.search + u.hash;
    return out.startsWith("/") && !out.startsWith("//") && !out.startsWith("/\\") ? out : "/";
  } catch {
    return "/";
  }
}
