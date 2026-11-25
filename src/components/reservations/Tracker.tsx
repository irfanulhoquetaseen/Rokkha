"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { type Coalescer, createCoalescer } from "@/components/realtime/coalesce";
import { ReconnectingBanner } from "@/components/realtime/ReconnectingBanner";
import { useLive } from "@/components/realtime/useLive";
import { getJson, postJson } from "@/lib/api-client";
import type { Bilingual } from "@/lib/errors";
import type { Lang } from "@/lib/i18n";
import { realtime } from "@/lib/i18n/realtime";
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
type OneResponse = { reservation: TrackerReservation; serverNow?: string };

/**
 * Live part of the tracker: status, a countdown to expiresAt (server-clock corrected), cancel with an
 * inline second tap (never window.confirm), and the event timeline. At 0 it shows "Expired" and asks
 * the server, which lazily expires the hold and returns the real status. Live: `reservation:{id}` events
 * newer than the shown version (and every socket (re)connect) refetch the reservation, so a staff
 * check-in, rejection, completion or the expiry sweeper shows up at once, without a reload.
 */
export function Tracker({ initial, serverNowMs, lang }: { initial: TrackerReservation; serverNowMs: number; lang: Lang }) {
  const [r, setR] = useState(initial);
  // serverNowMs is only for the first (server/hydration) render: a page restored by Back/Forward from the
  // router cache carries an old render time. After mount the clock is the device clock, corrected by the
  // server time from a fresh GET as soon as it arrives.
  const [nowMs, setNowMs] = useState(serverNowMs);
  const offsetRef = useRef(0);
  const [armed, setArmed] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<Bilingual | null>(null);
  const inFlight = useRef(false);
  const refetchRef = useRef<Coalescer | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const held = r.status === "HELD";
  const leftMs = new Date(r.expiresAt).getTime() - nowMs;
  const timeUp = held && leftMs <= 0;

  // On every mount (incl. Back/Forward): fetch the live reservation and the server clock (a phone's clock may be wrong).
  useEffect(() => {
    let stop = false;
    const tick = () => setNowMs(Date.now() + offsetRef.current);
    const first = setTimeout(tick, 0); // device clock right away, never the stale render time
    void getJson<OneResponse>(`/api/reservations/${encodeURIComponent(r.id)}`).then((res) => {
      if (stop || !res.ok) return;
      const server = res.data.serverNow ? Date.parse(res.data.serverNow) : NaN;
      if (Number.isFinite(server)) offsetRef.current = server - Date.now();
      setR(newer(res.data.reservation));
      tick();
    });
    return () => {
      stop = true;
      clearTimeout(first);
    };
  }, [r.id]);

  // Live refetch (coalesced). Declared before useLive, so it exists before the first connect.
  const applyFresh = useEffectEvent((next: TrackerReservation) => {
    if (next.version > r.version && next.status !== r.status) {
      setAnnouncement(realtime.statusNow[lang].replace("{s}", statusLabel(next.status, lang)));
    }
    setR(newer(next));
  });
  useEffect(() => {
    const c = createCoalescer(async () => {
      const res = await getJson<OneResponse>(`/api/reservations/${encodeURIComponent(r.id)}`);
      if (!res.ok) return; // keep what is shown; the next event or connect tries again
      const server = res.data.serverNow ? Date.parse(res.data.serverNow) : NaN;
      if (Number.isFinite(server)) offsetRef.current = server - Date.now();
      applyFresh(res.data.reservation);
    }, 150);
    refetchRef.current = c;
    return () => {
      c.cancel();
      refetchRef.current = null;
    };
  }, [r.id]);

  const { state } = useLive({
    rooms: [`reservation:${r.id}`],
    onEvent: {
      "reservation:changed": (ev) => {
        if (ev.id === r.id && ev.version > r.version) refetchRef.current?.trigger();
      },
    },
    onConnect: () => refetchRef.current?.trigger(),
  });

  useEffect(() => {
    if (!held) return;
    const id = setInterval(() => setNowMs(Date.now() + offsetRef.current), 1000);
    return () => clearInterval(id);
  }, [held]);

  // Time is up: the server decides (lazy expiry on read). Retry briefly if it still says HELD.
  useEffect(() => {
    if (!timeUp) return;
    let stop = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const res = await getJson<OneResponse>(`/api/reservations/${encodeURIComponent(r.id)}`);
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

  function arm() {
    setArmed(true);
    setError(null);
  }

  async function confirmCancel() {
    if (inFlight.current) return;
    inFlight.current = true;
    setCancelling(true);
    const res = await postJson<{ reservation: TrackerReservation }>(`/api/reservations/${encodeURIComponent(r.id)}/cancel`);
    if (res.ok) {
      setR(newer(res.data.reservation));
    } else if ("error" in res && res.status < 500) {
      setError(res.error.message);
      // e.g. INVALID_TRANSITION (it expired or staff acted meanwhile): show the real status.
      const fresh = await getJson<OneResponse>(`/api/reservations/${encodeURIComponent(r.id)}`);
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
      <ReconnectingBanner state={state} lang={lang} />
      <p role="status" aria-live="polite" data-testid="tracker-live-status" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-xs">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-[var(--text-muted)]">{t.resource[lang]}</p>
          <p className="text-lg font-bold break-words">
            {lang === "bn" ? r.resource.nameBn : r.resource.nameEn}
            {r.quantity > 1 && ` × ${fmtNum(r.quantity, lang)}`}
          </p>
        </div>
        <StatusBadge status={r.status} lang={lang} testId="reservation-status" />
      </div>

      {held && (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-5 text-center shadow-xs">
          <p className="text-sm font-semibold text-[var(--warning-text)]">{t.timeLeft[lang]}</p>
          <p
            data-testid="countdown"
            aria-live="off"
            className="font-mono text-5xl font-extrabold tabular-nums text-[var(--warning-text)]"
          >
            {timeUp ? t.expired[lang] : fmtCountdown(leftMs, lang)}
          </p>
          <p className="text-sm text-[var(--text-primary)]">{t.holdHint[lang]}</p>
        </div>
      )}

      {r.status === "REJECTED" && r.rejectedReason && (
        <p className="rounded-xl border border-[var(--emergency-border)] bg-[var(--emergency-tint)] px-4 py-3 text-sm font-medium text-[var(--emergency-text)]">
          {t.rejectedReason[lang]}: {r.rejectedReason}
        </p>
      )}

      {error && (
        <p role="alert" data-testid="tracker-error" className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-sm font-medium text-[var(--warning-text)]">
          ⚠️ {error[lang]}
        </p>
      )}

      {held && !timeUp && !armed && (
        <button
          type="button"
          data-testid="cancel-button"
          onClick={arm}
          className={`${btn} w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]`}
        >
          {t.cancel[lang]}
        </button>
      )}
      {held && !timeUp && armed && (
        // "Keep hold" sits exactly where "Cancel hold" was, and the destructive confirm is below it:
        // the 2nd tap of an accidental double tap lands on "Keep", never on "Yes, cancel".
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-xs">
          <button
            type="button"
            data-testid="cancel-keep"
            onClick={() => setArmed(false)}
            disabled={cancelling}
            className={`${btn} w-full rounded-xl border border-[var(--border-strong)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]`}
          >
            {t.keepHold[lang]}
          </button>
          <p className="text-sm font-semibold">{t.cancelPrompt[lang]}</p>
          <button
            type="button"
            data-testid="cancel-confirm"
            onClick={confirmCancel}
            disabled={cancelling}
            aria-busy={cancelling}
            className={`${btn} w-full rounded-xl bg-[var(--emergency)] text-white hover:bg-[var(--emergency-hover)]`}
          >
            {cancelling ? t.cancelling[lang] : t.confirmCancel[lang]}
          </button>
        </div>
      )}

      <section aria-labelledby="timeline-title" className="flex flex-col gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 shadow-xs">
        <h2 id="timeline-title" className="text-base font-bold">{t.timeline[lang]}</h2>
        <ol data-testid="timeline" className="flex flex-col gap-2 border-l-2 border-[var(--border-default)] pl-4">
          {r.events.map((e, i) => (
            <li key={i} data-testid="timeline-event" data-status={e.toStatus} className="text-sm">
              <span className="font-mono tabular-nums text-[var(--text-muted)]">{fmtClock(e.createdAt, lang)}</span>{" "}
              <span className="font-semibold">{statusLabel(e.toStatus, lang)}</span>
              {e.note && <span className="text-[var(--text-muted)]"> — {e.note}</span>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
