import type { Pool } from "pg";
import { desc, eq } from "drizzle-orm";
import { companiesTable, db, loadRunsTable } from "@workspace/db";
import type { Ficha } from "./ficha";

export type Estado = "em_dia" | "atencao" | "desatualizado" | "sem_dados";
const HOUR = 3_600_000;

/**
 * How stale is too stale. With a scheduled load the data should never be older than two intervals (one missed load is tolerated, two is a problem).
 * Without a schedule, loads are manual, so a day is fine and three days is too old.
 */
export function classify(ageMs: number | null, intervalMin: number | null): Estado {
  if (ageMs === null) return "sem_dados";
  const warn = intervalMin ? intervalMin * 60_000 * 1.5 : 24 * HOUR;
  const late = intervalMin ? intervalMin * 60_000 * 3 : 72 * HOUR;
  return ageMs > late ? "desatualizado" : ageMs > warn ? "atencao" : "em_dia";
}
const rank: Record<Estado, number> = { em_dia: 0, atencao: 1, desatualizado: 2, sem_dados: 3 };
export const worst = (states: Estado[]): Estado => states.reduce<Estado>((a, b) => (rank[b] > rank[a] ? b : a), "em_dia");

export type HealthTable = { nome: string; carregadoEm: string | null; idadeHoras: number | null; estado: Estado };
export type HealthView = { nome: string; assunto: string; maisRecenteEm: string | null; idadeHoras: number | null; estado: Estado };

const asIso = (value: unknown): string | null => { const d = value instanceof Date ? value : value ? new Date(String(value)) : null; return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };
const hours = (iso: string | null, now: number) => (iso ? Math.max(0, (now - new Date(iso).getTime()) / HOUR) : null);

/** Reads, from the company's own database, when each mirror table was last loaded and how recent the newest row of each described view is. Nothing is changed. */
export async function readHealth(pool: Pool, ficha: Ficha, intervalMin: number | null, now = Date.now()): Promise<{ tabelas: HealthTable[]; visoes: HealthView[] }> {
  const tabelas: HealthTable[] = [];
  const control = await pool.query("SELECT tabela, carregado_em FROM espelho_controle ORDER BY tabela").catch(() => ({ rows: [] as Array<Record<string, unknown>> }));
  for (const row of control.rows) {
    const iso = asIso(row.carregado_em); const idade = hours(iso, now);
    tabelas.push({ nome: String(row.tabela), carregadoEm: iso, idadeHoras: idade, estado: classify(idade === null ? null : idade * HOUR, intervalMin) });
  }
  const visoes: HealthView[] = [];
  for (const view of ficha.visoes) {
    let iso: string | null = null;
    if (view.atualizadoEm) {
      // names come from the validated ficha (identifiers only), never from a request
      const res = await pool.query(`SELECT max("${view.atualizadoEm}") AS recente FROM "${view.nome}"`).catch(() => null);
      iso = asIso(res?.rows[0]?.recente);
    }
    const idade = hours(iso, now);
    visoes.push({ nome: view.nome, assunto: view.assunto, maisRecenteEm: iso, idadeHoras: idade, estado: classify(idade === null ? null : idade * HOUR, intervalMin) });
  }
  return { tabelas, visoes };
}

export async function lastLoads(companyId: number, limit = 5) {
  return db.select().from(loadRunsTable).where(eq(loadRunsTable.companyId, companyId)).orderBy(desc(loadRunsTable.id)).limit(limit);
}
export const companyInterval = async (companyId: number) => (await db.select({ m: companiesTable.loadEveryMin }).from(companiesTable).where(eq(companiesTable.id, companyId)))[0]?.m ?? null;
