import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool } from "@workspace/db";

/**
 * Applies lib/db/migracao-aditiva.sql with the application's own database user, so new tables belong to it.
 * The file only adds columns and tables and is idempotent; the previous code keeps working while it runs.
 *   pnpm --filter @workspace/api-server run db:aditiva
 */
const file = resolve(import.meta.dirname, "../../../../lib/db/migracao-aditiva.sql");
pool.query(readFileSync(file, "utf8"))
  .then(() => console.log("Migração aditiva aplicada (ou já estava aplicada)."))
  .catch(error => { console.error("Migração aditiva falhou:", error instanceof Error ? error.message : error); process.exitCode = 1; })
  .finally(() => pool.end());
