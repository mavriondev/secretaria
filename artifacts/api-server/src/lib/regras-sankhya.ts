import type { Pool } from "pg";
import { z } from "zod";

/**
 * What counts as a sale and as a receivable for a Sankhya customer. The defaults are the usual Sankhya meaning; the analyst's answers
 * (or the search against a reference total) only change these values, never the code. Every value is validated to a few safe shapes because
 * it is written into a view definition, which cannot take bound parameters.
 */
export const regrasSchema = z.object({
  /** Which date places a sale in a month: DTNEG (negotiation) or DTFATUR (invoicing). */
  dataVenda: z.enum(["DTNEG", "DTFATUR"]),
  /** TIPMOV values that are sales (V = venda). */
  tiposMovimento: z.array(z.string().regex(/^[A-Z]$/)).min(1).max(8),
  /** STATUSNOTA values that count (L = liberada). Anything else, such as cancelled or pending, stays out. */
  statusNota: z.array(z.string().regex(/^[A-Z]$/)).min(1).max(8),
  /** liquido: VLRTOT minus VLRDESC. bruto: VLRTOT. */
  valorItem: z.enum(["liquido", "bruto"]),
  /** Operations (CODTIPOPER) left out of sales. */
  operacoesExcluidas: z.array(z.number().int().min(0).max(99_999_999)).max(200),
  /** Leave out operations marked as bonus (TGFTOP.BONIFICACAO = 'S'). */
  excluirBonificacao: z.boolean(),
  /** Companies (CODEMP) that count; null means all. */
  empresas: z.array(z.number().int().min(0).max(99_999)).max(100).nullable(),
  /** Receivables: whether provisioned (not yet real) titles are included. */
  incluirProvisao: z.boolean(),
}).strict();
export type RegrasSankhya = z.infer<typeof regrasSchema>;
export const REGRAS_PADRAO: RegrasSankhya = {
  dataVenda: "DTNEG", tiposMovimento: ["V"], statusNota: ["L"], valorItem: "liquido",
  operacoesExcluidas: [], excluirBonificacao: false, empresas: null, incluirProvisao: false,
};
export const regrasEfetivas = (stored: unknown): RegrasSankhya => regrasSchema.parse({ ...REGRAS_PADRAO, ...(stored && typeof stored === "object" ? stored : {}) });

const list = (values: Array<string | number>) => values.map(v => typeof v === "number" ? String(v) : `'${v}'`).join(", ");
const valorSql = (r: RegrasSankhya) => r.valorItem === "liquido" ? `(i.vlrtot - COALESCE(i.vlrdesc, 0))` : `i.vlrtot`;

/** The view of sales items, over the mirror tables, in the shape the governed metrics read. */
export function viewVendasSql(r: RegrasSankhya): string {
  const where = [
    `c.tipmov IN (${list(r.tiposMovimento)})`, `c.statusnota IN (${list(r.statusNota)})`,
    ...(r.operacoesExcluidas.length ? [`c.codtipoper NOT IN (${list(r.operacoesExcluidas)})`] : []),
    ...(r.excluirBonificacao ? [`COALESCE(t.bonificacao, 'N') <> 'S'`] : []),
    ...(r.empresas ? [`c.codemp IN (${list(r.empresas)})`] : []),
  ].join("\n  AND ");
  return `CREATE OR REPLACE VIEW vw_vendas_itens AS
SELECT
  c.${r.dataVenda.toLowerCase()}::date AS data,
  c.codparc AS cliente_id, COALESCE(p.nomeparc, 'Sem cadastro') AS cliente,
  i.codprod AS produto_id, COALESCE(pr.descrprod, 'Sem cadastro') AS produto,
  c.codvend AS vendedor_id, COALESCE(v.apelido, 'Sem vendedor') AS vendedor,
  i.qtdneg AS quantidade,
  ${valorSql(r)} AS valor_liquido,
  (SELECT MIN(carregado_em) FROM espelho_controle WHERE tabela IN ('tgfcab', 'tgfite')) AS atualizado_em
FROM tgfite i
JOIN tgfcab c ON c.nunota = i.nunota
LEFT JOIN tgftop t ON t.codtipoper = c.codtipoper AND t.dhalter = c.dhtipoper
LEFT JOIN tgfpar p ON p.codparc = c.codparc
LEFT JOIN tgfpro pr ON pr.codprod = i.codprod
LEFT JOIN tgfven v ON v.codvend = c.codvend
WHERE ${where}`;
}

export function viewTitulosSql(r: RegrasSankhya): string {
  return `CREATE OR REPLACE VIEW vw_titulos_receber AS
SELECT
  f.nufin AS titulo_id, f.codparc AS cliente_id, COALESCE(p.nomeparc, 'Sem cadastro') AS cliente,
  f.dtvenc::date AS vencimento, f.vlrdesdob AS valor, f.dhbaixa::timestamp AS baixado_em,
  (SELECT carregado_em FROM espelho_controle WHERE tabela = 'tgffin') AS atualizado_em
FROM tgffin f
LEFT JOIN tgfpar p ON p.codparc = f.codparc
WHERE f.recdesp = 1${r.incluirProvisao ? "" : `\n  AND COALESCE(f.provisao, 'N') = 'N'`}${r.empresas ? `\n  AND f.codemp IN (${list(r.empresas)})` : ""}`;
}

/** Creates or replaces the two views in the company's database. Which of them depends on the subjects whose tables were copied. */
export async function aplicarRegras(pool: Pool, regras: RegrasSankhya, assuntos: string[]): Promise<{ vendas: boolean; financeiro: boolean }> {
  const done = { vendas: false, financeiro: false };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TABLE IF NOT EXISTS espelho_controle (tabela text PRIMARY KEY, carregado_em timestamptz NOT NULL)`);
    if (assuntos.includes("vendas")) { await client.query(viewVendasSql(regras)); done.vendas = true; }
    if (assuntos.includes("financeiro")) { await client.query(viewTitulosSql(regras)); done.financeiro = true; }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
  return done;
}

export type LinhaDiagnostico = { tipmov: string | null; status: string | null; bonificacao: boolean; dataUsada: "DTNEG" | "DTFATUR"; liquido: number; bruto: number; itens: number };
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Sales of one month in the mirror, split by the attributes the rules choose on, for both candidate dates. Nothing is filtered, so the owner sees what each rule would include. */
export async function diagnosticoVendas(pool: Pool, mes: string): Promise<LinhaDiagnostico[]> {
  if (!MES.test(mes)) throw new Error("Informe o mês no formato AAAA-MM.");
  const out: LinhaDiagnostico[] = [];
  for (const dataUsada of ["DTNEG", "DTFATUR"] as const) {
    const { rows } = await pool.query(
      `SELECT c.tipmov AS tipmov, c.statusnota AS status, (COALESCE(t.bonificacao, 'N') = 'S') AS bonificacao,
              COALESCE(SUM(i.vlrtot - COALESCE(i.vlrdesc, 0)), 0)::float8 AS liquido, COALESCE(SUM(i.vlrtot), 0)::float8 AS bruto, COUNT(*)::int AS itens
       FROM tgfite i JOIN tgfcab c ON c.nunota = i.nunota
       LEFT JOIN tgftop t ON t.codtipoper = c.codtipoper AND t.dhalter = c.dhtipoper
       WHERE to_char(c.${dataUsada.toLowerCase()}, 'YYYY-MM') = $1 GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [mes]);
    for (const r of rows) out.push({ ...r, dataUsada });
  }
  return out;
}

export type Candidata = { regras: Pick<RegrasSankhya, "dataVenda" | "tiposMovimento" | "statusNota" | "valorItem" | "excluirBonificacao">; total: number; diferenca: number };
const subsets = <T,>(items: T[]): T[][] => items.reduce<T[][]>((all, item) => [...all, ...all.map(s => [...s, item])], [[]]).filter(s => s.length);

/**
 * Finds which combination of the common rules reproduces a total the customer already trusts for a month. The search is only over the values
 * actually present in that month, so it is small. It returns every combination within the tolerance, simplest first; the owner (with the analyst)
 * picks the one that makes business sense, because several can coincide.
 */
export function procurarRegras(linhas: LinhaDiagnostico[], totalEsperado: number, tolerancia = 0.01): Candidata[] {
  const tipos = [...new Set(linhas.map(l => l.tipmov).filter((v): v is string => !!v))];
  const status = [...new Set(linhas.map(l => l.status).filter((v): v is string => !!v))];
  const found: Candidata[] = [];
  for (const dataVenda of ["DTNEG", "DTFATUR"] as const) for (const valorItem of ["liquido", "bruto"] as const) for (const excluirBonificacao of [false, true])
    for (const tiposMovimento of subsets(tipos)) for (const statusNota of subsets(status)) {
      const total = linhas.filter(l => l.dataUsada === dataVenda && tiposMovimento.includes(l.tipmov ?? "") && statusNota.includes(l.status ?? "") && !(excluirBonificacao && l.bonificacao))
        .reduce((sum, l) => sum + (valorItem === "liquido" ? l.liquido : l.bruto), 0);
      const diferenca = Math.round((total - totalEsperado) * 100) / 100;
      if (Math.abs(diferenca) <= tolerancia) found.push({ regras: { dataVenda, tiposMovimento, statusNota, valorItem, excluirBonificacao }, total: Math.round(total * 100) / 100, diferenca });
    }
  const weight = (c: Candidata) => c.regras.tiposMovimento.length + c.regras.statusNota.length + (c.regras.excluirBonificacao ? 1 : 0) + (c.regras.dataVenda === "DTNEG" ? 0 : 0.5) + (c.regras.valorItem === "liquido" ? 0 : 0.5);
  return found.sort((a, b) => weight(a) - weight(b)).slice(0, 20);
}
