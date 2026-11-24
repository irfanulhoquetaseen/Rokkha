import { NextResponse } from "next/server";
import { apiHandler } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { listHospitalQueue } from "@/server/reservations/queries";

export const GET = apiHandler(async (req: Request, ctx: { params: Promise<{ hospitalId: string }> }) => {
  const { hospitalId } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  // Absent params stay undefined so the Zod defaults apply; validation happens in the query.
  const opt = (name: string) => sp.get(name) ?? undefined;
  const data = await listHospitalQueue(await getUserFromRequest(req), hospitalId, {
    status: opt("status"), q: opt("q"), sort: opt("sort"), page: opt("page"),
  });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
});
