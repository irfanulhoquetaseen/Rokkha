import "dotenv/config";
import { assertTestDatabaseUrl } from "../support/test-db-guard";

// Runs before every integration test file, BEFORE it imports `@/server/db`,
// so the app's Prisma client connects to the *_test database only.
process.env.DATABASE_URL = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);

// Rate-limit tests assume the documented defaults (5 / 30 / 10). Drop any values inherited from a
// developer's .env before the limiter module is imported, so local tuning can't break them.
for (const name of ["LOGIN_LIMIT_PER_PHONE", "LOGIN_LIMIT_PER_IP", "SIGNUP_LIMIT_PER_IP"]) {
  delete process.env[name];
}
