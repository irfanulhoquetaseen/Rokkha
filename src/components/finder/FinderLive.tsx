"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { fmtClock } from "@/components/finder/format";
import { type Coalescer, createCoalescer } from "@/components/realtime/coalesce";
import { ReconnectingBanner } from "@/components/realtime/ReconnectingBanner";
import { useLive } from "@/components/realtime/useLive";
import { createVersionGate } from "@/components/realtime/version-gate";
import type { Lang } from "@/lib/i18n";
import { realtime } from "@/lib/i18n/realtime";

/** A refresh whose transition never settles must not wedge the coalescer. */
const SETTLE_TIMEOUT_MS = 10_000;
/** Screen readers hear "List updated" at most this often. */
const ANNOUNCE_EVERY_MS = 10_000;

/**
 * Live island of the Finder. The ranking itself stays a Server Component: a newer `stock:changed` for
 * a relevant resource at a hospital that can be in this result (any page) — or a reconnect — re-runs
 * it with router.refresh() inside a transition. The coalescer (300 ms debounce, 1 s max wait) only
 * starts the next refresh after the previous transition settled, so refreshes never overlap. Events
 * for rows not on this page are accepted (unknown id): a hospital further down can move up.
 * Renders the reconnect banner and a visually hidden "List updated HH:MM" live region.
 */
export function FinderLive({
  relevantCodes, hospitalIds, versions, lang,
}: { relevantCodes: string[]; hospitalIds: string[]; versions: Record<string, number>; lang: Lang }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [gate] = useState(createVersionGate);
  const [announcement, setAnnouncement] = useState("");
  const refreshRef = useRef<Coalescer | null>(null);
  const settleRef = useRef<(() => void) | null>(null);
  const fromEventRef = useRef(false);
  const lastAnnounceRef = useRef(0);
  const langRef = useRef(lang);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  // Declared before useLive, so the coalescer exists before the first connect calls onConnect.
  useEffect(() => {
    const c = createCoalescer(
      async () => {
        const announce = fromEventRef.current;
        fromEventRef.current = false;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, SETTLE_TIMEOUT_MS);
          function done() {
            clearTimeout(timer);
            settleRef.current = null;
            resolve();
          }
          settleRef.current = done;
          startTransition(() => router.refresh());
        });
        const now = Date.now();
        if (announce && now - lastAnnounceRef.current >= ANNOUNCE_EVERY_MS) {
          lastAnnounceRef.current = now;
          setAnnouncement(realtime.listUpdated[langRef.current].replace("{t}", fmtClock(new Date(now), langRef.current)));
        }
      },
      300,
      1000,
    );
    refreshRef.current = c;
    return () => {
      c.cancel();
      settleRef.current?.();
      refreshRef.current = null;
    };
  }, [router]);

  // The refresh transition has settled (fresh server props are on screen): release the coalescer.
  useEffect(() => {
    if (!isPending) settleRef.current?.();
  }, [isPending]);

  // Each refresh brings newer server versions: raise the gate (it never lowers).
  useEffect(() => {
    for (const [id, v] of Object.entries(versions)) gate.set(id, v);
  }, [gate, versions]);

  const codesKey = relevantCodes.join("|");
  const idsKey = hospitalIds.join("|");
  const { state } = useLive({
    rooms: ["finder"],
    onEvent: {
      "stock:changed": (s) => {
        if (!codesKey.split("|").includes(s.code) || !idsKey.split("|").includes(s.hospitalId)) return;
        if (!gate.accept(s.id, s.version)) return;
        fromEventRef.current = true;
        refreshRef.current?.trigger();
      },
    },
    onConnect: () => refreshRef.current?.trigger(),
  });

  return (
    <>
      <ReconnectingBanner state={state} lang={lang} />
      <p role="status" aria-live="polite" data-testid="finder-live-status" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
