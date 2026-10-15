export * from "./retencao";
export * from "./provedores";
// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./sankhya";
export * from "./assistant";
export * from "./preferences";export * from "./knowledge";
export * from "./frota";
export * from "./tenancy";
export * from "./avaliacoes";
export * from "./testes";
export * from "./cargas";
export * from "./favoritos";

export * from "./avisos";
export * from "./custos";
export * from "./saude";
