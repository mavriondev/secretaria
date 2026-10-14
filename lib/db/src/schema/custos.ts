import { index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { queryLogsTable } from "./assistant";
import { companiesTable, usersTable } from "./tenancy";

/** Kinds of paid calls. "texto" is the reasoning model of an answer; the others are everything around it. */
export const COST_KINDS = ["texto", "voz", "transcricao", "reescrita", "implantacao"] as const;
export type CostKind = (typeof COST_KINDS)[number];

/**
 * The single ledger of paid calls (model, voice, transcription, favourite rewrite, implantation agent), one row per call,
 * always attributed to a company. Daily and monthly ceilings are computed from this table and from nothing else.
 */
export const costsTable = pgTable("custos_ia", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  userId: integer("usuario_id").references(() => usersTable.id, { onDelete: "set null" }),
  kind: text("tipo").notNull().$type<CostKind>(),
  provider: text("provedor").notNull(),
  model: text("modelo"),
  /** How much was consumed, in `unit` (tokens, caracteres, segundos). */
  quantity: numeric("quantidade", { precision: 14, scale: 3 }).notNull().default("0"),
  unit: text("unidade").notNull(),
  costUsd: numeric("custo_usd", { precision: 14, scale: 8 }).notNull(),
  queryLogId: integer("query_log_id").references(() => queryLogsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("custos_ia_empresa_idx").on(table.companyId, table.createdAt), index("custos_ia_criado_idx").on(table.createdAt)]);

/** Owner-level settings as key/value text (daily ceilings of the platform and the default daily ceiling of a company). */
export const platformSettingsTable = pgTable("plataforma_configuracao", {
  key: text("chave").primaryKey(),
  value: text("valor").notNull(),
  updatedAt: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Threshold events (80 % and block) per scope and period, recorded once: the row's uniqueness is what guarantees that
 * the owner and the administrators are warned a single time. empresa_id 0 stands for the platform as a whole.
 */
export const ceilingEventsTable = pgTable("tetos_eventos", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull().default(0),
  /** empresa_dia | empresa_mes | plataforma_dia */
  scope: text("escopo").notNull(),
  /** 2026-10-14 for a day, 2026-10 for a month (São Paulo calendar). */
  period: text("periodo").notNull(),
  /** 80 (warning) or 100 (blocked). */
  level: integer("nivel").notNull(),
  usedUsd: numeric("usado_usd", { precision: 14, scale: 8 }).notNull(),
  limitUsd: numeric("limite_usd", { precision: 12, scale: 2 }).notNull(),
  /** The company whose call hit a platform-wide ceiling (null for company scopes). */
  triggeredBy: integer("disparado_por"),
  createdAt: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("tetos_eventos_unico").on(table.companyId, table.scope, table.period, table.level)]);
