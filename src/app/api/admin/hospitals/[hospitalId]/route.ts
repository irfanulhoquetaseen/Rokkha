import { NextResponse } from "next/server";
import { apiHandler, parseBody } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { deleteOrArchiveHospital, getHospitalDetail, hospitalUpdateSchema, updateHospital } from "@/server/admin/hospitals";

const NO_STORE = { "Cache-Control": "no-store" };
type Ctx = { params: Promise<{ hospitalId: string }> };

export const GET = apiHandler(async (req, ctx: Ctx) => {
  const user = await getUserFromRequest(req);
  const { hospitalId } = await ctx.params;
  const hospital = await getHospitalDetail(user, hospitalId);
  return NextResponse.json(hospital, { headers: NO_STORE });
});

export const PATCH = apiHandler(async (req, ctx: Ctx) => {
  const user = await getUserFromRequest(req);
  const { hospitalId } = await ctx.params;
  const input = await parseBody(req, hospitalUpdateSchema);
  const hospital = await updateHospital(user, hospitalId, input);
  return NextResponse.json(hospital, { headers: NO_STORE });
}, { mutation: true });

export const DELETE = apiHandler(async (req, ctx: Ctx) => {
  const user = await getUserFromRequest(req);
  const { hospitalId } = await ctx.params;
  const result = await deleteOrArchiveHospital(user, hospitalId);
  return NextResponse.json(result, { headers: NO_STORE });
}, { mutation: true });
