import { NextResponse } from "next/server";
import { apiHandler } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { listHospitalResources } from "@/server/resources/queries";

export const GET = apiHandler(async (req: Request, ctx: { params: Promise<{ hospitalId: string }> }) => {
  const { hospitalId } = await ctx.params;
  const user = await getUserFromRequest(req);
  const data = await listHospitalResources(user, hospitalId);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
});
