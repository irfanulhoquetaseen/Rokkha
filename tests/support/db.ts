import { prisma } from "@/server/db";
import { assertTestDatabaseUrl } from "./test-db-guard";

/** Empties every app table in the *_test database (keeps migrations). Call in beforeEach. */
export async function resetDb(): Promise<void> {
  assertTestDatabaseUrl(process.env.DATABASE_URL);
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
