import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";
import { auth } from "@/lib/i18n/auth";
import { safeNextPath } from "@/lib/safe-next";
import { getLang } from "@/server/i18n/lang";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Shared shell for /login and /signup. The lang cookie + searchParams are request-time, hence <Suspense>. */
export function AuthPage({ mode, searchParams }: { mode: "login" | "signup"; searchParams: SearchParams }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-4 py-8">
      <Suspense fallback={<AuthSkeleton />}>
        <AuthBody mode={mode} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function AuthBody({ mode, searchParams }: { mode: "login" | "signup"; searchParams: SearchParams }) {
  const [lang, sp] = await Promise.all([getLang(), searchParams]);
  const next = safeNextPath(sp.next);
  const nextQuery = next === "/" ? "" : `?next=${encodeURIComponent(next)}`;
  const isLogin = mode === "login";

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-xs">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-extrabold">{isLogin ? auth.loginTitle[lang] : auth.signupTitle[lang]}</h1>
        <p className="text-sm text-[var(--text-muted)]">{auth.whyLogin[lang]}</p>
      </div>
      <AuthForm mode={mode} lang={lang} next={next} />
      <p className="border-t border-[var(--border-default)] pt-3 text-sm text-[var(--text-muted)]">
        {isLogin ? auth.noAccount[lang] : auth.haveAccount[lang]}{" "}
        <Link
          href={`${isLogin ? "/signup" : "/login"}${nextQuery}`}
          className="inline-flex min-h-11 items-center font-semibold text-[var(--brand-primary-text)] underline"
        >
          {isLogin ? auth.signup[lang] : auth.login[lang]}
        </Link>
      </p>
    </div>
  );
}

function AuthSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-8 w-40 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-10 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-12 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-12 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-12 w-full rounded bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}
