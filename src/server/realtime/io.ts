import type { IncomingMessage, Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { ErrorCode } from "@/lib/errors";
import { sessionTokenFromCookieHeader, validateSessionToken, type SessionUser } from "@/server/auth/session";
import { isSameOrigin } from "@/server/http/origin";
import { authorizeRoom, roomPayloadSchema } from "./rooms";

// The Socket.io server lives on globalThis so Next route handlers (same process)
// can emit after a transaction commits: `getIO()?.to(room).emit(...)`.
const globalForIO = globalThis as unknown as { io?: Server };

/** Per-socket state. `token` is the raw session token: kept server-side only, never logged or emitted. */
type SocketData = { token: string | null; userId: string | null };

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
  const { token } = data;
  // Re-validated on every subscribe, so logout (session deleted) or expiry revokes access.
  const user = token ? await validateSessionToken(token) : null;
  data.userId = user?.id ?? null;
  return user;
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
    data.token = sessionTokenFromCookieHeader(socket.handshake.headers.cookie);
    data.userId = null;
    if (!data.token) return next();
    validateSessionToken(data.token)
      .then((user) => { data.userId = user?.id ?? null; })
      .catch(() => { data.userId = null; })
      .finally(() => next());
  });

  io.on("connection", (socket) => {
    socket.emit("server:hello", { time: new Date().toISOString() });

    socket.on("subscribe", async (payload: unknown, ack?: unknown) => {
      const reply: Ack = typeof ack === "function" ? (ack as Ack) : () => {};
      const parsed = roomPayloadSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, code: "VALIDATION_ERROR" });
      const { room } = parsed.data;
      try {
        const user = await currentUser(socket);
        if (!(await authorizeRoom(user, room))) return reply({ ok: false, code: "NOT_FOUND" });
        await socket.join(room);
        reply({ ok: true });
      } catch {
        reply({ ok: false, code: "INTERNAL" });
      }
    });

    socket.on("unsubscribe", async (payload: unknown, ack?: unknown) => {
      const reply: Ack = typeof ack === "function" ? (ack as Ack) : () => {};
      const parsed = roomPayloadSchema.safeParse(payload);
      if (!parsed.success) return reply({ ok: false, code: "VALIDATION_ERROR" });
      await socket.leave(parsed.data.room);
      reply({ ok: true });
    });
  });

  globalForIO.io = io;
  return io;
}

export function getIO(): Server | undefined {
  return globalForIO.io;
}
