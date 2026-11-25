import { finder } from "@/lib/i18n/finder";
import type { Lang } from "@/lib/i18n";

/** Plain `tel:` link (no JS). Reserved strictly for emergency action (`#C8102E`). */
export function Call999Button({ lang, size = "md" }: { lang: Lang; size?: "md" | "lg" }) {
  const sizing = size === "lg" ? "min-h-14 px-6 text-lg" : "min-h-11 px-4 text-base";
  return (
    <a
      href="tel:999"
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--emergency)] font-bold text-white shadow-xs transition-colors hover:bg-[var(--emergency-hover)] motion-reduce:transition-none ${sizing}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
      <span>{finder.call999[lang]}</span>
    </a>
  );
}
