import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { queryLogsTable } from "./assistant";

export const assistantSettingsTable = pgTable("assistant_settings", {
  id: integer("id").primaryKey(),
  preferredName: text("preferred_name").notNull().default(""),
  voiceGender: text("voice_gender").notNull().default("female"),
  thinkingSpeech: boolean("thinking_speech").notNull().default(true),
});
// Metadata only. Downloads are rendered from the original, audited SQL result.
export const exportDocumentsTable = pgTable("export_documents", {
  id: serial("id").primaryKey(),
  companyId: integer("empresa_id").notNull().default(1),
  queryLogId: integer("query_log_id").notNull().references(() => queryLogsTable.id),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
