import type { MetricResult, MetricDetail } from "@workspace/api-zod";
import { ERP_CONFIG } from "@workspace/db";
import { withMetricReader } from "./metric-reader";
import { addDays, assertDate, dateBr, previousPeriod, yearAgoPeriod, monthlySeries, type DateRange } from "./periods";
import type { PoolClient } from "pg";

const amount = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const percentage = (current: number, previous: number) => previous === 0 ? null : amount((current - previous) / previous * 100);
const saleFilters = [
  `Empresa: CODEMP = ${ERP_CONFIG.companyCode}`,
  `TIPMOV = ${ERP_CONFIG.validSale.movement}; STATUSNOTA = ${ERP_CONFIG.validSale.status} (códigos de exemplo)`,
  "Faturamento líquido: VLRTOT − VLRDESC, por DTNEG; datas inclusivas",
];
const detail = (subject: string, value: unknown, quantity: number | null = null, daysPastDue: number | null = null, bucket: string | null = null): MetricDetail =>
  ({ subject, amount: amount(value), quantity, daysPastDue, bucket });
async function freshness(client: PoolClient, view: "vw_vendas_itens" | "vw_titulos_receber"): Promise<string> {
  const { rows } = await client.query(`SELECT MAX(atualizado_em) AS updated FROM ${view}`);
  if (!rows[0]?.updated) throw new Error("Dados de demonstração ainda não foram carregados.");
  return new Date(rows[0].updated).toISOString();
}
async function revenueTotal(client: PoolClient, period: DateRange): Promise<number> {
  const { rows } = await client.query("SELECT COALESCE(SUM(valor_liquido), 0) AS total FROM vw_vendas_itens WHERE data BETWEEN $1::date AND $2::date", [period.startDate, period.endDate]);
  return amount(rows[0].total);
}
export type ComparisonBase = "anterior" | "ano_anterior";
/** Whether the comparison base has any sale at all, so "no history loaded" is never confused with "revenue was zero". */
async function hasSales(client: PoolClient, period: DateRange): Promise<boolean> {
  const { rows } = await client.query("SELECT EXISTS (SELECT 1 FROM vw_vendas_itens WHERE data BETWEEN $1::date AND $2::date) AS found", [period.startDate, period.endDate]);
  return Boolean(rows[0]?.found);
}
export async function faturamento(period: DateRange, compareWith: ComparisonBase = "anterior"): Promise<MetricResult> {
  return withMetricReader(async client => {
    const value = await revenueTotal(client, period);
    // The backend resolves the base period; the model never builds last year's dates.
    const previous = compareWith === "ano_anterior" ? yearAgoPeriod(period) : previousPeriod(period);
    const previousValue = await revenueTotal(client, previous);
    const baseHasData = await hasSales(client, previous);
    const variationPct = percentage(value, previousValue);
    const { rows } = await client.query("SELECT cliente_id, cliente, SUM(valor_liquido) AS total FROM vw_vendas_itens WHERE data BETWEEN $1::date AND $2::date GROUP BY cliente_id, cliente ORDER BY total DESC, cliente_id LIMIT 3", [period.startDate, period.endDate]);
    const details = rows.map(row => detail(row.cliente, row.total));
    const { rows: monthlyRows } = await client.query(
      "SELECT to_char(data, 'YYYY-MM') AS month, SUM(valor_liquido) AS total FROM vw_vendas_itens WHERE data BETWEEN $1::date AND $2::date GROUP BY 1 ORDER BY 1",
      [period.startDate, period.endDate],
    );
    const monthly = monthlySeries(period, monthlyRows.map(row => ({ month: row.month as string, amount: amount(row.total) })));
    const comparisons = [{ label: `${compareWith === "ano_anterior" ? "Mesmo período do ano anterior" : "Comparação"}: ${dateBr(previous.startDate)} a ${dateBr(previous.endDate)}`, value: previousValue, variationPct }];
    let sameWeekdayValue: number | null = null;
    if (period.startDate === period.endDate) {
      const day = addDays(period.startDate, -7);
      sameWeekdayValue = await revenueTotal(client, { startDate: day, endDate: day, label: dateBr(day) });
      comparisons.push({ label: `Mesmo dia da semana anterior: ${dateBr(day)}`, value: sameWeekdayValue, variationPct: percentage(value, sameWeekdayValue) });
    }
    return {
      metric: "faturamento", value,
      period: { label: period.label, startDate: period.startDate, endDate: period.endDate, referenceDate: null },
      filters: saleFilters, lastUpdatedAt: await freshness(client, "vw_vendas_itens"),
      comparisons, details,
      rawResult: { total: value, periodo: period, periodoAnterior: previous, comparadoCom: compareWith, baseTemDados: baseHasData, totalAnterior: previousValue, variacaoPercentual: variationPct, mesmoDiaSemanaAnterior: sameWeekdayValue, topClientes: details, monthly },
    };
  });
}
export async function contasAReceberVencidas(referenceDate: string): Promise<MetricResult> {
  assertDate(referenceDate);
  return withMetricReader(async client => {
    const where = "baixado_em IS NULL AND vencimento < $1::date";
    const { rows: totals } = await client.query(`SELECT COALESCE(SUM(valor), 0) AS total, COUNT(*)::integer AS count FROM vw_titulos_receber WHERE ${where}`, [referenceDate]);
    const value = amount(totals[0].total);
    const { rows: debtors } = await client.query(`SELECT cliente_id, cliente, SUM(valor) AS total, COUNT(*)::integer AS count, MAX($1::date - vencimento)::integer AS days FROM vw_titulos_receber WHERE ${where} GROUP BY cliente_id, cliente ORDER BY total DESC, cliente_id LIMIT 5`, [referenceDate]);
    const { rows: buckets } = await client.query(`SELECT CASE WHEN $1::date - vencimento <= 30 THEN '1-30' WHEN $1::date - vencimento <= 60 THEN '31-60' WHEN $1::date - vencimento <= 90 THEN '61-90' ELSE 'mais de 90' END AS bucket, SUM(valor) AS total, COUNT(*)::integer AS count FROM vw_titulos_receber WHERE ${where} GROUP BY bucket`, [referenceDate]);
    const aging = ["1-30", "31-60", "61-90", "mais de 90"].map(bucket => {
      const row = buckets.find(row => row.bucket === bucket);
      return detail(`Atraso: ${bucket} dias`, row?.total ?? 0, row?.count ?? 0, null, bucket);
    });
    const topDebtors = debtors.map(row => detail(row.cliente, row.total, row.count, row.days));
    return {
      metric: "contas_a_receber_vencidas", value,
      period: { label: `Vencidos antes de ${dateBr(referenceDate)}`, startDate: null, endDate: null, referenceDate },
      filters: ["RECDESP = 1 (receita)", "DHBAIXA IS NULL (sem baixa)", `DTVENC anterior a ${dateBr(referenceDate)}; títulos vencendo nesta data não entram`],
      lastUpdatedAt: await freshness(client, "vw_titulos_receber"), comparisons: [],
      details: [...topDebtors, ...aging],
      rawResult: { total: value, quantidade: totals[0].count, dataReferencia: referenceDate, maioresDevedores: topDebtors, faixasAtraso: aging },
    };
  });
}
export async function produtosMaisVendidos(period: DateRange, limit: number): Promise<MetricResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("O limite deve ser de 1 a 20 produtos.");
  return withMetricReader(async client => {
    const { rows } = await client.query("SELECT produto_id, produto, SUM(valor_liquido) AS total, SUM(quantidade) AS quantity FROM vw_vendas_itens WHERE data BETWEEN $1::date AND $2::date GROUP BY produto_id, produto ORDER BY total DESC, produto_id LIMIT $3", [period.startDate, period.endDate, limit]);
    const details = rows.map(row => detail(row.produto, row.total, Number(row.quantity)));
    return {
      metric: "produtos_mais_vendidos", value: details[0]?.amount ?? 0,
      period: { label: period.label, startDate: period.startDate, endDate: period.endDate, referenceDate: null },
      filters: [...saleFilters, `Ranking por valor líquido, não por quantidade; limite: ${limit}`],
      lastUpdatedAt: await freshness(client, "vw_vendas_itens"), comparisons: [], details,
      rawResult: { valorLider: details[0]?.amount ?? 0, totalPeriodo: await revenueTotal(client, period), periodo: period, limite: limit, ranking: details },
    };
  });
}
