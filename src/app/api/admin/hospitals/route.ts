import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, parseBody } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { createHospital, hospitalCreateSchema, hospitalListSchema, listHospitals } from "@/server/admin/hospitals";

const NO_STORE = { "Cache-Control": "no-store" };

const boolParam = z.enum(["true", "false"]).transform((v) => v === "true").optional();
const intParam = z.string().regex(/^\d{1,6}$/).transform(Number).optional();

function opt(sp: URLSearchParams, key: string): string | undefined {
  const v = sp.get(key);
  return v === null || v === "" ? undefined : v;
}

export const GET = apiHandler(async (req) => {
  const user = await getUserFromRequest(req);
  const sp = new URL(req.url).searchParams;
  const input = hospitalListSchema.parse({
    search: opt(sp, "search"),
    type: opt(sp, "type"),
    liveDataEnabled: boolParam.parse(opt(sp, "liveDataEnabled")),
    archived: boolParam.parse(opt(sp, "archived")),
    sort: opt(sp, "sort"),
    order: opt(sp, "order"),
    page: intParam.parse(opt(sp, "page")),
    pageSize: intParam.parse(opt(sp, "pageSize")),
  });
  const result = await listHospitals(user, input);
  return NextResponse.json(result, { headers: NO_STORE });
});

export const POST = apiHandler(async (req) => {
  const user = await getUserFromRequest(req);
  const input = await parseBody(req, hospitalCreateSchema);
  const hospital = await createHospital(user, input);
  return NextResponse.json(hospital, { status: 201, headers: NO_STORE });
}, { mutation: true });
