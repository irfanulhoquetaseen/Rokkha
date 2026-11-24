import type { Server } from "socket.io";

// The Socket.io server lives on globalThis so Next route handlers (same process) can emit after a
// transaction commits. Kept in its own module (no imports from auth) so session.ts can revoke
// sockets without an import cycle.
const globalForIO = globalThis as unknown as { io?: Server };

export function getIO(): Server | undefined {
  return globalForIO.io;
}

export function setIO(io: Server | undefined): void {
  globalForIO.io = io;
}

/**
 * Internal per-session room (`session:{sha256 of token}`). The subscribe/unsubscribe regex can
 * never match it, so only the server joins sockets to it — at handshake.
 */
export function sessionRoom(sessionHash: string): string {
  return `session:${sessionHash}`;
}

/** Drop every socket opened with this session (logout, rotation, expiry): its private rooms go with it. */
export function disconnectSessionSockets(sessionHash: string): void {
  getIO()?.in(sessionRoom(sessionHash)).disconnectSockets(true);
}
