import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { finder } from "@/lib/i18n/finder";
import { realtime } from "@/lib/i18n/realtime";
import { reservations } from "@/lib/i18n/reservations";
import { HoldButton } from "@/components/reservations/HoldButton";
import type { FinderResult } from "@/server/finder/search";
import { STALE_AFTER_MS } from "@/server/matching";
import { fmtAge, fmtKm, fmtNum } from "./format";
import { HospitalPhone } from "./HospitalPhone";
import { TypeBadges } from "./TypeBadges";

type Item = FinderResult["results"][number];

/** Who is looking and what they searched for: shapes the hold buttons. */
export type HoldContext = {
  /** null = signed out; false = signed in but not a citizen (staff/admin cannot hold). */
  citizen: boolean | null;
  loginHref: string;
  conditionCode: string;
  bloodGroup?: string;
  origin?: { lat: number; lng: number };
};

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

export function HospitalCard({ item, lang, nowMs, hold }: { item: Item; lang: Lang; nowMs: number; hold: HoldContext }) {
  const h = item.hospital;
  const old =
    item.stale || (item.lastUpdatedAt !== null && nowMs - item.lastUpdatedAt.getTime() > STALE_AFTER_MS);

  return (
    <li
      data-testid="hospital-card"
      data-hospital-id={item.hospitalId}
      data-rank={item.rank}
      className={`flex flex-col gap-3 rounded-xl border p-4 ${item.suitable ? "border-zinc-200 dark:border-zinc-800" : "border-zinc-200 bg-zinc-50 opacity-90 dark:border-zinc-800 dark:bg-zinc-900/60"}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-bold text-white dark:bg-zinc-100 dark:text-zinc-900">
          {fmtNum(item.rank, lang)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold leading-snug break-words">
            <Link
              href={`/hospitals/${encodeURIComponent(h.slug)}`}
              prefetch={false}
              className="underline decoration-zinc-400 underline-offset-2 hover:decoration-current"
            >
              {lang === "bn" ? h.nameBn : h.nameEn}
            </Link>
          </h3>
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

      {item.holdable.length > 0 && hold.citizen !== false && (
        <div data-testid="hold-section" className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <p className="text-sm font-bold">{reservations.holdSectionTitle[lang]}</p>
          {/* Signed out sees one login link, so list every holdable count here (signed in: counts are on the buttons). */}
          {!hold.citizen && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">{realtime.availableNow[lang]}:</span>
              {item.holdable.map((r) => (
                <span key={r.code}>
                  {lang === "bn" ? r.nameBn : r.nameEn}{" "}
                  <span data-testid="hold-available" data-code={r.code} className="font-bold">
                    {fmtNum(r.available, lang)}
                  </span>
                </span>
              ))}
            </p>
          )}
          {/* Signed out: one login link per card (it returns here); signed in: one button per resource,
              sold-out ones included (disabled) so a live refresh never unmounts an open sold-out panel. */}
          {(hold.citizen ? item.holdable : item.holdable.filter((r) => !r.soldOut).slice(0, 1)).map((r) => (
            <HoldButton
              key={r.code}
              hospitalId={item.hospitalId}
              resource={{ code: r.code, nameBn: r.nameBn, nameEn: r.nameEn, available: r.available, soldOut: r.soldOut }}
              conditionCode={hold.conditionCode}
              bloodGroup={hold.bloodGroup}
              origin={hold.origin}
              signedIn={hold.citizen === true}
              loginHref={hold.loginHref}
              lang={lang}
            />
          ))}
        </div>
      )}
    </li>
  );
}
