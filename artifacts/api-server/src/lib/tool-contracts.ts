import { z } from "zod";
import type OpenAI from "openai";
import { salesOptions } from "./sales-query";
import type { SuggestedAction } from "./conversation-state";
import { ficha, fichaSubjects } from "./ficha";
import { DECLARABLE_FORMATS } from "./free-facts";

/** Register of the answer. Decided by the router from the user's wording; explicit requests always win over initiative levels. */
export const presentationSchema = z.enum(["normal", "conciso", "completo", "comparar"]);
export const periodSchema = z.object({
  periodo: z.enum(["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "year_to_date", "custom", "completed_months", "including_current_month", "rolling_months"]),
  meses: z.number().int().min(1).max(120).nullable(),
  data_inicio: z.string().nullable(),
  data_fim: z.string().nullable(),
}).strict();
const periods = periodSchema.shape.periodo.options;
export const periodProperties = {
  periodo: { type: "string", enum: periods, description: "Prefer presets. custom accepts explicit dates or an unambiguous named calendar interval such as July 2026 (2026-07-01 through 2026-07-31)." },
  meses: { type: ["integer", "null"], minimum: 1, maximum: 120, description: "Number of months for completed_months, including_current_month or rolling_months; otherwise null." },
  data_inicio: { type: ["string", "null"], description: "YYYY-MM-DD only when explicit, otherwise null." },
  data_fim: { type: ["string", "null"], description: "YYYY-MM-DD only when explicit, otherwise null." },
};
/** Presentation decided by the router in the same call: no extra model call is needed to honour an explicit request. */
export const presentationProperty = {
  apresentacao: { type: "string", enum: presentationSchema.options, description: "Register asked by the user, in any wording: conciso = only the figure/answer, nothing else (só o valor, resumido, direto, objetivo). completo = everything relevant, with context and follow-up questions (completo, detalhado, me explica tudo). comparar = explicit comparison between periods. normal = no register asked." },
};
export const withPresentation = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) => schema.extend({ apresentacao: presentationSchema });
/** Base of the automatic comparison, resolved by the backend. The model only picks the base; it never builds the dates. */
export const comparisonBaseSchema = z.enum(["anterior", "ano_anterior"]);
export const faturamentoSchema = periodSchema.extend({ comparar_com: comparisonBaseSchema.nullable().optional(), apresentacao: presentationSchema }).strict();
export const limitSchema = z.number().int().min(1).max(20);
export const referenceSchema = z.object({ data_referencia: z.string(), apresentacao: presentationSchema }).strict();
export const salesSchema = periodSchema.merge(salesOptions).extend({ apresentacao: presentationSchema }).strict();
const salesProperties = {
  ...periodProperties,
  agrupar: { type: "string", enum: ["mes", "cliente", "produto", "vendedor"] },
  filtro_tipo: { type: ["string", "null"], enum: ["cliente", "produto", "vendedor", null] },
  filtro_nome: { type: ["string", "null"], description: "Exact name explicitly supplied, otherwise null. Do not guess identities." },
  limite: { type: "integer", minimum: 1, maximum: 120 },
  ...presentationProperty,
};
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: "function", function: { name: "faturamento", description: "Faturamento líquido das vendas confirmadas no período, com top 3 clientes e série mensal. A comparação com o período anterior fica disponível como fato; só é apresentada se for relevante ou pedida.", strict: true, parameters: object({ ...periodProperties, comparar_com: { type: ["string", "null"], enum: ["anterior", "ano_anterior", null], description: "ano_anterior = compara com o MESMO intervalo do ano anterior (vs ano passado, mesmo período de 2025, comparado ao ano anterior); o backend calcula as datas, nunca as informe. anterior = período imediatamente anterior equivalente. null = sem pedido de base." }, ...presentationProperty }) } },
  { type: "function", function: { name: "contas_a_receber_vencidas", description: "Total de títulos de receita sem baixa, vencidos antes da data de referência, top 5 devedores e faixas de atraso.", strict: true, parameters: object({ data_referencia: { type: "string", description: "hoje, ou YYYY-MM-DD explicitamente informado pelo usuário. Nunca calcule uma data." }, ...presentationProperty }) } },
  { type: "function", function: { name: "produtos_mais_vendidos", description: "Ranking dos produtos por valor líquido de vendas, com quantidade.", strict: true, parameters: object({ ...periodProperties, limite: { type: "integer", minimum: 1, maximum: 20, description: "Default 5, unless explicitly requested." }, ...presentationProperty }) } },
  { type: "function", function: { name: "consultar_vendas", description: "Consulta vendas líquidas da empresa da POC agrupadas por mês, cliente, produto ou vendedor. Filtro de nome exato opcional. Não representa lucro, estoque ou saldo bancário.", strict: true, parameters: object(salesProperties) } },
  { type: "function", function: { name: "consultar_dados", description: "Consulta livre, somente leitura, aos dados internos liberados da empresa (views descritas no mapa), para qualquer assunto SEM ferramenta oficial própria: frota, listagens, filtros, cruzamentos, perguntas novas. Você escreve UMA consulta SELECT em PostgreSQL usando somente as views e colunas descritas, nunca outras. Use as ferramentas oficiais (faturamento, contas_a_receber_vencidas, produtos_mais_vendidos) quando o pedido for exatamente o que elas fazem. Regras da consulta: uma instrução, sem ponto e vírgula; filtre texto com ILIKE e '%termo%'; use datas literais AAAA-MM-DD (hoje está no início das instruções); sempre inclua LIMIT razoável (até 50) em listagens; dê aliases claros em português (snake_case); códigos de situação conforme os significados descritos nas colunas. Nunca invente colunas, valores ou significados que o mapa não traz: se não houver como responder, use responder dizendo o que falta. Selecione apenas as colunas que o pedido exige: não inclua códigos/identificadores (colunas terminadas em _id) a menos que o gestor peça. Responda de forma objetiva: consulte só o que foi pedido, sem cruzar assuntos por conta própria.", strict: true, parameters: object({
    sql: { type: "string", maxLength: 4000, description: "Uma consulta SELECT (ou WITH ... SELECT) em PostgreSQL, sem ponto e vírgula." },
    interpretacao: { type: "string", maxLength: 300, description: "Uma frase curta com os critérios usados para entender o pedido (por exemplo: 'considerei parado como situação P ou ocorrência de parada em agosto de 2026'). Só critérios, nunca resultados." },
    formatos: { type: "array", maxItems: 20, items: { type: "object", additionalProperties: false, required: ["coluna", "formato", "rotulo"], properties: { coluna: { type: "string", maxLength: 80 }, formato: { type: "string", enum: [...DECLARABLE_FORMATS] }, rotulo: { type: ["string", "null"], maxLength: 60, description: "Nome de exibição em português, com acentos (ex.: 'Títulos vencidos'), ou null para manter o do mapa." } } }, description: "Colunas CALCULADAS (aliases): formato (dinheiro, percentual, inteiro, numero, data, data_hora ou texto) e rótulo de exibição. Colunas que já constam no mapa mantêm tipo e rótulo do mapa; deixe a lista vazia se não houver colunas calculadas." },
    ...presentationProperty }) } },
  { type: "function", function: { name: "pesquisar", description: "Pesquisa somente um assunto público, sem dados privados do ERP. Cotação atual do dólar USD/BRL usa PTAX oficial; outras informações usam busca web com fontes.", strict: true, parameters: object({ assunto: { type: "string", maxLength: 240 }, ...presentationProperty }) } },
  { type: "function", function: { name: "responder", description: "Conversa geral, explicação conceitual, pedido fora da base (diga o que não existe, o que existe de mais próximo e pergunte se serve) ou esclarecimento (UMA pergunta curta com as opções reais). Nunca afirmar números financeiros internos sem consulta ou cotações sem pesquisa. Se o usuário pede para anotar/guardar/lembrar algo sem entrar em treinamento, diga que só guarda ensinamentos no modo treinamento e pergunte se quer entrar; nada é gravado.", strict: true, parameters: object({ tipo: { type: "string", enum: ["general", "clarification"] }, texto: { type: "string", maxLength: 1800 }, dominio: { type: "string", enum: ["sistema", "externo", "conversa"], description: "Domínio do assunto desta resposta: sistema = dados ou regras internas da empresa/ERP; externo = mundo público; conversa = saudação, conceito, esclarecimento." }, ...presentationProperty }) } },
  { type: "function", function: { name: "definir_registro", description: "O usuário pede uma forma de responder daqui em diante (a partir de agora seja objetivo / pode voltar ao normal / quero sempre o completo). Define o registro padrão da conversa; normal remove o padrão.", strict: true, parameters: object({ registro: { type: "string", enum: ["conciso", "normal", "completo"] } }) } },
  { type: "function", function: { name: "iniciar_treinamento", description: "O usuário declara que quer ensinar/treinar a assistente (quero te ensinar, vamos treinar, quero te passar como funciona a empresa, quero te mostrar como falar comigo). Abre o modo treinamento, um marco explícito; a partir daí tudo é ensinamento até o usuário encerrar. Não use para um simples pedido de anotar algo.", strict: true, parameters: object({ motivo: { type: "string", maxLength: 200 } }) } },
];
/** Tools available only inside the training milestone: no ERP query, no research. One routing call, no composition. */
export const trainingTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  { type: "function", function: { name: "ensinar", description: "Guarda um ensinamento do usuário em UMA categoria: perfil = como falar com o gestor, preferências e instruções pessoais; empresa = termos, tags, áreas, apelidos e vocabulário interno da empresa; interesses = assuntos externos que ele acompanha e fontes/sites preferidos (URL quando dita); erp = tipos, dicas e significados de tabelas, colunas e códigos do ERP. Título curto e conteúdo fiel ao que foi dito, sem números financeiros. Uma correção do mesmo assunto usa o mesmo título. Pode ser chamada mais de uma vez se o usuário ensinou coisas distintas no mesmo turno.", strict: true, parameters: object({ categoria: { type: "string", enum: ["perfil", "empresa", "interesses", "erp"] }, titulo: { type: "string", maxLength: 80 }, conteudo: { type: "string", maxLength: 400 }, url: { type: ["string", "null"], description: "Endereço público citado pelo usuário, senão null." }, erp_ref: { type: ["string", "null"], description: "TABELA ou TABELA.COLUNA do catálogo quando o ensinamento é sobre uma delas, senão null." } }) } },
  { type: "function", function: { name: "esquecer", description: "O usuário pede para esquecer/apagar um ensinamento (esquece isso, apaga o que eu falei, desconsidera o último). Informe o título quando ele o identificar; sem título, o último ensinado nesta conversa é esquecido.", strict: true, parameters: object({ titulo: { type: ["string", "null"], maxLength: 80 } }) } },
  { type: "function", function: { name: "encerrar_treinamento", description: "O usuário dá por encerrado o treinamento (terminei, é isso, pode voltar ao normal, sair do treinamento, chega por hoje). Fecha o marco; perguntas ao ERP voltam a ser possíveis.", strict: true, parameters: object({ motivo: { type: "string", maxLength: 200 } }) } },
  { type: "function", function: { name: "responder", description: "Dentro do treinamento: pedir que o usuário repita ou especifique um ensinamento confuso, ou lembrar que consultas e pesquisas ficam suspensas até ele encerrar o treinamento. Nunca responda perguntas de dados.", strict: true, parameters: object({ tipo: { type: "string", enum: ["general", "clarification"] }, texto: { type: "string", maxLength: 600 } }) } },
];
export const trainingResponseTools: OpenAI.Responses.Tool[] = trainingTools.map(tool => tool.type === "function" ? { type: "function", name: tool.function.name, description: tool.function.description, strict: true, parameters: tool.function.parameters ?? {} } : (() => { throw new Error("Only function tools are permitted"); })());
export const registerSchema = z.enum(["conciso", "normal", "completo"]);

/** Living capabilities map derived from the tool contracts, so "what exists / what does not" and clarification options never come from hand-written phrases. */
export function capabilitiesMap(): { livre: string[]; consultas: string[]; agrupamentos: string[]; filtros: string[]; periodos: string[]; publico: string[]; indisponivel: string[] } {
  const erp = tools.filter(t => t.type === "function" && !["pesquisar", "responder", "definir_registro", "iniciar_treinamento", "consultar_dados"].includes(t.function.name));
  return {
    livre: [`consultar_dados: consulta livre somente leitura sobre ${fichaSubjects().join(", ")} (views da ficha de implantação)`],
    consultas: erp.map(t => t.type === "function" ? `${t.function.name}: ${t.function.description}` : ""),
    agrupamentos: [...(salesProperties.agrupar.enum as string[])],
    filtros: (salesProperties.filtro_tipo.enum as Array<string | null>).filter((v): v is string => !!v),
    periodos: [...periods],
    publico: ["cotação atual do dólar USD/BRL (PTAX do Banco Central)", "pesquisa web de assuntos públicos, com fontes"],
    indisponivel: [...ficha.naoDisponivel],
  };
}
export const capabilitiesText = () => {
  const map = capabilitiesMap();
  return `Consultas oficiais: ${map.consultas.join(" | ")}. Consulta livre: ${map.livre.join(" | ")}. Agrupamentos de vendas: ${map.agrupamentos.join(", ")}; filtros por nome exato de ${map.filtros.join(", ")}. Períodos: ${map.periodos.join(", ")}. Fontes públicas: ${map.publico.join("; ")}. Não existe nesta base: ${map.indisponivel.join(", ")} nem qualquer assunto fora das consultas e das views descritas.`;
};
export const responseTools: OpenAI.Responses.Tool[] = tools.map(tool => {
  if (tool.type !== "function") throw new Error("Only function tools are permitted");
  return { type: "function", name: tool.function.name, description: tool.function.description, strict: true, parameters: tool.function.parameters ?? {} };
});

/** A suggested action must be a valid call of an existing ERP tool; anything else is discarded. */
export function validateAction(action: SuggestedAction): boolean {
  const params = { apresentacao: "normal", ...action.params };
  const schema = {
    faturamento: faturamentoSchema,
    produtos_mais_vendidos: periodSchema.extend({ limite: limitSchema, apresentacao: presentationSchema }).strict(),
    contas_a_receber_vencidas: referenceSchema,
    consultar_vendas: salesSchema,
  }[action.tool];
  const parsed = schema.safeParse(params);
  if (!parsed.success) return false;
  if ("periodo" in parsed.data && parsed.data.periodo === "custom" && (!parsed.data.data_inicio || !parsed.data.data_fim)) return false;
  return true;
}
