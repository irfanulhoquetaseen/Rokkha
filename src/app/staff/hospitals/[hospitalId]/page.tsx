import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { ConsoleSkeleton } from "@/components/staff/ConsoleSkeleton";
import { ResourceConsole, type ConsoleRow } from "@/components/staff/ResourceConsole";
import { AppError } from "@/lib/errors";
import { staff } from "@/lib/i18n/staff";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLang } from "@/server/i18n/lang";
import { listHospitalResources, STALE_AFTER_MS, type ResourceView } from "@/server/resources/queries";

export const metadata: Metadata = { title: "Staff console — JibonSetu" };

type Params = Promise<{ hospitalId: string }>;

export default function HospitalConsolePage({ params }: PageProps<"/staff/hospitals/[hospitalId]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-6">
      <Suspense fallback={<ConsoleSkeleton />}>
        <ConsoleBody params={params} />
      </Suspense>
    </main>
  );
}

const toRow = (r: ResourceView): ConsoleRow => ({
  id: r.id, code: r.code, kind: r.kind, consumable: r.consumable, nameBn: r.nameBn, nameEn: r.nameEn,
  total: r.total, available: r.available, isAvailable: r.isAvailable, version: r.version, updatedAt: r.updatedAt.toISOString(),
});

async function ConsoleBody({ params }: { params: Params }) {
  const [{ hospitalId }, user, lang] = await Promise.all([params, getCurrentUser(), getLang()]);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/staff/hospitals/${hospitalId}`)}`);

  let data: Awaited<ReturnType<typeof listHospitalResources>>;
  try {
    // Server-side isolation: another hospital (or a non-staff user) gets NOT_FOUND, never a 403.
    data = await listHospitalResources(user, hospitalId);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">{staff.title[lang]}</p>
        <h1 className="text-2xl font-bold">{lang === "bn" ? data.hospital.nameBn : data.hospital.nameEn}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{staff.intro[lang]}</p>
      </div>
      <ResourceConsole
        lang={lang}
        initialRows={data.resources.map(toRow)}
        nowMs={serverNow()}
        staleAfterMs={STALE_AFTER_MS}
      />
    </div>
  );
}

/** Request time (after the session read, so it never ends up in a prerendered shell). */
function serverNow(): number {
  return Date.now();
}
