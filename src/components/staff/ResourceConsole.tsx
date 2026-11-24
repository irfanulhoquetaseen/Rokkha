"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent } from "react";
import { fmtClock } from "@/components/finder/format";
import { type Coalescer, createCoalescer } from "@/components/realtime/coalesce";
import { ReconnectingBanner } from "@/components/realtime/ReconnectingBanner";
import { useLive } from "@/components/realtime/useLive";
import { createVersionGate } from "@/components/realtime/version-gate";
import { getJson } from "@/lib/api-client";
import type { Bilingual, ErrorBody } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { common } from "@/lib/i18n/common";
import { realtime } from "@/lib/i18n/realtime";
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
type RowUi = {
  saving?: boolean;
  editing?: boolean;
  error?: Bilingual;
  conflict?: { current: Current; intended: ServerValues };
  /** A live change arrived while this row's Set form was dirty (the form keeps its base version). */
  changedElsewhere?: boolean;
};
/** A live value of one row (socket event or snapshot row). */
type LiveValue = Current & { id: string };
type Filter = "all" | "low" | "stale";
type Group = "beds" | "blood" | "services";

const MAX_STOCK = 100_000;
/** Screen readers hear "Stock updated" at most this often. */
const ANNOUNCE_EVERY_MS = 10_000;
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

const liveValue = (v: LiveValue): Current => ({
  available: v.available, total: v.total, isAvailable: v.isAvailable, version: v.version, updatedAt: v.updatedAt,
});

type Props = { lang: Lang; hospitalId: string; initialRows: ConsoleRow[]; nowMs: number; staleAfterMs: number };

/**
 * Live staff console (CLAUDE.md §3.2). Rows follow `staff:{hospitalId}` stock events that pass the
 * version gate, and every (re)connect refetches the snapshot. A row whose Set form is open AND dirty is
 * frozen at the form's base version: the live value is held back and a "changed by someone else" hint
 * appears, so saving hits the versioned PATCH's 409 and the existing conflict panel (Reload / Re-apply)
 * instead of silently overwriting the other change. +/- and switches always use the latest live version.
 */
export function ResourceConsole({ lang, hospitalId, initialRows, nowMs, staleAfterMs }: Props) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [ui, setUi] = useState<Record<string, RowUi>>({});
  const [gate] = useState(() => {
    const g = createVersionGate();
    for (const r of initialRows) g.set(r.id, r.version);
    return g;
  });
  /** Rows whose open Set form the user has typed into. */
  const dirty = useRef(new Set<string>());
  /** Latest live value of a frozen (dirty) row, applied when its form closes. */
  const heldBack = useRef(new Map<string, Current>());
  const refetchRef = useRef<Coalescer | null>(null);
  const lastAnnounce = useRef(0);
  const [announcement, setAnnouncement] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [now, setNow] = useState(nowMs); // starts from the server's clock so hydration matches

  useEffect(() => {
    const t = setInterval(() => setNow(clockNow()), 30_000);
    return () => clearInterval(t);
  }, []);

  const adopt = (id: string, v: Current) => {
    gate.set(id, v.version); // our own save's echo event is then a no-op
    setRows((rs) => rs.map((r) => (r.id === id && v.version > r.version ? { ...r, ...v } : r)));
  };
  /** Replace a row's UI state. Closing its Set form unfreezes the row and applies any held-back live value. */
  const patchUi = (id: string, next: RowUi) => {
    if (!next.editing) {
      dirty.current.delete(id);
      const held = heldBack.current.get(id);
      heldBack.current.delete(id);
      if (held) adopt(id, held);
    }
    setUi((u) => ({ ...u, [id]: next }));
  };

  /** Apply live values that already passed the version gate. */
  function applyLive(values: LiveValue[]) {
    if (values.length === 0) return;
    const now = clockNow();
    const fresh = new Map<string, Current>();
    for (const v of values) {
      const cur = liveValue(v);
      if (dirty.current.has(v.id)) {
        heldBack.current.set(v.id, cur);
        setUi((u) => ({ ...u, [v.id]: { ...u[v.id], changedElsewhere: true } }));
      } else {
        fresh.set(v.id, cur);
      }
    }
    if (fresh.size > 0) {
      setRows((rs) => rs.map((r) => {
        const v = fresh.get(r.id);
        return v && v.version > r.version ? { ...r, ...v } : r;
      }));
      // An open conflict panel shows the newest server value, so Reload / Re-apply act on it.
      setUi((u) => {
        let next = u;
        for (const [id, v] of fresh) {
          const c = u[id]?.conflict;
          if (c && v.version > c.current.version) next = { ...next, [id]: { ...u[id], conflict: { ...c, current: v } } };
        }
        return next;
      });
    }
    setNow(now);
    if (now - lastAnnounce.current >= ANNOUNCE_EVERY_MS) {
      lastAnnounce.current = now;
      setAnnouncement(realtime.stockUpdated[lang].replace("{t}", fmtClock(new Date(now), lang)));
    }
  }
  const applySnapshot = useEffectEvent((values: LiveValue[]) => applyLive(values));

  // Declared before useLive, so the coalescer exists before the first connect calls onConnect.
  useEffect(() => {
    const c = createCoalescer(async () => {
      const res = await getJson<{ resources: LiveValue[] }>(`/api/staff/hospitals/${encodeURIComponent(hospitalId)}/resources`);
      if (!res.ok) return; // keep what is shown; the next connect or event tries again
      // Everything the gate holds is already shown (or held back): apply only strictly newer rows.
      applySnapshot(res.data.resources.filter((r) => gate.accept(r.id, r.version)));
    }, 300);
    refetchRef.current = c;
    return () => {
      c.cancel();
      refetchRef.current = null;
    };
  }, [hospitalId, gate]);

  const { state } = useLive({
    rooms: [`staff:${hospitalId}`],
    onEvent: {
      "stock:changed": (s) => {
        if (s.hospitalId === hospitalId && gate.accept(s.id, s.version)) applyLive([s]);
      },
    },
    onConnect: () => refetchRef.current?.trigger(),
  });

  async function send(shown: ConsoleRow, change: Change) {
    const prev = ui[shown.id] ?? {};
    // A Set is versioned on the form's base row; a step or a switch acts on the latest live value.
    const held = change.op === "set" ? undefined : heldBack.current.get(shown.id);
    const row = held && held.version > shown.version ? { ...shown, ...held } : shown;
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
      if (res.status === 401) {
        // Session expired or logged out elsewhere: log in again and come back here.
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
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

  /** The user typed into a Set form: from now on live values must not replace its base row. */
  function markDirty(row: ConsoleRow, e: FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    if (String(fd.get("available")) !== String(row.available) || String(fd.get("total")) !== String(row.total)) {
      dirty.current.add(row.id);
    }
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
      <ReconnectingBanner state={state} lang={lang} />
      <p role="status" aria-live="polite" data-testid="console-live-status" className="sr-only">
        {announcement}
      </p>
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
                        <p className="shrink-0 text-right tabular-nums">
                          <span className="sr-only">{staff.available[lang]}: </span>
                          <span data-testid="available" className="text-2xl font-bold">{r.available}</span>
                          <span aria-hidden="true" className="text-zinc-600 dark:text-zinc-400"> / </span>
                          <span className="sr-only">, {staff.total[lang]}: </span>
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
                      // Keyed by version: an untouched form re-mounts with the live values; a dirty one is
                      // never re-keyed because its row is frozen until the form closes.
                      <form
                        key={r.version}
                        onSubmit={(e) => submitSet(r, e)}
                        onInput={(e) => markDirty(r, e)}
                        noValidate
                        className="grid grid-cols-2 gap-2"
                      >
                        {u.changedElsewhere && (
                          <p data-testid="changed-elsewhere" role="status" className="col-span-2 rounded-md border border-orange-400 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-950 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-100">
                            {realtime.changedElsewhere[lang]}
                          </p>
                        )}
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
