"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";

// Static bilingual copy (no cookie read, no server data): Bangla first, English under it, like not-found.
// Whatever broke, the way out of an emergency — calling 999 — must still be one tap away.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Server errors arrive with only a digest (details stay in the server log).
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <h1 className="text-xl font-bold">কিছু একটা সমস্যা হয়েছে</h1>
      <p lang="en" className="text-zinc-600 dark:text-zinc-400">
        Something went wrong. Please try again.
      </p>
      <a
        href="tel:999"
        className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-6 text-lg font-bold text-white shadow-sm hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
      >
        <span aria-hidden="true">📞</span>
        ৯৯৯-এ কল করুন <span lang="en" className="font-normal">/ Call 999</span>
      </a>
      <button
        type="button"
        onClick={() => retry()}
        className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 px-4 font-semibold hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        আবার চেষ্টা করুন <span lang="en" className="ml-1 font-normal">/ Try again</span>
      </button>
    </main>
  );
}
