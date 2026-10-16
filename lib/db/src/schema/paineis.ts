import { boolean, index, integer, pgTable, primaryKey, serial, text, timestamp } from "drizzle-orm/pg-core";
import { companiesTable, usersTable } from "./tenancy";
import { favoritesTable } from "./favoritos";

export const panelCompanyTable = pgTable("painel_empresas", {
  companyId: integer("empresa_id").primaryKey().references(() => companiesTable.id, { onDelete: "cascade" }),
  slug: text("apelido").notNull().unique(),
});
export const panelsTable = pgTable("paineis_tv", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  creatorId: integer("criador_id").references(() => usersTable.id, { onDelete: "set null" }),
  creatorRole: text("papel_criacao").notNull(),
  name: text("nome").notNull(),
  layout: text("modelo").notNull().default("grade"),
  theme: text("tema").notNull().default("escuro"),
  refreshSec: integer("atualizacao_segundos").notNull().default(300),
  rotateSec: integer("rotacao_segundos").notNull().default(20),
  autoOrder: boolean("ordem_automatica").notNull().default(true),
  tokenHash: text("codigo_hash").notNull().unique(),
  tokenPrefix: text("codigo_prefixo").notNull(),
  expiresAt: timestamp("expira_em", { withTimezone: true }),
  revokedAt: timestamp("revogado_em", { withTimezone: true }),
  lastAccessAt: timestamp("ultimo_acesso", { withTimezone: true }),
  createdAt: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("paineis_tv_empresa_idx").on(t.companyId)]);
export const panelCardsTable = pgTable("painel_cartoes", {
  panelId: integer("painel_id").notNull().references(() => panelsTable.id, { onDelete: "cascade" }),
  position: integer("posicao").notNull(),
  favoriteId: integer("favorito_id").references(() => favoritesTable.id, { onDelete: "set null" }),
  size: text("tamanho").notNull().default("auto"),
  page: integer("pagina"),
}, t => [primaryKey({ columns: [t.panelId, t.position] })]);
export const panelAccessTable = pgTable("painel_acessos", {
  panelId: integer("painel_id").notNull().references(() => panelsTable.id, { onDelete: "cascade" }),
  hour: timestamp("hora", { withTimezone: true }).notNull(),
  count: integer("total").notNull().default(0),
}, t => [primaryKey({ columns: [t.panelId, t.hour] })]);
export const panelAuditTable = pgTable("painel_auditoria", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  panelId: integer("painel_id").references(() => panelsTable.id, { onDelete: "set null" }),
  actorId: integer("ator_id").references(() => usersTable.id, { onDelete: "set null" }),
  action: text("acao").notNull(),
  at: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("painel_auditoria_empresa_idx").on(t.companyId, t.panelId)]);
