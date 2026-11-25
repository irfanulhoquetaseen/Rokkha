import type { Lang } from "@/lib/i18n";
import { finder } from "@/lib/i18n/finder";
import type { DirectoryEntry } from "@/server/finder/search";
import { fmtKm } from "./format";
import { HospitalPhone } from "./HospitalPhone";
import { TypeBadges } from "./TypeBadges";

/** Hospitals without live data: contact details only, clearly marked unverified. */
export function DirectoryList({ entries, lang }: { entries: DirectoryEntry[]; lang: Lang }) {
  return (
    <section aria-labelledby="directory-title" className="flex flex-col gap-3 rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 shadow-xs">
      <h2 id="directory-title" className="text-lg font-bold">
        {finder.directoryTitle[lang]}
      </h2>
      <p className="text-sm text-[var(--text-muted)]">{finder.directoryIntro[lang]}</p>
      {entries.length === 0 ? (
        <p className="text-sm">{finder.directoryEmpty[lang]}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border-default)]">
          {entries.map((d) => {
            const name = lang === "bn" ? d.nameBn : d.nameEn;
            return (
            <li key={d.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="font-semibold break-words">{name}</p>
                <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
                  <TypeBadges type={d.type} freeService={d.freeService} lang={lang} />
                  {d.isDemo && (
                    <span className="rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--warning-text)]">
                      {finder.demoTag[lang]}
                    </span>
                  )}
                  <span className="break-words">{d.address}</span>
                  {d.distanceKm !== null && <span>· {fmtKm(d.distanceKm, lang)}</span>}
                </div>
              </div>
              <HospitalPhone phone={d.phone} isDemo={d.isDemo} name={name} lang={lang} compact />
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
