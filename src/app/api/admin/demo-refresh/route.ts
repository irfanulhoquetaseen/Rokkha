import { NextResponse } from "next/server";
import { apiHandler } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { refreshDemoStock } from "@/server/admin/demo-refresh";

export const POST = apiHandler(async (req) => {
  const user = await getUserFromRequest(req);
  const result = await refreshDemoStock(user);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}, { mutation: true });
