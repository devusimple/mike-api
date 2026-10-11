import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Db = ReturnType<typeof getDb>;

/** Build a per-request Drizzle client from the D1 binding. */
export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}
