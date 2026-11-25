import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { admin } from "@/lib/i18n/admin";
import { requireAdminPage } from "@/server/admin/page-guard";

export const metadata: Metadata = { title: "Admin — Rokkha" };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <AdminShell>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />}>
        <AdminGuard>{children}</AdminGuard>
      </Suspense>
    </AdminShell>
  );
}

async function AdminGuard({ children }: { children: React.ReactNode }) {
  const { lang } = await requireAdminPage("/admin");

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 shadow-xs">
        <h1 className="text-lg font-extrabold text-[var(--brand-primary-text)]">{admin.title[lang]}</h1>
        <nav className="flex flex-wrap items-center gap-1" aria-label={admin.navLabel[lang]}>
          <Link href="/admin" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold hover:bg-[var(--bg-subtle)]">
            {admin.hospitals[lang]}
          </Link>
          <Link href="/admin/users" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold hover:bg-[var(--bg-subtle)]">
            {admin.users[lang]}
          </Link>
          <Link href="/admin/audit" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold hover:bg-[var(--bg-subtle)]">
            {admin.auditLog[lang]}
          </Link>
          <Link href="/admin/analytics" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold hover:bg-[var(--bg-subtle)]">
            {admin.analytics[lang]}
          </Link>
        </nav>
      </div>
      {children}
    </>
  );
}

function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
      {children}
    </main>
  );
}
