import type { Metadata, Viewport } from "next";
import { Noto_Sans_Bengali } from "next/font/google";
import { Suspense } from "react";
import { SiteHeader, SiteHeaderSkeleton } from "@/components/SiteHeader";
import "./globals.css";

const notoSansBengali = Noto_Sans_Bengali({
  subsets: ["bengali", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-rokkha-bn",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rokkha — The right hospital, right when it matters",
  description: "রক্ষা (Rokkha) — জরুরি মুহূর্তে, সঠিক হাসপাতাল। Find hospitals that can treat an emergency right now, hold the resource, and follow first aid.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Default theme is LIGHT; only apply `.dark` before first paint if the user explicitly saved "dark".
const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("rokkha-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="bn" suppressHydrationWarning className={`h-full antialiased ${notoSansBengali.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col bg-[var(--bg-page)] text-[var(--text-primary)]">
        <Suspense fallback={<SiteHeaderSkeleton />}>
          <SiteHeader />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
