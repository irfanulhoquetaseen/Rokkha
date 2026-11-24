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
      // Network failure: the server session may survive, but navigating home re-renders the
      // header from the real cookie state, so the UI never claims a logout that didn't happen.
    }
    resetLiveSocket(); // drop the old session from the live socket
    router.push("/");
    router.refresh();
    setPending(false);
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={pending}
      className="min-h-11 rounded-md border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-600 dark:hover:bg-zinc-800"
    >
      {auth.logout[lang]}
    </button>
  );
}
