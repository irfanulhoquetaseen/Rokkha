import { finder } from "@/lib/i18n/finder";
import type { Lang } from "@/lib/i18n";

/** Plain `tel:` link (no JS). `size="lg"` for the primary home action. */
export function Call999Button({ lang, size = "md" }: { lang: Lang; size?: "md" | "lg" }) {
  const sizing = size === "lg" ? "min-h-14 px-6 text-lg" : "min-h-11 px-4 text-base";
  return (
    <a
      href="tel:999"
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 font-bold text-white shadow-sm hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 ${sizing}`}
    >
      <span aria-hidden="true">📞</span>
      {finder.call999[lang]}
    </a>
  );
}
