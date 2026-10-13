import { and, desc, eq, lt } from "drizzle-orm";
import { companiesTable, db, loadRunsTable } from "@workspace/db";
import { carregar, fontePostgres, type RelatorioCarga } from "./carga";
import { newCompanyPool } from "./company-data";
import { aplicarRegras, regrasEfetivas } from "./regras-sankhya";
import { PACOTE_SANKHYA } from "./pacotes/sankhya";
import type { Pacote } from "./pacotes/tipos";
import { decryptSecret } from "./secrets";

export const SOURCE_KINDS = ["postgres", "recebida"] as const; // "recebida": the customer's side sends the data to us; oracle and sqlserver readers come when a customer needs them
export const RECEBIDA = "recebida";
const PACOTES: Record<string, Pacote> = { sankhya: PACOTE_SANKHYA };
export const pacoteDoErp = (erp: string): Pacote | null => PACOTES[erp] ?? null;
/** The package a company copies: the one proposed and approved for it, otherwise the ERP's ready-made one. */
export const pacoteDaEmpresa = (c: { erp: string; packageJson: unknown }): Pacote | null => (c.packageJson as Pacote | null) ?? pacoteDoErp(c.erp);
const STALE_MINUTES = 120;
const FULL_EVERY_DAYS = 7;
const isUniqueViolation = (error: unknown) => [error, (error as { cause?: unknown } | null)?.cause].some(e => (e as { code?: string } | null)?.code === "23505");
const oneLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.replace(/postgres(ql)?:\/\/\S+/gi, "[conexão]");

export async function closeStaleLoads(companyId?: number) {
  const limit = new Date(Date.now() - STALE_MINUTES * 60_000);
  await db.update(loadRunsTable).set({ status: "interrompida", ok: false, error: "O servidor reiniciou ou a carga demorou demais.", finishedAt: new Date() })
    .where(and(companyId ? eq(loadRunsTable.companyId, companyId) : undefined, eq(loadRunsTable.status, "executando"), lt(loadRunsTable.startedAt, limit)));
}

/** Starts a load in the background. One at a time per company, guaranteed by the database. */
export async function startLoad(companyId: number, mode: "incremental" | "completa", trigger: "manual" | "agendada"): Promise<{ loadId: number } | { error: string }> {
  await closeStaleLoads(companyId);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  if (!company) return { error: "Empresa não encontrada." };
  if (companyId === 1) return { error: "A empresa de demonstração não tem origem externa." };
  if (company.sourceKind === RECEBIDA) return { error: "Esta empresa envia os próprios dados; não há o que carregar daqui." };
  if (!company.sourceUrlEnc) return { error: "Cadastre o endereço da origem antes de carregar." };
  if (!company.dataUrlEnc) return { error: "Cadastre o banco da empresa (onde fica o espelho) antes de carregar." };
  if (!SOURCE_KINDS.includes(company.sourceKind as never)) return { error: `Ainda não existe leitor para o tipo de banco "${company.sourceKind}".` };
  const pacote = pacoteDaEmpresa(company);
  if (!pacote) return { error: `Ainda não existe pacote de tabelas para o ERP "${company.erp}".` };
  if (!company.subjects.length) return { error: "Escolha ao menos um assunto para copiar." };
  const [run] = await db.insert(loadRunsTable).values({ companyId, mode, trigger }).returning().catch(error => { if (isUniqueViolation(error)) return []; throw error; });
  if (!run) return { error: "Já existe uma carga em andamento. Aguarde terminar." };
  void (async () => {
    const destino = newCompanyPool(decryptSecret(company.dataUrlEnc!), 2);
    const origem = fontePostgres(decryptSecret(company.sourceUrlEnc!));
    try {
      const report: RelatorioCarga = await carregar({ fonte: origem.fonte, destino, pacote, assuntos: company.subjects, modo: mode });
      // Sales and receivable rules become views over the mirror as soon as the tables exist, so a first load already yields a usable database.
      let relatorio: RelatorioCarga & { regras?: unknown } = report;
      if (company.erp === "sankhya" && !company.packageJson && report.ok) {
        try { relatorio = { ...report, regras: { aplicadas: await aplicarRegras(destino, regrasEfetivas(company.rules), company.subjects) } }; }
        catch (error) { relatorio = { ...report, ok: false, regras: { erro: oneLine(error) } }; }
      }
      await db.update(loadRunsTable).set({ status: "concluida", ok: relatorio.ok, report: relatorio, finishedAt: new Date() }).where(eq(loadRunsTable.id, run.id));
    } catch (error) {
      await db.update(loadRunsTable).set({ status: "concluida", ok: false, error: oneLine(error), finishedAt: new Date() }).where(eq(loadRunsTable.id, run.id));
    } finally { await origem.fechar().catch(() => undefined); await destino.end().catch(() => undefined); }
  })();
  return { loadId: run.id };
}

/**
 * Scheduler step: for each company with a source and an interval, starts an incremental load when the last one is older than the interval,
 * and a complete one when the last complete load is older than a week (that is what notices notes deleted at the source).
 */
export async function runDueLoads(now = new Date()): Promise<number[]> {
  const companies = await db.select().from(companiesTable).where(eq(companiesTable.active, true));
  const started: number[] = [];
  for (const c of companies) {
    if (!c.sourceUrlEnc || !c.loadEveryMin || !c.subjects.length) continue;
    const [last] = await db.select().from(loadRunsTable).where(eq(loadRunsTable.companyId, c.id)).orderBy(desc(loadRunsTable.id)).limit(1);
    if (last?.status === "executando") continue;
    if (last && now.getTime() - last.startedAt.getTime() < c.loadEveryMin * 60_000) continue;
    const [lastFull] = await db.select().from(loadRunsTable).where(and(eq(loadRunsTable.companyId, c.id), eq(loadRunsTable.mode, "completa"), eq(loadRunsTable.ok, true))).orderBy(desc(loadRunsTable.id)).limit(1);
    const needsFull = !lastFull || now.getTime() - lastFull.startedAt.getTime() > FULL_EVERY_DAYS * 86_400_000;
    const result = await startLoad(c.id, needsFull ? "completa" : "incremental", "agendada");
    if ("loadId" in result) started.push(c.id);
  }
  return started;
}

let timer: NodeJS.Timeout | null = null;
export function startScheduler(everyMs = 60_000) {
  if (timer || process.env.CARGA_AGENDADOR === "off") return;
  timer = setInterval(() => { void runDueLoads().catch(() => undefined); }, everyMs);
  timer.unref();
}
