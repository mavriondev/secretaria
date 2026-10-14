import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { companiesTable, usersTable } from "./tenancy";
import { queryLogsTable } from "./assistant";

/** Forms a card can take; chosen by code from the shape of the result, never by the model. */
export const FAVORITE_FORMS = ["numero", "serie", "ranking", "tabela"] as const;
export type FavoriteForm = (typeof FAVORITE_FORMS)[number];

/**
 * A pinned answer. "vivo" re-runs the saved SQL (no model call) while the app is open; "fixo" keeps the result of the
 * moment it was pinned and is never recalculated. empresa_id + usuario_id isolate it; `escopo = empresa` shares the card
 * with the whole company (the creator stays in usuario_id; every viewer runs it with their own permissions).
 */
export const favoritesTable = pgTable("favoritos", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  userId: integer("usuario_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("titulo").notNull(),
  originalQuestion: text("pergunta_original").notNull(),
  kind: text("tipo").notNull().$type<"vivo" | "fixo">(),
  /** SQL executed on every refresh of a live card (already rewritten with relative dates). Null for a fixed card. */
  savedSql: text("sql_salvo"),
  /** Ready-made shortcut behind the card (faturamento, contas_a_receber_vencidas, produtos_mais_vendidos, consultar_vendas), with its parameters and the relative period as asked. Null for a free-query card. */
  tool: text("ferramenta"),
  toolParams: jsonb("parametros").$type<Record<string, unknown>>(),
  /** Declared formats of computed columns, as the model declared them when the answer was produced. */
  formats: jsonb("colunas_formatos").$type<Array<{ coluna: string; formato: string; rotulo?: string | null }>>().notNull().default([]),
  form: text("forma").notNull().$type<FavoriteForm>(),
  intervalSec: integer("intervalo_seg"),
  /** Snapshot kept by a fixed card (the same shape the live endpoint returns). */
  fixedResult: jsonb("resultado_fixo"),
  frozenAt: timestamp("guardado_em", { withTimezone: true }),
  order: integer("ordem").notNull().default(0),
  section: text("secao"),
  onHome: boolean("na_tela_inicial").notNull().default(false),
  queryLogId: integer("query_log_id").references(() => queryLogsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp("ultima_execucao", { withTimezone: true }),
  lastError: text("ultimo_erro"),
  /** Last value of a single-number live card, to show the variation since the previous refresh. */
  lastValue: text("ultimo_valor"),
  /** "pessoal" (only its creator) or "empresa" (every user of the company sees and runs it, with their own permissions). */
  scope: text("escopo").notNull().default("pessoal").$type<"pessoal" | "empresa">(),
  /** Audit of the sharing: who published the card to the company and when (kept even after it goes back to personal). */
  sharedBy: integer("compartilhado_por").references(() => usersTable.id, { onDelete: "set null" }),
  sharedAt: timestamp("compartilhado_em", { withTimezone: true }),
  /** Shared card that an administrator put on everyone's home strip (after each person's own cards, three at most in total). */
  onHomeAll: boolean("fixo_na_inicial_todos").notNull().default(false),
}, table => [index("favoritos_usuario_idx").on(table.companyId, table.userId, table.order), index("favoritos_empresa_escopo_idx").on(table.companyId, table.scope)]);
