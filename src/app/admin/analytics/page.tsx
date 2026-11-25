import { Suspense } from "react";
import { AnalyticsDashboard, type AnalyticsData } from "@/components/admin/AnalyticsDashboard";
import {
  avgHoldToArrival,
  holdOutcomeRates,
  reservationsPerConditionPerDay,
  soldOutEventsPerResourceAndDistrict,
  staleHospitals,
} from "@/server/admin/analytics";
import { requireAdminPage } from "@/server/admin/page-guard";

export default function AdminAnalyticsPage() {
  return (
    <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-900" />}>
      <AnalyticsBody />
    </Suspense>
  );
}

async function AnalyticsBody() {
  const { user, lang } = await requireAdminPage("/admin/analytics");
  const [perDay, soldOut, outcomeStats, avgMinutes, stale] = await Promise.all([
    reservationsPerConditionPerDay(user),
    soldOutEventsPerResourceAndDistrict(user),
    holdOutcomeRates(user),
    avgHoldToArrival(user),
    staleHospitals(user),
  ]);

  const initial: AnalyticsData = {
    perDay,
    soldOut,
    ...outcomeStats,
    avgMinutes,
    stale,
  };

  return <AnalyticsDashboard lang={lang} initial={initial} />;
}
