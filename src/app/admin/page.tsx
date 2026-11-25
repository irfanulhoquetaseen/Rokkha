import { Suspense } from "react";
import { HospitalList, type HospitalPageData, type ResourceTypeOption } from "@/components/admin/HospitalList";
import { listHospitals } from "@/server/admin/hospitals";
import { requireAdminPage } from "@/server/admin/page-guard";
import { prisma } from "@/server/db";

export default function AdminHospitalsPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />}>
      <HospitalsBody />
    </Suspense>
  );
}

async function HospitalsBody() {
  const { user, lang } = await requireAdminPage("/admin");
  const [list, types] = await Promise.all([
    listHospitals(user, { archived: false, sort: "nameEn", order: "asc", page: 1, pageSize: 20 }),
    prisma.resourceType.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, nameBn: true, nameEn: true, kind: true },
    }),
  ]);

  const initial: HospitalPageData = {
    page: list.page,
    pageSize: list.pageSize,
    total: list.total,
    items: list.items.map((h) => ({
      ...h,
      archivedAt: h.archivedAt ? h.archivedAt.toISOString() : null,
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
    })),
  };

  return <HospitalList lang={lang} initial={initial} resourceTypes={types as ResourceTypeOption[]} />;
}
