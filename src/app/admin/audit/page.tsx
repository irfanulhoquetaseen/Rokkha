import { Suspense } from "react";
import { AuditLogViewer, type AuditPageData } from "@/components/admin/AuditLogViewer";
import { distinctActions, listAuditLogs } from "@/server/admin/audit-viewer";
import { requireAdminPage } from "@/server/admin/page-guard";

export default function AdminAuditPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />}>
      <AuditBody />
    </Suspense>
  );
}

async function AuditBody() {
  const { user, lang } = await requireAdminPage("/admin/audit");
  const [list, actions] = await Promise.all([
    listAuditLogs(user, { page: 1, pageSize: 20 }),
    distinctActions(user),
  ]);

  const initial: AuditPageData = {
    page: list.page,
    pageSize: list.pageSize,
    total: list.total,
    items: list.items.map((i) => ({
      ...i,
      createdAt: i.createdAt.toISOString(),
    })),
  };

  return <AuditLogViewer lang={lang} initial={initial} actions={actions} />;
}
