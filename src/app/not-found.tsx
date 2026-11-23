import Link from "next/link";

// Static on purpose (no cookie read → no streaming), so a 404 status set before rendering is kept.
// Shows Bangla first with the English line under it.
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center">
      <p className="text-5xl font-bold text-zinc-300 dark:text-zinc-700">404</p>
      <h1 className="text-xl font-bold">পাতাটি খুঁজে পাওয়া যায়নি</h1>
      <p lang="en" className="text-zinc-600 dark:text-zinc-400">This page could not be found.</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-md bg-red-700 px-4 font-semibold text-white hover:bg-red-800"
      >
        হোমে ফিরে যান <span lang="en" className="ml-1 font-normal">/ Go home</span>
      </Link>
    </main>
  );
}
