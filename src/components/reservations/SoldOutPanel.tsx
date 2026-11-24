"use client";

import { fmtKm, fmtNum } from "@/components/finder/format";
import { reservations as t } from "@/lib/i18n/reservations";
import { HoldButton, type HoldButtonProps } from "./HoldButton";

/** One next-best hospital from a SOLD_OUT response (`details.alternatives`). */
export type AlternativeItem = {
  hospitalId: string;
  slug: string;
  nameBn: string;
  nameEn: string;
  distanceKm: number | null;
  available: number;
  score: number | null;
  isDemo: boolean;
};

/**
 * Shown in place of a hold button whose stock ran out between page load and click. Each alternative
 * gets its own HoldButton (its own Idempotency-Key: holding elsewhere is a new action).
 */
export function SoldOutPanel(props: HoldButtonProps & { alternatives: AlternativeItem[] }) {
  const { alternatives, ...hold } = props;
  const { lang, resource } = hold;
  return (
    <div data-testid="sold-out-panel" role="alert" className="flex flex-col gap-3 rounded-lg border-2 border-red-700 p-3">
      <p className="font-semibold text-red-800 dark:text-red-300">❌ {t.soldOut[lang]}</p>
      {alternatives.length === 0 ? (
        <p className="text-sm">{t.noAlternatives[lang]}</p>
      ) : (
        <>
          <p className="text-sm font-bold">{t.alternativesTitle[lang]}</p>
          <ul className="flex flex-col gap-3">
            {alternatives.map((a) => (
              <li key={a.hospitalId} data-testid="alternative" className="flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <p className="font-semibold break-words">{lang === "bn" ? a.nameBn : a.nameEn}</p>
                <p className="text-sm text-zinc-700 dark:text-zinc-300">
                  {fmtKm(a.distanceKm, lang)} · {fmtNum(a.available, lang)} {t.available[lang]}
                </p>
                <HoldButton {...hold} hospitalId={a.hospitalId} resource={{ ...resource, available: a.available, soldOut: false }} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
