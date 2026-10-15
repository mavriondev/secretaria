import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** A manager flagging an answer as wrong. The administrator reviews it, says what was done, and closes it. */
export const answerReviewsTable = pgTable("avaliacoes", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull(),
  logId: integer("log_id").notNull(),
  userId: integer("usuario_id").notNull(),
  reason: text("motivo").notNull().default(""),
  reasonAt: timestamp("motivo_em", { withTimezone: true }),
  status: text("status").notNull().default("nova"),
  resolution: text("tratativa").notNull().default(""),
  createdAt: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("revisada_em", { withTimezone: true }),
}, table => [uniqueIndex("avaliacoes_log_usuario").on(table.logId, table.userId)]);
