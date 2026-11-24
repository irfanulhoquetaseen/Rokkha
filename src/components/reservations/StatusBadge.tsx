import type { Lang } from "@/lib/i18n";
import { reservations as t } from "@/lib/i18n/reservations";

export type Status = "HELD" | "ARRIVED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "REJECTED";

const color: Record<Status, string> = {
  HELD: "bg-amber-400 text-black",
  ARRIVED: "bg-blue-700 text-white",
  COMPLETED: "bg-green-700 text-white",
  CANCELLED: "bg-zinc-600 text-white",
  EXPIRED: "bg-zinc-300 text-zinc-900",
  REJECTED: "bg-red-700 text-white",
};

export function statusLabel(status: Status, lang: Lang): string {
  return t[`status_${status}`][lang];
}

/** Status pill; `data-status` carries the raw status for tests and the live updater. */
export function StatusBadge({ status, lang, testId }: { status: Status; lang: Lang; testId?: string }) {
  return (
    <span
      data-testid={testId}
      data-status={status}
      className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-sm font-bold ${color[status]}`}
    >
      {statusLabel(status, lang)}
    </span>
  );
}
