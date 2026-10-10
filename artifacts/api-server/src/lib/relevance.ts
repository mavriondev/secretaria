import type { MetricResult } from "@workspace/api-zod";
import type { Fact } from "./facts";
import { alreadyOffered, type ConversationState, type SuggestedAction } from "./conversation-state";
import { relevanceConfig, type RelevanceConfig } from "./relevance-config";

export type Presentation = "normal" | "conciso" | "completo" | "comparar";
export type PresentationOrigin = "roteador" | "padrao" | "conversa" | "sugestao-pendente" | "continuacao";
export type Candidate = {
  id: string;
  kind: "comentario" | "sugestao";
  /** Fact ids the candidate is about; the composition may only cite these (plus the facts of the request itself). */
  factIds: string[];
  motivo: string;
  acao?: SuggestedAction;
};
export type ToolResult = { prefix: string; result: MetricResult; parameters: Record<string, unknown> };

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
/** Text patterns are a safety net for the router's apresentacao argument; the explicit request always wins. */
export function detectPresentation(question: string): Presentation | null {
  const text = normalize(question);
  if (/\b(so|somente|apenas)\s+(me\s+)?(diga|diz|fala|fale|informe|quero|o total|o valor|o numero)\b|\bsem (comparar|comparacao|detalhes|comentarios?)\b|\bdireto ao ponto\b|\bresposta curta\b|\bseja (breve|objetiv\w)\b|\bresumid\w\b/.test(text)) return "conciso";
  if (/\bcompar\w*\b|\bem relacao a\w*\b|\bversus\b|\bcontra\b|\bfrente a\w*\b|\bcomparativo\b/.test(text)) return "comparar";
  if (/\b(complet\w|detalhad\w|me explica tudo|tudo sobre|com detalhes)\b/.test(text)) return "completo";
  return null;
}
/** Explicit request in the turn (router, then text pattern as safety net) > standing preference of the conversation > normal. */
export const resolvePresentation = (routerChoice: Presentation | undefined, question: string, standing: "conciso" | "completo" | null = null): { presentation: Presentation; origem: PresentationOrigin } => {
  const pattern = detectPresentation(question);
  if (pattern && pattern !== (routerChoice ?? "normal")) return { presentation: pattern, origem: "padrao" };
  if (routerChoice && routerChoice !== "normal") return { presentation: routerChoice, origem: routerChoice === standing && !pattern ? "conversa" : "roteador" };
  if (standing) return { presentation: standing, origem: "conversa" };
  return { presentation: "normal", origem: "roteador" };
};

const number = (facts: Fact[], id: string) => { const f = facts.find(f => f.id === id); return typeof f?.value === "number" ? f.value : null; };
const keysOf = (facts: Fact[], ids: string[]) => ids.map(id => facts.find(f => f.id === id)?.key).filter((k): k is string => !!k);

/** Builds everything that could be mentioned and keeps only what passes threshold, novelty and action availability. */
export function buildCandidates(input: {
  results: ToolResult[]; facts: Fact[]; state: ConversationState; level: 0 | 1 | 2; presentation: Presentation; config?: RelevanceConfig;
}): Candidate[] {
  // "completo" is an explicit request: every available insight becomes a candidate and suggestions are allowed regardless of level.
  const complete = input.presentation === "completo";
  const cfg = complete ? { ...relevanceConfig, minVariationPct: 0, minMonthlyTrendPct: 0, minConcentrationPct: 0, minLongOverduePct: 0, minOverdueDays: 0, maxCandidates: 8 } : (input.config ?? relevanceConfig);
  if ((input.level === 0 && !complete) || input.presentation === "conciso") return [];
  const candidates: Candidate[] = [];
  const comment = (id: string, factIds: string[], motivo: string) => {
    const keys = keysOf(input.facts, factIds);
    if (!keys.length || keys.every(k => input.state.apresentado.includes(k))) return;
    candidates.push({ id, kind: "comentario", factIds, motivo });
  };
  const suggest = (id: string, acao: SuggestedAction, motivo: string) => {
    if ((input.level < 2 && !complete) || alreadyOffered(input.state, acao)) return;
    candidates.push({ id, kind: "sugestao", factIds: [], motivo, acao });
  };
  const requested = input.presentation === "comparar";
  for (const { prefix, result, parameters } of input.results) {
    const p = prefix ? `${prefix}.` : "";
    const f = input.facts;
    if (result.metric === "faturamento") {
      const variation = number(f, `${p}comparacao.variacao`);
      // Automatic comparison with the previous period is only a candidate; an explicit "compare" request is handled by the deterministic text.
      if (!requested && variation != null && Math.abs(variation) >= cfg.minVariationPct) {
        comment(`${p}comparacao`, [`${p}comparacao.periodo`, `${p}comparacao.valor`, `${p}comparacao.variacao`, `${p}comparacao.direcao`, `${p}comparacao.movimento`], `variação de ${variation}% sobre o período anterior equivalente (limite ${cfg.minVariationPct}%)`);
      }
      const trend = number(f, `${p}meses.variacao_ponta_a_ponta`);
      if (trend != null && Math.abs(trend) >= cfg.minMonthlyTrendPct) {
        const months = f.filter(x => x.id.startsWith(`${p}mes.`) && x.id.endsWith(".valor")).map(x => x.id);
        comment(`${p}tendencia_mensal`, [`${p}meses.variacao_ponta_a_ponta`, `${p}meses.direcao`, `${p}meses.movimento`, ...months], `variação de ${trend}% entre o primeiro e o último mês (limite ${cfg.minMonthlyTrendPct}%)`);
      }
      const concentration = number(f, `${p}concentracao.cliente`) ?? number(f, `${p}concentracao.lider`);
      if (concentration != null && concentration >= cfg.minConcentrationPct) {
        const leaderId = f.find(x => x.id === `${p}cliente.1.nome`) ? `${p}cliente.1.nome` : `${p}grupo.1.nome`;
        comment(`${p}concentracao`, [f.find(x => x.id === `${p}concentracao.cliente`) ? `${p}concentracao.cliente` : `${p}concentracao.lider`, leaderId], `o líder concentra ${concentration}% do total (limite ${cfg.minConcentrationPct}%)`);
      }
      if (result.period.startDate && result.period.endDate) {
        const base = { periodo: "custom", meses: null, data_inicio: result.period.startDate, data_fim: result.period.endDate, filtro_tipo: parameters.filtro_tipo ?? null, filtro_nome: parameters.filtro_nome ?? null, limite: 5 };
        const current = result.rawResult.agrupamento as string | undefined;
        for (const agrupar of ["cliente", "produto", "vendedor"] as const) {
          if (agrupar === current || agrupar === parameters.filtro_tipo) continue;
          suggest(`${p}detalhar_${agrupar}`, { tool: "consultar_vendas", params: { ...base, agrupar } }, `detalhar o mesmo período por ${agrupar}`);
        }
      }
    }
    if (result.metric === "produtos_mais_vendidos") {
      const share = number(f, `${p}concentracao.lider`);
      if (share != null && share >= cfg.minConcentrationPct) comment(`${p}concentracao`, [`${p}concentracao.lider`, `${p}produto.1.nome`, `${p}total_periodo`], `o produto líder concentra ${share}% do faturamento (limite ${cfg.minConcentrationPct}%)`);
      if (result.period.startDate && result.period.endDate) {
        suggest(`${p}faturamento_periodo`, { tool: "faturamento", params: { periodo: "custom", meses: null, data_inicio: result.period.startDate, data_fim: result.period.endDate } }, "ver o faturamento total do mesmo período");
      }
    }
    if (result.metric === "contas_a_receber_vencidas") {
      const longOverdue = number(f, `${p}atraso.acima_90.participacao`);
      if (longOverdue != null && longOverdue >= cfg.minLongOverduePct) comment(`${p}atraso_longo`, [`${p}atraso.acima_90.valor`, `${p}atraso.acima_90.participacao`, `${p}atraso.acima_90.faixa`], `${longOverdue}% do vencido tem mais de 90 dias (limite ${cfg.minLongOverduePct}%)`);
      const days = number(f, `${p}devedor.1.dias`);
      const share = number(f, `${p}concentracao.devedor`);
      if ((days != null && days >= cfg.minOverdueDays) || (share != null && share >= cfg.minConcentrationPct)) {
        comment(`${p}maior_devedor`, [`${p}devedor.1.nome`, `${p}devedor.1.valor`, `${p}devedor.1.dias`, `${p}concentracao.devedor`], `maior devedor com ${days ?? 0} dias de atraso e ${share ?? 0}% do total`);
      }
    }
  }
  return candidates.slice(0, cfg.maxCandidates);
}
