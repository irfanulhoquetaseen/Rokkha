import type { Prisma, ReservationStatus } from "@/generated/prisma/client";

export const reservationViewInclude = {
  hospital: { select: { id: true, slug: true, nameBn: true, nameEn: true, phone: true, isDemo: true } },
  resourceType: { select: { code: true, nameBn: true, nameEn: true, consumable: true } },
  events: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { toStatus: true, fromStatus: true, createdAt: true, note: true },
  },
} as const satisfies Prisma.ReservationInclude;

export type ReservationViewRow = Prisma.ReservationGetPayload<{ include: typeof reservationViewInclude }>;

export type ReservationView = {
  id: string;
  status: ReservationStatus;
  quantity: number;
  expiresAt: Date;
  createdAt: Date;
  arrivedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  rejectedAt: Date | null;
  expiredAt: Date | null;
  rejectedReason: string | null;
  version: number;
  hospital: { id: string; slug: string; nameBn: string; nameEn: string; phone: string; isDemo: boolean };
  resource: { code: string; nameBn: string; nameEn: string; consumable: boolean };
  events: { toStatus: ReservationStatus; fromStatus: ReservationStatus | null; createdAt: Date; note: string | null }[];
};

export function toReservationView(row: ReservationViewRow): ReservationView {
  return {
    id: row.id, status: row.status, quantity: row.quantity, expiresAt: row.expiresAt, createdAt: row.createdAt,
    arrivedAt: row.arrivedAt, completedAt: row.completedAt, cancelledAt: row.cancelledAt, rejectedAt: row.rejectedAt,
    expiredAt: row.expiredAt, rejectedReason: row.rejectedReason, version: row.version,
    hospital: { ...row.hospital },
    resource: { ...row.resourceType },
    events: row.events.map((e) => ({ toStatus: e.toStatus, fromStatus: e.fromStatus, createdAt: e.createdAt, note: e.note })),
  };
}

export async function loadReservationView(db: Prisma.TransactionClient, id: string): Promise<ReservationView> {
  return toReservationView(await db.reservation.findUniqueOrThrow({ where: { id }, include: reservationViewInclude }));
}
