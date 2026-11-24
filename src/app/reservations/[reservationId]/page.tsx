import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Call999Button } from "@/components/Call999Button";
import { HospitalPhone } from "@/components/finder/HospitalPhone";
import { Tracker, type TrackerReservation } from "@/components/reservations/Tracker";
import { AppError } from "@/lib/errors";
import { reservations as t } from "@/lib/i18n/reservations";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLang } from "@/server/i18n/lang";
import { getConditionSummary, getMyReservation } from "@/server/reservations/queries";
import type { ReservationView } from "@/server/reservations/view";

export const metadata: Metadata = { title: "Reservation — JibonSetu" };

type Params = Promise<{ reservationId: string }>;

export default function ReservationPage({ params }: PageProps<"/reservations/[reservationId]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4">
      <Suspense fallback={<TrackerSkeleton />}>
        <TrackerBody params={params} />
      </Suspense>
    </main>
  );
}

const toTracker = (v: ReservationView): TrackerReservation => ({
  id: v.id, status: v.status, quantity: v.quantity, expiresAt: v.expiresAt.toISOString(), rejectedReason: v.rejectedReason,
  version: v.version, resource: { nameBn: v.resource.nameBn, nameEn: v.resource.nameEn },
  events: v.events.map((e) => ({ toStatus: e.toStatus, fromStatus: e.fromStatus, createdAt: e.createdAt.toISOString(), note: e.note })),
});

/** Session + DB are request-time, so this renders inside <Suspense>. The proxy already answered foreign ids with a 404. */
async function TrackerBody({ params }: { params: Params }) {
  const [{ reservationId }, user, lang] = await Promise.all([params, getCurrentUser(), getLang()]);
  if (!user) redirect(`/login?next=${encodeURIComponent(`/reservations/${reservationId}`)}`);

  let view: ReservationView;
  try {
    view = await getMyReservation(user, reservationId);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const condition = await getConditionSummary(view.conditionId);
  const hospitalName = lang === "bn" ? view.hospital.nameBn : view.hospital.nameEn;

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">{t.trackerTitle[lang]}</p>
        <h1 className="text-2xl font-bold break-words">{hospitalName}</h1>
        {condition && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{lang === "bn" ? condition.nameBn : condition.nameEn}</p>
        )}
      </div>
      <Tracker initial={toTracker(view)} serverNowMs={serverNow()} lang={lang} />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <HospitalPhone phone={view.hospital.phone} isDemo={view.hospital.isDemo} name={hospitalName} lang={lang} />
        <Call999Button lang={lang} />
        {condition && (
          <Link
            href={`/first-aid/${encodeURIComponent(condition.code)}`}
            data-testid="first-aid-link"
            className="inline-flex min-h-11 items-center justify-center rounded-lg border-2 border-green-700 px-4 font-semibold text-green-800 hover:bg-green-50 dark:text-green-300 dark:hover:bg-green-950"
          >
            🩹 {t.firstAidLink[lang]}
          </Link>
        )}
      </div>
      <Link href="/reservations" className="inline-flex min-h-11 items-center self-start text-sm font-semibold underline">
        ← {t.myReservations[lang]}
      </Link>
    </>
  );
}

/** Request time (read after the session, so it never ends up in a prerendered shell). */
function serverNow(): number {
  return Date.now();
}

function TrackerSkeleton() {
  return (
    <div className="flex flex-col gap-4 motion-safe:animate-pulse" aria-hidden="true">
      <div className="h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-8 w-64 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-20 rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-36 rounded-xl bg-amber-50 dark:bg-amber-950/30" />
      <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
