import Link from "next/link";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { Logo } from "@/components/brand/Logo";
import { DemoBadge } from "@/components/DemoBadge";
import { LangToggle } from "@/components/LangToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { auth } from "@/lib/i18n/auth";
import { reservations } from "@/lib/i18n/reservations";
import { getCurrentUser } from "@/server/auth/current-user";
import { getLang } from "@/server/i18n/lang";

const shell =
  "flex min-h-16 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-1.5 shadow-2xs";
const linkBtn =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold transition-colors";

/** Reads the session + lang cookies, so it must render inside <Suspense> (Cache Components). */
export async function SiteHeader() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);

  return (
    <header className={shell}>
      <div className="flex items-center gap-2">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg pr-1">
          <Logo lang={lang} size={30} />
        </Link>
        <DemoBadge lang={lang} />
      </div>
      <nav aria-label={lang === "bn" ? "প্রধান নেভিগেশন" : "Primary navigation"} className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <ThemeToggle lang={lang} />
        <LangToggle lang={lang} />
        {user ? (
          <>
            <span
              className="max-w-[8.5rem] truncate rounded-md bg-[var(--bg-subtle)] px-2.5 py-1 text-sm font-medium text-[var(--text-primary)] sm:max-w-xs"
              title={user.name}
            >
              {user.name}
            </span>
            {user.role === "CITIZEN" && (
              <Link
                href="/reservations"
                data-testid="my-reservations-link"
                className={`${linkBtn} bg-[var(--bg-brand-tint)] text-[var(--brand-primary-text)] hover:opacity-90`}
              >
                {reservations.myReservations[lang]}
              </Link>
            )}
            {user.role === "HOSPITAL_STAFF" && (
              <Link
                href="/staff"
                className={`${linkBtn} bg-[var(--bg-brand-tint)] text-[var(--brand-primary-text)] hover:opacity-90`}
              >
                {auth.staffConsole[lang]}
              </Link>
            )}
            {user.role === "ADMIN" && (
              <>
                <Link
                  href="/staff"
                  className={`${linkBtn} border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]`}
                >
                  {auth.staffConsole[lang]}
                </Link>
                <Link
                  href="/admin"
                  data-testid="admin-link"
                  className={`${linkBtn} bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)]`}
                >
                  {auth.adminPanel[lang]}
                </Link>
              </>
            )}
            <LogoutButton lang={lang} />
          </>
        ) : (
          <>
            <Link
              href="/login"
              className={`${linkBtn} border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]`}
            >
              {auth.login[lang]}
            </Link>
            <Link
              href="/signup"
              className={`${linkBtn} bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)]`}
            >
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
      <div className="flex items-center gap-2">
        <div className="h-8 w-28 rounded-lg bg-[var(--bg-subtle)]" />
        <div className="h-6 w-14 rounded-full bg-[var(--warning-bg)]" />
      </div>
      <div className="h-11 w-44 rounded-lg bg-[var(--bg-subtle)]" />
    </div>
  );
}
