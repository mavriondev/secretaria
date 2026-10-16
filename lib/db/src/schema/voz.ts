import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { companiesTable, usersTable } from "./tenancy";

/** How the spoken question is sent: on a short pause (today's behaviour), on a long pause, or only by a tap on "Enviar". */
export const ENVIO_MODOS = ["automatico", "pausa_longa", "eu_envio"] as const;
export type EnvioModo = (typeof ENVIO_MODOS)[number];
/** Surroundings of the person: higher levels ignore quieter (more distant) voices. */
export const AMBIENTE_NIVEIS = ["normal", "ruidoso", "muito_ruidoso"] as const;
export type AmbienteNivel = (typeof AMBIENTE_NIVEIS)[number];

/** Per-person microphone preferences; the row is absent until the person changes something (defaults apply). */
export const voicePreferencesTable = pgTable("voz_preferencias", {
  userId: integer("usuario_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  companyId: integer("empresa_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  sendMode: text("envio").notNull().default("automatico").$type<EnvioModo>(),
  environment: text("ambiente").notNull().default("normal").$type<AmbienteNivel>(),
  updatedAt: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});
