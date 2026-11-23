/** Layout-matching placeholder for /find while the DB query runs (never a blank screen). */
export function FinderSkeleton() {
  return (
    <div className="flex flex-col gap-4 motion-safe:animate-pulse" aria-hidden="true">
      <div className="h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-40 rounded-xl bg-green-50 dark:bg-green-950/20" />
      <div className="h-48 rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-44 rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      ))}
    </div>
  );
}
