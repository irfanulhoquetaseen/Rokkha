"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createCoalescer } from "@/components/realtime/coalesce";
import { ReconnectingBanner } from "@/components/realtime/ReconnectingBanner";
import { useLive } from "@/components/realtime/useLive";
import { createVersionGate } from "@/components/realtime/version-gate";
import type { Lang } from "@/lib/i18n";

/**
 * Live island of the Finder. The ranking itself stays a Server Component: a relevant, newer
 * `stock:changed` (or a reconnect) re-runs it with router.refresh(), coalesced so a burst of
 * events costs one RSC request. Events for rows not on this page are accepted too (unknown id),
 * since a hospital further down can move up into the page. Renders only the reconnect banner.
 */
export function FinderLive({
  relevantCodes, versions, lang,
}: { relevantCodes: string[]; versions: Record<string, number>; lang: Lang }) {
  const router = useRouter();
  const [gate] = useState(createVersionGate);
  const [refresh] = useState(() =>
    createCoalescer(async () => {
      router.refresh();
    }, 300),
  );

  // Each refresh brings newer server versions: raise the gate (it never lowers).
  useEffect(() => {
    for (const [id, v] of Object.entries(versions)) gate.set(id, v);
  }, [gate, versions]);
  useEffect(() => () => refresh.cancel(), [refresh]);

  const codesKey = relevantCodes.join("|");
  const { state } = useLive({
    rooms: ["finder"],
    onEvent: {
      "stock:changed": (s) => {
        if (codesKey.split("|").includes(s.code) && gate.accept(s.id, s.version)) refresh.trigger();
      },
    },
    onConnect: () => refresh.trigger(),
  });

  return <ReconnectingBanner state={state} lang={lang} />;
}
