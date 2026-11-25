import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { FirstAidCard } from "@/components/finder/FirstAidCard";
import { finder } from "@/lib/i18n/finder";
import { finderParamsSchema } from "@/server/finder/params";
import { getFirstAidGuide } from "@/server/finder/search";
import { getLang } from "@/server/i18n/lang";

export const metadata: Metadata = { title: "First aid — Rokkha" };

type Params = Promise<{ condition: string }>;

export default function FirstAidPage({ params }: PageProps<"/first-aid/[condition]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-4">
      <Suspense fallback={<FirstAidSkeleton />}>
        <FirstAidBody params={params} />
      </Suspense>
    </main>
  );
}

async function FirstAidBody({ params }: { params: Params }) {
  const [{ condition }, lang] = await Promise.all([params, getLang()]);
  const code = finderParamsSchema.shape.condition.safeParse(condition);
  if (!code.success || code.data === undefined) notFound();
  const guide = await getFirstAidGuide(code.data);
  if (!guide) notFound();

  return (
    <>
      <h1 className="text-2xl font-bold break-words">
        {finder.firstAid[lang]}: {lang === "bn" ? guide.condition.nameBn : guide.condition.nameEn}
      </h1>
      <FirstAidCard guide={guide} lang={lang} variant="full" />
      <Link
        href={`/find?condition=${encodeURIComponent(guide.condition.code)}`}
        className="inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--brand-primary)] px-5 font-semibold text-white shadow-xs transition-colors hover:bg-[var(--brand-primary-hover)]"
      >
        {finder.findHospitals[lang]} →
      </Link>
    </>
  );
}

function FirstAidSkeleton() {
  return (
    <div className="flex flex-col gap-4 motion-safe:animate-pulse" aria-hidden="true">
      <div className="h-8 w-64 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-96 rounded-xl bg-green-50 dark:bg-green-950/20" />
    </div>
  );
}
