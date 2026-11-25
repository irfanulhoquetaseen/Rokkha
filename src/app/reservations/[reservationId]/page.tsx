import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Call999Button } from "@/components/Call999Button";
import { HospitalPhone } from "@/components/finder/HospitalPhone";
import { Tracker, type TrackerReservation } from "@/components/reservations/Tracker";
import { AppError } from "@/lib/errors";
import { finder } from "@/lib/i18n/finder";
import { reservations as t } from "@/lib/i18n/reservations";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLang } from "@/server/i18n/lang";
import { getConditionSummary, getMyReservation } from "@/server/reservations/queries";
import type { ReservationView } from "@/server/reservations/view";

export const metadata: Metadata = { title: "Reservation — Rokkha" };

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
      <div className="flex flex-col gap-1 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-xs">
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--brand-primary-text)]">{t.trackerTitle[lang]}</p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-extrabold break-words">{hospitalName}</h1>
          {view.hospital.isDemo && (
            <span
              data-testid="hospital-demo-tag"
              className="rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--warning-text)]"
            >
              {finder.demoTag[lang]}
            </span>
          )}
        </div>
        {condition && (
          <p className="text-sm text-[var(--text-muted)]">{lang === "bn" ? condition.nameBn : condition.nameEn}</p>
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
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--brand-primary)] bg-[var(--bg-brand-tint)] px-4 font-semibold text-[var(--brand-primary-text)] hover:opacity-90"
          >
            🩹 {t.firstAidLink[lang]}
          </Link>
        )}
      </div>
      <Link href="/reservations" className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-[var(--brand-primary-text)] underline">
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
