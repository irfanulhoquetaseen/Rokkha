import Link from "next/link";
import { Call999Button } from "@/components/Call999Button";
import type { Lang } from "@/lib/i18n";
import { finder } from "@/lib/i18n/finder";

export type FirstAidGuideView = {
  dosBn: string[];
  dosEn: string[];
  dontsBn: string[];
  dontsEn: string[];
  sourceName: string;
  sourceUrl: string;
  reviewStatus: "DRAFT" | "SOURCE_CHECKED" | "MEDICALLY_REVIEWED";
  condition: { code: string; nameBn: string; nameEn: string };
};

/**
 * Renders a FirstAidGuide row verbatim (no invented text). `compact` = collapsible card on /find
 * (open by default so it is the first thing seen on a phone); `full` = the /first-aid page.
 */
export function FirstAidCard({ guide, lang, variant }: { guide: FirstAidGuideView; lang: Lang; variant: "compact" | "full" }) {
  const dos = lang === "bn" ? guide.dosBn : guide.dosEn;
  const donts = lang === "bn" ? guide.dontsBn : guide.dontsEn;
  const conditionName = lang === "bn" ? guide.condition.nameBn : guide.condition.nameEn;
  const H = variant === "full" ? "h2" : "h3";

  const body = (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-brand-tint)] p-3.5">
          <H className="mb-2 text-base font-bold text-[var(--brand-primary-text)]">✅ {finder.dos[lang]}</H>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-[var(--text-primary)]">
            {dos.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </section>
        <section className="rounded-lg border border-[var(--emergency-border)] bg-[var(--emergency-tint)] p-3.5">
          <H className="mb-2 text-base font-bold text-[var(--emergency-text)]">❌ {finder.donts[lang]}</H>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-[var(--text-primary)]">
            {donts.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </section>
      </div>
      <Call999Button lang={lang} />
      <p className="text-xs break-words text-[var(--text-muted)]">
        {finder.source[lang]}:{" "}
        {/^https?:\/\//i.test(guide.sourceUrl) ? (
          <a
            data-testid="first-aid-source"
            href={guide.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[var(--brand-primary-text)] underline"
          >
            {guide.sourceName}
          </a>
        ) : (
          // Defence in depth: never emit a non-http(s) URL (e.g. javascript:) as a link.
          <span data-testid="first-aid-source-text" className="font-medium">{guide.sourceName}</span>
        )}{" "}
        · {finder[`review${guide.reviewStatus}`][lang]}
      </p>
      <div role="note" className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-xs font-medium text-[var(--warning-text)]">
        <p lang="bn">{finder.disclaimer.bn}</p>
        <p lang="en">{finder.disclaimer.en}</p>
      </div>
      {variant === "compact" && (
        <Link
          href={`/first-aid/${encodeURIComponent(guide.condition.code)}`}
          className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-[var(--brand-primary-text)] underline"
        >
          {finder.fullFirstAid[lang]} →
        </Link>
      )}
    </div>
  );

  const shell = "rounded-xl border border-[var(--brand-primary)]/30 bg-[var(--bg-surface)] p-4 shadow-xs sm:p-5";
  if (variant === "full") {
    return (
      <article data-testid="first-aid-card" className={shell}>
        {body}
      </article>
    );
  }
  return (
    <details data-testid="first-aid-card" open className={shell}>
      <summary className="-m-1 flex min-h-11 cursor-pointer items-center p-1">
        <h2 className="inline text-lg font-bold">
          {finder.firstAid[lang]}: {conditionName}
        </h2>
      </summary>
      <div className="mt-3">{body}</div>
    </details>
  );
}
