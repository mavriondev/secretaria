import { index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companiesTable } from "./tenancy";

/** Severity of one check: `ok` is green, `atencao` yellow, `critico` red, `desconhecido` grey (the check could not run here; never notified). */
export const SYSTEM_SEVERITIES = ["ok", "atencao", "critico", "desconhecido"] as const;
export type SystemSeverity = (typeof SYSTEM_SEVERITIES)[number];

/**
 * Current state of each system check (service, loads, backup, disk, certificate, cost, security), one row per check key.
 * The periodic monitor compares the fresh reading with this row to notify only on transitions (new problem, worse, resolved)
 * plus one daily reminder while a problem persists.
 */
export const systemAlertsTable = pgTable("alertas_sistema", {
  id: serial("id").primaryKey(),
  /** Stable key of the check (`disco`, `backup`, `carga:3`...). */
  key: text("chave").notNull(),
  group: text("grupo").notNull(),
  /** Null for checks about the installation itself; the company for loads and per-company costs. */
  companyId: integer("empresa_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  severity: text("gravidade").notNull().$type<SystemSeverity>(),
  title: text("titulo").notNull(),
  message: text("mensagem").notNull(),
  /** What the owner should do about it, in plain words; null when nothing is needed. */
  action: text("acao"),
  detail: jsonb("detalhe"),
  /** When the current problem began (null while ok). */
  since: timestamp("desde", { withTimezone: true }),
  lastNotifiedAt: timestamp("ultimo_aviso", { withTimezone: true }),
  lastCheckedAt: timestamp("ultima_verificacao", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("alertas_sistema_chave_idx").on(table.key), index("alertas_sistema_empresa_idx").on(table.companyId)]);
