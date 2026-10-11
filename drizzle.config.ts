import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // drizzle-kit needs a URL only for local generation; D1 migrations
    // are applied with `wrangler d1 migrations apply`. This file exists so
    // `bun run db:generate` works. No live DB connection is required.
    url: "file:./drizzle/local.db",
  },
});
