import { z } from "zod";
import { currentFicha, fichaSubjects } from "./ficha";
import { esclarecimentoSchema, type Esclarecimento } from "./esclarecimento";

/** Typed conversation state. Every log row stores the complete cumulative state, never a delta,
 * so text mode (which only links to the previous log) and voice mode (4-turn context) reconstruct it the same way. */
export const suggestedActionSchema = z.object({
  tool: z.enum(["faturamento", "contas_a_receber_vencidas", "produtos_mais_vendidos", "consultar_vendas"]),
  params: z.record(z.unknown()),
}).strict();
export type SuggestedAction = z.infer<typeof suggestedActionSchema>;
export const suggestionStatus = z.enum(["oferecida", "aceita", "feita", "recusada"]);
export const conversationStateSchema = z.object({
  periodo: z.object({ startDate: z.string(), endDate: z.string() }).nullable(),
  filtros: z.object({ tipo: z.string(), nome: z.string() }).nullable(),
  apresentado: z.array(z.string()),
  sugestoes: z.array(z.object({ acao: suggestedActionSchema, status: suggestionStatus, turno: z.number().int() })),
  capacidades: z.array(z.string()),
  turno: z.number().int(),
  /** Register the user asked for "from now on"; null means no standing preference. */
  registroPadrao: z.enum(["conciso", "completo"]).nullable().default(null),
  /** Last ERP action executed, so "agora me fala completo" can rerun it in another register. */
  ultimaAcao: suggestedActionSchema.nullable().default(null),
  /** Clarification asked by the assistant in the previous turn; the next short answer completes it. */
  perguntaAberta: z.object({ pergunta: z.string(), turno: z.number().int() }).nullable().default(null),
  /** Explicit training milestone: while true, every turn is a teaching, no ERP query or research runs. */
  treinamento: z.boolean().default(false),
  /** Ids taught in this conversation, so "esquece isso" can resolve the latest one. */
  ensinados: z.array(z.number().int()).default([]),
  /** Request under guided clarification (rounds used, fields already answered); valid for one turn, like perguntaAberta. */
  esclarecimento: esclarecimentoSchema.nullable().default(null),
}).strict();
export type ConversationState = z.infer<typeof conversationStateSchema>;

export const CAPABILITIES = [
  "faturamento: total líquido por período, com top 3 clientes e série mensal",
  "consultar_vendas: vendas líquidas agrupadas por mes, cliente, produto ou vendedor; filtro opcional por nome exato",
  "produtos_mais_vendidos: ranking de produtos por valor líquido, com quantidade",
  "contas_a_receber_vencidas: total vencido sem baixa, maiores devedores e faixas de atraso",
  `consultar_dados: consulta livre somente leitura sobre ${fichaSubjects().join(", ")}`,
  "pesquisar: cotação do dólar (PTAX) e assuntos públicos com fontes",
];
/** Subjects the asking company does not have, from its own ficha. */
export const unavailable = () => [...currentFicha().naoDisponivel];
const MAX_PRESENTED = 60, MAX_SUGGESTIONS = 20;

export const emptyState = (): ConversationState => ({ periodo: null, filtros: null, apresentado: [], sugestoes: [], capacidades: CAPABILITIES, turno: 0, registroPadrao: null, ultimaAcao: null, perguntaAberta: null, treinamento: false, ensinados: [], esclarecimento: null });
export const openQuestion = (state: ConversationState) => state.perguntaAberta && state.perguntaAberta.turno === state.turno ? state.perguntaAberta : null;

/** The latest complete state found in the context wins; older entries are never merged. */
export function stateFrom(context: Array<{ parameters: Record<string, unknown> }>): ConversationState {
  for (const item of [...context].reverse()) {
    const parsed = conversationStateSchema.safeParse(item.parameters._state);
    if (parsed.success) return { ...parsed.data, capacidades: CAPABILITIES };
  }
  return emptyState();
}
const normalizeParams = (params: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(params).filter(([k, v]) => v != null && k !== "apresentacao").sort()));
export const sameAction = (a: SuggestedAction, b: SuggestedAction) => a.tool === b.tool && normalizeParams(a.params) === normalizeParams(b.params);
export const pendingSuggestion = (state: ConversationState) => [...state.sugestoes].reverse().find(s => s.status === "oferecida" && s.turno === state.turno) ?? null;
export const alreadyOffered = (state: ConversationState, action: SuggestedAction) => state.sugestoes.some(s => sameAction(s.acao, action));

export function advanceState(previous: ConversationState, update: {
  periodo?: ConversationState["periodo"]; filtros?: ConversationState["filtros"];
  presented: string[]; executed: SuggestedAction[]; offered: SuggestedAction | null; refusedPending: boolean;
  registroPadrao?: ConversationState["registroPadrao"]; perguntaAberta?: string | null;
  treinamento?: boolean; ensinados?: number[]; limparUltimaAcao?: boolean;
  esclarecimento?: Omit<Esclarecimento, "turno"> | null;
}): ConversationState {
  const turno = previous.turno + 1;
  const sugestoes = previous.sugestoes.map(s => {
    if (s.status !== "oferecida") return s;
    if (update.executed.some(a => sameAction(a, s.acao))) return { ...s, status: "feita" as const };
    if (update.refusedPending && s.turno === previous.turno) return { ...s, status: "recusada" as const };
    return s;
  });
  if (update.offered && !sugestoes.some(s => sameAction(s.acao, update.offered!))) sugestoes.push({ acao: update.offered, status: "oferecida", turno });
  const apresentado = [...previous.apresentado.filter(k => !update.presented.includes(k)), ...update.presented].slice(-MAX_PRESENTED);
  return {
    periodo: update.periodo === undefined ? previous.periodo : update.periodo,
    filtros: update.filtros === undefined ? previous.filtros : update.filtros,
    apresentado, sugestoes: sugestoes.slice(-MAX_SUGGESTIONS), capacidades: CAPABILITIES, turno,
    registroPadrao: update.registroPadrao === undefined ? previous.registroPadrao : update.registroPadrao,
    ultimaAcao: update.limparUltimaAcao ? null : (update.executed.at(-1) ?? previous.ultimaAcao),
    perguntaAberta: update.perguntaAberta ? { pergunta: update.perguntaAberta, turno } : null,
    treinamento: update.treinamento ?? previous.treinamento,
    ensinados: [...previous.ensinados, ...(update.ensinados ?? [])].slice(-20),
    esclarecimento: update.esclarecimento ? { ...update.esclarecimento, turno } : null,
  };
}

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").trim();
const NEW_QUESTION_WORDS = /\b(qual|quais|quanto|quanta|como|por que|porque)\b|\b(fatur|vend|receb|vencid|produto|cliente|vendedor|compar|pesquis|cotac|dolar|ranking|margem|lucro|estoque|trimestre|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\w*|\b(mes|meses|semana|semanas|ano|anos|ontem|hoje|anterior)\b/;
/** Short acceptances execute the pending suggestion directly, without a routing call. */
export function acceptsSuggestion(question: string): boolean {
  const text = normalize(question);
  if (text.split(/\s+/).length > 8) return false;
  return /^(sim|pode|claro|ok|isso|vamos|bora|quero|manda|detalha|detalhe|mostra|mostre|ta|pode ser|por favor|beleza|pode sim|vamos ver|quero ver|quero sim)\b/.test(text)
    && !/\b(nao|outro|outra|mas|em vez|ao inves)\b/.test(text)
    // A message that names a metric, period, entity or tool is a new question, not a yes to the pending suggestion: it goes to the router.
    && !NEW_QUESTION_WORDS.test(text);
}
export function refusesSuggestion(question: string): boolean {
  const text = normalize(question);
  return text.split(/\s+/).length <= 10 && /^(nao|agora nao|deixa|deixe|depois|por enquanto nao|nao precisa|nao quero|nao obrigado|obrigado|ta bom|so isso|era so isso|e so)\b/.test(text)
    && !/\b(qual|quais|quanto|quanta|como|fatur|vend|receb|vencid|produto|cliente|compar|pesquis|cotac|dolar)\w*/.test(text);
}

/** A short turn that only changes the register ("agora me fala completo", "resumido", "só o valor") reruns the last action in that register, without routing. */
export function registerOnlyTurn(question: string): "conciso" | "completo" | "normal" | null {
  const text = normalize(question);
  if (/\b(a partir de|daqui em diante|de agora em diante|sempre|toda vez|daqui pra frente)\b/.test(text)) return null;
  if (text.split(/\s+/).length > 8 || /\b(qual|quais|quanto|quanta|como|fatur|vend|receb|vencid|produto|cliente|compar|pesquis|cotac|dolar|mes|semana|ano|ontem|hoje|setembro|outubro|agosto|julho|junho)\w*/.test(text)) return null;
  if (/\b(complet\w*|detalh\w*|tudo|explica\w*|mais informac\w*|aprofund\w*)\b/.test(text)) return "completo";
  if (/\b(resum\w*|objetiv\w*|curt\w*|so o valor|so o numero|so o total|direto)\b/.test(text)) return "conciso";
  if (/\b(normal|como antes)\b/.test(text)) return "normal";
  return null;
}
