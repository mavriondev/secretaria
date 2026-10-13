import { eq } from "drizzle-orm";
import type { Pool } from "pg";
import { companiesTable, db } from "@workspace/db";
import { fichaSchema, type Ficha } from "./ficha";
import { pendingFields } from "./ficha-gerar";
import { forgetCompanyData, newCompanyPool } from "./company-data";
import { runFreeQuery } from "./free-query";
import { faturamento, contasAReceberVencidas } from "./metrics";
import { grantMetricReader, prepareFreeAccess } from "./metric-access";
import { range, addDays } from "./periods";
import { decryptSecret, encryptSecret } from "./secrets";
import { runAsTenant } from "./tenant";

/** Views the optional governed shortcuts (faturamento, recebíveis, ranking) read. A company needs them only if its ficha lists them; otherwise everything is answered from the tables of the ficha. */
export const REQUIRED_VIEWS = ["vw_vendas_itens", "vw_titulos_receber"] as const;
export type SetupReport = { ok: boolean; problemas: string[]; passos: Array<{ passo: string; ok: boolean }> };

const oneLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.replace(/postgres(ql)?:\/\/\S+/gi, "[conexão]");

/**
 * Proves that a database and a ficha work together before the company is released: the server answers, the views exist, the read-only
 * roles can be set up, every column the ficha describes can be read, and the governed metrics run. Nothing is stored here.
 */
export async function verifyCompanyData(companyId: number, pool: Pool, ficha: Ficha): Promise<SetupReport> {
  const passos: SetupReport["passos"] = [];
  const problemas: string[] = [];
  const step = async (passo: string, fn: () => Promise<string | undefined>) => {
    try { const problem = await fn(); passos.push({ passo, ok: !problem }); if (problem) problemas.push(problem); return !problem; }
    catch (error) { passos.push({ passo, ok: false }); problemas.push(`${passo}: ${oneLine(error)}`); return false; }
  };
  if (!await step("Conectar ao banco", async () => { await pool.query("SELECT 1"); return undefined; })) return { ok: false, problemas, passos };
  const present = new Set<string>();
  await step("Conferir as tabelas e views", async () => {
    const { rows } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    rows.forEach(r => present.add(String(r.table_name)));
    const missing = ficha.visoes.map(v => v.nome).filter(v => !present.has(v));
    if (missing.length) return `Faltam no banco (tabelas ou views da ficha): ${missing.join(", ")}.`;
    return undefined;
  });
  if (problemas.length) return { ok: false, problemas, passos };
  const access = await step("Criar os papéis de leitura", async () => {
    try { await grantMetricReader(pool); await prepareFreeAccess(ficha, pool); return undefined; }
    catch (error) { return `O usuário do banco não conseguiu preparar os papéis somente leitura (precisa poder criar papéis e conceder SELECT): ${oneLine(error)}`; }
  });
  if (!access) return { ok: false, problemas, passos };
  await runAsTenant({ companyId, userId: 0, role: "administrador", data: { pool, ficha } }, async () => {
    await step("Ler as colunas descritas na ficha", async () => {
      for (const view of ficha.visoes) {
        try { await runFreeQuery(`SELECT ${view.colunas.map(c => c.nome).join(", ")} FROM ${view.nome} LIMIT 1`, ficha); }
        catch (error) { return `A view ${view.nome} não bate com a ficha: ${oneLine(error)}`; }
      }
      return undefined;
    });
    // The shortcuts exist only for a company whose ficha lists both governed views.
    if (REQUIRED_VIEWS.every(v => ficha.visoes.some(x => x.nome === v))) await step("Executar os atalhos de faturamento e recebíveis", async () => {
      const today = new Date().toISOString().slice(0, 10);
      try { await faturamento(range(addDays(today, -30), today)); await contasAReceberVencidas(today); }
      catch (error) { return `As views de vendas e recebíveis não têm o formato esperado: ${oneLine(error)}`; }
      return undefined;
    });
  });
  return { ok: problemas.length === 0, problemas, passos };
}

export function parseFicha(input: unknown): { ficha: Ficha } | { problemas: string[] } {
  const parsed = fichaSchema.safeParse(input);
  if (!parsed.success) return { problemas: parsed.error.issues.slice(0, 8).map(i => `Ficha inválida em ${i.path.join(".") || "raiz"}: ${i.message}`) };
  const pending = pendingFields(parsed.data);
  if (pending.length) return { problemas: [`A ficha ainda tem campos por descrever: ${pending.slice(0, 8).join(", ")}${pending.length > 8 ? ` e mais ${pending.length - 8}` : ""}.`] };
  return { ficha: parsed.data };
}

/** Verifies a new connection and ficha, and only when everything passes stores them and releases the company. A failed attempt changes nothing. */
export async function connectCompanyData(companyId: number, input: { url?: string; ficha?: unknown }): Promise<SetupReport> {
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  if (!company) return { ok: false, problemas: ["Empresa não encontrada."], passos: [] };
  if (companyId === 1) return { ok: false, problemas: ["A empresa de demonstração usa a base compartilhada e não pode ser reconfigurada."], passos: [] };
  const url = input.url?.trim() || (company.dataUrlEnc ? decryptSecret(company.dataUrlEnc) : "");
  if (!url) return { ok: false, problemas: ["Informe o endereço de conexão do banco."], passos: [] };
  if (!/^postgres(ql)?:\/\//i.test(url)) return { ok: false, problemas: ["O endereço do banco precisa começar com postgresql://."], passos: [] };
  const parsed = parseFicha(input.ficha ?? company.fichaJson);
  if ("problemas" in parsed) return { ok: false, problemas: parsed.problemas, passos: [] };
  const pool = newCompanyPool(url, 2);
  try {
    const report = await verifyCompanyData(companyId, pool, parsed.ficha);
    if (!report.ok) return report;
    await db.update(companiesTable).set({
      dataUrlEnc: input.url?.trim() ? encryptSecret(url) : company.dataUrlEnc, fichaJson: parsed.ficha, dataReady: true, dataCheckedAt: new Date(), dataError: null,
    }).where(eq(companiesTable.id, companyId));
    await forgetCompanyData(companyId);
    return report;
  } finally { await pool.end().catch(() => undefined); }
}

/** Re-runs the verification with what is stored and records the outcome: a company whose database stopped working is closed, not left half-working. */
export async function recheckCompanyData(companyId: number): Promise<SetupReport> {
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  if (!company?.dataUrlEnc || !company.fichaJson) return { ok: false, problemas: ["Esta empresa ainda não tem banco e ficha cadastrados."], passos: [] };
  const parsed = parseFicha(company.fichaJson);
  if ("problemas" in parsed) return { ok: false, problemas: parsed.problemas, passos: [] };
  const pool = newCompanyPool(decryptSecret(company.dataUrlEnc), 2);
  try {
    const report = await verifyCompanyData(companyId, pool, parsed.ficha);
    await db.update(companiesTable).set({ dataReady: report.ok, dataCheckedAt: new Date(), dataError: report.ok ? null : report.problemas.join(" | ").slice(0, 600) }).where(eq(companiesTable.id, companyId));
    await forgetCompanyData(companyId);
    return report;
  } finally { await pool.end().catch(() => undefined); }
}
