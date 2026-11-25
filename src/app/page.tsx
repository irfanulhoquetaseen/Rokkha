import Link from "next/link";
import { Suspense } from "react";
import { ConditionIcon } from "@/components/brand/ConditionIcon";
import { LogoMark } from "@/components/brand/Logo";
import { Call999Button } from "@/components/Call999Button";
import { ConditionGrid, ConditionGridSkeleton } from "@/components/finder/ConditionGrid";
import { auth } from "@/lib/i18n/auth";
import { finder } from "@/lib/i18n/finder";
import { listConditions } from "@/server/finder/search";
import { getLang } from "@/server/i18n/lang";

/** Home = Finder entry: pick the emergency (public, no login). */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-6">
      <Suspense fallback={<HomeSkeleton />}>
        <HomeBody />
      </Suspense>
    </main>
  );
}

async function HomeBody() {
  const [lang, conditions] = await Promise.all([getLang(), listConditions()]);
  const steps = [finder.step1[lang], finder.step2[lang], finder.step3[lang]];

  return (
    <>
      <section className="flex flex-col gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-xs sm:p-6">
        <div className="inline-flex w-fit items-center gap-2 rounded-full bg-[var(--bg-brand-tint)] px-3 py-1 text-xs font-semibold text-[var(--brand-primary-text)]">
          <LogoMark size={16} />
          <span>{auth.tagline[lang]}</span>
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--text-primary)] sm:text-3xl">
          {finder.homeTitle[lang]}
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-[var(--text-muted)]">
          {finder.homeIntro[lang]}
        </p>
        <ol
          aria-label={finder.howItWorksTitle[lang]}
          className="mt-1 grid grid-cols-1 gap-2 pt-2 text-xs font-semibold text-[var(--brand-primary-text)] sm:grid-cols-3"
        >
          {steps.map((step) => (
            <li
              key={step}
              className="flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-brand-tint)] px-3 py-2"
            >
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="conditions-heading" className="flex flex-col gap-3">
        <h2 id="conditions-heading" className="sr-only">
          {finder.pickCondition[lang]}
        </h2>
        <ConditionGrid conditions={conditions} lang={lang} />
      </section>

      <section className="flex flex-col items-center gap-3 rounded-xl border border-[var(--emergency-border)] bg-[var(--emergency-tint)] p-5 text-center shadow-xs sm:flex-row sm:justify-between sm:text-left">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--emergency)] text-white" aria-hidden="true">
            <ConditionIcon code="HEART_ATTACK" className="size-5" />
          </span>
          <p className="text-base font-bold text-[var(--emergency-text)]">{finder.call999Hint[lang]}</p>
        </div>
        <Call999Button lang={lang} size="lg" />
      </section>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-default)] pt-4 text-xs text-[var(--text-muted)]">
        <span>{finder.footerTagline[lang]}</span>
        <Link href="/status" className="inline-flex min-h-11 items-center font-medium text-[var(--brand-primary-text)] underline">
          {finder.systemStatus[lang]}
        </Link>
      </footer>
    </>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-6 motion-safe:animate-pulse" aria-hidden="true">
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
        <div className="h-6 w-52 rounded-full bg-[var(--bg-brand-tint)]" />
        <div className="h-8 w-64 rounded bg-[var(--bg-subtle)]" />
        <div className="h-12 w-full rounded bg-[var(--bg-subtle)]" />
      </div>
      <ConditionGridSkeleton />
      <div className="h-24 rounded-xl bg-[var(--emergency-tint)]" />
    </div>
  );
}
