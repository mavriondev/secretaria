import { date, integer, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { ERP_CONFIG as c } from "../erp-config";

export const partnersTable = pgTable(c.tables.customers, {
  id: integer(c.fields.customers.id).primaryKey(),
  name: text(c.fields.customers.name).notNull(),
});
export const productsTable = pgTable(c.tables.products, {
  id: integer(c.fields.products.id).primaryKey(),
  name: text(c.fields.products.name).notNull(),
  group: integer(c.fields.products.group).notNull(),
});
export const salespeopleTable = pgTable(c.tables.salespeople, {
  id: integer(c.fields.salespeople.id).primaryKey(),
  name: text(c.fields.salespeople.name).notNull(),
});
export const invoicesTable = pgTable(c.tables.invoices, {
  id: integer(c.fields.invoices.id).primaryKey(),
  company: integer(c.fields.invoices.company).notNull(),
  customer: integer(c.fields.invoices.customer).notNull().references(() => partnersTable.id),
  salesperson: integer(c.fields.invoices.salesperson).notNull().references(() => salespeopleTable.id),
  operation: integer(c.fields.invoices.operation).notNull(),
  movement: text(c.fields.invoices.movement).notNull(),
  status: text(c.fields.invoices.status).notNull(),
  date: date(c.fields.invoices.date, { mode: "string" }).notNull(),
  amount: numeric(c.fields.invoices.amount, { precision: 18, scale: 2 }).notNull(),
});
export const invoiceItemsTable = pgTable(c.tables.items, {
  invoice: integer(c.fields.items.invoice).notNull().references(() => invoicesTable.id),
  sequence: integer(c.fields.items.sequence).notNull(),
  product: integer(c.fields.items.product).notNull().references(() => productsTable.id),
  quantity: numeric(c.fields.items.quantity, { precision: 18, scale: 3 }).notNull(),
  amount: numeric(c.fields.items.amount, { precision: 18, scale: 2 }).notNull(),
  discount: numeric(c.fields.items.discount, { precision: 18, scale: 2 }).notNull(),
}, (table) => [primaryKey({ columns: [table.invoice, table.sequence] })]);
export const financeTable = pgTable(c.tables.finance, {
  id: integer(c.fields.finance.id).primaryKey(),
  // TGFFIN carries the company like TGFCAB; the default keeps older seeds and the single-company demo working.
  company: integer(c.fields.finance.company).notNull().default(c.companyCode),
  customer: integer(c.fields.finance.customer).notNull().references(() => partnersTable.id),
  dueDate: date(c.fields.finance.dueDate, { mode: "string" }).notNull(),
  amount: numeric(c.fields.finance.amount, { precision: 18, scale: 2 }).notNull(),
  paidAt: timestamp(c.fields.finance.paidAt, { withTimezone: true }),
  direction: integer(c.fields.finance.direction).notNull(),
});
