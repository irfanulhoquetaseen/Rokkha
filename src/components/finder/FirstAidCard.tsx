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
      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <H className="mb-2 text-base font-bold text-green-800 dark:text-green-300">✅ {finder.dos[lang]}</H>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
            {dos.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </section>
        <section>
          <H className="mb-2 text-base font-bold text-red-800 dark:text-red-300">❌ {finder.donts[lang]}</H>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-relaxed">
            {donts.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        </section>
      </div>
      <Call999Button lang={lang} />
      <p className="text-xs break-words text-zinc-700 dark:text-zinc-300">
        {finder.source[lang]}:{" "}
        {/^https?:\/\//i.test(guide.sourceUrl) ? (
          <a
            data-testid="first-aid-source"
            href={guide.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium underline"
          >
            {guide.sourceName}
          </a>
        ) : (
          // Defence in depth: never emit a non-http(s) URL (e.g. javascript:) as a link.
          <span data-testid="first-aid-source-text" className="font-medium">{guide.sourceName}</span>
        )}{" "}
        · {finder[`review${guide.reviewStatus}`][lang]}
      </p>
      <div role="note" className="rounded-md bg-amber-50 p-2 text-xs font-medium text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
        <p lang="bn">{finder.disclaimer.bn}</p>
        <p lang="en">{finder.disclaimer.en}</p>
      </div>
      {variant === "compact" && (
        <Link
          href={`/first-aid/${encodeURIComponent(guide.condition.code)}`}
          className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-red-700 underline dark:text-red-400"
        >
          {finder.fullFirstAid[lang]} →
        </Link>
      )}
    </div>
  );

  const shell = "rounded-xl border border-green-300 bg-green-50/60 p-4 dark:border-green-900 dark:bg-green-950/20";
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
