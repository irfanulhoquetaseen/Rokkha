"use client"; // Error boundaries must be Client Components.

// Only shown when the root layout itself fails. It replaces the layout, so it brings its own
// <html>/<body> and inline styles (globals.css is not loaded here). Kept minimal on purpose.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  const button = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 48, padding: "0 20px",
    borderRadius: 8, fontSize: 18, fontWeight: 700, textDecoration: "none", cursor: "pointer",
  } as const;
  return (
    <html lang="bn">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "48px 16px" }}>
        <title>Rokkha</title>
        <h1 style={{ fontSize: 22 }}>কিছু একটা সমস্যা হয়েছে</h1>
        <p lang="en">Something went wrong. Please try again.</p>
        <p>
          <a href="tel:999" style={{ ...button, background: "#C8102E", color: "#fff" }}>
            ৯৯৯-এ কল করুন / Call 999
          </a>
        </p>
        <p>
          <button type="button" onClick={() => retry()} style={{ ...button, border: "1px solid #a1a1aa", background: "transparent", color: "inherit" }}>
            আবার চেষ্টা করুন / Try again
          </button>
        </p>
      </body>
    </html>
  );
}
