import type { Lang } from "@/lib/i18n";
import { finder } from "@/lib/i18n/finder";

export function TypeBadges({ type, freeService, lang }: { type: "GOVT" | "PRIVATE"; freeService: boolean; lang: Lang }) {
  return (
    <span className="flex flex-wrap gap-1 text-xs font-semibold">
      <span
        data-testid="type-badge"
        className={`rounded px-2 py-0.5 ${type === "GOVT" ? "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-100" : "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100"}`}
      >
        {type === "GOVT" ? finder.govt[lang] : finder.private[lang]}
      </span>
      {freeService && (
        <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          {finder.free[lang]}
        </span>
      )}
    </span>
  );
}
