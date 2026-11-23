// Idempotent demo seed: fictional hospitals, resources, conditions, first-aid guides, demo accounts.
// Passwords come from the environment only (SEED_*_PASSWORD) and are never printed.
import "dotenv/config";
import { prisma } from "../src/server/db";
import { runSeed } from "../src/server/seed/run-seed";

function requirePassword(name: string): string {
  const v = process.env[name];
  if (!v || v.length < 8) {
    console.error(`Missing or too short (min 8 chars): ${name}. Set it in .env.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const passwords = {
    admin: requirePassword("SEED_ADMIN_PASSWORD"),
    staff: requirePassword("SEED_STAFF_PASSWORD"),
    citizen: requirePassword("SEED_CITIZEN_PASSWORD"),
  };
  const resetStock = process.env.SEED_RESET_STOCK === "1";
  const summary = await runSeed(prisma, { passwords, resetStock });
  console.log(`Seed complete (resetStock=${resetStock}).`);
  console.table(summary);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
