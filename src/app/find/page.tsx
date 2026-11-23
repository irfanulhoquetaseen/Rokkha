import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Call999Button } from "@/components/Call999Button";
import { ConditionGrid } from "@/components/finder/ConditionGrid";
import { DirectoryList } from "@/components/finder/DirectoryList";
import { FilterBar } from "@/components/finder/FilterBar";
import { FinderSkeleton } from "@/components/finder/FinderSkeleton";
import { FirstAidCard } from "@/components/finder/FirstAidCard";
import { fmtNum, requestTimeMs } from "@/components/finder/format";
import { HospitalCard } from "@/components/finder/HospitalCard";
import { finderHref } from "@/components/finder/url";
import type { Bilingual } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { finder } from "@/lib/i18n/finder";
import { getLang } from "@/server/i18n/lang";
import { parseFinderParams, RADIUS_OPTIONS, type FinderParams } from "@/server/finder/params";
import { getFirstAidGuide, listConditions, searchHospitals, type FinderResult } from "@/server/finder/search";

export const metadata: Metadata = { title: "Find a hospital — JibonSetu" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function FindPage({ searchParams }: PageProps<"/find">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-4">
      <Suspense fallback={<FinderSkeleton />}>
        <FinderBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/** searchParams + lang cookie + DB are request-time, so this renders inside <Suspense>. */
async function FinderBody({ searchParams }: { searchParams: SearchParams }) {
  const [sp, lang] = await Promise.all([searchParams, getLang()]);
  // Live stock + "x min ago" use the request clock: never part of a prerendered/prefetched shell.
  await connection();
  const { params, notices } = parseFinderParams(sp);

  const [result, guide] = await Promise.all([
    searchHospitals(params),
    params.condition ? getFirstAidGuide(params.condition) : Promise.resolve(null),
  ]);
  const nowMs = requestTimeMs();

  const allNotices: Bilingual[] = [...notices];
  if (params.condition && !result.condition) allNotices.push(finder.unknownCondition);
  if (result.radiusIgnored) allNotices.push(finder.radiusIgnored);

  const noticeList = allNotices.length > 0 && (
    <ul className="flex flex-col gap-2">
      {allNotices.map((n, i) => (
        <li key={i} data-testid="notice" role="status" className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950">
          ⚠️ {n[lang]}
        </li>
      ))}
    </ul>
  );

  if (!result.condition) {
    const conditions = await listConditions();
    return (
      <>
        {noticeList}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{finder.pickCondition[lang]}</h1>
          <Call999Button lang={lang} />
        </div>
        <ConditionGrid conditions={conditions} lang={lang} />
        <DirectoryList entries={result.directory} lang={lang} />
      </>
    );
  }

  const conditionName = lang === "bn" ? result.condition.nameBn : result.condition.nameEn;

  return (
    <>
      {noticeList}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold break-words">{conditionName}</h1>
        <Call999Button lang={lang} />
      </div>
      {guide ? (
        <FirstAidCard guide={guide} lang={lang} variant="compact" />
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm">{finder.noFirstAid[lang]}</p>
          <Call999Button lang={lang} />
        </div>
      )}
      <FilterBar params={params} lang={lang} />
      <Results result={result} params={params} lang={lang} nowMs={nowMs} />
      <DirectoryList entries={result.directory} lang={lang} />
    </>
  );
}

function Results({ result, params, lang, nowMs }: { result: FinderResult; params: FinderParams; lang: Lang; nowMs: number }) {
  if (result.total === 0) return <EmptyState params={params} lang={lang} />;

  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  return (
    <section aria-labelledby="results-title" className="flex flex-col gap-3">
      <h2 id="results-title" className="text-lg font-bold">
        {finder.resultsFor[lang]}{" "}
        <span className="text-sm font-normal text-zinc-600 dark:text-zinc-400">
          ({fmtNum(result.total, lang)} {finder.resultsCount[lang]})
        </span>
      </h2>
      <ol className="flex flex-col gap-3">
        {result.results.map((item) => (
          <HospitalCard key={item.hospitalId} item={item} lang={lang} nowMs={nowMs} />
        ))}
      </ol>
      {lastPage > 1 && (
        <nav aria-label={finder.pageOf[lang]} className="flex items-center justify-between gap-2 text-sm">
          {result.page > 1 ? (
            <Link href={finderHref(params, { page: result.page - 1 === 1 ? undefined : result.page - 1 })} className={pageLink}>
              ← {finder.prev[lang]}
            </Link>
          ) : (
            <span />
          )}
          <span>
            {finder.pageOf[lang]} {fmtNum(result.page, lang)} / {fmtNum(lastPage, lang)}
          </span>
          {result.page < lastPage ? (
            <Link href={finderHref(params, { page: result.page + 1 })} className={pageLink}>
              {finder.next[lang]} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}

const pageLink =
  "inline-flex min-h-11 items-center rounded-lg border border-zinc-300 px-3 font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800";

function EmptyState({ params, lang }: { params: FinderParams; lang: Lang }) {
  const wider = params.radius !== undefined ? RADIUS_OPTIONS.find((r) => r > params.radius!) : undefined;
  return (
    <section data-testid="empty-state" className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="font-semibold">{finder.emptyTitle[lang]}</p>
      <div className="flex flex-wrap gap-2">
        {params.radius !== undefined && (
          <Link href={finderHref(params, { radius: wider, page: undefined })} className={pageLink}>
            {finder.widenRadius[lang]}
            {wider !== undefined && ` (${fmtNum(wider, lang)} ${finder.km[lang]})`}
          </Link>
        )}
        <Link href={`/find?condition=${encodeURIComponent(params.condition ?? "")}`} className={pageLink}>
          {finder.clearFilters[lang]}
        </Link>
      </div>
    </section>
  );
}
