import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { fmtNum } from "@/components/finder/format";
import { StatusBadge } from "@/components/reservations/StatusBadge";
import { AppError } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { reservations as t } from "@/lib/i18n/reservations";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLang } from "@/server/i18n/lang";
import { listMyReservations, type Page } from "@/server/reservations/queries";
import type { ReservationView } from "@/server/reservations/view";

export const metadata: Metadata = { title: "My reservations — Rokkha" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function MyReservationsPage({ searchParams }: PageProps<"/reservations">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4">
      <Suspense fallback={<ListSkeleton />}>
        <ListBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

const pageLink =
  "inline-flex min-h-11 items-center rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 font-semibold text-[var(--text-primary)] shadow-2xs hover:bg-[var(--bg-subtle)]";

async function ListBody({ searchParams }: { searchParams: SearchParams }) {
  const [sp, user, lang] = await Promise.all([searchParams, getCurrentUser(), getLang()]);
  if (!user) redirect("/login?next=%2Freservations");
  const raw = Array.isArray(sp.page) ? sp.page[0] : sp.page;

  let data: Page<ReservationView>;
  try {
    data = await listMyReservations(user, raw);
  } catch (e) {
    // A malformed ?page= is not worth an error page: show the first page.
    if (e instanceof AppError && e.code === "VALIDATION_ERROR") data = await listMyReservations(user, "1");
    else throw e;
  }
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <>
      <h1 className="text-2xl font-bold">{t.myReservations[lang]}</h1>
      {data.items.length === 0 ? (
        <div data-testid="no-reservations" className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <p>{t.noReservations[lang]}</p>
          <Link href="/find" className={`${pageLink} self-start`}>{t.findHospital[lang]}</Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.items.map((r) => (
            <Row key={r.id} r={r} lang={lang} />
          ))}
        </ul>
      )}
      {lastPage > 1 && (
        <nav aria-label={t.page[lang]} className="flex items-center justify-between gap-2 text-sm">
          {data.page > 1 ? (
            <Link href={data.page === 2 ? "/reservations" : `/reservations?page=${data.page - 1}`} className={pageLink}>
              ← {t.prev[lang]}
            </Link>
          ) : (
            <span />
          )}
          <span>
            {t.page[lang]} {fmtNum(data.page, lang)} / {fmtNum(lastPage, lang)}
          </span>
          {data.page < lastPage ? (
            <Link href={`/reservations?page=${data.page + 1}`} className={pageLink}>
              {t.next[lang]} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}

const dateFmt = { bn: new Intl.DateTimeFormat("bn-BD", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }),
  en: new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka" }) };

function Row({ r, lang }: { r: ReservationView; lang: Lang }) {
  return (
    <li data-testid="reservation-row" data-id={r.id}>
      <Link
        href={`/reservations/${encodeURIComponent(r.id)}`}
        className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-xs transition-colors hover:border-[var(--brand-primary)] hover:bg-[var(--bg-brand-tint)]"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-bold break-words">{lang === "bn" ? r.hospital.nameBn : r.hospital.nameEn}</p>
          <p className="text-sm break-words">{lang === "bn" ? r.resource.nameBn : r.resource.nameEn}</p>
          <p className="text-xs text-[var(--text-muted)]">
            {t.createdAt[lang]}: {dateFmt[lang].format(r.createdAt)}
          </p>
        </div>
        <StatusBadge status={r.status} lang={lang} />
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 motion-safe:animate-pulse" aria-hidden="true">
      <div className="h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-24 rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      ))}
    </div>
  );
}
