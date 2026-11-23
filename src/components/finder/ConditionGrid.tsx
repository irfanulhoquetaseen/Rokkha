import Link from "next/link";
import type { Lang } from "@/lib/i18n";

export type ConditionOption = { code: string; nameBn: string; nameEn: string };

/** The 8 emergencies as large tap targets, each linking to its Finder results. */
export function ConditionGrid({ conditions, lang }: { conditions: ConditionOption[]; lang: Lang }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {conditions.map((c) => (
        <li key={c.code} className="min-w-0">
          <Link
            href={`/find?condition=${encodeURIComponent(c.code)}`}
            className="flex h-full min-h-20 items-center justify-center rounded-xl border-2 border-red-200 bg-red-50 p-3 text-center text-base font-semibold leading-snug break-words text-red-900 hover:border-red-500 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
          >
            {lang === "bn" ? c.nameBn : c.nameEn}
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
        <div key={i} className="min-h-20 rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      ))}
    </div>
  );
}
