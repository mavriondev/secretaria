/**
 * "Como calculei": a short, code-built explanation of where a number came from. It only reads what was already recorded
 * with the answer (the audit log's `_executions`, the interpretation, the views, the period, the age of the data) or with
 * the favourite card (tool + parameters, or the saved SQL). Nothing here calls the model and nothing changes how the
 * assistant answers; a company only ever sees its own logs and cards.
 */
import { and, eq } from "drizzle-orm";
import { db, queryLogsTable } from "@workspace/db";
import type { MetricResult } from "@workspace/api-zod";
import { currentCompanyId, currentTenant } from "./tenant";
import { columnDefinition, currentFicha, type Ficha } from "./ficha";
import { marcadorDados } from "./marcador-dados";
import { resolvePeriod, localToday, type PeriodPreset } from "./periods";
import { FavoritoError, pegarFavorito, type Favorito, type Resultado } from "./favoritos";

export type FontePublica = { title: string; url: string; retrievedAt: string; referenceDate?: string | null };
export type Explicacao = {
  /** atalho = ready-made shortcut; livre = free query; externa = only public research; nenhuma = no data was consulted. */
  origem: "atalho" | "livre" | "externa" | "nenhuma";
  pergunta: string;
  /** How the request was understood: the interpretation recorded with a free query, or the fixed definition of a shortcut. */
  entendimento: string | null;
  /** Subjects and descriptions from the ficha (never bare technical names). */
  fontes: Array<{ assunto: string; descricao: string }>;
  periodo: { texto: string; relativo: string | null } | null;
  filtros: string[];
  /** Plain sentence of how the value was obtained, generated from the tool or the query. */
  metodo: string | null;
  /** Labels of the fields shown (free queries and cards). */
  campos: string[];
  /** Age of the data (ISO) and where that stamp comes from. */
  dadosDe: string | null;
  dadosDeObs: string | null;
  /** When the answer or the card value was produced (ISO). */
  calculadoEm: string | null;
  linhas: number | null;
  truncado: boolean;
  /** Warning when the result was cut or summarised (ranking limit, row cap). */
  resumido: string | null;
  /** Read-only SQL for administrators; null for managers. */
  sql: string | null;
  sqlObs: string | null;
  /** Technical names of the views read; administrators only. */
  tabelas: string[];
  fontesPublicas: FontePublica[];
  /** Metadata that was not recorded, so the screen can say so instead of guessing. */
  faltando: string[];
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
/** "1 de outubro de 2026" from YYYY-MM-DD. */
export function dataPorExtenso(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`;
}
const intervalo = (inicio: string, fim: string) => inicio === fim ? `${dataPorExtenso(inicio)}` : `de ${dataPorExtenso(inicio)} a ${dataPorExtenso(fim)}`;

/** Relative wording of a shortcut period preset, as the person asked it. */
export function periodoRelativoTexto(p: Record<string, unknown>): string | null {
  const preset = p.periodo as PeriodPreset | undefined;
  const meses = typeof p.meses === "number" ? p.meses : null;
  const dias = typeof p.dias === "number" ? p.dias : null;
  switch (preset) {
    case "today": return "hoje";
    case "yesterday": return "ontem";
    case "this_week": return "esta semana, até hoje";
    case "last_week": return "semana passada";
    case "this_month": return "mês atual, até hoje";
    case "last_month": return "mês passado";
    case "year_to_date": return "ano atual, até hoje";
    case "last_year": return "ano passado";
    case "last_days": return dias ? `últimos ${dias} dias, até hoje` : "últimos dias, até hoje";
    case "completed_months": return meses ? `últimos ${meses} meses fechados` : "últimos meses fechados";
    case "including_current_month": return meses ? `últimos ${meses} meses, incluindo o atual` : "últimos meses, incluindo o atual";
    case "rolling_months": return meses ? `últimos ${meses} meses, até hoje` : "últimos meses, até hoje";
    default: return p._hoje === true ? "hoje" : null;
  }
}

const AGRUPAMENTO: Record<string, string> = { mes: "mês", cliente: "cliente", produto: "produto", vendedor: "vendedor" };
const FILTRO_TIPO: Record<string, string> = { cliente: "o cliente", produto: "o produto", vendedor: "o vendedor" };
const COLUNA_FILTRO: Record<string, string> = { cliente: "cliente", produto: "produto", vendedor: "vendedor" };

type Atalho = { ferramenta: string; parametros: Record<string, unknown>; resultado: MetricResult | null };
type Livre = { interpretacao: string | null; sql: string | null; formatos: Array<{ coluna: string; formato: string; rotulo?: string | null }>; linhas: number | null; truncado: boolean; views: string[] };

const fontesDe = (views: string[], f: Ficha) => {
  const seen = new Set<string>();
  const fontes: Explicacao["fontes"] = [];
  for (const view of views) {
    const found = f.visoes.find(v => v.nome === view);
    const assunto = found ? found.assunto.charAt(0).toUpperCase() + found.assunto.slice(1) : "Dados da empresa";
    const key = `${assunto}|${found?.descricao ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key); fontes.push({ assunto, descricao: found?.descricao ?? "Visão liberada para consulta." });
  }
  return fontes;
};

const VISTA_ATALHO: Record<string, string> = { faturamento: "vw_vendas_itens", faturamento_por_dia: "vw_vendas_itens", consultar_vendas: "vw_vendas_itens", produtos_mais_vendidos: "vw_vendas_itens", contas_a_receber_vencidas: "vw_titulos_receber" };
const VENDAS_FILTROS = ["Somente vendas confirmadas (canceladas e compras não entram)", "Valor líquido: valor da venda menos o desconto"];

/** Explanation of a ready-made shortcut: the definition is fixed in code, so the sentence is fixed too. */
function explicarAtalho(a: Atalho, f: Ficha, opts: { periodoRelativo: string | null; hoje: string }): Pick<Explicacao, "entendimento" | "fontes" | "periodo" | "filtros" | "metodo" | "campos" | "linhas" | "truncado" | "resumido" | "sql" | "sqlObs" | "tabelas"> {
  const p = a.parametros;
  const r = a.resultado;
  const inicio = (r?.period.startDate ?? (typeof p.data_inicio === "string" ? p.data_inicio : null)) as string | null;
  const fim = (r?.period.endDate ?? (typeof p.data_fim === "string" ? p.data_fim : null)) as string | null;
  const periodo = inicio && fim ? { texto: intervalo(inicio, fim), relativo: opts.periodoRelativo } : null;
  const view = VISTA_ATALHO[a.ferramenta] ?? null;
  const base = { fontes: view ? fontesDe([view], f) : [], tabelas: view ? [view] : [], campos: [] as string[], truncado: false, resumido: null as string | null, linhas: null as number | null, sqlObs: "Consulta equivalente ao atalho, cuja definição é fixa no código." };
  const filtroNome = typeof p.filtro_tipo === "string" && typeof p.filtro_nome === "string" && p.filtro_nome ? { tipo: p.filtro_tipo, nome: p.filtro_nome } : null;
  const filtroFrase = filtroNome ? ` Somente ${FILTRO_TIPO[filtroNome.tipo] ?? filtroNome.tipo} com nome exato “${filtroNome.nome}”.` : "";
  const filtroSql = filtroNome ? ` AND lower(${COLUNA_FILTRO[filtroNome.tipo] ?? filtroNome.tipo}) = lower('${filtroNome.nome.replace(/'/g, "''")}')` : "";
  const entre = inicio && fim ? `data BETWEEN '${inicio}' AND '${fim}'` : "data BETWEEN :inicio AND :fim";
  const quando = periodo ? ` ${periodo.texto}` : "";
  switch (a.ferramenta) {
    case "faturamento": {
      const comparacao = p.comparar_com === "ano_anterior" ? "Comparação disponível com o mesmo intervalo do ano anterior." : p.comparar_com === "anterior" ? "Comparação disponível com o período imediatamente anterior." : null;
      return { ...base, periodo, entendimento: "Faturamento líquido: atalho com definição fixa.",
        filtros: [...VENDAS_FILTROS, ...(filtroNome ? [`Nome exato: ${filtroNome.nome}`] : [])],
        metodo: `Soma do valor líquido dos itens de vendas confirmadas, pela data da venda,${quando}.${filtroFrase}${comparacao ? ` ${comparacao}` : ""}`,
        campos: ["Faturamento líquido"], sql: `SELECT COALESCE(SUM(valor_liquido), 0) AS faturamento_liquido\nFROM vw_vendas_itens\nWHERE ${entre}${filtroSql}` };
    }
    case "consultar_vendas": {
      const agrupar = typeof p.agrupar === "string" ? AGRUPAMENTO[p.agrupar] ?? p.agrupar : "grupo";
      const limite = typeof p.limite === "number" ? p.limite : null;
      const grupos = typeof r?.rawResult?.groupCount === "number" ? (r.rawResult.groupCount as number) : null;
      const mostrados = Array.isArray(r?.rawResult?.groups) ? (r!.rawResult.groups as unknown[]).length : null;
      const cortado = grupos !== null && mostrados !== null && grupos > mostrados;
      const grouping = p.agrupar === "mes" ? "to_char(data, 'YYYY-MM')" : COLUNA_FILTRO[String(p.agrupar)] ?? "cliente";
      return { ...base, periodo, entendimento: `Vendas líquidas por ${agrupar}: atalho com definição fixa.`,
        filtros: [...VENDAS_FILTROS, `Agrupado por ${agrupar}`, ...(filtroNome ? [`Nome exato: ${filtroNome.nome}`] : [])],
        metodo: `Soma do valor líquido dos itens de vendas confirmadas, pela data da venda,${quando}, separada por ${agrupar}.${filtroFrase}${limite ? ` Mostrados até ${limite} ${agrupar === "mês" ? "meses" : `${agrupar}s`}, do maior para o menor.` : ""}`,
        campos: [agrupar.charAt(0).toUpperCase() + agrupar.slice(1), "Valor líquido", "Quantidade"], linhas: grupos ?? mostrados, truncado: cortado,
        resumido: cortado ? `Existem ${grupos} grupos no período; a resposta mostrou os ${mostrados} maiores.` : null,
        sql: `SELECT ${grouping} AS ${p.agrupar === "mes" ? "mes" : String(p.agrupar)}, SUM(valor_liquido) AS valor_liquido, SUM(quantidade) AS quantidade\nFROM vw_vendas_itens\nWHERE ${entre}${filtroSql}\nGROUP BY 1\nORDER BY valor_liquido DESC${limite ? `\nLIMIT ${limite}` : ""}` };
    }
    case "produtos_mais_vendidos": {
      const limite = typeof p.limite === "number" ? p.limite : null;
      const mostrados = r?.details.length ?? null;
      return { ...base, periodo, entendimento: "Produtos mais vendidos: atalho com definição fixa.",
        filtros: [...VENDAS_FILTROS, "Ordem pelo valor líquido vendido, não pela quantidade"],
        metodo: `Soma do valor líquido vendido de cada produto nas vendas confirmadas${quando}, em ordem decrescente${limite ? `; mostrados os ${limite} primeiros` : ""}.`,
        campos: ["Produto", "Valor líquido", "Quantidade"], linhas: mostrados,
        resumido: limite && mostrados !== null && mostrados >= limite ? `Ranking limitado aos ${limite} primeiros produtos; os demais não aparecem.` : null,
        sql: `SELECT produto, SUM(valor_liquido) AS valor_liquido, SUM(quantidade) AS quantidade\nFROM vw_vendas_itens\nWHERE ${entre}\nGROUP BY produto_id, produto\nORDER BY valor_liquido DESC, produto_id${limite ? `\nLIMIT ${limite}` : ""}` };
    }
    case "contas_a_receber_vencidas": {
      const ref = (r?.period.referenceDate ?? (typeof p.data_referencia === "string" ? p.data_referencia : null)) as string | null;
      const quantidade = typeof r?.rawResult?.quantidade === "number" ? (r.rawResult.quantidade as number) : null;
      return { ...base, periodo: ref ? { texto: `vencidos antes de ${dataPorExtenso(ref)}`, relativo: p._hoje === true ? "hoje" : opts.periodoRelativo } : null,
        entendimento: "Contas a receber vencidas: atalho com definição fixa.",
        filtros: ["Somente títulos a receber ainda sem baixa", "Vencimento anterior à data de referência (títulos que vencem nesse dia não entram)"],
        metodo: `Soma do valor dos títulos a receber sem baixa cujo vencimento é anterior a ${ref ? dataPorExtenso(ref) : "a data de referência"}.`,
        campos: ["Total vencido", "Quantidade de títulos"], linhas: quantidade,
        sql: `SELECT COALESCE(SUM(valor), 0) AS total_vencido, COUNT(*) AS titulos\nFROM vw_titulos_receber\nWHERE baixado_em IS NULL AND vencimento < '${ref ?? opts.hoje}'` };
    }
    case "faturamento_por_dia":
      return { ...base, periodo, entendimento: "Faturamento líquido por dia: cartão derivado do atalho de faturamento.",
        filtros: [...VENDAS_FILTROS, "Dias sem venda contam zero"],
        metodo: `Soma do valor líquido dos itens de vendas confirmadas em cada dia do calendário${quando}.`,
        campos: ["Dia", "Faturamento líquido"],
        sql: `SELECT data, COALESCE(SUM(valor_liquido), 0) AS faturamento_liquido\nFROM vw_vendas_itens\nWHERE ${entre}\nGROUP BY data\nORDER BY data` };
    default:
      return { ...base, periodo, entendimento: null, filtros: [], metodo: null, sql: null };
  }
}

/* ---------- free queries: what the SQL tells without describing it in jargon ---------- */

const LITERAL_DATE = /'(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?'/g;
/** Dates the query used, read from its literals; relative expressions mean "follows today's calendar". */
export function periodoDaConsulta(sqlText: string, hoje: string): Explicacao["periodo"] {
  const datas = [...sqlText.matchAll(LITERAL_DATE)].map(m => m[1]!).sort();
  const relativo = /\b(CURRENT_DATE|CURRENT_TIMESTAMP|NOW\(\)|LOCALTIMESTAMP|date_trunc)\b/i.test(sqlText);
  if (datas.length >= 2) return { texto: intervalo(datas[0]!, datas.at(-1)!), relativo: relativo ? "parte das datas acompanha o dia de hoje" : null };
  if (datas.length === 1) return { texto: `com referência a ${dataPorExtenso(datas[0]!)}`, relativo: relativo ? "parte das datas acompanha o dia de hoje" : null };
  if (relativo) return { texto: `calculado em relação a hoje (${dataPorExtenso(hoje)}, calendário de São Paulo)`, relativo: "acompanha o dia de hoje" };
  return null;
}
const humanize = (name: string) => { const t = name.replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
/** Labels of the output fields: declared formats first, then the ficha, then the alias itself (already Portuguese by contract). */
export function camposDaConsulta(sqlText: string, formatos: Livre["formatos"], views: string[], f: Ficha): string[] {
  const upper = sqlText.toUpperCase();
  const start = upper.lastIndexOf("SELECT ");
  const end = upper.indexOf(" FROM ", start);
  if (start < 0 || end < 0) return [];
  const lista = sqlText.slice(start + 7, end).replace(/^\s*DISTINCT\s+/i, "");
  const partes: string[] = []; let depth = 0, atual = "";
  for (const ch of lista) {
    if (ch === "(") depth++; else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { partes.push(atual); atual = ""; } else atual += ch;
  }
  partes.push(atual);
  const campos: string[] = [];
  for (const parte of partes) {
    const expr = parte.trim();
    if (!expr || expr === "*") continue;
    const alias = /\s+AS\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*$/i.exec(expr)?.[1] ?? (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(expr) ? expr.split(".").at(-1)! : null);
    if (!alias) continue;
    const declared = formatos.find(x => x.coluna === alias);
    const ficha = columnDefinition(alias, views, f);
    const label = declared?.rotulo || ficha?.rotulo || humanize(alias);
    if (!campos.includes(label)) campos.push(label);
  }
  return campos.slice(0, 12);
}

function explicarLivre(l: Livre, f: Ficha, hoje: string): Pick<Explicacao, "entendimento" | "fontes" | "periodo" | "filtros" | "metodo" | "campos" | "linhas" | "truncado" | "resumido" | "sql" | "sqlObs" | "tabelas"> {
  const campos = l.sql ? camposDaConsulta(l.sql, l.formatos, l.views, f) : l.formatos.map(x => x.rotulo || humanize(x.coluna));
  const fontes = fontesDe(l.views, f);
  const assuntos = fontes.map(x => x.assunto.toLowerCase());
  const metodo = l.sql
    ? `Consulta direta aos dados de ${assuntos.length ? assuntos.join(" e ") : "a empresa"}, com os critérios da interpretação acima${campos.length ? `; campos apresentados: ${campos.join(", ")}` : ""}.`
    : null;
  return { entendimento: l.interpretacao, fontes, periodo: l.sql ? periodoDaConsulta(l.sql, hoje) : null, filtros: [], metodo, campos,
    linhas: l.linhas, truncado: l.truncado, resumido: l.truncado ? "A consulta devolveu mais linhas do que o limite; a resposta mostrou as primeiras." : null,
    sql: l.sql, sqlObs: null, tabelas: l.views };
}

const mostraSql = () => { const role = currentTenant()?.role; return role === "administrador" || role === "dono"; };
const semSql = <T extends Pick<Explicacao, "sql" | "sqlObs" | "tabelas">>(x: T): T => mostraSql() ? x : { ...x, sql: null, sqlObs: null, tabelas: [] };

/* ---------- entry points ---------- */

const execucoes = (parameters: unknown): Array<Record<string, unknown>> => {
  const list = (parameters as { _executions?: unknown } | null)?._executions;
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
};
const ATALHOS = new Set(["faturamento", "contas_a_receber_vencidas", "produtos_mais_vendidos", "consultar_vendas"]);

/** Explanation of one answer of the running company. 404 for another company's log. */
export async function explicarResposta(logId: number): Promise<Explicacao> {
  const [log] = await db.select().from(queryLogsTable).where(and(eq(queryLogsTable.id, logId), eq(queryLogsTable.companyId, currentCompanyId()))).limit(1);
  if (!log) throw new FavoritoError("nao-encontrado", "Não encontrei essa resposta.");
  const f = currentFicha();
  const hoje = localToday();
  const lista = execucoes(log.parameters);
  const fontesPublicas = (((log.parameters as { _sources?: unknown } | null)?._sources ?? []) as FontePublica[]).filter(s => s && typeof s.url === "string");
  const vazio: Explicacao = { origem: "nenhuma", pergunta: log.question, entendimento: null, fontes: [], periodo: null, filtros: [], metodo: null, campos: [], dadosDe: null, dadosDeObs: null,
    calculadoEm: log.createdAt.toISOString(), linhas: null, truncado: false, resumido: null, sql: null, sqlObs: null, tabelas: [], fontesPublicas, faltando: [] };
  // The last data execution of the turn is the one the headline came from (the same rule favourites use).
  for (const e of [...lista].reverse()) {
    const tool = String(e.tool ?? "");
    if (tool === "consultar_dados" && e.sql && e.status !== "falhou") {
      const l: Livre = { interpretacao: typeof e.interpretacao === "string" ? e.interpretacao : null, sql: String(e.sql), formatos: Array.isArray(e.formatos) ? (e.formatos as Livre["formatos"]) : [],
        linhas: typeof e.linhas === "number" ? e.linhas : null, truncado: e.truncado === true, views: Array.isArray(e.views) ? (e.views as string[]) : [] };
      const faltando: string[] = [];
      // The free turn does not record the age of the data it read; the current marker is the closest honest stamp.
      const marcador = await marcadorDados().catch(() => null);
      if (!marcador?.marcador) faltando.push("idade dos dados");
      if (!l.interpretacao) faltando.push("interpretação");
      return { ...vazio, origem: "livre", ...semSql(explicarLivre(l, f, hoje)), dadosDe: marcador?.marcador ?? null, dadosDeObs: marcador?.marcador ? "última carga registrada na base (marcador atual)" : null, faltando };
    }
    if (ATALHOS.has(tool) && e.result && e.parameters && typeof e.parameters === "object") {
      const a: Atalho = { ferramenta: tool, parametros: e.parameters as Record<string, unknown>, resultado: e.result as MetricResult };
      const faltando: string[] = [];
      if (!a.resultado?.lastUpdatedAt) faltando.push("idade dos dados");
      return { ...vazio, origem: "atalho", ...semSql(explicarAtalho(a, f, { periodoRelativo: periodoRelativoTexto(a.parametros), hoje })),
        dadosDe: a.resultado?.lastUpdatedAt ?? null, dadosDeObs: a.resultado?.lastUpdatedAt ? "última atualização dos dados lidos" : null, faltando };
    }
  }
  if (fontesPublicas.length || lista.some(e => e.tool === "pesquisar")) return { ...vazio, origem: "externa" };
  return vazio;
}

/** Explanation of a favourite card of the running user (own or shared with the company). */
export async function explicarFavorito(id: number): Promise<Explicacao> {
  const fav: Favorito = await pegarFavorito(id);
  const f = currentFicha();
  const hoje = localToday();
  const fixo = fav.kind === "fixo";
  const stored = fixo ? (fav.fixedResult as Resultado | null) : null;
  const marcador = fixo ? null : await marcadorDados().catch(() => null);
  const base: Explicacao = { origem: "nenhuma", pergunta: fav.originalQuestion, entendimento: null, fontes: [], periodo: null, filtros: [], metodo: null, campos: [],
    dadosDe: fixo ? stored?.updatedAt ?? fav.frozenAt?.toISOString() ?? null : marcador?.marcador ?? null,
    dadosDeObs: fixo ? "dados do momento em que o cartão foi guardado" : marcador?.marcador ? "última carga registrada na base; o cartão é refeito quando ela muda" : null,
    calculadoEm: fixo ? fav.frozenAt?.toISOString() ?? stored?.executadoEm ?? null : fav.lastRunAt?.toISOString() ?? null,
    linhas: stored ? stored.rows.length : null, truncado: stored?.truncated ?? false, resumido: null, sql: null, sqlObs: null, tabelas: [], fontesPublicas: [], faltando: [] };
  const acompanhamento = fixo ? "Valor guardado: não é recalculado." : "Cartão acompanhado: recalculado quando chegam dados novos, com as datas resolvidas no dia.";
  if (fav.tool && fav.toolParams) {
    const p = { ...fav.toolParams };
    const relativo = periodoRelativoTexto(p);
    // A live card resolves its period again on every run; the explanation shows the dates it would use today.
    if (!fixo && typeof p.periodo === "string" && p.periodo !== "custom") {
      const period = resolvePeriod({ preset: p.periodo as PeriodPreset, months: typeof p.meses === "number" ? p.meses : undefined, days: typeof p.dias === "number" ? p.dias : undefined }, new Date());
      p.data_inicio = period.startDate; p.data_fim = period.endDate;
    }
    if (!fixo && p._hoje === true) p.data_referencia = hoje;
    const parte = explicarAtalho({ ferramenta: fav.tool, parametros: p, resultado: null }, f, { periodoRelativo: relativo, hoje });
    const periodo = parte.periodo ? { ...parte.periodo, relativo: relativo ?? (fixo ? "datas fixas" : null) } : null;
    return { ...base, origem: "atalho", ...semSql({ ...parte, periodo, filtros: [...parte.filtros, acompanhamento], campos: stored?.columns.map(c => c.label) ?? parte.campos }) };
  }
  if (fav.savedSql || stored) {
    const sqlText = fav.savedSql ?? null;
    const views = sqlText ? f.visoes.map(v => v.nome).filter(v => new RegExp(`\\b${v}\\b`, "i").test(sqlText)) : [];
    const livre: Livre = { interpretacao: null, sql: sqlText, formatos: (fav.formats ?? []) as Livre["formatos"], linhas: stored ? stored.rows.length : null, truncado: stored?.truncated ?? false, views };
    // The interpretation lives in the answer the card came from, when that log still exists.
    if (fav.queryLogId) {
      const [log] = await db.select({ parameters: queryLogsTable.parameters }).from(queryLogsTable).where(and(eq(queryLogsTable.id, fav.queryLogId), eq(queryLogsTable.companyId, currentCompanyId()))).limit(1);
      const origem = log ? [...execucoes(log.parameters)].reverse().find(e => e.tool === "consultar_dados" && typeof e.interpretacao === "string") : null;
      if (origem) { livre.interpretacao = String(origem.interpretacao); if (!views.length && Array.isArray(origem.views)) livre.views = origem.views as string[]; }
    }
    const parte = explicarLivre(livre, f, hoje);
    const faltando = livre.interpretacao ? [] : ["interpretação (resposta de origem não encontrada)"];
    return { ...base, origem: "livre", ...semSql({ ...parte, filtros: [acompanhamento], campos: stored?.columns.map(c => c.label) ?? parte.campos }), faltando };
  }
  return { ...base, faltando: ["consulta de origem"] };
}
