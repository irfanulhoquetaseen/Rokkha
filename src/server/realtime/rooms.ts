import { z } from "zod";
import { AppError } from "@/lib/errors";
import { requireHospitalAccess, requireReservationOwner } from "@/server/auth/guards";
import type { SessionUser } from "@/server/auth/session";

// Socket.io room authorization. Clients only ever enter a room through `subscribe`, which
// calls authorizeRoom with the user re-derived from the session (never a client-sent id).
//  - finder, hospital:{id}      public (stock levels are public data)
//  - staff:{hospitalId}         HOSPITAL_STAFF of that hospital, or ADMIN
//  - reservation:{id}           its owner, or ADMIN
// Denials for signed-in users are audited AUTHZ_DENIED by the guards.

export const ROOM_PATTERN = /^(finder|hospital:[\w-]{1,64}|staff:[\w-]{1,64}|reservation:[\w-]{1,64})$/;

export const roomPayloadSchema = z.object({ room: z.string().max(100).regex(ROOM_PATTERN) });

/** True when `user` (null = anonymous) may join `room`. Infrastructure errors propagate. */
export async function authorizeRoom(user: SessionUser | null, room: string): Promise<boolean> {
  if (!ROOM_PATTERN.test(room)) return false;
  const sep = room.indexOf(":");
  const kind = sep === -1 ? room : room.slice(0, sep);
  const id = sep === -1 ? "" : room.slice(sep + 1);
  try {
    switch (kind) {
      case "finder":
      case "hospital":
        return true;
      case "staff":
        await requireHospitalAccess(user, id);
        return true;
      case "reservation":
        await requireReservationOwner(user, id);
        return true;
      default:
        return false;
    }
  } catch (e) {
    if (e instanceof AppError) return false;
    throw e;
  }
}
