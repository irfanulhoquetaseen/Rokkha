import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { SiteHeader, SiteHeaderSkeleton } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "JibonSetu — Emergency healthcare finder",
  description: "Find hospitals that can treat an emergency right now, hold the resource, and follow first aid.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="bn" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <div role="note" className="bg-amber-300 px-4 py-1 text-center text-xs font-semibold text-black">
          DEMO DATA — not real hospital availability
        </div>
        <Suspense fallback={<SiteHeaderSkeleton />}>
          <SiteHeader />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
