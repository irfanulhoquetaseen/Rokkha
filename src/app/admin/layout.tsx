import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { admin } from "@/lib/i18n/admin";
import { requireAdminPage } from "@/server/admin/page-guard";

export const metadata: Metadata = { title: "Admin — JibonSetu" };

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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <h1 className="text-lg font-bold text-purple-800 dark:text-purple-300">{admin.title[lang]}</h1>
        <nav className="flex flex-wrap items-center gap-1" aria-label={admin.navLabel[lang]}>
          <Link href="/admin" className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {admin.hospitals[lang]}
          </Link>
          <Link href="/admin/users" className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {admin.users[lang]}
          </Link>
          <Link href="/admin/audit" className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {admin.auditLog[lang]}
          </Link>
          <Link href="/admin/analytics" className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800">
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
