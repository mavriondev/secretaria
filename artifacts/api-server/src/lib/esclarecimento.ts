import { z } from "zod";
import type { ConversationState } from "./conversation-state";
import { periodForms } from "./facts";
import { resolvePeriod, type PeriodPreset } from "./periods";

/**
 * Guided clarification (owner's decision of 16/10): the assistant asks only when the wrong path would give a misleading
 * number, at most two rounds per request, in a fixed order (entity → period → metric). Everything else is answered with
 * a declared hypothesis plus adjustment buttons. This module holds the round state, the limits and the buttons; the
 * questions themselves are still chosen by the router (closed list in its instructions) or by the data (name matches).
 */
export const MAX_RODADAS = 2;
export const CAMPOS = ["entidade", "periodo", "metrica"] as const;
export type Campo = typeof CAMPOS[number];
export const campoSchema = z.enum(CAMPOS);
/** Pending request being clarified; stored in the conversation state and valid for exactly one turn, like the open question. */
export const esclarecimentoSchema = z.object({
  pedido: z.string(),
  rodadas: z.number().int().min(1),
  perguntas: z.array(z.object({ campo: campoSchema, pergunta: z.string() })),
  respondido: z.record(campoSchema, z.string()),
  turno: z.number().int(),
}).strict();
export type Esclarecimento = z.infer<typeof esclarecimentoSchema>;
export type Ajuste = { rotulo: string; pergunta: string };
export const MAX_OPCOES = 4, MAX_AJUSTES = 3;

const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}\s/]/gu, " ").trim();
const palavras = (text: string) => normalize(text).split(/\s+/).filter(Boolean).length;
/** A reply to a clarification is short ("o primeiro", "mês passado", a name). Anything longer is a new request and abandons the pending one. */
const MAX_PALAVRAS_RESPOSTA = 6;

export const pendente = (state: ConversationState): Esclarecimento | null => state.esclarecimento && state.esclarecimento.turno === state.turno ? state.esclarecimento : null;
export const continuaPedido = (state: ConversationState, question: string): boolean => !!pendente(state) && palavras(question) <= MAX_PALAVRAS_RESPOSTA;
/** True when the person already answered the maximum number of rounds for this request: the next doubt is resolved by hypothesis, never by another question. */
export const rodadasEsgotadas = (state: ConversationState, question: string): boolean => continuaPedido(state, question) && pendente(state)!.rodadas >= MAX_RODADAS;

/** State to store after asking `pergunta` in this turn: round counter and the fields the person already answered. */
export function registrarPergunta(state: ConversationState, question: string, pergunta: string, campo: Campo): Omit<Esclarecimento, "turno"> {
  const anterior = continuaPedido(state, question) ? pendente(state)! : null;
  return {
    pedido: anterior?.pedido ?? question,
    rodadas: (anterior?.rodadas ?? 0) + 1,
    perguntas: [...(anterior?.perguntas ?? []), { campo, pergunta }].slice(-MAX_RODADAS - 1),
    respondido: respostasAcumuladas(anterior, question),
  };
}
/** The current message answers the last question asked; the answer is kept under that field so it is never asked again. */
export function respostasAcumuladas(anterior: Esclarecimento | null, question: string): Record<string, string> {
  if (!anterior) return {};
  const ultima = anterior.perguntas.at(-1);
  return ultima ? { ...anterior.respondido, [ultima.campo]: question.trim().slice(0, 120) } : { ...anterior.respondido };
}

/** The request as the person actually said it: original wording plus every clarification reply, or just the message when nothing is pending. */
export function pedidoCompleto(state: ConversationState, question: string): string {
  const atual = pendente(state);
  if (!atual || !continuaPedido(state, question)) return question;
  return [atual.pedido, ...Object.values(atual.respondido), question].join(" ");
}

const CAMPO_LABEL: Record<Campo, string> = { entidade: "quem/qual (cliente, produto ou vendedor)", periodo: "período", metrica: "métrica ou agrupamento" };
/** Closed rules the router follows in every turn. */
export const regrasDeEsclarecimento = () => `Esclarecimento (lista fechada; fora dela nunca pergunte): use responder com tipo clarification SOMENTE quando (1) um nome bate com vários clientes, produtos ou vendedores (o backend lista as opções reais ao executar consultar_vendas com filtro, então prefira executar); (2) o pedido é genérico, sem período E sem métrica ("me mostra as vendas", "como estamos") e o contexto da conversa não resolve; (3) é uma comparação sem dizer com o quê; (4) é "contas a receber" sem dizer vencidas ou a vencer e o contexto não resolve. Em qualquer outro caso NÃO pergunte: execute com a melhor hipótese (este mês quando falta só o período; agrupamento mais natural ao pedido) — a tela declara a hipótese e oferece botões de ajuste. Uma pergunta por vez, curta, respondível falando ("o primeiro", "a segunda", ou o nome); informe o campo (entidade, periodo ou metrica) e as opções em opcoes (até ${MAX_OPCOES}, só do mapa de dados ou do contexto; nunca invente opção). Ordem fixa quando faltar mais de uma coisa: entidade, depois período, depois métrica. No máximo ${MAX_RODADAS} rodadas por pedido; depois disso execute com a hipótese. Opções de período, nesta ordem: este mês, mês passado, esta semana, hoje. Se a pessoa responder "tanto faz", "você decide" ou algo fora das opções, não insista: execute com este mês (período) ou a primeira opção (entidade), ou com o que ela disse, e deixe a tela declarar; nunca escolha "hoje" por omissão. Se houver uma pergunta aberta do turno anterior, a resposta curta do usuário a completa: execute sem perguntar de novo; se ela mudar de assunto, abandone o pedido pendente e atenda o novo.`;

/** Dynamic context of the pending request for the router: what was asked, what was answered, whether the limit was reached. */
export function contextoDeEsclarecimento(state: ConversationState, question: string): string | null {
  const atual = pendente(state);
  if (!atual || !continuaPedido(state, question)) return null;
  const respondido = respostasAcumuladas(atual, question);
  const feitas = atual.perguntas.map(p => `${CAMPO_LABEL[p.campo]}: "${p.pergunta}"`).join("; ");
  const dadas = Object.entries(respondido).map(([campo, resposta]) => `${CAMPO_LABEL[campo as Campo]} = "${resposta}"`).join("; ");
  const limite = atual.rodadas >= MAX_RODADAS
    ? `Limite de ${MAX_RODADAS} rodadas atingido: NÃO faça outra pergunta; execute a consulta agora com a melhor hipótese (este mês para período; a primeira opção para entidade), sem clarification.`
    : `Rodada ${atual.rodadas} de ${MAX_RODADAS} já usada: só pergunte de novo se ainda faltar algo da lista fechada e nunca o que já foi respondido.`;
  return `Esclarecimento em andamento do pedido "${atual.pedido}". Perguntas já feitas: ${feitas || "nenhuma"}. Respostas já dadas: ${dadas || "nenhuma"}. A mensagem atual responde à última pergunta (ou muda de assunto). ${limite}`;
}
export const instrucaoDeLimite = () => `Limite de perguntas atingido para este pedido. É proibido usar responder com tipo clarification nesta chamada: escolha a ferramenta e execute com a melhor hipótese (este mês quando faltar o período; a primeira opção já oferecida para entidade).`;

/** Options offered by the router or found in the data, trimmed to the closed limit; "outro" is said in the text, never a button. */
export function opcoesValidas(opcoes: unknown): string[] {
  if (!Array.isArray(opcoes)) return [];
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const item of opcoes) {
    if (typeof item !== "string") continue;
    const texto = item.trim().replace(/\s+/g, " ").slice(0, 80);
    const chave = normalize(texto);
    if (!texto || !chave || chave === "outro" || chave === "outra" || vistas.has(chave)) continue;
    vistas.add(chave); saida.push(texto);
    if (saida.length === MAX_OPCOES) break;
  }
  return saida;
}
/** Buttons under a clarification: each option is sent as the answer, the same way the person would say it. */
export const botoesDasOpcoes = (opcoes: string[]): Ajuste[] => opcoesValidas(opcoes).map(opcao => ({ rotulo: opcao, pergunta: opcao }));

const TIPO_PLURAL: Record<string, string> = { cliente: "clientes", produto: "produtos", vendedor: "vendedores" };
/** Question for an ambiguous name, built from real matches (already limited to MAX_OPCOES; `maisOpcoes` says whether others exist). */
export function perguntaDeEntidade(tipo: string, informado: string, opcoes: string[], maisOpcoes: boolean, periodoLabel: string): string {
  const lista = opcoes.map((nome, i) => `${i + 1}) ${nome}`).join(", ");
  const outro = maisOpcoes ? " Há outros além desses: se for outro, diga o nome completo." : " Se for outro, diga o nome completo.";
  return `Encontrei ${maisOpcoes ? "vários" : opcoes.length} ${TIPO_PLURAL[tipo] ?? tipo} com "${informado}": ${lista}. Qual deles? Pode dizer o número ou o nome.${outro} Mantenho o período de ${periodoLabel}.`;
}

const MESES = "janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
/** The person named a period (any form the router understands); the period used is then a choice, not a hypothesis. */
export const mencionaPeriodo = (question: string) => new RegExp(`\\b(hoje|ontem|anteontem|agora|semana|semanas|mes|meses|ano|anos|dia|dias|trimestre|semestre|bimestre|periodo|desde|ate|entre|ultim\\w*|${MESES}|\\d{1,2}/\\d{1,2}|20\\d\\d)\\b`).test(normalize(question));
/** The person named how to group (by client, by product, ranking…). */
export const mencionaAgrupamento = (question: string) => /\b(por|cada|dos|das|de)\s+(cliente|produto|vendedor|mes|dia|item)s?\b|\b(cliente|produto|vendedor|ranking|top|maior|maiores|mais vendid|devedor)\w*/.test(normalize(question));

const PERIODOS: Array<{ preset: PeriodPreset; rotulo: string }> = [
  { preset: "this_month", rotulo: "este mês" }, { preset: "last_month", rotulo: "mês passado" }, { preset: "this_week", rotulo: "esta semana" }, { preset: "today", rotulo: "hoje" }, { preset: "year_to_date", rotulo: "este ano" },
];
const base = (question: string) => question.trim().replace(/[\s?.!…]+$/u, "");
const ajuste = (question: string, rotulo: string): Ajuste => ({ rotulo, pergunta: `${base(question)} — ${rotulo}` });

/**
 * Hypothesis declared on screen and up to three adjustment buttons, decided by code from what the person did NOT say.
 * Tapping a button sends a new question through the normal path; the spoken answer never reads the buttons.
 */
export function ajustesPara(input: { question: string; tool: string; parameters: Record<string, unknown>; periodoLabel?: string | null; filtroInformado?: string | null; filtroUsado?: string | null }): { hipotese: string | null; ajustes: Ajuste[] } {
  const partes: string[] = [];
  const ajustes: Ajuste[] = [];
  const { question, tool, parameters } = input;
  if (input.filtroInformado && input.filtroUsado && normalize(input.filtroInformado) !== normalize(input.filtroUsado)) partes.push(`Entendi "${input.filtroInformado}" como ${input.filtroUsado}`);
  const periodico = ["faturamento", "consultar_vendas", "produtos_mais_vendidos"].includes(tool);
  if (periodico && !mencionaPeriodo(question)) {
    // The period actually consulted (the router may carry it from the conversation as explicit dates); a preset with the same dates is the same choice.
    const inicio = typeof parameters.data_inicio === "string" ? parameters.data_inicio : null;
    const fim = typeof parameters.data_fim === "string" ? parameters.data_fim : null;
    const mesmo = (preset: PeriodPreset) => { const r = resolvePeriod({ preset }); return r.startDate === inicio && r.endDate === fim; };
    const atual = PERIODOS.find(p => p.preset === parameters.periodo) ?? (inicio && fim ? PERIODOS.find(p => mesmo(p.preset)) : undefined);
    partes.push(`Considerei ${atual?.rotulo ?? (inicio && fim ? periodForms(inicio, fim).display : input.periodoLabel ?? "o período padrão")}`);
    for (const p of PERIODOS) { if (p !== atual && !(inicio && fim && mesmo(p.preset)) && ajustes.length < 2) ajustes.push(ajuste(question, p.rotulo)); }
  }
  // Grouping is a choice only for the whole base; a single client's or product's sales have nothing to regroup.
  if (periodico && !mencionaAgrupamento(question) && !parameters.filtro_nome) {
    const agrupar = typeof parameters.agrupar === "string" ? parameters.agrupar : null;
    if (tool === "faturamento" || (tool === "consultar_vendas" && agrupar === "mes")) ajustes.push(ajuste(question, "por cliente"));
    else if (tool === "consultar_vendas" && agrupar) { partes.push(`agrupei por ${agrupar === "mes" ? "mês" : agrupar}`); ajustes.push(ajuste(question, agrupar === "cliente" ? "por produto" : "por cliente")); }
  }
  if (tool === "contas_a_receber_vencidas" && !/\bvencid/.test(normalize(question))) {
    partes.push("Considerei só os títulos vencidos");
    ajustes.push({ rotulo: "a vencer", pergunta: `${base(question)} — só os títulos a vencer, ainda não vencidos` });
    if (!mencionaAgrupamento(question)) ajustes.push(ajuste(question, "por cliente"));
  }
  if (!partes.length) return { hipotese: null, ajustes: [] };
  const [primeira, ...resto] = partes;
  return { hipotese: `${primeira}${resto.length ? "; " + resto.join("; ") : ""}.`, ajustes: ajustes.slice(0, MAX_AJUSTES) };
}
