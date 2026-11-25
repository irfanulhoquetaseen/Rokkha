import Link from "next/link";
import { ConditionIcon } from "@/components/brand/ConditionIcon";
import type { Lang } from "@/lib/i18n";

export type ConditionOption = { code: string; nameBn: string; nameEn: string };

/** The 8 emergencies as clean icon cards with large tap targets, keeping accessible link text exact. */
export function ConditionGrid({ conditions, lang }: { conditions: ConditionOption[]; lang: Lang }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {conditions.map((c) => (
        <li key={c.code} className="min-w-0">
          <Link
            href={`/find?condition=${encodeURIComponent(c.code)}`}
            className="group flex h-full min-h-28 flex-col items-center justify-center gap-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-3.5 text-center text-base font-semibold leading-snug break-words text-[var(--text-primary)] shadow-xs transition-colors hover:border-[var(--brand-primary)] hover:bg-[var(--bg-brand-tint)] active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            <span
              aria-hidden="true"
              className="flex size-10 items-center justify-center rounded-lg bg-[var(--bg-brand-tint)] text-[var(--brand-primary-text)] transition-colors group-hover:bg-[var(--brand-primary)] group-hover:text-white motion-reduce:transition-none"
            >
              <ConditionIcon code={c.code} className="size-5" />
            </span>
            <span>{lang === "bn" ? c.nameBn : c.nameEn}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ConditionGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="min-h-28 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)]" />
      ))}
    </div>
  );
}
