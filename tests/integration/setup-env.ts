import "dotenv/config";
import { assertTestDatabaseUrl } from "../support/test-db-guard";

// Runs before every integration test file, BEFORE it imports `@/server/db`,
// so the app's Prisma client connects to the *_test database only.
process.env.DATABASE_URL = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
