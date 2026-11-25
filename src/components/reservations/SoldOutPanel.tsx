"use client";

import { fmtKm, fmtNum } from "@/components/finder/format";
import { reservations as t } from "@/lib/i18n/reservations";
import { HoldButton, type HoldButtonProps } from "./HoldButton";

const DEMO_TAG = { bn: "ডেমো", en: "Demo" } as const;

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
    <div data-testid="sold-out-panel" role="alert" className="flex flex-col gap-3 rounded-xl border-2 border-[var(--emergency)] bg-[var(--bg-surface)] p-4 shadow-xs">
      <p className="font-semibold text-[var(--emergency-text)]">❌ {t.soldOut[lang]}</p>
      {alternatives.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">{t.noAlternatives[lang]}</p>
      ) : (
        <>
          <p className="text-sm font-bold">{t.alternativesTitle[lang]}</p>
          <ul className="flex flex-col gap-3">
            {alternatives.map((a) => (
              <li key={a.hospitalId} data-testid="alternative" className="flex flex-col gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-subtle)] p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold break-words">{lang === "bn" ? a.nameBn : a.nameEn}</p>
                  {a.isDemo && (
                    <span
                      data-testid="hospital-demo-tag"
                      className="rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--warning-text)]"
                    >
                      {DEMO_TAG[lang]}
                    </span>
                  )}
                </div>
                <p className="text-sm text-[var(--text-muted)]">
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
