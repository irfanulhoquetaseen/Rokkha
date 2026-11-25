import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { BLOOD_LABEL, finder } from "@/lib/i18n/finder";
import { AREAS } from "@/server/finder/areas";
import { BLOOD_GROUPS, RADIUS_OPTIONS, type FinderParams } from "@/server/finder/params";
import type { ResourceOption } from "@/server/finder/search";
import { fmtNum } from "./format";
import { LocationButton } from "./LocationButton";
import { finderHref } from "./url";

const field = "flex min-w-0 flex-col gap-1 text-sm font-medium text-[var(--text-primary)]";
const control =
  "min-h-11 w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 text-base text-[var(--text-primary)]";

/** Plain GET form (works without JS); only the geolocation button is a client component. */
export function FilterBar({
  params,
  resourceTypes,
  lang,
}: {
  params: FinderParams;
  resourceTypes: ResourceOption[];
  lang: Lang;
}) {
  const usingLocation = !params.area && params.lat !== undefined && params.lng !== undefined;

  return (
    <form method="get" action="/find" className="flex flex-col gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-xs">
      <h2 className="text-base font-bold">{finder.filters[lang]}</h2>
      {params.condition && <input type="hidden" name="condition" value={params.condition} />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label className={field}>
          {finder.bloodGroup[lang]}
          <select name="blood" defaultValue={params.blood ?? ""} className={control}>
            <option value="">{finder.bloodUnknown[lang]}</option>
            {BLOOD_GROUPS.map((g) => (
              <option key={g} value={g}>
                {BLOOD_LABEL[g]}
              </option>
            ))}
          </select>
        </label>

        <label className={field}>
          {finder.resource[lang]}
          <select name="resource" defaultValue={params.resource ?? ""} className={control}>
            <option value="">{finder.anyResource[lang]}</option>
            {resourceTypes.map((t) => (
              <option key={t.code} value={t.code}>
                {lang === "bn" ? t.nameBn : t.nameEn}
              </option>
            ))}
          </select>
        </label>

        {usingLocation ? (
          <div className={field}>
            <span>{finder.area[lang]}</span>
            <input type="hidden" name="lat" value={params.lat} />
            <input type="hidden" name="lng" value={params.lng} />
            <span className="flex min-h-11 flex-wrap items-center gap-x-2 rounded-lg bg-sky-50 px-2 text-sm dark:bg-sky-950/40">
              <span>📍 {finder.usingMyLocation[lang]}</span>
              <Link
                href={finderHref(params, { lat: undefined, lng: undefined, page: undefined })}
                className="inline-flex min-h-11 items-center underline"
              >
                {finder.clearLocation[lang]}
              </Link>
            </span>
          </div>
        ) : (
          <label className={field}>
            {finder.area[lang]}
            <select name="area" defaultValue={params.area ?? ""} className={control}>
              <option value="">{finder.anyArea[lang]}</option>
              {AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {lang === "bn" ? a.nameBn : a.nameEn}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={field}>
          {finder.radius[lang]}
          <select name="radius" defaultValue={params.radius ? String(params.radius) : ""} className={control}>
            <option value="">{finder.anyRadius[lang]}</option>
            {RADIUS_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {fmtNum(r, lang)} {finder.km[lang]}
              </option>
            ))}
          </select>
        </label>

        <label className={field}>
          {finder.hospitalType[lang]}
          <select name="type" defaultValue={params.type ?? ""} className={control}>
            <option value="">{finder.anyType[lang]}</option>
            <option value="GOVT">{finder.govt[lang]}</option>
            <option value="PRIVATE">{finder.private[lang]}</option>
          </select>
        </label>

        <label className={field}>
          {finder.sort[lang]}
          <select name="sort" defaultValue={params.sort} className={control}>
            <option value="score">{finder.sortScore[lang]}</option>
            <option value="distance">{finder.sortDistance[lang]}</option>
            <option value="freshness">{finder.sortFreshness[lang]}</option>
          </select>
        </label>

        <label className="flex min-h-11 items-center gap-2 self-end text-sm font-medium">
          <input type="checkbox" name="free" value="1" defaultChecked={params.free === true} className="size-5 shrink-0" />
          {finder.freeOnly[lang]}
        </label>

        {!usingLocation && (
          <div className="col-span-2 self-end lg:col-span-1">
            <LocationButton
              labels={{ use: finder.useMyLocation[lang], locating: finder.locating[lang], denied: finder.locationDenied[lang] }}
            />
          </div>
        )}

        <button
          type="submit"
          className="col-span-2 min-h-11 self-end rounded-lg bg-[var(--brand-primary)] px-4 font-semibold text-white shadow-2xs transition-colors hover:bg-[var(--brand-primary-hover)] lg:col-span-1"
        >
          {finder.apply[lang]}
        </button>
      </div>
    </form>
  );
}
