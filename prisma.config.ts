import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` (run at install/build time) does not need a database,
    // so an empty value is tolerated there; migrate commands fail loudly without it.
    url: process.env.DATABASE_URL ?? "",
  },
});
