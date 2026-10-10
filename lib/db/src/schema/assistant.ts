import { integer, jsonb, numeric, pgTable, serial, text, timestamp, date } from "drizzle-orm/pg-core";

export const queryLogsTable = pgTable("query_logs", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  question: text("question").notNull(),
  functionName: text("function_name"),
  parameters: jsonb("parameters").notNull().default({}),
  result: jsonb("result"),
  answer: text("answer").notNull(),
  freedomLevel: integer("freedom_level").notNull(),
  latencyMs: integer("latency_ms").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 14, scale: 8 }),
});

export const demoMetadataTable = pgTable("demo_metadata", {
  id: integer("id").primaryKey(),
  loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull(),
  anchorDate: date("anchor_date", { mode: "string" }).notNull(),
  fixtureStartDate: date("fixture_start_date", { mode: "string" }).notNull(),
});
