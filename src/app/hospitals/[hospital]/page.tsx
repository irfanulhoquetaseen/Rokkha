import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Call999Button } from "@/components/Call999Button";
import { HospitalPhone } from "@/components/finder/HospitalPhone";
import { TypeBadges } from "@/components/finder/TypeBadges";
import { LiveStockTable, type LiveStockRow } from "@/components/hospital/LiveStockTable";
import { AppError } from "@/lib/errors";
import { finder } from "@/lib/i18n/finder";
import { realtime } from "@/lib/i18n/realtime";
import { getLang } from "@/server/i18n/lang";
import { getHospitalName, getHospitalPage, type HospitalPage } from "@/server/reservations/queries";

/** Request-time (params, lang cookie, DB): streams with the rest of the page, which is already dynamic. */
export async function generateMetadata({ params }: PageProps<"/hospitals/[hospital]">): Promise<Metadata> {
  const [{ hospital: key }, lang] = await Promise.all([params, getLang()]);
  const h = await getHospitalName(key);
  return { title: h ? `${lang === "bn" ? h.nameBn : h.nameEn} — Rokkha` : "Rokkha" };
}

type Params = Promise<{ hospital: string }>;

/** Public (no login): one hospital's live stock. The proxy already answered unknown hospitals with a real 404. */
export default function HospitalStockPage({ params }: PageProps<"/hospitals/[hospital]">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-4">
      <Suspense fallback={<HospitalSkeleton />}>
        <HospitalBody params={params} />
      </Suspense>
    </main>
  );
}

/** Params + lang cookie + live DB stock are request-time, so this renders inside <Suspense>. */
async function HospitalBody({ params }: { params: Params }) {
  const [{ hospital: key }, lang] = await Promise.all([params, getLang()]);
  await connection();
  let page: HospitalPage;
  try {
    page = await getHospitalPage(key);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { stock, info, names } = page;
  const h = stock.hospital;
  const name = lang === "bn" ? h.nameBn : h.nameEn;
  const rows: LiveStockRow[] = stock.resources.map((r) => ({
    id: r.id, code: r.code, kind: r.kind, available: r.available, total: r.total, isAvailable: r.isAvailable,
    version: r.version, updatedAt: r.updatedAt.toISOString(),
    nameBn: names[r.code]?.nameBn ?? r.code, nameEn: names[r.code]?.nameEn ?? r.code,
  }));

  return (
    <>
      <section className="flex flex-col gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-xs">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold break-words">{name}</h1>
            {h.isDemo && (
              <span
                data-testid="hospital-demo-tag"
                className="rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--warning-text)]"
              >
                {finder.demoTag[lang]}
              </span>
            )}
          </div>
          <p className="text-sm break-words text-[var(--text-muted)]">{info.address}</p>
          <TypeBadges type={info.type} freeService={info.freeService} lang={lang} />
        </div>
        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:items-center">
          <HospitalPhone phone={info.phone} isDemo={h.isDemo} name={name} lang={lang} />
          <Call999Button lang={lang} />
        </div>
      </section>

      <section aria-labelledby="stock-title" className="flex flex-col gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-xs">
        <h2 id="stock-title" className="text-lg font-bold">{realtime.stockTitle[lang]}</h2>
        {h.liveDataEnabled ? (
          <>
            <p className="text-sm text-[var(--text-muted)]">{realtime.liveNote[lang]}</p>
            <LiveStockTable hospitalId={h.id} initial={rows} lang={lang} />
          </>
        ) : (
          <p data-testid="no-live-data" role="status" className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3.5 py-2.5 text-sm font-medium text-[var(--warning-text)]">
            ⚠️ {realtime.noLiveData[lang]}
          </p>
        )}
      </section>

      <Link href="/find" className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-[var(--brand-primary-text)] underline">
        ← {realtime.findHospital[lang]}
      </Link>
    </>
  );
}

function HospitalSkeleton() {
  return (
    <div className="flex flex-col gap-4 motion-safe:animate-pulse" aria-hidden="true">
      <div className="h-8 w-64 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-4 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-96 rounded-xl bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
