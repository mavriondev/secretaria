import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companiesTable, usersTable } from "./tenancy";
import { favoritesTable } from "./favoritos";

/** Fixed, code-evaluated conditions (never the model). */
export const ALERT_CONDITIONS = ["acima", "abaixo", "variacao", "mudou"] as const;
export type AlertCondition = (typeof ALERT_CONDITIONS)[number];

/**
 * A rule on a live favourite: "tell me when this number goes above X". Checked on the server whenever the company's data
 * marker moves, with the permissions of the rule's owner. Fires on transitions (false → true), not on every load.
 */
export const alertsTable = pgTable("avisos", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  userId: integer("usuario_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  favoriteId: integer("favorito_id").notNull().references(() => favoritesTable.id, { onDelete: "cascade" }),
  condition: text("condicao").notNull().$type<AlertCondition>(),
  /** Threshold: a value for acima/abaixo, a percentage or a value for variacao (see thresholdKind), unused for mudou. */
  threshold: text("limiar"),
  thresholdKind: text("tipo_limiar").notNull().default("valor").$type<"valor" | "percentual">(),
  /** Column type of the observed number (dinheiro, percentual, ...) so thresholds and values are shown the same way; learnt at the first check. */
  valueType: text("tipo_valor"),
  /** Whether the condition held at the last check (transitions are detected against this). */
  currentState: boolean("estado_atual").notNull().default(false),
  /** Last observed value (number as text, or a fingerprint of the rows for mudou) and when it was observed. */
  lastValue: text("ultimo_valor"),
  lastRows: jsonb("ultimas_linhas"),
  lastCheckedAt: timestamp("ultima_verificacao", { withTimezone: true }),
  lastMarker: text("ultimo_marcador"),
  lastFiredAt: timestamp("ultimo_disparo", { withTimezone: true }),
  /** While the condition stays true, remind again only after this many minutes (default 24 h). */
  remindAfterMin: integer("reavisar_apos_min").notNull().default(1440),
  active: boolean("ativo").notNull().default(true),
  lastError: text("ultimo_erro"),
  createdAt: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("avisos_empresa_idx").on(table.companyId, table.active), index("avisos_usuario_idx").on(table.userId)]);

/** Per-user alert preferences: quiet hours apply to push only (the inbox always receives the notice). */
export const alertSettingsTable = pgTable("avisos_configuracao", {
  userId: integer("usuario_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  companyId: integer("empresa_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  quietEnabled: boolean("silencio_ativo").notNull().default(true),
  quietStartHour: integer("silencio_inicio").notNull().default(22),
  quietEndHour: integer("silencio_fim").notNull().default(7),
  updatedAt: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});

/** The in-app inbox: one row per notice (or per daily summary once the daily cap is reached). */
export const notificationsTable = pgTable("notificacoes", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  userId: integer("usuario_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  alertId: integer("aviso_id").references(() => alertsTable.id, { onDelete: "set null" }),
  favoriteId: integer("favorito_id").references(() => favoritesTable.id, { onDelete: "set null" }),
  kind: text("tipo").notNull().default("aviso").$type<"aviso" | "resumo">(),
  title: text("titulo").notNull(),
  message: text("mensagem").notNull(),
  /** Observed value (formatted) and the condition in words, for the list. */
  value: text("valor"),
  conditionText: text("condicao_texto"),
  /** Number of notices folded into a summary row. */
  count: integer("quantidade").notNull().default(1),
  pushed: boolean("empurrada").notNull().default(false),
  pushSkippedReason: text("motivo_sem_push"),
  createdAt: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("lida_em", { withTimezone: true }),
}, table => [index("notificacoes_usuario_idx").on(table.userId, table.readAt, table.createdAt)]);

/** Web Push subscriptions (one per browser/device); removed when the push service says they are gone. */
export const pushSubscriptionsTable = pgTable("assinaturas_push", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  userId: integer("usuario_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  userAgent: text("navegador"),
  createdAt: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("ultimo_uso", { withTimezone: true }),
  lastError: text("ultimo_erro"),
}, table => [uniqueIndex("assinaturas_push_endpoint_idx").on(table.endpoint), index("assinaturas_push_usuario_idx").on(table.userId)]);
