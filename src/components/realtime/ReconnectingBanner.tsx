import { type Lang, pick } from "@/lib/i18n";
import { realtime } from "@/lib/i18n/realtime";
import type { LiveState } from "./socket";

/**
 * Sticky, high-contrast, non-interactive notice shown only while a live island is reconnecting.
 * Also renders a hidden `live-state` marker (`data-state`): "connected" means the socket is up and
 * the rooms held at connect time are joined (used by E2E tests and handy when debugging).
 */
export function ReconnectingBanner({ state, lang }: { state: LiveState; lang: Lang }) {
  const marker = <span hidden data-testid="live-state" data-state={state} />;
  if (state !== "reconnecting") return marker;
  return (
    <>
      {marker}
      <div
        role="status"
        data-testid="reconnecting-banner"
        className="sticky top-0 z-50 flex min-h-11 items-center justify-center border-b border-[var(--warning-border)] bg-[var(--accent-gold)] px-4 py-2 text-center text-base font-bold text-[#14201B]"
      >
        {pick(lang, realtime.reconnecting)}
      </div>
    </>
  );
}
