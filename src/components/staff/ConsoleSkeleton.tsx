/** Placeholder with the console's rough shape while the session and stock are read (no blank screen, low CLS). */
export function ConsoleSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <div className="h-8 w-3/4 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-4 w-1/2 rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="h-12 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="h-28 w-full rounded-lg bg-zinc-100 dark:bg-zinc-900" />
      ))}
    </div>
  );
}
