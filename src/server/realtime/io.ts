import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";

// The Socket.io server lives on globalThis so Next route handlers (same process)
// can emit after a transaction commits: `getIO()?.to(room).emit(...)`.
const globalForIO = globalThis as unknown as { io?: Server };

export function attachSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    path: "/socket.io",
    // Same-origin only; the client is served from this same host/port.
    cors: { origin: false },
  });

  io.on("connection", (socket) => {
    // P5 adds cookie-authenticated handshakes and room authorization.
    socket.emit("server:hello", { time: new Date().toISOString() });
  });

  globalForIO.io = io;
  return io;
}

export function getIO(): Server | undefined {
  return globalForIO.io;
}
