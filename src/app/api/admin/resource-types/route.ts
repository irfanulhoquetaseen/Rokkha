import { NextResponse } from "next/server";
import { apiHandler } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { requireRole } from "@/server/auth/guards";
import { prisma } from "@/server/db";

/** List all resource types (for the hospital create form's resource picker). */
export const GET = apiHandler(async (req) => {
  const user = await getUserFromRequest(req);
  await requireRole(user, "ADMIN");
  const types = await prisma.resourceType.findMany({
    orderBy: { sortOrder: "asc" },
    select: { id: true, code: true, nameBn: true, nameEn: true, kind: true },
  });
  return NextResponse.json({ types }, { headers: { "Cache-Control": "no-store" } });
});
