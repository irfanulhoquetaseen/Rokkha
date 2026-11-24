import type { Lang } from "@/lib/i18n";
import { finder } from "@/lib/i18n/finder";

/**
 * Hospital phone. Seeded demo hospitals are fictional, so they show the number but never a `tel:` link:
 * a panicking user must not dial a real person's phone by mistake.
 */
export function HospitalPhone({
  phone,
  isDemo,
  name,
  lang,
  compact = false,
}: {
  phone: string;
  isDemo: boolean;
  name: string;
  lang: Lang;
  compact?: boolean;
}) {
  const size = compact
    ? "min-h-11 shrink-0 gap-2 self-start rounded-lg border border-zinc-400 px-3 sm:self-auto"
    : "min-h-11 gap-2 self-start rounded-lg border-2 border-zinc-800 px-4 dark:border-zinc-300";

  if (!isDemo) {
    return (
      <a
        href={`tel:${phone}`}
        aria-label={`${finder.callHospital[lang]}: ${name}, ${phone}`}
        className={`inline-flex items-center justify-center text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 ${size}`}
      >
        <span aria-hidden="true">📞</span>
        {!compact && <>{finder.callHospital[lang]} · </>}
        <span dir="ltr">{phone}</span>
      </a>
    );
  }

  return (
    <div data-testid="demo-phone" className="flex flex-wrap items-center gap-2 self-start text-sm">
      <span dir="ltr" className="font-semibold">{phone}</span>
      <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-bold text-white dark:bg-zinc-200 dark:text-zinc-900">
        {finder.demoBadge.en}
      </span>
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={finder.demoCallDisabled.en}
        className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
      >
        <span aria-hidden="true">📞</span>
        {finder.demoCallDisabled[lang]}
      </button>
    </div>
  );
}
