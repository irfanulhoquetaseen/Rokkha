"use client";

import type { Lang } from "@/lib/i18n";
import { staff } from "@/lib/i18n/staff";

export type ServerValues = { available: number; total: number; isAvailable: boolean };

type Props = {
  lang: Lang;
  kind: "COUNTABLE" | "STATUS";
  current: ServerValues;
  intended: ServerValues;
  busy: boolean;
  onReload: () => void;
  onReapply: () => void;
};

const btn = "min-h-11 flex-1 rounded-md px-3 text-sm font-semibold disabled:opacity-60";

/** Shown when a versioned save hit 409 CONFLICT: the row changed on the server since this page loaded it. */
export function ConflictPanel({ lang, kind, current, intended, busy, onReload, onReapply }: Props) {
  const show = (v: ServerValues) =>
    kind === "STATUS" ? (v.isAvailable ? staff.on[lang] : staff.off[lang]) : `${v.available} / ${v.total}`;

  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-orange-400 bg-orange-50 p-3 text-sm text-orange-950 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-100">
      <p className="font-semibold">{staff.conflictTitle[lang]}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt>{staff.conflictCurrent[lang]}</dt>
        <dd className="font-bold tabular-nums">{show(current)}</dd>
        <dt>{staff.conflictYours[lang]}</dt>
        <dd className="tabular-nums">{show(intended)}</dd>
      </dl>
      <div className="flex gap-2">
        <button type="button" onClick={onReload} disabled={busy} className={`${btn} border border-orange-400 bg-white text-orange-950 hover:bg-orange-100 dark:bg-transparent dark:text-orange-100`}>
          {staff.reload[lang]}
        </button>
        <button type="button" onClick={onReapply} disabled={busy} className={`${btn} bg-orange-700 text-white hover:bg-orange-800`}>
          {staff.reapply[lang]}
        </button>
      </div>
    </div>
  );
}
