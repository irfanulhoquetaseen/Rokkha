import type { Lang } from "@/lib/i18n";
import { finder } from "@/lib/i18n/finder";

const nf = { bn: new Intl.NumberFormat("bn-BD"), en: new Intl.NumberFormat("en-US") };

export function fmtNum(n: number, lang: Lang): string {
  return nf[lang].format(n);
}

export function fmtKm(km: number | null, lang: Lang): string {
  return km === null ? "—" : `${fmtNum(km, lang)} ${finder.km[lang]}`;
}

/** "5 min ago" / "2 h ago" relative to the request time. */
export function fmtAge(at: Date | null, nowMs: number, lang: Lang): string {
  if (!at) return finder.never[lang];
  const min = Math.max(0, Math.floor((nowMs - at.getTime()) / 60_000));
  if (min < 1) return finder.justNow[lang];
  if (min < 120) return `${fmtNum(min, lang)} ${finder.minutesAgo[lang]}`;
  return `${fmtNum(Math.floor(min / 60), lang)} ${finder.hoursAgo[lang]}`;
}

/**
 * Request time for "x min ago" labels. Server Components render once per request (no re-renders),
 * so reading the clock here is stable; it lives outside the component to keep render code pure.
 */
export function requestTimeMs(): number {
  return Date.now();
}
