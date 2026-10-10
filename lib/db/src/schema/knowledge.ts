import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Knowledge taught by the manager (panel or training mode). Context for the model, never a source of numbers. */
export const knowledgeItemsTable = pgTable("knowledge_items", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  url: text("url"),
  erpRef: text("erp_ref"),
  active: boolean("active").notNull().default(true),
  origin: text("origin").notNull().default("painel"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
