"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";

const COPY = {
  pill: { bn: "ডেমো", en: "Demo" },
  detail: {
    bn: "এই হাসপাতালগুলো কাল্পনিক, আসল উপলব্ধতা নয়",
    en: "Hospitals are fictional; not real availability",
  },
} as const;

/**
 * Compact header pill next to the logo with an accessible hover/focus/tap popover explaining that
 * seeded hospital stocks are fictional demo data. Minimum 44 px vertical tap area for mobile safety.
 */
export function DemoBadge({ lang }: { lang: Lang }) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const popId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setPinned(false);
        setHovered(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinned(false);
        setHovered(false);
      }
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleToggle() {
    if (pinned) {
      setPinned(false);
      setHovered(false);
    } else {
      setPinned(true);
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative inline-flex items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        data-testid="demo-badge"
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        onClick={handleToggle}
        className="inline-flex min-h-11 items-center px-0.5 focus-visible:rounded-full"
      >
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--warning-border)] bg-[var(--warning-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--warning-text)] shadow-2xs">
          <span className="size-1.5 rounded-full bg-[var(--accent-gold)]" aria-hidden="true" />
          {COPY.pill[lang]}
        </span>
      </button>
      {open && (
        <div
          id={popId}
          role="tooltip"
          data-testid="demo-popover"
          className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-[var(--warning-border)] bg-[var(--bg-surface)] p-3 text-xs leading-relaxed text-[var(--text-primary)] shadow-lg"
        >
          <p className="font-semibold text-[var(--warning-text)]">{COPY.detail[lang]}</p>
        </div>
      )}
    </div>
  );
}
