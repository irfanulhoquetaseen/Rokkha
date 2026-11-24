"use client";

import { useEffect, useState } from "react";
import { fmtNum } from "@/components/finder/format";
import { createCoalescer } from "@/components/realtime/coalesce";
import { ReconnectingBanner } from "@/components/realtime/ReconnectingBanner";
import { useLive } from "@/components/realtime/useLive";
import { createVersionGate } from "@/components/realtime/version-gate";
import { getJson } from "@/lib/api-client";
import type { Lang } from "@/lib/i18n";
import { realtime } from "@/lib/i18n/realtime";
import type { StockChangedEvent } from "@/lib/realtime-types";

/** One stock row as the wire sends it (updatedAt is an ISO string), plus its display names. */
export type LiveStockRow = Omit<StockChangedEvent, "hospitalId" | "resourceTypeId"> & {
  kind: "COUNTABLE" | "STATUS";
  nameBn: string;
  nameEn: string;
};

type Snapshot = { resources: (StockChangedEvent & { kind: "COUNTABLE" | "STATUS" })[] };

const FLASH_MS = 1500;
const timeFmt = {
  bn: new Intl.DateTimeFormat("bn-BD", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Dhaka" }),
  en: new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Dhaka" }),
};

/**
 * Public live stock of one hospital. Rows update in place from `hospital:{id}` events that pass the
 * version gate; every (re)connect refetches the public snapshot and applies only rows newer than
 * what is shown. A changed row flashes briefly (not under reduced motion).
 */
export function LiveStockTable({ hospitalId, initial, lang }: { hospitalId: string; initial: LiveStockRow[]; lang: Lang }) {
  const [rows, setRows] = useState(initial);
  const [flash, setFlash] = useState<ReadonlySet<string>>(() => new Set());
  const [gate] = useState(() => {
    const g = createVersionGate();
    for (const r of initial) g.set(r.id, r.version);
    return g;
  });
  const [timers] = useState(() => new Map<string, ReturnType<typeof setTimeout>>()); // flash timers per row

  function apply(changes: Pick<LiveStockRow, "id" | "available" | "total" | "isAvailable" | "version" | "updatedAt">[]) {
    if (changes.length === 0) return;
    const byId = new Map(changes.map((c) => [c.id, c]));
    setRows((prev) =>
      prev.map((r) => {
        const c = byId.get(r.id);
        return c ? { ...r, available: c.available, total: c.total, isAvailable: c.isAvailable, version: c.version, updatedAt: c.updatedAt } : r;
      }),
    );
    setFlash((prev) => new Set([...prev, ...byId.keys()]));
    for (const id of byId.keys()) {
      clearTimeout(timers.get(id));
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          setFlash((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, FLASH_MS),
      );
    }
  }

  const [refetch] = useState(() =>
    createCoalescer(async () => {
      const res = await getJson<Snapshot>(`/api/hospitals/${encodeURIComponent(hospitalId)}/stock`);
      if (!res.ok) return; // keep what is shown; the next connect or event tries again
      // Every version the gate holds is already on screen, so a snapshot row is applied only when
      // strictly newer: an equal one is a no-op (no flash), an older one never rolls the row back.
      apply(res.data.resources.filter((r) => gate.accept(r.id, r.version)));
    }, 300),
  );

  useEffect(
    () => () => {
      refetch.cancel();
      for (const id of timers.values()) clearTimeout(id);
    },
    [refetch, timers],
  );

  const { state } = useLive({
    rooms: [`hospital:${hospitalId}`],
    onEvent: {
      "stock:changed": (s) => {
        if (s.hospitalId === hospitalId && gate.accept(s.id, s.version)) apply([s]);
      },
    },
    onConnect: () => refetch.trigger(),
  });

  return (
    <>
      <ReconnectingBanner state={state} lang={lang} />
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-300 text-left dark:border-zinc-700">
            <th scope="col" className="py-2 pr-2 font-semibold">{realtime.colResource[lang]}</th>
            <th scope="col" className="py-2 pr-2 text-right font-semibold">{realtime.colAvailable[lang]}</th>
            <th scope="col" className="py-2 text-right font-semibold">{realtime.colUpdated[lang]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              data-testid="stock-row"
              data-code={r.code}
              data-version={r.version}
              className={`border-b border-zinc-200 motion-safe:transition-colors motion-safe:duration-700 dark:border-zinc-800 ${flash.has(r.id) ? "motion-safe:bg-yellow-100 motion-safe:dark:bg-yellow-900/40" : ""}`}
            >
              <th scope="row" className="py-2 pr-2 text-left font-normal break-words">
                {lang === "bn" ? r.nameBn : r.nameEn}
              </th>
              <td className="py-2 pr-2 text-right whitespace-nowrap">
                {r.kind === "COUNTABLE" ? (
                  <>
                    <span data-testid="stock-available" className={`font-bold ${r.available === 0 ? "text-red-800 dark:text-red-300" : ""}`}>
                      {fmtNum(r.available, lang)}
                    </span>
                    <span className="text-zinc-600 dark:text-zinc-400"> / {fmtNum(r.total, lang)}</span>
                  </>
                ) : (
                  <span
                    data-testid="stock-status"
                    className={`rounded px-2 py-0.5 text-xs font-bold ${r.isAvailable ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-100" : "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"}`}
                  >
                    {r.isAvailable ? realtime.statusOn[lang] : realtime.statusOff[lang]}
                  </span>
                )}
              </td>
              <td className="py-2 text-right whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                {timeFmt[lang].format(new Date(r.updatedAt))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
