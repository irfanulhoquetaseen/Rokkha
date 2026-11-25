import { NextResponse } from "next/server";
import { apiHandler, parseBody } from "@/server/http/api-handler";
import { getUserFromRequest } from "@/server/auth/current-user";
import { csvImportSchema, importHospitalsCsv } from "@/server/admin/csv-import";

export const POST = apiHandler(async (req) => {
  const user = await getUserFromRequest(req);
  const { csv } = await parseBody(req, csvImportSchema);
  const report = await importHospitalsCsv(user, csv);
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}, { mutation: true });
