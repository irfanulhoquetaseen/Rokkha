import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { LangToggle } from "@/components/LangToggle";
import { auth } from "@/lib/i18n/auth";
import { reservations } from "@/lib/i18n/reservations";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLang } from "@/server/i18n/lang";

const shell = "flex min-h-14 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-1 dark:border-zinc-800";
const linkBtn = "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium";

/** Reads the session + lang cookies, so it must render inside <Suspense> (Cache Components). */
export async function SiteHeader() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);

  return (
    <header className={shell}>
      <Link href="/" className="inline-flex min-h-11 items-center text-lg font-bold text-red-700 dark:text-red-400">
        {auth.appName[lang]}
      </Link>
      <nav className="flex flex-wrap items-center gap-2">
        <LangToggle lang={lang} />
        {user ? (
          <>
            <span className="max-w-[9rem] truncate text-sm font-medium sm:max-w-xs" title={user.name}>
              {user.name}
            </span>
            {user.role === "CITIZEN" && (
              <Link href="/reservations" data-testid="my-reservations-link" className={`${linkBtn} hover:bg-zinc-100 dark:hover:bg-zinc-800`}>
                {reservations.myReservations[lang]}
              </Link>
            )}
            {user.role === "HOSPITAL_STAFF" && (
              <Link href="/staff" className={`${linkBtn} hover:bg-zinc-100 dark:hover:bg-zinc-800`}>
                {auth.staffConsole[lang]}
              </Link>
            )}
            <LogoutButton lang={lang} />
          </>
        ) : (
          <>
            <Link href="/login" className={`${linkBtn} hover:bg-zinc-100 dark:hover:bg-zinc-800`}>
              {auth.login[lang]}
            </Link>
            <Link href="/signup" className={`${linkBtn} bg-red-700 text-white hover:bg-red-800`}>
              {auth.signup[lang]}
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

/** Same-height placeholder while the session is read, so the page below never shifts (CLS). */
export function SiteHeaderSkeleton() {
  return (
    <div className={shell} aria-hidden="true">
      <div className="h-6 w-24 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-11 w-40 rounded bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}
