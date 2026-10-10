import { db, exportDocumentsTable, queryLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AskAssistantResponse, type ExportDocument, type MetricResult } from "@workspace/api-zod";
const metricNames: Record<MetricResult["metric"], string> = {
  faturamento: "Faturamento", contas_a_receber_vencidas: "Contas a receber vencidas", produtos_mais_vendidos: "Produtos mais vendidos",
};

export const exportRequested = (text: string) => {
  const normalized = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return !/\b(nao|sem|nunca)\s+(quero\s+)?(export|planilha|csv|baix|ger)/.test(normalized)
    && /\b(export\w*|planilha|csv|baixar|baixe|(?:gere|gerar|crie|criar)\s+(?:um |uma |o |a )?(?:relatorio|documento|arquivo))\b/.test(normalized);
};
export const exportPreviousRequested = (text: string) => exportRequested(text)
  && !/\b(hoje|ontem|semana|m[eê]s|meses|ano|trimestre|janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b|\d{4}-\d{2}-\d{2}/i.test(text)
  && (/\b(essa?|esta?|isso|ultimo|ultima|anterior)\b/.test(text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase())
    || !/fatur|receb|vencid|produto/i.test(text));
export function documentMetadata(row: typeof exportDocumentsTable.$inferSelect): ExportDocument {
  return { ...row, format: "csv", createdAt: row.createdAt.toISOString(), downloadUrl: `/api/documents/${row.id}/download` };
}
export async function findMetricLog(id: number) {
  const [log] = await db.select().from(queryLogsTable).where(eq(queryLogsTable.id, id));
  if (!log?.result) throw Object.assign(new Error("Faça uma consulta financeira antes de exportar."), { statusCode: 400 });
  // Validate the audited snapshot rather than trusting arbitrary client data.
  const metric = AskAssistantResponse.shape.metricResult.parse(log.result);
  if (!metric) throw new Error("Resultado da consulta indisponível.");
  const parameters = log.parameters as { _executions?: Array<{ result?: unknown }> };
  const metrics = (parameters._executions ?? []).filter(e => e.result).map(e => AskAssistantResponse.shape.metricResult.parse(e.result)).filter((r): r is MetricResult => Boolean(r));
  return { log, metric, metrics: metrics.length ? metrics : [metric] };
}
export async function createDocument(queryLogId: number): Promise<ExportDocument> {
  const { metric, metrics } = await findMetricLog(queryLogId);
  const [row] = await db.insert(exportDocumentsTable).values({
    queryLogId, title: metrics.length > 1 ? `Consulta com ${metrics.length} resultados` : `${metricNames[metric.metric]} · ${metric.period.label}`,
  }).returning();
  if (!row) throw new Error("Não foi possível preparar a exportação.");
  return documentMetadata(row);
}
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Prevent spreadsheet formula execution, including values after whitespace.
  if (/^[\s\uFEFF]*[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
const decimal = (value: number | null | undefined) => value == null ? "" : value.toFixed(2).replace(".", ",");
export function metricCsv(question: string, metric: MetricResult): string {
  const rows: unknown[][] = [
    ["Consulta", question], ["Métrica", metricNames[metric.metric]], ["Período", metric.period.label],
    ["Início", metric.period.startDate], ["Fim", metric.period.endDate], ["Referência", metric.period.referenceDate],
    ["Dados atualizados", metric.lastUpdatedAt], ["Filtros", metric.filters.join(" | ")],
    ["Valor calculado", decimal(metric.value)], [],
    ["Mês", "Faturamento líquido"],
    ...((metric.rawResult.monthly ?? []) as Array<{month: string; amount: number}>).map(m => [m.month, decimal(m.amount)]),
    [],
    ["Descrição", "Valor", "Quantidade", "Dias em atraso", "Faixa"],
    ...metric.details.map(d => [d.subject, decimal(d.amount), d.quantity, d.daysPastDue, d.bucket]),
    [], ["Comparação", "Valor", "Variação (%)"],
    ...metric.comparisons.map(c => [c.label, decimal(c.value), decimal(c.variationPct)]),
  ];
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n");
}
