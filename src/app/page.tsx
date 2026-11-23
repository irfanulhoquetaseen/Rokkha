import Link from "next/link";
import { Suspense } from "react";
import { Call999Button } from "@/components/Call999Button";
import { ConditionGrid, ConditionGridSkeleton } from "@/components/finder/ConditionGrid";
import { finder } from "@/lib/i18n/finder";
import { listConditions } from "@/server/finder/search";
import { getLang } from "@/server/i18n/lang";

/** Home = Finder entry: pick the emergency (public, no login). */
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6">
      <Suspense fallback={<HomeSkeleton />}>
        <HomeBody />
      </Suspense>
    </main>
  );
}

async function HomeBody() {
  const [lang, conditions] = await Promise.all([getLang(), listConditions()]);
  return (
    <>
      <section className="flex flex-col gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">{finder.homeTitle[lang]}</h1>
        <p className="text-zinc-700 dark:text-zinc-300">{finder.homeIntro[lang]}</p>
      </section>
      <ConditionGrid conditions={conditions} lang={lang} />
      <section className="flex flex-col items-center gap-2 rounded-xl bg-red-50 p-4 text-center dark:bg-red-950/30">
        <p className="text-sm font-medium text-red-900 dark:text-red-100">{finder.call999Hint[lang]}</p>
        <Call999Button lang={lang} size="lg" />
      </section>
      <footer className="mt-auto flex justify-center">
        <Link href="/status" className="inline-flex min-h-11 items-center text-xs text-zinc-500 underline">
          {finder.systemStatus[lang]}
        </Link>
      </footer>
    </>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="flex flex-col gap-3">
        <div className="h-8 w-56 rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-12 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
      </div>
      <ConditionGridSkeleton />
      <div className="h-28 rounded-xl bg-red-50 dark:bg-red-950/30" />
    </div>
  );
}
