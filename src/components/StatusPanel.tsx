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
    <section aria-label="System status" className="w-full max-w-sm rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 text-sm shadow-xs">
      <h2 className="mb-3 text-base font-bold">System status</h2>
      <dl className="grid grid-cols-2 gap-y-2">
        <dt className="text-[var(--text-muted)]">API health</dt>
        <dd data-testid="api-health" className="font-semibold text-[var(--brand-primary-text)]">{apiText}</dd>
        <dt className="text-[var(--text-muted)]">Socket.io</dt>
        <dd data-testid="socket-status" className="font-semibold text-[var(--brand-primary-text)]">{socketState}</dd>
      </dl>
    </section>
  );
}
