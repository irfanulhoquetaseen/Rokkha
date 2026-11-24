import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler, parseBody } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { changeRoleSchema, changeUserRole, listUsers, userListSchema } from "@/server/admin/users";

const NO_STORE = { "Cache-Control": "no-store" };
const intParam = z.string().regex(/^\d{1,6}$/).transform(Number).optional();

function opt(sp: URLSearchParams, key: string): string | undefined {
  const v = sp.get(key);
  return v === null || v === "" ? undefined : v;
}

export const GET = apiHandler(async (req) => {
  const user = await getUserFromRequest(req);
  const sp = new URL(req.url).searchParams;
  const input = userListSchema.parse({
    search: opt(sp, "search"),
    role: opt(sp, "role"),
    page: intParam.parse(opt(sp, "page")),
    pageSize: intParam.parse(opt(sp, "pageSize")),
  });
  const result = await listUsers(user, input);
  return NextResponse.json(result, { headers: NO_STORE });
});

export const PATCH = apiHandler(async (req) => {
  const user = await getUserFromRequest(req);
  const input = await parseBody(req, changeRoleSchema);
  const updated = await changeUserRole(user, input);
  return NextResponse.json(updated, { headers: NO_STORE });
}, { mutation: true });
