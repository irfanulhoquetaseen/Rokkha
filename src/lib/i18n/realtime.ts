import type { Bilingual } from "@/lib/errors";

export const realtime = {
  reconnecting: { bn: "আবার সংযোগ হচ্ছে…", en: "Reconnecting…" },
} as const satisfies Record<string, Bilingual>;
