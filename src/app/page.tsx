import Link from "next/link";

// Placeholder home; P3 replaces it with the Emergency Finder.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">JibonSetu</h1>
      <p className="text-center text-zinc-600 dark:text-zinc-400">
        Live emergency healthcare finder for Bangladesh — under construction.
      </p>
      <Link href="/status" className="inline-flex min-h-11 items-center text-sm underline">
        System status
      </Link>
    </main>
  );
}
