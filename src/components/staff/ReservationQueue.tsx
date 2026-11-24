"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { fmtNum } from "@/components/finder/format";
import { StatusBadge, type Status } from "@/components/reservations/StatusBadge";
import { fmtCountdown } from "@/components/reservations/Tracker";
import { getJson, postJson } from "@/lib/api-client";
import type { Bilingual } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { reservations as rt } from "@/lib/i18n/reservations";
import { staff } from "@/lib/i18n/staff";

/** One queue row as the API serialises it (dates are ISO strings). */
export type QueueRow = {
  id: string;
  status: Status;
  quantity: number;
  expiresAt: string;
  createdAt: string;
  rejectedReason: string | null;
  version: number;
  resource: { nameBn: string; nameEn: string };
  citizen: { name: string; phone: string };
};
export type QueuePage = { items: QueueRow[]; page: number; pageSize: number; total: number };

type StatusFilter = "ACTIVE" | Status | "ALL";
type Sort = "expiresAt" | "newest" | "oldest";
type Action = "checkIn" | "reject" | "complete";

const STATUS_OPTIONS: StatusFilter[] = ["ACTIVE", "HELD", "ARRIVED", "COMPLETED", "REJECTED", "CANCELLED", "EXPIRED", "ALL"];
const SORT_OPTIONS: { value: Sort; label: Bilingual }[] = [
  { value: "expiresAt", label: staff.sortExpires },
  { value: "newest", label: staff.sortNewest },
  { value: "oldest", label: staff.sortOldest },
];
const statusOptionLabel = (s: StatusFilter): Bilingual =>
  s === "ACTIVE" ? staff.statusActive : s === "ALL" ? staff.statusAll : rt[`status_${s}`];

const SEARCH_DEBOUNCE_MS = 300;
const REASON_MIN = 3;
const REASON_MAX = 300;

/** Never go back to an older version of a row: a list GET that started before a transition committed
 *  can land after the transition's own response. */
function mergeNewer(prev: QueueRow[], next: QueueRow[]): QueueRow[] {
  const known = new Map(prev.map((r) => [r.id, r]));
  return next.map((n) => {
    const cur = known.get(n.id);
    return cur && cur.version > n.version ? cur : n;
  });
}

const noopSubscribe = () => () => {};

const inputCls = "min-h-11 w-full rounded-md border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-600";
const btn = "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60";

/**
 * A hospital's reservation queue for its staff: search (debounced), status filter, sort, pagination and
 * the per-row transitions (HELD: check in / reject with reason; ARRIVED: complete). The first page is
 * server-rendered; the server is the arbiter of every transition (an INVALID_TRANSITION, e.g. the hold
 * expired or the citizen cancelled meanwhile, shows its message and refetches the page).
 */
export function ReservationQueue({
  hospitalId, initial, lang, serverNowMs,
}: { hospitalId: string; initial: QueuePage; lang: Lang; serverNowMs: number }) {
  const [data, setData] = useState(initial);
  const [status, setStatus] = useState<StatusFilter>("ACTIVE");
  const [sort, setSort] = useState<Sort>("expiresAt");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState(""); // debounced
  const [page, setPage] = useState(initial.page);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // serverNowMs only for the server/hydration render; after mount the device clock ticks.
  const [nowMs, setNowMs] = useState(serverNowMs);
  const seq = useRef(0);
  const inFlight = useRef(false);
  const firstRender = useRef(true);
  // Action buttons stay disabled until hydrated: a tap on server HTML would otherwise do nothing.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const sp = new URLSearchParams({ status, sort, page: String(page) });
    if (q) sp.set("q", q);
    const res = await getJson<QueuePage>(`/api/staff/hospitals/${encodeURIComponent(hospitalId)}/reservations?${sp}`);
    if (mine !== seq.current) return; // a newer request superseded this one
    setLoading(false);
    if (res.ok) {
      setData((d) => ({ ...res.data, items: mergeNewer(d.items, res.data.items) }));
      // A shrunk result (e.g. rows left the filter) can leave us past the last page.
      const last = Math.max(1, Math.ceil(res.data.total / res.data.pageSize));
      if (res.data.page > last) setPage(last);
    } else {
      setError("error" in res ? res.error.message : staff.networkError);
    }
  }, [hospitalId, status, sort, page, q]);

  // Debounce the search box.
  useEffect(() => {
    const id = setTimeout(() => {
      setQ(query.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  // Refetch on any filter change (the first page came from the server).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void load();
  }, [load]);

  const anyHeld = data.items.some((r) => r.status === "HELD");
  useEffect(() => {
    if (!anyHeld) return;
    const tick = () => setNowMs(Date.now());
    const first = setTimeout(tick, 0); // device clock right away, never the (possibly cached) render time
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [anyHeld]);

  async function act(row: QueueRow, action: Action) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusyId(row.id);
    setError(null);
    const body = action === "reject" ? { action, reason: reason.trim() } : { action };
    const res = await postJson<{ reservation: QueueRow }>(`/api/staff/reservations/${encodeURIComponent(row.id)}`, body);
    if (res.ok) {
      // Update in place (keeps the row visible with its new status even if it now falls outside the filter).
      const next = res.data.reservation;
      setData((d) => ({
        ...d,
        items: d.items.map((r) => (r.id === row.id && next.version >= r.version ? { ...r, ...next, citizen: r.citizen } : r)),
      }));
      if (action === "reject") {
        setRejectingId(null);
        setReason("");
      }
    } else if ("error" in res) {
      setError(res.error.message);
      if (res.error.code === "INVALID_TRANSITION" || res.error.code === "NOT_FOUND") {
        setRejectingId(null);
        setReason("");
        await load();
      }
    } else {
      setError(staff.networkError);
    }
    setBusyId(null);
    inFlight.current = false;
  }

  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  const reasonOk = reason.trim().length >= REASON_MIN && reason.trim().length <= REASON_MAX;

  return (
    <section aria-labelledby="queue-title" data-testid="reservation-queue" data-hydrated={hydrated} className="flex flex-col gap-3">
      <h2 id="queue-title" className="text-xl font-bold">{staff.queueTitle[lang]}</h2>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="queue-search" className="text-sm font-medium">{staff.queueSearch[lang]}</label>
          <input
            id="queue-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            maxLength={64} autoComplete="off" className={inputCls}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:flex">
          <div className="flex flex-col gap-1">
            <label htmlFor="queue-status" className="text-sm font-medium">{staff.queueStatus[lang]}</label>
            <select
              id="queue-status" value={status} className={inputCls}
              onChange={(e) => { setStatus(e.target.value as StatusFilter); setPage(1); }}
            >
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{statusOptionLabel(s)[lang]}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="queue-sort" className="text-sm font-medium">{staff.queueSort[lang]}</label>
            <select
              id="queue-sort" value={sort} className={inputCls}
              onChange={(e) => { setSort(e.target.value as Sort); setPage(1); }}
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label[lang]}</option>)}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950">⚠️ {error[lang]}</p>
      )}

      <div aria-busy={loading} className={loading ? "opacity-60 transition-opacity motion-reduce:transition-none" : undefined}>
        {data.items.length === 0 ? (
          <p data-testid="queue-empty" className="rounded-md bg-zinc-100 p-4 text-sm dark:bg-zinc-900">{staff.queueEmpty[lang]}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {data.items.map((r) => {
              const busy = busyId === r.id;
              const off = busy || !hydrated;
              const left = new Date(r.expiresAt).getTime() - nowMs;
              const rejecting = rejectingId === r.id;
              return (
                <li
                  key={r.id} data-testid="queue-row" data-reservation-id={r.id} data-status={r.status}
                  className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold break-words">{r.citizen.name}</p>
                      <a data-testid="queue-phone" href={`tel:${r.citizen.phone}`} className="text-sm text-blue-800 underline dark:text-blue-300">
                        {r.citizen.phone}
                      </a>
                    </div>
                    <StatusBadge status={r.status} lang={lang} testId="queue-status" />
                  </div>
                  <p className="text-sm">
                    {lang === "bn" ? r.resource.nameBn : r.resource.nameEn} × {fmtNum(r.quantity, lang)}
                  </p>
                  {r.status === "HELD" && (
                    <p className="text-sm">
                      {staff.expiresIn[lang]}:{" "}
                      <span data-testid="queue-countdown" className="font-mono font-bold tabular-nums">
                        {left <= 0 ? rt.expired[lang] : fmtCountdown(left, lang)}
                      </span>
                    </p>
                  )}
                  {r.status === "REJECTED" && r.rejectedReason && (
                    <p className="text-sm text-red-900 dark:text-red-300">{rt.rejectedReason[lang]}: {r.rejectedReason}</p>
                  )}

                  {r.status === "HELD" && !rejecting && (
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" disabled={off} aria-busy={busy} onClick={() => act(r, "checkIn")} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}>
                        {busy ? staff.working[lang] : staff.checkIn[lang]}
                      </button>
                      <button
                        type="button" disabled={off}
                        onClick={() => { setRejectingId(r.id); setReason(""); setError(null); }}
                        className={`${btn} border-2 border-red-700 text-red-800 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950`}
                      >
                        {staff.reject[lang]}
                      </button>
                    </div>
                  )}
                  {r.status === "HELD" && rejecting && (
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(e) => { e.preventDefault(); if (reasonOk) void act(r, "reject"); }}
                    >
                      <label htmlFor={`reason-${r.id}`} className="text-sm font-medium">{staff.rejectReason[lang]}</label>
                      <input
                        id={`reason-${r.id}`} value={reason} onChange={(e) => setReason(e.target.value)}
                        maxLength={REASON_MAX} autoComplete="off" autoFocus className={inputCls}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" disabled={off} onClick={() => setRejectingId(null)} className={`${btn} border-2 border-zinc-700 dark:border-zinc-300`}>
                          {staff.cancel[lang]}
                        </button>
                        <button type="submit" disabled={off || !reasonOk} aria-busy={busy} className={`${btn} bg-red-700 text-white hover:bg-red-800`}>
                          {busy ? staff.working[lang] : staff.rejectSubmit[lang]}
                        </button>
                      </div>
                    </form>
                  )}
                  {r.status === "ARRIVED" && (
                    <button type="button" disabled={off} aria-busy={busy} onClick={() => act(r, "complete")} className={`${btn} w-full bg-green-700 text-white hover:bg-green-800`}>
                      {busy ? staff.working[lang] : staff.complete[lang]}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <nav aria-label={rt.page[lang]} className="flex items-center justify-between gap-2">
        <button type="button" disabled={!hydrated || loading || data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className={`${btn} border border-zinc-300 dark:border-zinc-600`}>
          {rt.prev[lang]}
        </button>
        <span className="text-sm tabular-nums">
          {rt.page[lang]} {fmtNum(data.page, lang)} / {fmtNum(lastPage, lang)}
        </span>
        <button type="button" disabled={!hydrated || loading || data.page >= lastPage} onClick={() => setPage((p) => p + 1)} className={`${btn} border border-zinc-300 dark:border-zinc-600`}>
          {rt.next[lang]}
        </button>
      </nav>
    </section>
  );
}
