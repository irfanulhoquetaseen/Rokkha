"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Bilingual, ErrorBody } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { common } from "@/lib/i18n/common";
import { staff, staffFmt } from "@/lib/i18n/staff";
import { ConflictPanel, type ServerValues } from "./ConflictPanel";

export type ConsoleRow = {
  id: string;
  code: string;
  kind: "COUNTABLE" | "STATUS";
  consumable: boolean;
  nameBn: string;
  nameEn: string;
  total: number;
  available: number;
  isAvailable: boolean;
  version: number;
  /** ISO timestamp */
  updatedAt: string;
};

type Change =
  | { op: "adjust"; delta: number }
  | { op: "set"; available: number; total: number }
  | { op: "status"; isAvailable: boolean };

type Current = ServerValues & { version: number; updatedAt: string };
type RowUi = { saving?: boolean; editing?: boolean; error?: Bilingual; conflict?: { current: Current; intended: ServerValues } };
type Filter = "all" | "low" | "stale";
type Group = "beds" | "blood" | "services";

const MAX_STOCK = 100_000;
/** Wall clock, only ever read from effects and event handlers (never during render). */
const clockNow = () => Date.now();
const GROUPS: { id: Group; label: Bilingual }[] = [
  { id: "beds", label: staff.groupBeds },
  { id: "blood", label: staff.groupBlood },
  { id: "services", label: staff.groupServices },
];
// Generic rule (no per-code lists): status → services, consumable stock → blood & medicines, the rest → beds & equipment.
const groupOf = (r: ConsoleRow): Group => (r.kind === "STATUS" ? "services" : r.consumable ? "blood" : "beds");

const btnBase = "min-h-11 min-w-11 rounded-md px-3 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-40";
const stepBtn = `${btnBase} border border-zinc-300 text-xl hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800`;
const inputCls = "min-h-11 w-full rounded-md border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-600";
const alertCls = "rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200";

/** The intended end state of a change, so it can be re-applied as an absolute value after a conflict. */
function intendedValues(row: ConsoleRow, change: Change): ServerValues {
  if (change.op === "adjust") return { available: row.available + change.delta, total: row.total, isAvailable: row.isAvailable };
  if (change.op === "set") return { available: change.available, total: change.total, isAvailable: row.isAvailable };
  return { available: row.available, total: row.total, isAvailable: change.isAvailable };
}

function isCurrent(v: unknown): v is Current {
  const c = v as Partial<Current> | null;
  return !!c && typeof c.available === "number" && typeof c.total === "number" && typeof c.isAvailable === "boolean"
    && typeof c.version === "number" && typeof c.updatedAt === "string";
}

type Props = { lang: Lang; initialRows: ConsoleRow[]; nowMs: number; staleAfterMs: number };

export function ResourceConsole({ lang, initialRows, nowMs, staleAfterMs }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [ui, setUi] = useState<Record<string, RowUi>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(nowMs); // starts from the server's clock so hydration matches

  useEffect(() => {
    const t = setInterval(() => setNow(clockNow()), 30_000);
    return () => clearInterval(t);
  }, []);

  const patchUi = (id: string, next: RowUi) => setUi((u) => ({ ...u, [id]: next }));
  const adopt = (id: string, v: Current) =>
    setRows((rs) => rs.map((r) => (r.id === id && v.version > r.version ? { ...r, ...v } : r)));

  async function send(row: ConsoleRow, change: Change) {
    const prev = ui[row.id] ?? {};
    if (prev.saving) return; // double-submit guard (buttons are disabled too)
    patchUi(row.id, { editing: prev.editing && change.op === "set" ? true : undefined, saving: true });
    try {
      const res = await fetch(`/api/staff/resources/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: row.version, change }),
      });
      const body = (await res.json().catch(() => null)) as ({ resource?: Current } & Partial<ErrorBody>) | null;
      if (res.ok && body?.resource && isCurrent(body.resource)) {
        adopt(row.id, body.resource);
        patchUi(row.id, {});
        setNow(clockNow()); // "Updated just now" for the saved row
        return;
      }
      const err = body?.error;
      const current = (err?.details as { current?: unknown } | undefined)?.current;
      if (err?.code === "CONFLICT" && isCurrent(current)) {
        patchUi(row.id, { conflict: { current, intended: intendedValues(row, change) } });
        return;
      }
      patchUi(row.id, { editing: prev.editing, error: err?.message ?? common.retry });
    } catch {
      patchUi(row.id, { editing: prev.editing, error: staff.networkError });
    }
  }

  function reload(row: ConsoleRow) {
    const c = ui[row.id]?.conflict;
    if (!c) return;
    adopt(row.id, c.current);
    patchUi(row.id, {});
  }

  function reapply(row: ConsoleRow) {
    const c = ui[row.id]?.conflict;
    if (!c) return;
    const base = { ...row, ...c.current };
    const change: Change = row.kind === "STATUS"
      ? { op: "status", isAvailable: c.intended.isAvailable }
      : { op: "set", available: c.intended.available, total: c.intended.total };
    void send(base, change);
  }

  function submitSet(row: ConsoleRow, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const available = Number(fd.get("available"));
    const total = Number(fd.get("total"));
    const valid = [available, total].every((n) => Number.isInteger(n) && n >= 0 && n <= MAX_STOCK) && available <= total
      && String(fd.get("available")).trim() !== "" && String(fd.get("total")).trim() !== "";
    if (!valid) {
      patchUi(row.id, { editing: true, error: staff.setInvalid });
      return;
    }
    void send(row, { op: "set", available, total });
  }

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => rows.filter((r) => {
    if (q && !r.nameBn.toLowerCase().includes(q) && !r.nameEn.toLowerCase().includes(q)) return false;
    if (filter === "low") return r.kind === "COUNTABLE" && r.available <= 1;
    if (filter === "stale") return now - Date.parse(r.updatedAt) > staleAfterMs;
    return true;
  }), [rows, q, filter, now, staleAfterMs]);

  const filters: { id: Filter; label: Bilingual }[] = [
    { id: "all", label: staff.filterAll },
    { id: "low", label: staff.filterLow },
    { id: "stale", label: staff.filterStale },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="staff-search" className="text-sm font-medium">{staff.search[lang]}</label>
          <input id="staff-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} className={inputCls} autoComplete="off" />
        </div>
        <div role="group" aria-label={staff.filter[lang]} className="flex gap-1 rounded-md border border-zinc-300 p-1 dark:border-zinc-600">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className="min-h-11 flex-1 rounded px-3 text-sm font-medium aria-pressed:bg-zinc-900 aria-pressed:text-white dark:aria-pressed:bg-zinc-100 dark:aria-pressed:text-zinc-900"
            >
              {f.label[lang]}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && <p className="rounded-md bg-zinc-100 p-4 text-sm dark:bg-zinc-900">{staff.noMatch[lang]}</p>}

      {GROUPS.map((g) => {
        const items = visible.filter((r) => groupOf(r) === g.id);
        if (items.length === 0) return null;
        return (
          <section key={g.id} aria-labelledby={`group-${g.id}`} className="flex flex-col gap-2">
            <h2 id={`group-${g.id}`} className="text-lg font-bold">{g.label[lang]}</h2>
            <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {items.map((r) => {
                const u = ui[r.id] ?? {};
                const name = lang === "bn" ? r.nameBn : r.nameEn;
                const ageMin = Math.max(0, Math.floor((now - Date.parse(r.updatedAt)) / 60_000));
                const stale = now - Date.parse(r.updatedAt) > staleAfterMs;
                const busy = !!u.saving;
                const blocked = busy || !!u.conflict;
                return (
                  <li
                    key={r.id}
                    data-code={r.code}
                    aria-busy={busy}
                    className={`flex flex-col gap-2 rounded-lg border p-3 ${stale ? "border-yellow-400 bg-yellow-50 dark:border-yellow-600 dark:bg-yellow-950" : "border-zinc-200 dark:border-zinc-800"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold">{name}</h3>
                        <p className={`text-xs ${stale ? "font-semibold text-yellow-800 dark:text-yellow-300" : "text-zinc-600 dark:text-zinc-400"}`}>
                          {staffFmt.updatedAgo(ageMin)[lang]}
                          {stale && ` · ${staff.stale[lang]}`}
                        </p>
                      </div>
                      {r.kind === "COUNTABLE" ? (
                        <p className="shrink-0 text-right tabular-nums" aria-label={`${staff.available[lang]} / ${staff.total[lang]}`}>
                          <span data-testid="available" className="text-2xl font-bold">{r.available}</span>
                          <span className="text-zinc-600 dark:text-zinc-400"> / </span>
                          <span data-testid="total" className="text-zinc-600 dark:text-zinc-400">{r.total}</span>
                        </p>
                      ) : (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={r.isAvailable}
                          aria-label={name}
                          disabled={blocked}
                          onClick={() => void send(r, { op: "status", isAvailable: !r.isAvailable })}
                          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-1 disabled:opacity-60"
                        >
                          <span className={`relative h-7 w-12 rounded-full transition-colors motion-reduce:transition-none ${r.isAvailable ? "bg-green-600" : "bg-zinc-400 dark:bg-zinc-600"}`}>
                            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all motion-reduce:transition-none ${r.isAvailable ? "left-6" : "left-1"}`} />
                          </span>
                          <span className="w-10 text-left text-sm font-semibold">{r.isAvailable ? staff.on[lang] : staff.off[lang]}</span>
                        </button>
                      )}
                    </div>

                    {r.kind === "COUNTABLE" && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          aria-label={`${staff.decrease[lang]} — ${name}`}
                          disabled={blocked || r.available <= 0}
                          onClick={() => void send(r, { op: "adjust", delta: -1 })}
                          className={stepBtn}
                        >
                          −
                        </button>
                        <button
                          type="button"
                          aria-label={`${staff.increase[lang]} — ${name}`}
                          disabled={blocked || r.available >= r.total}
                          onClick={() => void send(r, { op: "adjust", delta: 1 })}
                          className={stepBtn}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          aria-expanded={!!u.editing}
                          disabled={blocked}
                          onClick={() => patchUi(r.id, { editing: !u.editing })}
                          className={`${btnBase} ml-auto border border-zinc-300 text-sm dark:border-zinc-600`}
                        >
                          {staff.set[lang]}
                        </button>
                      </div>
                    )}

                    {busy && <p className="text-xs text-zinc-600 dark:text-zinc-400" aria-live="polite">{staff.saving[lang]}</p>}

                    {r.kind === "COUNTABLE" && u.editing && !u.conflict && (
                      <form onSubmit={(e) => submitSet(r, e)} noValidate className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`${r.id}-available`} className="text-sm">{staff.available[lang]}</label>
                          <input id={`${r.id}-available`} name="available" type="number" inputMode="numeric" min={0} max={MAX_STOCK} defaultValue={r.available} className={inputCls} />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`${r.id}-total`} className="text-sm">{staff.total[lang]}</label>
                          <input id={`${r.id}-total`} name="total" type="number" inputMode="numeric" min={0} max={MAX_STOCK} defaultValue={r.total} className={inputCls} />
                        </div>
                        <button type="submit" disabled={busy} className={`${btnBase} bg-red-700 text-sm text-white hover:bg-red-800`}>
                          {staff.save[lang]}
                        </button>
                        <button type="button" disabled={busy} onClick={() => patchUi(r.id, {})} className={`${btnBase} border border-zinc-300 text-sm dark:border-zinc-600`}>
                          {staff.cancel[lang]}
                        </button>
                      </form>
                    )}

                    {u.error && <div role="alert" className={alertCls}>{u.error[lang]}</div>}

                    {u.conflict && (
                      <ConflictPanel
                        lang={lang}
                        kind={r.kind}
                        current={u.conflict.current}
                        intended={u.conflict.intended}
                        busy={busy}
                        onReload={() => reload(r)}
                        onReapply={() => reapply(r)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
