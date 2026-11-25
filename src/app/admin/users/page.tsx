import { Suspense } from "react";
import { UserList, type HospitalOption, type UserPageData } from "@/components/admin/UserList";
import { listHospitals } from "@/server/admin/hospitals";
import { requireAdminPage } from "@/server/admin/page-guard";
import { listUsers } from "@/server/admin/users";

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />}>
      <UsersBody />
    </Suspense>
  );
}

async function UsersBody() {
  const { user, lang } = await requireAdminPage("/admin/users");
  const [list, hospitalList] = await Promise.all([
    listUsers(user, { page: 1, pageSize: 20 }),
    listHospitals(user, { archived: false, sort: "nameEn", order: "asc", page: 1, pageSize: 100 }),
  ]);

  const initial: UserPageData = {
    page: list.page,
    pageSize: list.pageSize,
    total: list.total,
    items: list.items.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })),
  };

  const hospitals: HospitalOption[] = hospitalList.items.map((h) => ({
    id: h.id,
    nameBn: h.nameBn,
    nameEn: h.nameEn,
  }));

  return <UserList lang={lang} initial={initial} hospitals={hospitals} />;
}
