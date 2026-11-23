// P0 seed: records a heartbeat row so `npm run db:seed` is a real, working command.
// The full demo dataset (hospitals, resources, accounts) is added in P1.
import "dotenv/config";
import { prisma } from "../src/server/db";

async function main() {
  await prisma.systemHeartbeat.create({ data: { note: "seed" } });
  console.log("Seed complete.");
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
