"use client";

import type { Lang } from "@/lib/i18n";
import { admin } from "@/lib/i18n/admin";
import { reservations } from "@/lib/i18n/reservations";

type PerDay = { day: string; conditionCode: string | null; conditionBn: string | null; conditionEn: string | null; condition: string; count: number };
type SoldOut = { code: string; resourceBn: string; resourceEn: string; resourceType: string; district: string; count: number };
type Outcome = { status: "ARRIVED" | "EXPIRED" | "CANCELLED" | "REJECTED"; count: number; rate: number };
type Stale = { id: string; nameBn: string; nameEn: string; district: string; latestUpdate: string; minutesAgo: number };

export type AnalyticsData = {
  perDay: PerDay[];
  soldOut: SoldOut[];
  outcomes: Outcome[];
  totalResolved: number;
  totalReservations: number;
  avgMinutes: number | null;
  stale: Stale[];
};

const OUTCOME_COLORS: Record<Outcome["status"], string> = {
  ARRIVED: "#16a34a",
  EXPIRED: "#d97706",
  CANCELLED: "#71717a",
  REJECTED: "#dc2626",
};

function SvgBar({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const pct = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <svg width="100%" height="14" viewBox="0 0 100 14" preserveAspectRatio="none" role="img" aria-label={label} className="block rounded bg-zinc-100 dark:bg-zinc-800">
      <title>{label}</title>
      <rect x="0" y="0" width={pct} height="14" rx="3" fill={color} />
    </svg>
  );
}

export function AnalyticsDashboard({ lang, initial }: { lang: Lang; initial: AnalyticsData }) {
  const maxPerDay = Math.max(...initial.perDay.map((x) => x.count), 1);
  const maxSoldOut = Math.max(...initial.soldOut.map((x) => x.count), 1);

  return (
    <div className="flex flex-col gap-6" data-testid="admin-analytics">
      <h2 className="text-xl font-bold">{admin.analytics[lang]}</h2>

      {/* Reservations per condition per day (last 7 days) */}
      <section aria-labelledby="an-perday">
        <h3 id="an-perday" className="mb-2 text-lg font-semibold">{admin.reservationsPerDay[lang]}</h3>
        {initial.perDay.length === 0 ? (
          <p className="rounded-md bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{admin.noData[lang]}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-700">
                <tr>
                  <th className="px-3 py-2">{admin.date[lang]}</th>
                  <th className="px-3 py-2">{admin.condition[lang]}</th>
                  <th className="px-3 py-2">{admin.count[lang]}</th>
                  <th className="w-40 px-3 py-2" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {initial.perDay.map((r, i) => {
                  const condLabel = (lang === "bn" ? r.conditionBn : r.conditionEn) ?? admin.unknownCondition[lang];
                  return (
                    <tr key={`${r.day}-${r.conditionCode ?? i}`} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="whitespace-nowrap px-3 py-2">{r.day}</td>
                      <td className="px-3 py-2">{condLabel}</td>
                      <td className="px-3 py-2 tabular-nums">{r.count}</td>
                      <td className="px-3 py-2">
                        <SvgBar value={r.count} max={maxPerDay} color="#7e22ce" label={`${condLabel}: ${r.count}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Sold-out events per resource type and district */}
      <section aria-labelledby="an-soldout">
        <h3 id="an-soldout" className="mb-2 text-lg font-semibold">{admin.soldOutEvents[lang]}</h3>
        {initial.soldOut.length === 0 ? (
          <p className="rounded-md bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{admin.noData[lang]}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-700">
                <tr>
                  <th className="px-3 py-2">{admin.resourceType[lang]}</th>
                  <th className="px-3 py-2">{admin.district[lang]}</th>
                  <th className="px-3 py-2">{admin.count[lang]}</th>
                  <th className="w-40 px-3 py-2" aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {initial.soldOut.map((r) => {
                  const resLabel = lang === "bn" ? r.resourceBn : r.resourceEn;
                  return (
                    <tr key={`${r.code}-${r.district}`} className="border-b border-zinc-100 dark:border-zinc-800">
                      <td className="px-3 py-2">{resLabel}</td>
                      <td className="px-3 py-2">{r.district}</td>
                      <td className="px-3 py-2 tabular-nums">{r.count}</td>
                      <td className="px-3 py-2">
                        <SvgBar value={r.count} max={maxSoldOut} color="#dc2626" label={`${resLabel} (${r.district}): ${r.count}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Hold outcome rates */}
      <section aria-labelledby="an-outcomes">
        <h3 id="an-outcomes" className="mb-2 text-lg font-semibold">{admin.holdOutcomes[lang]}</h3>
        {initial.totalResolved === 0 ? (
          <p className="rounded-md bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{admin.noData[lang]}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {initial.outcomes.map((o) => {
              const pct = Math.round(o.rate * 100);
              const label = reservations[`status_${o.status}`][lang];
              return (
                <div key={o.status} className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{label}</span>
                    <span className="text-xs text-zinc-500 tabular-nums">{pct}%</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{o.count}</p>
                  <SvgBar value={pct} max={100} color={OUTCOME_COLORS[o.status]} label={`${label}: ${o.count} (${pct}%)`} />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Average hold-to-arrival minutes */}
      <section aria-labelledby="an-avg">
        <h3 id="an-avg" className="mb-2 text-lg font-semibold">{admin.avgHoldToArrival[lang]}</h3>
        {initial.avgMinutes !== null ? (
          <p className="text-2xl font-bold tabular-nums">
            {initial.avgMinutes.toFixed(1)}{" "}
            <span className="text-sm font-normal text-zinc-500">{admin.minutes[lang]}</span>
          </p>
        ) : (
          <p className="rounded-md bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{admin.noData[lang]}</p>
        )}
      </section>

      {/* Stale hospitals (> 30 min) */}
      <section aria-labelledby="an-stale">
        <h3 id="an-stale" className="mb-2 text-lg font-semibold">{admin.staleHospitals[lang]}</h3>
        {initial.stale.length === 0 ? (
          <p className="rounded-md bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{admin.noData[lang]}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-700">
                <tr>
                  <th className="px-3 py-2">{admin.nameEn[lang]}</th>
                  <th className="px-3 py-2">{admin.district[lang]}</th>
                  <th className="px-3 py-2">{admin.minutesAgo[lang]}</th>
                </tr>
              </thead>
              <tbody>
                {initial.stale.map((s) => (
                  <tr key={s.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="px-3 py-2 font-medium">{lang === "bn" ? s.nameBn : s.nameEn}</td>
                    <td className="px-3 py-2">{s.district}</td>
                    <td className="px-3 py-2 text-amber-700 tabular-nums dark:text-amber-400">{s.minutesAgo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
