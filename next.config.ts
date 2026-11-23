import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local E2E (playwright.config.ts) runs its own dev server next to a developer's one; Next 16
  // locks the dist dir per dev server, so E2E builds into a separate one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
