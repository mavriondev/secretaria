/**
 * Favourites that come from the ready-made shortcuts (faturamento, contas a receber vencidas, produtos mais vendidos,
 * consultar_vendas). Instead of SQL, the card stores the tool and its parameters with the *relative* period the person
 * asked for ("este mês", "hoje", "últimos 3 meses"); on every run the period is resolved again in America/Sao_Paulo and
 * the same metric function the assistant uses is executed — no model call. A literal period ("setembro") cannot follow
 * the calendar, so such a card can only be fixed.
 */
import type { MetricResult } from "@workspace/api-zod";
import type { FavoriteForm } from "@workspace/db";
import { contasAReceberVencidas, faturamento, produtosMaisVendidos, type ComparisonBase } from "./metrics";
import { salesOptions, salesQuery } from "./sales-query";
import { resolvePeriod, type PeriodPreset } from "./periods";
import type { FreeQueryResult } from "./free-query";
import type { DeclaredFormat } from "./free-facts";

export const METRIC_TOOLS = ["faturamento", "contas_a_receber_vencidas", "produtos_mais_vendidos", "consultar_vendas"] as const;
export type MetricTool = (typeof METRIC_TOOLS)[number];
export type MetricaSalva = { ferramenta: MetricTool; parametros: Record<string, unknown> };

const isMetricTool = (tool: unknown): tool is MetricTool => typeof tool === "string" && (METRIC_TOOLS as readonly string[]).includes(tool);

/** The last shortcut executed in an answer, as recorded in its audit log. Null when the answer had none. */
export function metricaDosParametros(parameters: unknown): MetricaSalva | null {
  const executions = (parameters as { _executions?: unknown[] } | null)?._executions;
  if (!Array.isArray(executions)) return null;
  for (const item of [...executions].reverse()) {
    const e = item as { tool?: unknown; parameters?: unknown; result?: unknown };
    if (isMetricTool(e.tool) && e.result && e.parameters && typeof e.parameters === "object") return { ferramenta: e.tool, parametros: e.parameters as Record<string, unknown> };
  }
  return null;
}

/** Whether the saved parameters describe a period that moves with the calendar (so the card can be live). */
export function periodoRelativo(m: MetricaSalva): boolean {
  if (m.ferramenta === "contas_a_receber_vencidas") return m.parametros._hoje === true;
  return typeof m.parametros.periodo === "string" && m.parametros.periodo !== "custom";
}
export const MOTIVO_PERIODO_FIXO = "o período pedido tem datas fixas, então só dá para guardar o valor de hoje";

const periodOf = (p: Record<string, unknown>, now: Date) => resolvePeriod({
  preset: p.periodo as PeriodPreset, months: typeof p.meses === "number" ? p.meses : undefined,
  startDate: typeof p.data_inicio === "string" ? p.data_inicio : undefined, endDate: typeof p.data_fim === "string" ? p.data_fim : undefined,
}, now);
const todayLocal = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Runs the metric exactly as the assistant does, with the period resolved for `now`. */
export async function rodarMetrica(m: MetricaSalva, now = new Date()): Promise<MetricResult> {
  const p = m.parametros;
  switch (m.ferramenta) {
    case "faturamento": return faturamento(periodOf(p, now), (p.comparar_com as ComparisonBase | undefined) ?? "anterior");
    case "produtos_mais_vendidos": return produtosMaisVendidos(periodOf(p, now), typeof p.limite === "number" ? p.limite : 5);
    case "consultar_vendas": return salesQuery(periodOf(p, now), salesOptions.parse({ agrupar: p.agrupar, filtro_tipo: p.filtro_tipo ?? null, filtro_nome: p.filtro_nome ?? null, limite: typeof p.limite === "number" ? p.limite : 10 }));
    case "contas_a_receber_vencidas": return contasAReceberVencidas(p._hoje === true || typeof p.data_referencia !== "string" ? todayLocal(now) : p.data_referencia);
  }
}

/** Column formats the card uses for each shortcut (the same four card forms as free queries). */
export function formatosDaMetrica(m: MetricaSalva): DeclaredFormat[] {
  switch (m.ferramenta) {
    case "faturamento": return [{ coluna: "faturamento", formato: "dinheiro", rotulo: "Faturamento" }];
    case "produtos_mais_vendidos": return [{ coluna: "produto", formato: "texto", rotulo: "Produto" }, { coluna: "total", formato: "dinheiro", rotulo: "Total vendido" }];
    case "contas_a_receber_vencidas": return [
      { coluna: "cliente", formato: "texto", rotulo: "Cliente" }, { coluna: "valor", formato: "dinheiro", rotulo: "Valor vencido" },
      { coluna: "titulos", formato: "inteiro", rotulo: "Títulos" }, { coluna: "dias", formato: "inteiro", rotulo: "Dias de atraso" },
    ];
    case "consultar_vendas": {
      const group = String(m.parametros.agrupar ?? "cliente");
      return group === "mes"
        ? [{ coluna: "mes", formato: "data", rotulo: "Mês" }, { coluna: "total", formato: "dinheiro", rotulo: "Faturamento" }]
        : [{ coluna: group, formato: "texto", rotulo: group.charAt(0).toUpperCase() + group.slice(1) }, { coluna: "total", formato: "dinheiro", rotulo: "Faturamento" }];
    }
  }
}

/** Form the card opens with (the person may switch to any compatible one): overdue receivables read better as a table with days past due. */
export const formaPreferida = (m: MetricaSalva): FavoriteForm | null => m.ferramenta === "contas_a_receber_vencidas" ? "tabela" : null;

const money = (v: number) => v.toFixed(2);
/** Shapes a metric result like a free-query result so the card pipeline (typed columns, form choice, drawing) is reused as is. */
export function resultadoDaMetrica(m: MetricaSalva, result: MetricResult): FreeQueryResult {
  const base = { sql: "", truncated: false, updatedAt: result.lastUpdatedAt ?? null };
  const col = (name: string, oid: number) => ({ name, oid });
  switch (m.ferramenta) {
    case "faturamento":
      return { ...base, views: ["vw_vendas_itens"], columns: [col("faturamento", 1700)], rows: [{ faturamento: money(result.value) }] };
    case "produtos_mais_vendidos":
      return { ...base, views: ["vw_vendas_itens"], columns: [col("produto", 25), col("total", 1700)], rows: result.details.map(d => ({ produto: d.subject, total: money(d.amount) })) };
    case "contas_a_receber_vencidas":
      return { ...base, views: ["vw_titulos_receber"], columns: [col("cliente", 25), col("valor", 1700), col("titulos", 23), col("dias", 23)],
        rows: result.details.map(d => ({ cliente: d.subject, valor: money(d.amount), titulos: d.quantity == null ? null : String(d.quantity), dias: d.daysPastDue == null ? null : String(d.daysPastDue) })) };
    case "consultar_vendas": {
      const group = String(m.parametros.agrupar ?? "cliente");
      return { ...base, views: ["vw_vendas_itens"], columns: [col(group, group === "mes" ? 1082 : 25), col("total", 1700)],
        rows: result.details.map(d => ({ [group]: group === "mes" ? `${d.subject}-01` : d.subject, total: money(d.amount) })) };
    }
  }
}
