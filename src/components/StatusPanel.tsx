"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";

type Health = { status: string; db: "up" | "down"; time: string };

export function StatusPanel() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [socketState, setSocketState] = useState<"connecting" | "connected" | "disconnected">("connecting");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json() as Promise<Health>)
      .then((h) => !cancelled && setHealth(h))
      .catch(() => !cancelled && setHealthError(true));

    const socket = io({ path: "/socket.io" });
    socket.on("connect", () => setSocketState("connected"));
    socket.on("disconnect", () => setSocketState("disconnected"));
    socket.on("connect_error", () => setSocketState("disconnected"));
    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, []);

  const apiText = healthError ? "unreachable" : health ? `${health.status} (db ${health.db})` : "checking…";

  return (
    <section aria-label="System status" className="w-full max-w-sm rounded-lg border border-zinc-300 p-4 text-sm">
      <h2 className="mb-2 font-semibold">System status</h2>
      <dl className="grid grid-cols-2 gap-y-1">
        <dt>API health</dt>
        <dd data-testid="api-health">{apiText}</dd>
        <dt>Socket.io</dt>
        <dd data-testid="socket-status">{socketState}</dd>
      </dl>
    </section>
  );
}
