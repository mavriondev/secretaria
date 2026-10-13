import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** One row per load of a company's mirror: when, how (incremental or complete), and what happened to each table. */
export const loadRunsTable = pgTable("cargas", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull(),
  mode: text("modo").notNull(),
  trigger: text("origem_disparo").notNull().default("manual"),
  status: text("status").notNull().default("executando"),
  ok: boolean("ok"),
  report: jsonb("relatorio"),
  error: text("erro"),
  startedAt: timestamp("iniciada_em", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("concluida_em", { withTimezone: true }),
}, table => [uniqueIndex("cargas_uma_em_andamento").on(table.companyId).where(sql`${table.status} = 'executando'`)]);
