import type { FinderParams } from "@/server/finder/params";

type Overrides = Partial<Record<keyof FinderParams, string | number | boolean | undefined>>;

/** Canonical /find URL for the given params (+ overrides; `undefined` drops a key). Page 1 / score sort are omitted. */
export function finderHref(params: FinderParams, overrides: Overrides = {}): string {
  const base: Overrides = {
    condition: params.condition,
    blood: params.blood,
    // An area implies its own centre point; explicit coordinates only when no area was chosen.
    area: params.area,
    lat: params.area ? undefined : params.lat,
    lng: params.area ? undefined : params.lng,
    radius: params.radius,
    type: params.type,
    free: params.free,
    sort: params.sort === "score" ? undefined : params.sort,
    page: params.page === 1 ? undefined : params.page,
  };
  const merged = { ...base, ...overrides };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === false) continue;
    qs.set(k, v === true ? "1" : String(v));
  }
  const s = qs.toString();
  return s ? `/find?${s}` : "/find";
}
