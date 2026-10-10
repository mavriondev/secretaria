import type { MetricResult } from "@workspace/api-zod";
import type { ToolResult } from "../lib/relevance";

const client = (subject: string, amount: number) => ({ subject, amount, quantity: null, daysPastDue: null, bucket: null });
export function revenueResult(options: { start?: string; end?: string; value?: number; previous?: number; monthly?: Array<{ month: string; amount: number }>; clients?: Array<[string, number]> } = {}): MetricResult {
  const start = options.start ?? "2026-09-01", end = options.end ?? "2026-09-30";
  const value = options.value ?? 630359.91, previous = options.previous ?? 646897.93;
  const variation = previous ? Math.round((value - previous) / previous * 10000) / 100 : null;
  const clients = (options.clients ?? [["Comercial Litoral 12", 23949.25], ["Comercial Atlântico 18", 22115.75], ["Comercial Serrana 23", 21745.75]]).map(([s, a]) => client(s, a));
  const prevStart = "2026-08-01", prevEnd = "2026-08-31";
  return {
    metric: "faturamento", value,
    period: { label: "Mês passado", startDate: start, endDate: end, referenceDate: null },
    filters: [], lastUpdatedAt: "2026-10-09T21:18:14.991Z",
    comparisons: [{ label: `Comparação: ${prevStart} a ${prevEnd}`, value: previous, variationPct: variation }], details: clients,
    rawResult: { total: value, periodo: { startDate: start, endDate: end }, periodoAnterior: { startDate: prevStart, endDate: prevEnd }, totalAnterior: previous, variacaoPercentual: variation, mesmoDiaSemanaAnterior: null, topClientes: clients, monthly: options.monthly ?? [{ month: start.slice(0, 7), amount: value }] },
  };
}
export const toolResult = (result: MetricResult, parameters: Record<string, unknown> = {}): ToolResult => ({ prefix: "", result, parameters });
export function receivablesResult(): MetricResult {
  const debtors = [{ subject: "Distribuidora Norte 4", amount: 52000, quantity: 3, daysPastDue: 95, bucket: null }, { subject: "Mercado Horizonte", amount: 11000, quantity: 1, daysPastDue: 12, bucket: null }];
  const buckets = [["1-30", 20000], ["31-60", 8000], ["61-90", 5000], ["mais de 90", 47000]].map(([b, a]) => ({ subject: `Atraso: ${b} dias`, amount: a as number, quantity: 1, daysPastDue: null, bucket: b as string }));
  return {
    metric: "contas_a_receber_vencidas", value: 80000,
    period: { label: "Vencidos antes de 10/10/2026", startDate: null, endDate: null, referenceDate: "2026-10-10" },
    filters: [], lastUpdatedAt: "2026-10-09T21:18:14.991Z", comparisons: [], details: [...debtors, ...buckets],
    rawResult: { total: 80000, quantidade: 9, dataReferencia: "2026-10-10", maioresDevedores: debtors, faixasAtraso: buckets },
  };
}
