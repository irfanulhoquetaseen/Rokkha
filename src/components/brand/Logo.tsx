import type { Lang } from "@/lib/i18n";
import { auth } from "@/lib/i18n/auth";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M16 2.5C9.65 2.5 4.5 7.65 4.5 14C4.5 21.15 13.15 28.05 15.08 29.52C15.62 29.93 16.38 29.93 16.92 29.52C18.85 28.05 27.5 21.15 27.5 14C27.5 7.65 22.35 2.5 16 2.5Z" fill="#006A4E" />
      <circle cx="16" cy="13.6" r="8.7" fill="#FFFFFF" />
      <g className="rk-beat">
        <path d="M16 21.4C12.2 18.8 9.9 16.4 9.9 13.6C9.9 11.7 11.3 10.4 13 10.4C14.3 10.4 15.4 11.1 16 12.1C16.6 11.1 17.7 10.4 19 10.4C20.7 10.4 22.1 11.7 22.1 13.6C22.1 16.4 19.8 18.8 16 21.4Z" fill="#C8102E" />
        <path d="M14.9 11C14.5 8.8 15.3 7.5 17.1 7.5C18.2 7.5 18.9 8.1 18.9 9" stroke="#C8102E" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M12.9 10.8L12.6 8.3" stroke="#C8102E" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M10.4 14.8H13.3L14.7 12.1L16.3 17.4L17.6 14H21.6" stroke="#FFFFFF" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <circle cx="24.2" cy="5.9" r="1.9" fill="#F4B400" stroke="#FFFFFF" strokeWidth="0.8" />
    </svg>
  );
}

/** Brand mark + Rokkha/রক্ষা wordmark; accessible label describes the brand in the active language. */
export function Logo({ lang, size = 28 }: { lang: Lang; size?: number }) {
  const label = lang === "bn" ? `${auth.appName.bn} — হোম` : `${auth.appName.en} — Home`;
  return (
    <span className="inline-flex items-center gap-2" aria-label={label}>
      <LogoMark size={size} />
      <span className="text-xl font-extrabold tracking-tight text-[var(--brand-primary-text)]">
        {auth.appName[lang]}
      </span>
    </span>
  );
}
