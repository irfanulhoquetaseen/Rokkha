"use client";

import { useEffect, useRef, useState } from "react";
import { getJson, postJson } from "@/lib/api-client";
import type { Bilingual } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { reservations as t } from "@/lib/i18n/reservations";
import { fmtNum } from "@/components/finder/format";
import { StatusBadge, statusLabel, type Status } from "./StatusBadge";

/** The reservation as the API serialises it (dates are ISO strings). */
export type TrackerReservation = {
  id: string;
  status: Status;
  quantity: number;
  expiresAt: string;
  rejectedReason: string | null;
  version: number;
  resource: { nameBn: string; nameEn: string };
  events: { toStatus: Status; fromStatus: Status | null; createdAt: string; note: string | null }[];
};

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";
const digits = (s: string, lang: Lang) => (lang === "bn" ? s.replace(/\d/g, (d) => BN_DIGITS[Number(d)]!) : s);
const pad = (n: number) => String(n).padStart(2, "0");

/** mm:ss (minutes may exceed 59 only for odd data; never negative). */
export function fmtCountdown(ms: number, lang: Lang): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return digits(`${pad(Math.floor(s / 60))}:${pad(s % 60)}`, lang);
}

/** HH:MM in Bangladesh time (UTC+6, no DST) — deterministic on server and client, so hydration matches. */
function fmtClock(iso: string, lang: Lang): string {
  const d = new Date(new Date(iso).getTime() + 6 * 3_600_000);
  return digits(`${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`, lang);
}

const btn = "inline-flex min-h-12 items-center justify-center rounded-lg px-4 text-base font-bold disabled:cursor-wait disabled:opacity-70";
const REFETCH_RETRIES = 5;
/** State updater that never goes back to an older version of the reservation. */
const newer = (next: TrackerReservation) => (cur: TrackerReservation) => (next.version >= cur.version ? next : cur);
const DISARM_MS = 5_000;

/**
 * Live part of the tracker: status, a countdown to expiresAt (server-clock corrected), cancel with an
 * inline second tap (never window.confirm), and the event timeline. At 0 it shows "Expired" and asks
 * the server, which lazily expires the hold and returns the real status.
 */
export function Tracker({ initial, serverNowMs, lang }: { initial: TrackerReservation; serverNowMs: number; lang: Lang }) {
  const [r, setR] = useState(initial);
  const [nowMs, setNowMs] = useState(serverNowMs);
  const [armed, setArmed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const inFlight = useRef(false);

  const held = r.status === "HELD";
  const leftMs = new Date(r.expiresAt).getTime() - nowMs;
  const timeUp = held && leftMs <= 0;

  // Tick against the server clock (a phone's clock may be wrong).
  useEffect(() => {
    if (!held) return;
    const offset = serverNowMs - Date.now();
    const id = setInterval(() => setNowMs(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [held, serverNowMs]);

  // Time is up: the server decides (lazy expiry on read). Retry briefly if it still says HELD.
  useEffect(() => {
    if (!timeUp) return;
    let stop = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const res = await getJson<{ reservation: TrackerReservation }>(`/api/reservations/${encodeURIComponent(r.id)}`);
      if (stop) return;
      if (res.ok) setR(newer(res.data.reservation));
      if ((!res.ok || res.data.reservation.status === "HELD") && ++tries < REFETCH_RETRIES) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [timeUp, r.id]);

  // An armed cancel button disarms itself if the second tap never comes.
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), DISARM_MS);
    return () => clearTimeout(id);
  }, [armed]);

  async function onCancel() {
    if (!armed) {
      setArmed(true);
      setError(null);
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    setCancelling(true);
    const res = await postJson<{ reservation: TrackerReservation }>(`/api/reservations/${encodeURIComponent(r.id)}/cancel`);
    if (res.ok) {
      setR(newer(res.data.reservation));
    } else if ("error" in res && res.status < 500) {
      setError(res.error.message);
      // e.g. INVALID_TRANSITION (it expired or staff acted meanwhile): show the real status.
      const fresh = await getJson<{ reservation: TrackerReservation }>(`/api/reservations/${encodeURIComponent(r.id)}`);
      if (fresh.ok) setR(newer(fresh.data.reservation));
    } else {
      setError(t.networkProblem);
    }
    setArmed(false);
    setCancelling(false);
    inFlight.current = false;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.resource[lang]}</p>
          <p className="text-lg font-bold break-words">
            {lang === "bn" ? r.resource.nameBn : r.resource.nameEn}
            {r.quantity > 1 && ` × ${fmtNum(r.quantity, lang)}`}
          </p>
        </div>
        <StatusBadge status={r.status} lang={lang} testId="reservation-status" />
      </div>

      {held && (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-amber-50 p-4 text-center dark:bg-amber-950/30">
          <p className="text-sm font-semibold">{t.timeLeft[lang]}</p>
          <p
            data-testid="countdown"
            aria-live="off"
            className="font-mono text-5xl font-bold tabular-nums text-amber-900 dark:text-amber-200"
          >
            {timeUp ? t.expired[lang] : fmtCountdown(leftMs, lang)}
          </p>
          <p className="text-sm">{t.holdHint[lang]}</p>
        </div>
      )}

      {r.status === "REJECTED" && r.rejectedReason && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900 dark:bg-red-950 dark:text-red-200">
          {t.rejectedReason[lang]}: {r.rejectedReason}
        </p>
      )}

      {error && (
        <p role="alert" data-testid="tracker-error" className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950">
          ⚠️ {error[lang]}
        </p>
      )}

      {held && !timeUp && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="cancel-button"
            onClick={onCancel}
            disabled={cancelling}
            aria-busy={cancelling}
            className={`${btn} flex-1 ${armed ? "bg-red-700 text-white hover:bg-red-800" : "border-2 border-zinc-800 hover:bg-zinc-100 dark:border-zinc-300 dark:hover:bg-zinc-800"}`}
          >
            {cancelling ? t.cancelling[lang] : armed ? t.tapAgainToCancel[lang] : t.cancel[lang]}
          </button>
          {armed && !cancelling && (
            <button type="button" onClick={() => setArmed(false)} className={`${btn} border border-zinc-300 dark:border-zinc-700`}>
              {t.keep[lang]}
            </button>
          )}
        </div>
      )}

      <section aria-labelledby="timeline-title" className="flex flex-col gap-2">
        <h2 id="timeline-title" className="text-base font-bold">{t.timeline[lang]}</h2>
        <ol data-testid="timeline" className="flex flex-col gap-2 border-l-2 border-zinc-300 pl-4 dark:border-zinc-700">
          {r.events.map((e, i) => (
            <li key={i} data-testid="timeline-event" data-status={e.toStatus} className="text-sm">
              <span className="font-mono tabular-nums text-zinc-600 dark:text-zinc-400">{fmtClock(e.createdAt, lang)}</span>{" "}
              <span className="font-semibold">{statusLabel(e.toStatus, lang)}</span>
              {e.note && <span className="text-zinc-700 dark:text-zinc-300"> — {e.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
