import { db, pool, fleetIncidentsTable, fleetTripsTable, fleetVehiclesTable } from "@workspace/db";
import { pathToFileURL } from "node:url";
import { addDays, localToday } from "../lib/periods";
import { logger } from "../lib/logger";

/** Deterministic and idempotent: runs only while the fleet tables are empty. Dates are relative to the demo anchor. */
export async function seedFleet(): Promise<boolean> {
  const { rows: existing } = await pool.query("SELECT 1 FROM frota_veiculos LIMIT 1").catch((error: { code?: string }) => {
    if (error.code === "42P01") throw new Error("As tabelas de frota ainda não existem: rode primeiro `pnpm --filter @workspace/db run push`.");
    throw error;
  });
  if (existing.length) return false;
  const { rows: meta } = await pool.query("SELECT anchor_date::text AS anchor FROM demo_metadata WHERE id = 1");
  const anchor: string = meta[0]?.anchor ?? localToday();
  const vehicles = [
    ["QWE1A23", "Caminhão baú Mercedes Accelo 1016", "baú", 6000, "D", "Revisão em dia."],
    ["RTY2B34", "Caminhão baú Volkswagen Delivery 11.180", "baú", 5500, "R", "Em rota de entrega para o interior."],
    ["UIO3C45", "Carreta graneleira Scania R450", "carreta", 32000, "M", "Parado na oficina: falha no sistema de freios, peça encomendada."],
    ["ASD4D56", "Caminhão refrigerado Iveco Tector", "refrigerado", 7500, "D", "Câmara fria revisada no mês passado."],
    ["FGH5E67", "Van de entregas Renault Master", "van", 1500, "D", null],
    ["JKL6F78", "Caminhão baú Volvo FH 460", "baú", 24000, "R", "Retorno previsto para amanhã."],
    ["ZXC7G89", "Carreta baú Randon", "carreta", 28000, "P", "Aguardando liberação de documentação do motorista."],
    ["VBN8H90", "Caminhão toco Ford Cargo 816", "toco", 7000, "D", null],
    ["MNB9J01", "Caminhão refrigerado Mercedes Atego", "refrigerado", 9000, "M", "Defeito no compressor da câmara fria."],
    ["POI1K12", "Van de entregas Fiat Ducato", "van", 1800, "D", "Pneus trocados."],
    ["LKJ2L23", "Caminhão baú DAF XF", "baú", 25000, "R", null],
    ["HGF3M34", "Caminhão caçamba Volkswagen Constellation", "caçamba", 14000, "D", "Sem pendências."],
  ] as const;
  await db.insert(fleetVehiclesTable).values(vehicles.map(([plate, description, kind, capacityKg, status, notes]) => ({ plate, description, kind, capacityKg, status, notes, updatedAt: new Date(`${anchor}T09:00:00Z`) })));
  const destinations = ["Campinas", "Ribeirão Preto", "Santos", "Belo Horizonte", "Curitiba", "Sorocaba", "Goiânia", "Rio de Janeiro"];
  const trips: typeof fleetTripsTable.$inferInsert[] = [];
  for (let i = 0; i < 64; i++) {
    const vehicleId = (i * 5) % vehicles.length + 1;
    const departed = addDays(anchor, -(i * 2 + 3));
    const length = 1 + (i % 4);
    const returned = addDays(departed, length);
    const open = i < 3;
    const late = !open && i % 11 === 0;
    trips.push({
      vehicleId, departedOn: open ? addDays(anchor, -(i + 1)) : departed, returnedOn: open ? null : returned,
      destination: destinations[i % destinations.length]!, loadKg: 800 + (i * 377) % 9000,
      delivery: open ? "P" : late ? "A" : "E", notes: late ? "Entrega com atraso por fila no destino." : null,
    });
  }
  await db.insert(fleetTripsTable).values(trips);
  const kinds = [["DEFEITO", "Falha mecânica registrada pelo motorista."], ["PARADO", "Veículo parado sem escala de viagem."], ["REVISAO", "Revisão programada na oficina."]] as const;
  const incidents: typeof fleetIncidentsTable.$inferInsert[] = [];
  for (let i = 0; i < 26; i++) {
    const [kind, description] = kinds[i % 3]!;
    const startedOn = addDays(anchor, -(i * 6 + 2));
    incidents.push({ vehicleId: (i * 7) % vehicles.length + 1, kind, startedOn, endedOn: i < 2 ? null : addDays(startedOn, 1 + (i % 5)), description });
  }
  // Two vehicles currently in the shop have open incidents that match their status.
  incidents.push({ vehicleId: 3, kind: "DEFEITO", startedOn: addDays(anchor, -9), endedOn: null, description: "Falha no sistema de freios." });
  incidents.push({ vehicleId: 9, kind: "DEFEITO", startedOn: addDays(anchor, -4), endedOn: null, description: "Compressor da câmara fria sem funcionar." });
  await db.insert(fleetIncidentsTable).values(incidents);
  logger.info("Fleet demo seed created: 12 vehicles, 64 trips, 28 incidents");
  return true;
}
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) seedFleet().catch(error => { logger.error({ err: error }, "Fleet seed failed"); process.exitCode = 1; }).finally(() => pool.end());
