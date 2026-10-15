import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
export const providerStateTable = pgTable("provedores_estado", {
  provider: text("provedor").primaryKey(),
  consecutive: integer("consecutivos").notNull().default(0),
  status: integer("ultimo_status"),
  updatedAt: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});
