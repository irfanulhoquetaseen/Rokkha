import { NextResponse } from "next/server";
import { z } from "zod";
import { apiHandler } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { auditListSchema, distinctActions, listAuditLogs } from "@/server/admin/audit-viewer";

const NO_STORE = { "Cache-Control": "no-store" };
const intParam = z.string().regex(/^\d{1,6}$/).transform(Number).optional();

function opt(sp: URLSearchParams, key: string): string | undefined {
  const v = sp.get(key);
  return v === null || v === "" ? undefined : v;
}

export const GET = apiHandler(async (req) => {
  const user = await getUserFromRequest(req);
  const sp = new URL(req.url).searchParams;

  if (sp.get("actions") === "true") {
    const actions = await distinctActions(user);
    return NextResponse.json({ actions }, { headers: NO_STORE });
  }

  const input = auditListSchema.parse({
    action: opt(sp, "action"),
    from: opt(sp, "from"),
    to: opt(sp, "to"),
    page: intParam.parse(opt(sp, "page")),
    pageSize: intParam.parse(opt(sp, "pageSize")),
  });
  const result = await listAuditLogs(user, input);
  return NextResponse.json(result, { headers: NO_STORE });
});
