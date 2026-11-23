import { execSync } from "node:child_process";
import "dotenv/config";
import { assertTestDatabaseUrl } from "../support/test-db-guard";

// Runs once before the integration suite: applies all migrations to the *_test database.
export default function setup() {
  const url = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST);
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
