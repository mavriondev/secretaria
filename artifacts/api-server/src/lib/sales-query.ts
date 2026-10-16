import { z } from "zod";
import type { MetricResult } from "@workspace/api-zod";
import { monthlySeries, type DateRange } from "./periods";
import { withMetricReader } from "./metric-reader";
import { MAX_OPCOES, perguntaDeEntidade } from "./esclarecimento";

export const salesOptions = z.object({
  agrupar: z.enum(["mes", "cliente", "produto", "vendedor"]),
  filtro_tipo: z.enum(["cliente", "produto", "vendedor"]).nullable(),
  filtro_nome: z.string().min(1).max(120).nullable(),
  limite: z.number().int().min(1).max(120),
}).strict();
const columns = { cliente: "cliente", produto: "produto", vendedor: "vendedor" } as const;
export class ClarificationNeeded extends Error {
  constructor(message: string, readonly opcoes: string[]) { super(message); }
}
/** `hipotese`: the rounds of clarification are exhausted, so an ambiguous name takes the best match (largest sales) instead of another question. */
export async function salesQuery(period: DateRange, options: z.infer<typeof salesOptions>, extra: { hipotese?: boolean } = {}): Promise<MetricResult> {
  const input = salesOptions.parse(options);
  if (Boolean(input.filtro_tipo) !== Boolean(input.filtro_nome)) throw new Error("Informe o tipo e o nome do filtro juntos.");
  return withMetricReader(async client => {
    const values: unknown[] = [period.startDate, period.endDate];
    let where = "data BETWEEN $1::date AND $2::date";
    let filtroUsado = input.filtro_nome;
    if (input.filtro_tipo) {
      const column = columns[input.filtro_tipo];
      const { rows: exact } = await client.query(`SELECT 1 FROM vw_vendas_itens WHERE lower(${column})=lower($1) LIMIT 1`, [input.filtro_nome]);
      if (!exact.length) {
        // Real options only, ordered by what they sold: first those with sales in the period (never an empty result), else the matches of the whole base.
        const matches = async (inPeriod: boolean) => (await client.query(`SELECT ${column} AS name, COALESCE(SUM(valor_liquido),0) AS total FROM vw_vendas_itens WHERE position(lower($1) in lower(${column}))>0${inPeriod ? " AND data BETWEEN $2::date AND $3::date" : ""} GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT ${MAX_OPCOES + 1}`, inPeriod ? [input.filtro_nome, period.startDate, period.endDate] : [input.filtro_nome])).rows as Array<{ name: string }>;
        const noPeriodo = await matches(true);
        const found = noPeriodo.length ? noPeriodo : await matches(false);
        const opcoes = found.slice(0, MAX_OPCOES).map(r => String(r.name));
        // One valid option: use it and declare, never ask. Rounds exhausted: the best match is the declared hypothesis.
        if (opcoes.length > 1 && !extra.hipotese) throw new ClarificationNeeded(perguntaDeEntidade(input.filtro_tipo, input.filtro_nome!, opcoes, found.length > MAX_OPCOES, period.label), opcoes);
        if (opcoes.length) filtroUsado = opcoes[0]!;
      }
      values.push(filtroUsado);
      where += ` AND lower(${columns[input.filtro_tipo]}) = lower($3)`;
    }
    const grouping = input.agrupar === "mes" ? "to_char(data, 'YYYY-MM')" : columns[input.agrupar];
    const { rows: totals } = await client.query(`SELECT COALESCE(SUM(valor_liquido),0) AS total, MAX(atualizado_em) AS updated FROM vw_vendas_itens WHERE ${where}`, values);
    const { rows: freshness } = await client.query("SELECT MAX(atualizado_em) AS updated FROM vw_vendas_itens");
    if (!freshness[0]?.updated) throw new Error("A base de vendas ainda não foi carregada.");
    const { rows } = await client.query(`SELECT ${grouping} AS subject, SUM(valor_liquido) AS amount, SUM(quantidade) AS quantity, COUNT(*) OVER()::int AS group_count FROM vw_vendas_itens WHERE ${where} GROUP BY 1 ORDER BY ${input.agrupar === "mes" ? "1" : "2 DESC, 1"} LIMIT $${values.length + 1}`, [...values, input.agrupar === "mes" ? 121 : input.limite]);
    const money = (v: unknown) => Math.round(Number(v) * 100) / 100;
    const allRows = input.agrupar === "mes"
      ? monthlySeries(period, rows.map(row => ({ month: String(row.subject), amount: money(row.amount) }))).map(row => ({ subject: row.month, amount: row.amount, quantity: null }))
      : rows;
    const groupCount = input.agrupar === "mes" ? allRows.length : Number(rows[0]?.group_count ?? 0);
    const details = allRows.slice(0, input.limite).map(row => ({ subject: String(row.subject), amount: money(row.amount), quantity: row.quantity == null ? null : Number(row.quantity), daysPastDue: null, bucket: null }));
    return {
      metric: "faturamento", value: money(totals[0].total),
      period: { ...period, referenceDate: null }, comparisons: [], details,
      filters: ["Empresa da POC; vendas confirmadas; faturamento líquido", `Agrupado por ${input.agrupar}`, ...(input.filtro_tipo ? [`${input.filtro_tipo}: nome exato ${filtroUsado}`] : []), `Até ${input.limite} grupos; o total inclui todos os grupos do filtro`],
      lastUpdatedAt: new Date(freshness[0].updated).toISOString(),
      rawResult: { total: money(totals[0].total), agrupamento: input.agrupar, filtro: input.filtro_tipo ? filtroUsado : null, ...(input.filtro_tipo && filtroUsado !== input.filtro_nome ? { filtroInformado: input.filtro_nome } : {}), groups: details, groupCount, truncated: groupCount > details.length },
    };
  });
}
