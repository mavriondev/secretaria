import { date, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Demonstration fleet data, deliberately NOT modelled on any ERP: it exists to prove that the assistant works on
 * whatever structure a client's database has, described by the ficha de implantação.
 */
export const fleetVehiclesTable = pgTable("frota_veiculos", {
  id: serial("id").primaryKey(),
  company: integer("empresa").notNull().default(1),
  plate: text("placa").notNull(),
  description: text("descricao").notNull(),
  kind: text("tipo").notNull(),
  capacityKg: integer("capacidade_kg").notNull(),
  /** D disponível, R em rota, M em manutenção, P parado. */
  status: text("situacao").notNull(),
  notes: text("observacao"),
  updatedAt: timestamp("atualizado_em", { withTimezone: true }).notNull().defaultNow(),
});
export const fleetTripsTable = pgTable("frota_viagens", {
  id: serial("id").primaryKey(),
  company: integer("empresa").notNull().default(1),
  vehicleId: integer("veiculo_id").notNull().references(() => fleetVehiclesTable.id),
  departedOn: date("saida_em", { mode: "string" }).notNull(),
  returnedOn: date("retorno_em", { mode: "string" }),
  destination: text("destino").notNull(),
  loadKg: integer("carga_kg").notNull(),
  /** P pendente, E entregue, A atrasada. */
  delivery: text("entrega").notNull(),
  notes: text("observacao"),
});
export const fleetIncidentsTable = pgTable("frota_ocorrencias", {
  id: serial("id").primaryKey(),
  company: integer("empresa").notNull().default(1),
  vehicleId: integer("veiculo_id").notNull().references(() => fleetVehiclesTable.id),
  /** DEFEITO, PARADO ou REVISAO. */
  kind: text("tipo").notNull(),
  startedOn: date("inicio_em", { mode: "string" }).notNull(),
  endedOn: date("fim_em", { mode: "string" }),
  description: text("descricao").notNull(),
});
