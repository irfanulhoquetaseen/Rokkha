import type { IncomingMessage, Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { ErrorCode } from "@/lib/errors";
import {
  hashSessionToken, sessionTokenFromCookieHeader, validateSessionHash, type SessionUser,
} from "@/server/auth/session";
import { isSameOrigin } from "@/server/http/origin";
import { sessionRoom, setIO } from "./registry";
import { authorizeRoom, roomPayloadSchema } from "./rooms";

export { getIO } from "./registry";

/** Most client-chosen rooms one socket may be in (its own id and session rooms not counted). */
export const MAX_ROOMS_PER_SOCKET = 20;

/** Per-socket state. Only the SHA-256 of the session token is kept, never the raw token. */
type SocketData = { sessionHash: string | null; userId: string | null };

type Ack = (res: { ok: true } | { ok: false; code: ErrorCode }) => void;

/**
 * Cross-site WebSocket hijacking guard: a browser always sends Origin on a WebSocket handshake,
 * so a foreign Origin is refused. Requests without Origin (same-origin polling GETs, non-browser
 * clients) carry no ambient-cookie risk from another site and are allowed.
 */
function allowRequest(req: IncomingMessage, cb: (err: string | null | undefined, ok: boolean) => void): void {
  const h = req.headers;
  if (!h.origin) return cb(null, true);
  const headers = new Headers();
  headers.set("origin", h.origin);
  if (typeof h.host === "string") headers.set("host", h.host);
  const fwd = h["x-forwarded-host"];
  if (typeof fwd === "string") headers.set("x-forwarded-host", fwd);
  const ok = isSameOrigin(headers);
  cb(ok ? null : "Origin not allowed", ok);
}

const dataOf = (socket: Socket): SocketData => socket.data as SocketData;

async function currentUser(socket: Socket): Promise<SessionUser | null> {
  const data = dataOf(socket);
  // Re-validated on every subscribe, so logout (session deleted) or expiry revokes access.
  const user = data.sessionHash ? await validateSessionHash(data.sessionHash) : null;
  data.userId = user?.id ?? null;
  return user;
}

/** Rooms the client chose via subscribe (excludes the socket's own id room and its session room). */
function clientRoomCount(socket: Socket): number {
  const { sessionHash } = dataOf(socket);
  const own = new Set([socket.id, ...(sessionHash ? [sessionRoom(sessionHash)] : [])]);
  let n = 0;
  for (const r of socket.rooms) if (!own.has(r)) n++;
  return n;
}

/** Infra failures are logged without payloads or session data (never the token). */
function logFailure(event: string, e: unknown): void {
  const err = e instanceof Error ? e : new Error(String(e));
  const code = (err as { code?: unknown }).code;
  console.error(`[socket] ${event} failed`, { name: err.name, code: typeof code === "string" ? code : undefined, message: err.message.slice(0, 200) });
}

export function attachSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/socket.io",
    // Same-origin only; the client is served from this same host/port.
    cors: { origin: false },
    allowRequest,
    // Payloads are tiny `{ room }` objects; cap what a client can push at us.
    maxHttpBufferSize: 10_000,
  });

  // Resolve the session from the handshake Cookie header. A bad/expired cookie (or a DB hiccup)
  // just means an anonymous socket: public rooms still work.
  io.use((socket, next) => {
    const data = dataOf(socket);
    data.sessionHash = null;
    data.userId = null;
    const token = sessionTokenFromCookieHeader(socket.handshake.headers.cookie);
    if (!token) return next();
    const hash = hashSessionToken(token);
    validateSessionHash(hash)
      .then((user) => {
        if (user) { data.sessionHash = hash; data.userId = user.id; }
      })
      .catch((e: unknown) => logFailure("handshake", e))
      .finally(() => next());
  });

  io.on("connection", (socket) => {
    const { sessionHash } = dataOf(socket);
    // Server-only room: deleting the session (logout/rotation/expiry) disconnects these sockets.
    if (sessionHash) void socket.join(sessionRoom(sessionHash));
    socket.emit("server:hello", { time: new Date().toISOString() });

    socket.on("subscribe", async (payload: unknown, ack?: unknown) => {
      const reply: Ack = typeof ack === "function" ? (ack as Ack) : () => {};
      const parsed = roomPayloadSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, code: "VALIDATION_ERROR" });
      const { room } = parsed.data;
      if (!socket.rooms.has(room) && clientRoomCount(socket) >= MAX_ROOMS_PER_SOCKET) {
        return reply({ ok: false, code: "LIMIT_REACHED" });
      }
      try {
        const user = await currentUser(socket);
        if (!(await authorizeRoom(user, room))) return reply({ ok: false, code: "NOT_FOUND" });
        // The session may have been revoked (socket disconnected) while we awaited.
        if (!socket.connected) return;
        await socket.join(room);
        reply({ ok: true });
      } catch (e) {
        logFailure("subscribe", e);
        reply({ ok: false, code: "INTERNAL" });
      }
    });

    socket.on("unsubscribe", async (payload: unknown, ack?: unknown) => {
      const reply: Ack = typeof ack === "function" ? (ack as Ack) : () => {};
      const parsed = roomPayloadSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, code: "VALIDATION_ERROR" });
      try {
        await socket.leave(parsed.data.room);
        reply({ ok: true });
      } catch (e) {
        logFailure("unsubscribe", e);
        reply({ ok: false, code: "INTERNAL" });
      }
    });
  });

  setIO(io);
  return io;
}
