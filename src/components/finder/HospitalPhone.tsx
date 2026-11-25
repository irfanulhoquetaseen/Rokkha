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
        className={`inline-flex items-center justify-center border-[var(--border-strong)] bg-[var(--bg-surface)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] ${size}`}
      >
        <span aria-hidden="true">📞</span>
        {!compact && <>{finder.callHospital[lang]} · </>}
        <span dir="ltr">{phone}</span>
      </a>
    );
  }

  return (
    <div data-testid="demo-phone" className="flex flex-wrap items-center gap-2 self-start text-sm">
      <span dir="ltr" className="font-semibold text-[var(--text-primary)]">{phone}</span>
      <span className="rounded-md bg-[var(--text-primary)] px-2 py-0.5 text-xs font-bold text-[var(--bg-surface)]">
        {finder.demoBadge.en}
      </span>
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={finder.demoCallDisabled.en}
        className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-subtle)] px-3 text-sm font-semibold text-[var(--text-muted)]"
      >
        <span aria-hidden="true">📞</span>
        {finder.demoCallDisabled[lang]}
      </button>
    </div>
  );
}
