"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resetLiveSocket } from "@/components/realtime/socket";
import { auth } from "@/lib/i18n/auth";
import type { Lang } from "@/lib/i18n";

export function LogoutButton({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onLogout() {
    if (pending) return;
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Network failure: re-render reflects cookie state accurately.
    }
    resetLiveSocket();
    router.push("/");
    router.refresh();
    setPending(false);
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={pending}
      className="min-h-11 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-60"
    >
      {auth.logout[lang]}
    </button>
  );
}
