import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Aggregate operational state only. No conversation text, credentials or per-user content. */
export const historyCleanupTable = pgTable("historico_limpeza", {
  id: integer("id").primaryKey(),
  attemptAt: timestamp("tentativa_em", { withTimezone: true }),
  successAt: timestamp("sucesso_em", { withTimezone: true }),
  status: text("status").notNull().default("nunca_executada"),
  counts: jsonb("contagens").notNull().default({}),
  error: text("erro"),
});
