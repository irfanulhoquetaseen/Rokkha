/** How long a hold keeps the resource before the sweeper (or a lazy read) expires it. */
export const HOLD_MINUTES = 30;
/** Max active (HELD | ARRIVED) reservations per user; 1 per resource type is enforced by a partial unique index. */
export const MAX_ACTIVE_TOTAL = 2;
export const ACTIVE_STATUSES = ["HELD", "ARRIVED"] as const;
