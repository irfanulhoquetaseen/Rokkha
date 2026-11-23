"use client";

import { useRouter } from "next/navigation";
import { auth } from "@/lib/i18n/auth";
import { LANG_COOKIE, type Lang } from "@/lib/i18n";

/** Switches bn <-> en: stores the choice in the `lang` cookie and re-renders server components. */
export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const other: Lang = lang === "bn" ? "en" : "bn";

  function switchLang() {
    document.cookie = `${LANG_COOKIE}=${other}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={switchLang}
      aria-label={auth.switchLangLabel[lang]}
      lang={other}
      className="min-h-11 min-w-11 rounded-md border border-zinc-300 px-3 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
    >
      {auth.switchLang[lang]}
    </button>
  );
}
