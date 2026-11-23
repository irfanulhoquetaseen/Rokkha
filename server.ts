import "dotenv/config";
import { createServer } from "node:http";
import next from "next";
import { attachSocketServer } from "@/server/realtime/io";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const dev = process.env.NODE_ENV !== "production";
// Bind on all interfaces in production (Railway routes to the container), localhost in dev.
const hostname = process.env.HOST ?? (dev ? "localhost" : "0.0.0.0");

async function main() {
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const httpServer = createServer((req, res) => {
    void handle(req, res);
  });

  // Next.js and Socket.io share ONE port. Socket.io only claims requests under /socket.io.
  const io = attachSocketServer(httpServer);

  httpServer.listen(port, hostname, () => {
    console.log(`> JibonSetu ready on http://${hostname}:${port} (${dev ? "development" : "production"})`);
  });

  const shutdown = (signal: string) => {
    console.log(`> ${signal} received, shutting down`);
    void io.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("> Failed to start server", err);
  process.exit(1);
});
