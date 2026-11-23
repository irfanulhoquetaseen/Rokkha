import { StatusPanel } from "@/components/StatusPanel";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 py-10">
      <h1 className="text-2xl font-bold">JibonSetu</h1>
      <p className="text-center text-zinc-600">Live emergency healthcare finder for Bangladesh — under construction.</p>
      <StatusPanel />
    </main>
  );
}
