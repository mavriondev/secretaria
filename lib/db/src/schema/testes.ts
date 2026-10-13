import { boolean, integer, jsonb, numeric, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Questions with a known correct answer, kept per company and re-run after every change to see what got worse. */
export const testQuestionsTable = pgTable("perguntas_teste", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull(),
  question: text("pergunta").notNull(),
  mustContain: jsonb("deve_conter").$type<string[]>().notNull().default([]),
  mustNotContain: jsonb("nao_deve_conter").$type<string[]>().notNull().default([]),
  note: text("nota").notNull().default(""),
  active: boolean("ativa").notNull().default(true),
  createdAt: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
});
export const testRunsTable = pgTable("execucoes_teste", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull(),
  userId: integer("usuario_id").notNull(),
  status: text("status").notNull().default("executando"),
  total: integer("total").notNull().default(0),
  passed: integer("aprovadas").notNull().default(0),
  failed: integer("reprovadas").notNull().default(0),
  costUsd: numeric("custo_usd", { precision: 14, scale: 8 }).notNull().default("0"),
  startedAt: timestamp("iniciada_em", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("concluida_em", { withTimezone: true }),
});
export const testResultsTable = pgTable("resultados_teste", {
  id: serial("id").primaryKey(),
  runId: integer("execucao_id").notNull(),
  questionId: integer("pergunta_id").notNull(),
  question: text("pergunta").notNull(),
  answer: text("resposta").notNull().default(""),
  passed: boolean("aprovada").notNull(),
  reason: text("motivo").notNull().default(""),
  latencyMs: integer("latencia_ms"),
  costUsd: numeric("custo_usd", { precision: 14, scale: 8 }),
  changed: boolean("mudou").notNull().default(false),
});
