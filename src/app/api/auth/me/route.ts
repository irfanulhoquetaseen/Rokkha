import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/current-user";
import { apiHandler } from "@/server/http/api-handler";

export const GET = apiHandler(async () => {
  const user = await getCurrentUser();
  return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
});
