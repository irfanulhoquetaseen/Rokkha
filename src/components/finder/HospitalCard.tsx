import type { Lang } from "@/lib/i18n";
import { finder } from "@/lib/i18n/finder";
import type { FinderResult } from "@/server/finder/search";
import { STALE_AFTER_MS } from "@/server/matching";
import { fmtAge, fmtKm, fmtNum } from "./format";
import { HospitalPhone } from "./HospitalPhone";
import { TypeBadges } from "./TypeBadges";

type Item = FinderResult["results"][number];

const reasonColor = {
  ok: "text-green-800 dark:text-green-300",
  warn: "text-amber-800 dark:text-amber-300",
  missing: "text-red-800 dark:text-red-300",
} as const;

function scoreClass(score: number, suitable: boolean): string {
  if (!suitable) return "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";
  if (score >= 70) return "bg-green-700 text-white";
  return "bg-amber-500 text-black";
}

export function HospitalCard({ item, lang, nowMs }: { item: Item; lang: Lang; nowMs: number }) {
  const h = item.hospital;
  const old =
    item.stale || (item.lastUpdatedAt !== null && nowMs - item.lastUpdatedAt.getTime() > STALE_AFTER_MS);

  return (
    <li
      data-testid="hospital-card"
      data-rank={item.rank}
      className={`flex flex-col gap-3 rounded-xl border p-4 ${item.suitable ? "border-zinc-200 dark:border-zinc-800" : "border-zinc-200 bg-zinc-50 opacity-90 dark:border-zinc-800 dark:bg-zinc-900/60"}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
          {fmtNum(item.rank, lang)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold leading-snug break-words">{lang === "bn" ? h.nameBn : h.nameEn}</h3>
          <p className="text-sm break-words text-zinc-600 dark:text-zinc-400">{h.address}</p>
        </div>
        <span
          className={`shrink-0 rounded-lg px-2 py-1 text-center text-sm font-bold ${scoreClass(item.score, item.suitable)}`}
        >
          <span className="sr-only">{finder.score[lang]} </span>
          {fmtNum(item.score, lang)}
          <span className="sr-only">/{fmtNum(100, lang)}</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {!item.suitable && (
          <span className="rounded bg-red-700 px-2 py-0.5 text-xs font-bold text-white">{finder.notSuitable[lang]}</span>
        )}
        <TypeBadges type={h.type} freeService={h.freeService} lang={lang} />
        <span data-testid="distance">
          {finder.distance[lang]}: {fmtKm(item.distanceKm, lang)}
        </span>
        <span
          data-testid="last-updated"
          className={old ? "rounded bg-yellow-200 px-1 font-medium text-yellow-950" : "text-zinc-600 dark:text-zinc-400"}
          title={old ? finder.staleWarning[lang] : undefined}
        >
          {old && "⚠️ "}
          {finder.lastUpdated[lang]}: {fmtAge(item.lastUpdatedAt, nowMs, lang)}
        </span>
      </div>

      <ul className="flex flex-col gap-1 text-sm">
        {item.reasons.map((r, i) => (
          <li key={i} data-testid="reason" className={reasonColor[r.kind]}>
            {lang === "bn" ? r.bn : r.en}
          </li>
        ))}
      </ul>

      <HospitalPhone phone={h.phone} isDemo={h.isDemo} name={lang === "bn" ? h.nameBn : h.nameEn} lang={lang} />
    </li>
  );
}
