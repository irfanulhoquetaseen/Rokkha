import { NextResponse } from "next/server";
import { apiHandler } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import {
  reservationsPerConditionPerDay,
  soldOutEventsPerResourceAndDistrict,
  holdOutcomeRates,
  avgHoldToArrival,
  staleHospitals,
} from "@/server/admin/analytics";

const NO_STORE = { "Cache-Control": "no-store" };

export const GET = apiHandler(async (req) => {
  const user = await getUserFromRequest(req);
  const [perDay, soldOut, outcomeStats, avgMinutes, stale] = await Promise.all([
    reservationsPerConditionPerDay(user),
    soldOutEventsPerResourceAndDistrict(user),
    holdOutcomeRates(user),
    avgHoldToArrival(user),
    staleHospitals(user),
  ]);
  return NextResponse.json({ perDay, soldOut, ...outcomeStats, avgMinutes, stale }, { headers: NO_STORE });
});
