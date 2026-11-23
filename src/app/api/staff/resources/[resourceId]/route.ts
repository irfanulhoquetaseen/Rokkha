import { NextResponse } from "next/server";
import { apiHandler, parseBody } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { updateHospitalResource, updateResourceBodySchema } from "@/server/resources/update";

export const PATCH = apiHandler(
  async (req: Request, ctx: { params: Promise<{ resourceId: string }> }) => {
    const { resourceId } = await ctx.params;
    const user = await getUserFromRequest(req);
    const body = await parseBody(req, updateResourceBodySchema);
    const resource = await updateHospitalResource(user, { resourceId, expectedVersion: body.version, change: body.change });
    return NextResponse.json({ resource }, { headers: { "Cache-Control": "no-store" } });
  },
  { mutation: true },
);
