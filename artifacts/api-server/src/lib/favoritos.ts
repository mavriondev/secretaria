/**
 * Favourites: answers the manager pins as cards. A live card re-runs its saved SQL (never the model) while the app is
 * open; a fixed card keeps the result of the moment it was pinned. Everything here is scoped to the company and the
 * user of the running request.
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, or, sql as dsql } from "drizzle-orm";
import type OpenAI from "openai";
import { z } from "zod";
import { db, favoritesTable, queryLogsTable, usersTable, type FavoriteForm } from "@workspace/db";
import { currentCompanyId, currentTenant } from "./tenant";
import { FreeQueryError, runFreeQuery, type FreeQueryResult } from "./free-query";
import { typedColumns, type DeclaredFormat } from "./free-facts";
import { guardSql } from "./sql-guard";
import { currentFicha, fichaPrompt, fichaViewNames } from "./ficha";
import { aiConfig, openaiClient } from "./openai-direct";
import { custoTexto, registrarCusto as contabilizar, verificarTeto } from "./limite-custo";
import { dadosDoCartao, escolherForma, formasCompativeis, toNumber, type CardColumn, type CardData, type CardRow } from "./apresentacao-grafica";
import { formaPreferida, formatosDaMetrica, metricaDosParametros, MOTIVO_PERIODO_FIXO, periodoRelativo, resultadoDaMetrica, rodarMetrica, variantesDaMetrica, type MetricaSalva, type Variante } from "./favoritos-metrica";
import { marcadorDados } from "./marcador-dados";
import type { Estado } from "./saude-dados";

export const FAVORITE_QUOTA = 30;
export const HOME_LIMIT = 3;
/** Safety ceiling for the per-marker cache: even with a frozen marker (demo company) a result is recomputed after this long. */
const CACHE_MAX_MS = 6 * 3_600_000;
/** Refreshes one user may trigger per minute (all cards together). */
const RUNS_PER_MINUTE = 60;
const DRAFT_TTL_MS = 10 * 60_000;

export class FavoritoError extends Error {
  constructor(readonly kind: "nao-encontrado" | "sem-consulta" | "cota" | "reescrita" | "consulta" | "limite" | "rascunho" | "tela-inicial" | "forma" | "sem-permissao", message: string) { super(message); this.name = "FavoritoError"; }
}

export type Resultado = {
  columns: CardColumn[]; rows: CardRow[]; truncated: boolean;
  /** Age of the data mirror (ISO), as in answers. */
  updatedAt: string | null;
  executadoEm: string;
  forma: FavoriteForm; formas: FavoriteForm[]; dados: CardData;
};
export type Rascunho = {
  id: string; queryLogId: number; pergunta: string; tituloSugerido: string;
  sql: string; formatos: DeclaredFormat[]; resultado: Resultado;
  /** Set when the answer came from a ready-made shortcut; the card then replays the tool instead of SQL. */
  metrica: MetricaSalva | null;
  /** What happened to literal dates: not needed, rewritten and checked, or rejected (only "fixo" is offered then). */
  reescrita: "nao-necessaria" | "ok" | "rejeitada"; motivo: string | null; podeVivo: boolean;
  /** The same result drawn in every compatible form, so the dialog previews the card exactly as it will look. */
  previas: Partial<Record<FavoriteForm, CardData>>;
  /** Companion cards offered for this answer (e.g. revenue by day for a revenue shortcut). */
  variantes: Variante[];
};
type Usage = { input: number; output: number };
export type DateRewriter = (input: { sql: string; pergunta: string; hoje: string }) => Promise<{ sql: string; usage: Usage }>;
export type Deps = { query?: (sql: string) => Promise<FreeQueryResult>; rewrite?: DateRewriter; now?: () => Date; metrica?: (m: MetricaSalva, now: Date) => Promise<FreeQueryResult>; marcador?: () => Promise<{ marcador: string | null; estado: Estado }> };
const defaultMetrica = async (m: MetricaSalva, now: Date) => resultadoDaMetrica(m, await rodarMetrica(m, now));

const user = () => { const t = currentTenant(); if (!t) throw new Error("Favoritos exigem um usuário autenticado."); return { companyId: t.companyId, userId: t.userId, role: t.role }; };
/** Administrators (and the owner, when operating a company) publish cards to the company and manage any shared card. */
export const podeCompartilhar = () => { const r = user().role; return r === "administrador" || r === "dono"; };
const todayLocal = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/* ---------- result shaping ---------- */

export function montarResultado(result: FreeQueryResult, formatos: DeclaredFormat[], forma: FavoriteForm | null, now = new Date()): Resultado {
  const columns = typedColumns(result, formatos, currentFicha()) as CardColumn[];
  const formas = formasCompativeis(columns, result.rows);
  const chosen = forma && formas.includes(forma) ? forma : escolherForma(columns, result.rows);
  return { columns, rows: result.rows, truncated: result.truncated, updatedAt: result.updatedAt, executadoEm: now.toISOString(), forma: chosen, formas, dados: dadosDoCartao(chosen, columns, result.rows) };
}
/** A stored snapshot drawn again, possibly in another compatible form. */
export const previasDoResultado = (r: Resultado): Partial<Record<FavoriteForm, CardData>> => Object.fromEntries(r.formas.map(f => [f, dadosDoCartao(f, r.columns, r.rows)]));
export const redesenhar = (stored: Resultado, forma: FavoriteForm): Resultado => ({ ...stored, forma: stored.formas.includes(forma) ? forma : stored.forma, dados: dadosDoCartao(stored.formas.includes(forma) ? forma : stored.forma, stored.columns, stored.rows) });

/* ---------- where the SQL of an answer lives ---------- */

export type ConsultaDoLog = { sql: string; formatos: DeclaredFormat[]; pergunta: string };
/** The SQL of an answer that came from a free query, as recorded in its audit log. Null when the answer had no query. */
export function consultaDosParametros(parameters: unknown): Omit<ConsultaDoLog, "pergunta"> | null {
  const executions = (parameters as { _executions?: unknown[] } | null)?._executions;
  if (!Array.isArray(executions)) return null;
  for (const item of [...executions].reverse()) {
    const e = item as { tool?: string; sql?: string | null; status?: string; formatos?: DeclaredFormat[] };
    if (e.tool === "consultar_dados" && e.sql && e.status !== "falhou") return { sql: e.sql, formatos: Array.isArray(e.formatos) ? e.formatos : [] };
  }
  return null;
}
/** Any pinnable source of an answer: a free query (SQL) or a ready-made shortcut (tool + parameters). */
export type FonteDoLog = { sql: string; formatos: DeclaredFormat[]; metrica: null } | { sql: null; formatos: DeclaredFormat[]; metrica: MetricaSalva };
export function fonteDosParametros(parameters: unknown): FonteDoLog | null {
  const livre = consultaDosParametros(parameters);
  if (livre) return { ...livre, metrica: null };
  const metrica = metricaDosParametros(parameters);
  return metrica ? { sql: null, formatos: formatosDaMetrica(metrica), metrica } : null;
}
export async function consultaDoLog(logId: number): Promise<FonteDoLog & { pergunta: string }> {
  const [log] = await db.select().from(queryLogsTable).where(and(eq(queryLogsTable.id, logId), eq(queryLogsTable.companyId, currentCompanyId()))).limit(1);
  if (!log) throw new FavoritoError("nao-encontrado", "Não encontrei essa resposta.");
  const found = fonteDosParametros(log.parameters);
  if (!found) throw new FavoritoError("sem-consulta", "Essa resposta não veio de uma consulta aos dados, então não dá para fixá-la.");
  return { ...found, pergunta: log.question };
}

export const temDatasLiterais = (sql: string) => /'\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?'/.test(sql) || /\b(make_date|to_date)\s*\(/i.test(sql);
const normalize = (rows: CardRow[]) => JSON.stringify(rows);

export function tituloSugerido(pergunta: string): string {
  let text = pergunta.trim().replace(/[?!.]+$/g, "").replace(/\s+/g, " ");
  text = text.replace(/^(me\s+)?(mostra|mostre|diga|diz|fala|fale|lista|liste|quero saber|gostaria de saber|pode me dizer)\s+/i, "");
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text || "Favorito";
}

/* ---------- date rewriting (the only model call, when pinning a live card) ---------- */

const rewriteSchema = { type: "object", additionalProperties: false, required: ["sql"], properties: { sql: { type: "string" } } };
export const openaiDateRewriter = (client: OpenAI = openaiClient(), model = aiConfig.textModel): DateRewriter => async input => {
  const response = await client.responses.create({
    model, store: false, reasoning: { effort: "low" }, max_output_tokens: 1200,
    instructions: `Você reescreve uma consulta SQL (PostgreSQL, somente leitura) para que ela continue correta em qualquer dia, sem datas literais. Hoje é ${input.hoje}. Substitua cada data literal pela expressão relativa equivalente (CURRENT_DATE, date_trunc('month', CURRENT_DATE), CURRENT_DATE - INTERVAL '7 days', etc.) preservando exatamente o mesmo período que a consulta original cobre hoje. Não mude colunas, filtros, agrupamentos, ordenação nem aliases. Uma única instrução, sem ponto e vírgula. Use somente as views e colunas descritas abaixo.\n\n${fichaPrompt(currentFicha())}`,
    input: JSON.stringify({ pedido_original: input.pergunta, consulta: input.sql }),
    text: { format: { type: "json_schema", name: "consulta_relativa", strict: true, schema: rewriteSchema } },
  });
  const parsed = z.object({ sql: z.string().min(1).max(4000) }).strict().parse(JSON.parse(response.output_text));
  return { sql: parsed.sql, usage: { input: response.usage?.input_tokens ?? 0, output: response.usage?.output_tokens ?? 0 } };
};

async function registrarCusto(pergunta: string, usage: Usage, detail: Record<string, unknown>) {
  const [log] = await db.insert(queryLogsTable).values({
    companyId: currentCompanyId(), question: `[favorito] ${pergunta}`, functionName: null, answer: "Reescrita de datas para favorito ao vivo.",
    parameters: { _favorito: detail, _metrics: { chamadas: 1 } }, result: null, freedomLevel: 0, latencyMs: 0,
    inputTokens: usage.input, outputTokens: usage.output,
    estimatedCostUsd: custoTexto(usage.input, usage.output).toFixed(8),
  }).returning({ id: queryLogsTable.id });
  await contabilizar({ tipo: "reescrita", provedor: "openai", modelo: aiConfig.textModel, quantidade: usage.input + usage.output, unidade: "tokens", custoUsd: custoTexto(usage.input, usage.output), queryLogId: log?.id ?? null });
}

/* ---------- drafts ---------- */

const drafts = new Map<string, { companyId: number; userId: number; draft: Rascunho; expires: number }>();
const putDraft = (draft: Rascunho) => { const { companyId, userId } = user(); drafts.set(draft.id, { companyId, userId, draft, expires: Date.now() + DRAFT_TTL_MS }); };
export function pegarRascunho(id: string): Rascunho {
  const { companyId, userId } = user();
  const entry = drafts.get(id);
  if (!entry || entry.expires < Date.now() || entry.companyId !== companyId || entry.userId !== userId) throw new FavoritoError("rascunho", "A confirmação expirou. Fixe a resposta novamente.");
  return entry.draft;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of drafts) if (v.expires < now) drafts.delete(k); }, 60_000).unref();

/**
 * Builds what the confirmation dialog shows: the current value, the suggested title and whether the card can be live.
 * For a live card with literal dates the SQL is rewritten once (model call, cost recorded), guarded and compared:
 * same result today or the live option is withdrawn.
 */
export type PrepararInput = { queryLogId: number; tipo: "vivo" | "fixo"; variante?: Variante["chave"] | null };
export async function prepararFavorito(input: PrepararInput, deps: Deps = {}): Promise<Rascunho> {
  const now = deps.now?.() ?? new Date();
  const query = deps.query ?? ((s: string) => runFreeQuery(s));
  const found = await consultaDoLog(input.queryLogId);
  if (found.metrica) return prepararMetrica(input, found, now, deps);
  if (input.variante) throw new FavoritoError("sem-consulta", "Essa resposta não tem essa variação.");
  let sql = found.sql;
  let reescrita: Rascunho["reescrita"] = "nao-necessaria";
  let motivo: string | null = null;
  let podeVivo = true;
  let original: FreeQueryResult;
  try { original = await query(found.sql); }
  catch (error) { throw new FavoritoError("consulta", error instanceof FreeQueryError ? `A consulta original não roda mais: ${error.message}` : "Não consegui executar a consulta original."); }
  let result = original;
  if (input.tipo === "vivo" && temDatasLiterais(found.sql)) {
    const teto = await verificarTeto(currentCompanyId(), now);
    if (teto.bloqueado) throw new FavoritoError("limite", teto.motivo === "empresa_mes" ? "O limite de uso deste mês foi atingido; não consigo preparar um favorito ao vivo agora. Guarde como fixo ou tente no mês que vem." : "O limite de uso de hoje foi atingido; não consigo preparar um favorito ao vivo agora. Guarde como fixo ou tente amanhã.");
    const rewrite = deps.rewrite ?? openaiDateRewriter();
    try {
      const rewritten = await rewrite({ sql: found.sql, pergunta: found.pergunta, hoje: todayLocal(now) });
      await registrarCusto(found.pergunta, rewritten.usage, { queryLogId: input.queryLogId, de: found.sql, para: rewritten.sql });
      const guarded = guardSql(rewritten.sql, fichaViewNames(currentFicha()));
      if (!guarded.ok) { reescrita = "rejeitada"; motivo = `a consulta reescrita foi recusada (${guarded.reason})`; }
      else if (temDatasLiterais(guarded.sql)) { reescrita = "rejeitada"; motivo = "a consulta reescrita ainda tem datas fixas"; }
      else {
        const check = await query(guarded.sql);
        if (normalize(check.rows) !== normalize(original.rows)) { reescrita = "rejeitada"; motivo = "a versão com datas relativas deu um resultado diferente do original hoje"; }
        else { reescrita = "ok"; sql = guarded.sql; result = check; }
      }
    } catch (error) {
      reescrita = "rejeitada"; motivo = error instanceof FreeQueryError ? `a consulta reescrita falhou (${error.message})` : "não foi possível reescrever as datas da consulta";
    }
    podeVivo = reescrita === "ok";
  }
  const resultado = montarResultado(result, found.formatos, null, now);
  const draft: Rascunho = {
    id: randomUUID(), queryLogId: input.queryLogId, pergunta: found.pergunta, tituloSugerido: tituloSugerido(found.pergunta),
    sql, formatos: found.formatos, resultado, reescrita, motivo, podeVivo, metrica: null, previas: previasDoResultado(resultado), variantes: [],
  };
  putDraft(draft);
  return draft;
}
/**
 * Draft of a shortcut answer: the tool runs again now (no model); live only when the period asked was relative.
 * A variant (e.g. revenue by day) is a companion card computed with the same business definition as the shortcut.
 */
async function prepararMetrica(input: PrepararInput, found: FonteDoLog & { pergunta: string; metrica: MetricaSalva }, now: Date, deps: Deps): Promise<Rascunho> {
  const variantes = variantesDaMetrica(found.metrica);
  const chosen = input.variante ? variantes.find(v => v.chave === input.variante) : null;
  if (input.variante && !chosen) throw new FavoritoError("sem-consulta", "Essa resposta não tem essa variação.");
  const metrica: MetricaSalva = chosen ? { ferramenta: chosen.ferramenta, parametros: found.metrica.parametros } : found.metrica;
  const formatos = chosen ? formatosDaMetrica(metrica) : found.formatos;
  let result: FreeQueryResult;
  try { result = await (deps.metrica ?? defaultMetrica)(metrica, now); }
  catch (error) { throw new FavoritoError("consulta", `A consulta original não roda mais: ${error instanceof Error ? error.message : "erro desconhecido"}`); }
  const podeVivo = periodoRelativo(metrica);
  const resultado = montarResultado(result, formatos, formaPreferida(metrica), now);
  const base = tituloSugerido(found.pergunta);
  const draft: Rascunho = {
    id: randomUUID(), queryLogId: input.queryLogId, pergunta: found.pergunta, tituloSugerido: chosen ? `${base} · ${chosen.sufixoTitulo}`.slice(0, 80) : base,
    sql: "", formatos, resultado, reescrita: "nao-necessaria",
    motivo: podeVivo ? null : MOTIVO_PERIODO_FIXO, podeVivo, metrica, previas: previasDoResultado(resultado), variantes: chosen ? [] : variantes,
  };
  putDraft(draft);
  return draft;
}

/* ---------- persistence ---------- */

export type Favorito = typeof favoritesTable.$inferSelect;
/** Rows of the running user's company (isolation between companies starts here; nothing below queries without it). */
const daEmpresa = () => eq(favoritesTable.companyId, user().companyId);
/** The user's own cards (personal and the ones they shared). */
const mine = () => { const { companyId, userId } = user(); return and(eq(favoritesTable.companyId, companyId), eq(favoritesTable.userId, userId)); };
/** What the user may see: their own cards and every card shared with the company. */
const visiveis = () => { const { userId } = user(); return and(daEmpresa(), or(eq(favoritesTable.userId, userId), eq(favoritesTable.scope, "empresa"))); };
/** Who may rename, delete, republish or redo a card: its creator, or an administrator for a shared card of the company. */
export const podeEditar = (fav: Favorito) => fav.userId === user().userId || (fav.scope === "empresa" && podeCompartilhar());
const exigirEdicao = (fav: Favorito) => { if (!podeEditar(fav)) throw new FavoritoError("sem-permissao", "Só quem criou este favorito ou um administrador pode alterá-lo. Você pode copiá-lo para os seus."); };

export type FavoritoListado = Favorito & { criadoPor: { id: number; nome: string } | null };
const comCriador = async (rows: Favorito[]): Promise<FavoritoListado[]> => {
  const userIds = [...new Set(rows.map(r => r.userId))];
  const people = userIds.length ? await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, userIds)) : [];
  const byId = new Map(people.map(p => [p.id, p.name]));
  return rows.map(r => ({ ...r, criadoPor: byId.has(r.userId) ? { id: r.userId, nome: byId.get(r.userId)! } : null }));
};
/** Own cards first (in the person's order), then the company's shared cards (newest publication first). */
export async function listarFavoritos(): Promise<FavoritoListado[]> {
  const { userId } = user();
  const rows = await db.select().from(favoritesTable).where(visiveis()).orderBy(asc(favoritesTable.order), asc(favoritesTable.id));
  const own = rows.filter(r => r.userId === userId);
  const shared = rows.filter(r => r.userId !== userId).sort((a, b) => (b.sharedAt?.getTime() ?? 0) - (a.sharedAt?.getTime() ?? 0) || a.id - b.id);
  return comCriador([...own, ...shared]);
}
export async function pegarFavorito(id: number): Promise<Favorito> {
  const [row] = await db.select().from(favoritesTable).where(and(visiveis(), eq(favoritesTable.id, id))).limit(1);
  if (!row) throw new FavoritoError("nao-encontrado", "Favorito não encontrado.");
  return row;
}
export const SHARED_QUOTA = 30;
async function checarCota() {
  const [count] = await db.select({ n: dsql<number>`count(*)::int` }).from(favoritesTable).where(and(mine(), eq(favoritesTable.scope, "pessoal")));
  if ((count?.n ?? 0) >= FAVORITE_QUOTA) throw new FavoritoError("cota", `Você já tem ${FAVORITE_QUOTA} favoritos. Exclua algum para fixar outro.`);
}
async function checarCotaCompartilhada(excludeId?: number) {
  const rows = await db.select({ id: favoritesTable.id }).from(favoritesTable).where(and(daEmpresa(), eq(favoritesTable.scope, "empresa")));
  if (rows.filter(r => r.id !== excludeId).length >= SHARED_QUOTA) throw new FavoritoError("cota", `A empresa já tem ${SHARED_QUOTA} favoritos compartilhados. Despublique algum para compartilhar outro.`);
}
async function checarTelaInicial(excludeId?: number) {
  const rows = await db.select({ id: favoritesTable.id }).from(favoritesTable).where(and(mine(), eq(favoritesTable.onHome, true)));
  if (rows.filter(r => r.id !== excludeId).length >= HOME_LIMIT) throw new FavoritoError("tela-inicial", `A tela inicial mostra no máximo ${HOME_LIMIT} favoritos. Desmarque um deles primeiro.`);
}
async function checarTelaInicialTodos(excludeId?: number) {
  const rows = await db.select({ id: favoritesTable.id }).from(favoritesTable).where(and(daEmpresa(), eq(favoritesTable.scope, "empresa"), eq(favoritesTable.onHomeAll, true)));
  if (rows.filter(r => r.id !== excludeId).length >= HOME_LIMIT) throw new FavoritoError("tela-inicial", `A tela inicial de todos mostra no máximo ${HOME_LIMIT} favoritos compartilhados. Desmarque um deles primeiro.`);
}
const proximaOrdem = async () => { const [max] = await db.select({ m: dsql<number>`coalesce(max(${favoritesTable.order}), -1)::int` }).from(favoritesTable).where(mine()); return (max?.m ?? -1) + 1; };
/** Sharing audit: besides the columns on the card, a line in the audit log says who published or withdrew it and when. */
async function registrarCompartilhamento(fav: Favorito, acao: "compartilhado" | "despublicado") {
  const { companyId, userId } = user();
  await db.insert(queryLogsTable).values({
    companyId, question: `[compartilhamento] ${acao}: ${fav.title}`, functionName: null, answer: acao === "compartilhado" ? "Favorito compartilhado com a empresa." : "Favorito voltou a ser pessoal.",
    parameters: { _favorito: { id: fav.id, acao, por: userId, criador: fav.userId } }, result: null, freedomLevel: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: "0",
  });
}

/** Live cards follow the data marker; `intervalo_seg` stays in the table unused (no destructive migration). */
export type SalvarInput = { rascunhoId: string; titulo: string; tipo: "vivo" | "fixo"; naTelaInicial: boolean; forma?: FavoriteForm | null; compartilhar?: boolean };
export async function salvarFavorito(input: SalvarInput): Promise<Favorito> {
  const draft = pegarRascunho(input.rascunhoId);
  const { companyId, userId } = user();
  if (input.tipo === "vivo" && !draft.podeVivo) throw new FavoritoError("reescrita", `Não dá para acompanhar ao vivo: ${draft.motivo ?? "a consulta depende de datas fixas"}. Guarde o valor como fixo.`);
  const compartilhar = input.compartilhar === true;
  if (compartilhar && !podeCompartilhar()) throw new FavoritoError("sem-permissao", "Só um administrador compartilha favoritos com a empresa.");
  if (compartilhar) await checarCotaCompartilhada(); else await checarCota();
  if (input.naTelaInicial) await checarTelaInicial();
  const intervalSec = null;
  const resultado = input.forma ? redesenhar(draft.resultado, input.forma) : draft.resultado;
  const firstValue = resultado.dados.form === "numero" ? resultado.dados.raw : null;
  const now = new Date();
  const [row] = await db.insert(favoritesTable).values({
    companyId, userId, title: input.titulo.trim().slice(0, 80) || draft.tituloSugerido, originalQuestion: draft.pergunta, kind: input.tipo,
    savedSql: input.tipo === "vivo" && !draft.metrica ? draft.sql : null, tool: input.tipo === "vivo" ? draft.metrica?.ferramenta ?? null : null, toolParams: input.tipo === "vivo" ? draft.metrica?.parametros ?? null : null,
    formats: draft.formatos, form: resultado.forma, intervalSec,
    fixedResult: input.tipo === "fixo" ? resultado : null, frozenAt: input.tipo === "fixo" ? new Date(resultado.executadoEm) : null,
    order: await proximaOrdem(), onHome: input.naTelaInicial, queryLogId: draft.queryLogId, lastRunAt: new Date(resultado.executadoEm), lastValue: firstValue,
    scope: compartilhar ? "empresa" : "pessoal", sharedBy: compartilhar ? userId : null, sharedAt: compartilhar ? now : null,
  }).returning();
  drafts.delete(input.rascunhoId);
  if (compartilhar) await registrarCompartilhamento(row!, "compartilhado");
  return row!;
}

export type AtualizarInput = Partial<{ titulo: string; naTelaInicial: boolean; forma: FavoriteForm; secao: string | null; escopo: "pessoal" | "empresa"; naTelaInicialTodos: boolean }>;
export async function atualizarFavorito(id: number, input: AtualizarInput): Promise<Favorito> {
  const current = await pegarFavorito(id);
  const { userId } = user();
  const set: Partial<typeof favoritesTable.$inferInsert> = {};
  // "Show on my home screen" is personal: only on one's own cards (a shared card of someone else is put there by an administrator, for everyone).
  if (input.naTelaInicial !== undefined) {
    if (current.userId !== userId) throw new FavoritoError("sem-permissao", "Este favorito é da empresa; copie-o para os seus para escolher onde ele aparece.");
    if (input.naTelaInicial && !current.onHome) await checarTelaInicial(id);
    set.onHome = input.naTelaInicial;
  }
  if (input.titulo !== undefined || input.secao !== undefined || input.forma !== undefined || input.escopo !== undefined || input.naTelaInicialTodos !== undefined) exigirEdicao(current);
  if (input.titulo !== undefined) set.title = input.titulo.trim().slice(0, 80) || current.title;
  if (input.secao !== undefined) set.section = input.secao?.trim().slice(0, 40) || null;
  if (input.forma !== undefined) {
    const stored = current.fixedResult as Resultado | null;
    if (stored && !stored.formas.includes(input.forma)) throw new FavoritoError("forma", "Essa forma não serve para este resultado.");
    set.form = input.forma;
    if (stored) set.fixedResult = redesenhar(stored, input.forma);
  }
  let auditoria: "compartilhado" | "despublicado" | null = null;
  if (input.escopo !== undefined && input.escopo !== current.scope) {
    if (!podeCompartilhar()) throw new FavoritoError("sem-permissao", "Só um administrador compartilha favoritos com a empresa.");
    if (input.escopo === "empresa") { await checarCotaCompartilhada(id); set.scope = "empresa"; set.sharedBy = userId; set.sharedAt = new Date(); auditoria = "compartilhado"; }
    else { set.scope = "pessoal"; set.onHomeAll = false; auditoria = "despublicado"; }
  }
  if (input.naTelaInicialTodos !== undefined) {
    if (!podeCompartilhar()) throw new FavoritoError("sem-permissao", "Só um administrador fixa favoritos na tela inicial de todos.");
    const scope = set.scope ?? current.scope;
    if (input.naTelaInicialTodos && scope !== "empresa") throw new FavoritoError("sem-permissao", "Compartilhe o favorito com a empresa antes de fixá-lo na tela inicial de todos.");
    if (input.naTelaInicialTodos && !current.onHomeAll) await checarTelaInicialTodos(id);
    set.onHomeAll = input.naTelaInicialTodos;
  }
  const [row] = await db.update(favoritesTable).set(set).where(and(daEmpresa(), eq(favoritesTable.id, id))).returning();
  if (auditoria) await registrarCompartilhamento(row!, auditoria);
  return row!;
}
export async function excluirFavorito(id: number): Promise<void> {
  exigirEdicao(await pegarFavorito(id));
  await db.delete(favoritesTable).where(and(daEmpresa(), eq(favoritesTable.id, id)));
}
/** A personal copy of a shared card: same query, same form, owned by the person who copied it (counts in their quota). */
export async function copiarFavorito(id: number): Promise<Favorito> {
  const fav = await pegarFavorito(id);
  const { companyId, userId } = user();
  if (fav.scope !== "empresa") throw new FavoritoError("sem-permissao", "Este favorito já é seu.");
  await checarCota();
  const [row] = await db.insert(favoritesTable).values({
    companyId, userId, title: fav.title, originalQuestion: fav.originalQuestion, kind: fav.kind, savedSql: fav.savedSql, tool: fav.tool, toolParams: fav.toolParams,
    formats: fav.formats, form: fav.form, intervalSec: null, fixedResult: fav.fixedResult, frozenAt: fav.frozenAt, order: await proximaOrdem(), section: fav.section, onHome: false,
    queryLogId: fav.queryLogId, lastRunAt: fav.lastRunAt, lastValue: fav.lastValue, scope: "pessoal",
  }).returning();
  return row!;
}
/** New order of all the user's own favourites (ids first to last). Ids not listed keep their relative order after the listed ones. */
export async function reordenarFavoritos(ids: number[]): Promise<FavoritoListado[]> {
  const { userId } = user();
  const all = (await listarFavoritos()).filter(f => f.userId === userId);
  const known = new Set(all.map(f => f.id));
  const ordered = [...ids.filter(id => known.has(id)), ...all.map(f => f.id).filter(id => !ids.includes(id))];
  await db.transaction(async tx => { for (const [i, id] of ordered.entries()) await tx.update(favoritesTable).set({ order: i }).where(and(mine(), eq(favoritesTable.id, id))); });
  return listarFavoritos();
}

/* ---------- running live cards ---------- */

/** Results keyed by company+query, valid while the data marker that produced them is still the current one. */
const cache = new Map<string, { at: number; marcador: string | null; result: FreeQueryResult }>();
const runs = new Map<number, { minute: number; n: number }>();
const checkRate = (userId: number, now: Date) => {
  const minute = Math.floor(now.getTime() / 60_000);
  const entry = runs.get(userId);
  if (!entry || entry.minute !== minute) { runs.set(userId, { minute, n: 1 }); return; }
  if (++entry.n > RUNS_PER_MINUTE) throw new FavoritoError("limite", "Muitas atualizações em um minuto. Aguarde um pouco.");
};
export const _limparCaches = () => { cache.clear(); runs.clear(); };

const metricaDoFavorito = (fav: Favorito): MetricaSalva | null => fav.tool && fav.toolParams ? { ferramenta: fav.tool as MetricaSalva["ferramenta"], parametros: fav.toolParams } : null;
export type Execucao =
  | { estado: "ok"; resultado: Resultado; variacao: number | null; cache: boolean; marcador: string | null; estadoDados: Estado }
  | { estado: "refazer"; erro: string };

/**
 * Runs a live card with the current user's permissions and the same locks as a free query. No model call, ever.
 * The result is cached per data marker: while no new data arrived, the same card (for any user of the company) costs nothing.
 */
export async function executarFavorito(fav: Favorito, deps: Deps = {}): Promise<Execucao> {
  const now = deps.now?.() ?? new Date();
  const { userId } = user();
  const dados = await (deps.marcador ?? marcadorDados)();
  if (fav.kind === "fixo") {
    const stored = fav.fixedResult as Resultado;
    return { estado: "ok", resultado: redesenhar(stored, fav.form), variacao: null, cache: true, marcador: dados.marcador, estadoDados: dados.estado };
  }
  const metrica = metricaDoFavorito(fav);
  if (!fav.savedSql && !metrica) return { estado: "refazer", erro: "Este favorito não tem consulta salva." };
  checkRate(userId, now);
  const key = metrica ? `${fav.companyId}:${metrica.ferramenta}:${JSON.stringify(metrica.parametros)}` : `${fav.companyId}:${fav.savedSql}`;
  const hit = cache.get(key);
  let result: FreeQueryResult; let fromCache = false;
  if (hit && hit.marcador === dados.marcador && now.getTime() - hit.at < CACHE_MAX_MS) { result = hit.result; fromCache = true; }
  else {
    try {
      result = metrica ? await (deps.metrica ?? defaultMetrica)(metrica, now) : await (deps.query ?? ((s: string) => runFreeQuery(s)))(fav.savedSql!);
      cache.set(key, { at: now.getTime(), marcador: dados.marcador, result });
    } catch (error) {
      const message = error instanceof FreeQueryError ? error.message : metrica && error instanceof Error ? error.message : "não foi possível executar a consulta";
      await db.update(favoritesTable).set({ lastError: message, lastRunAt: now }).where(eq(favoritesTable.id, fav.id));
      return { estado: "refazer", erro: message };
    }
  }
  const resultado = montarResultado(result, fav.formats as DeclaredFormat[], fav.form, now);
  const current = resultado.dados.form === "numero" ? resultado.dados.raw : null;
  const previous = toNumber(fav.lastValue);
  const variacao = resultado.dados.form === "numero" && resultado.dados.value !== null && previous !== null ? resultado.dados.value - previous : null;
  if (!fromCache) await db.update(favoritesTable).set({ lastRunAt: now, lastError: null, ...(current !== null && current !== fav.lastValue ? { lastValue: current } : {}) }).where(eq(favoritesTable.id, fav.id));
  return { estado: "ok", resultado, variacao, cache: fromCache, marcador: dados.marcador, estadoDados: dados.estado };
}

/** A fixed copy of a live card: the value right now, never recalculated. */
export async function congelarFavorito(id: number, deps: Deps = {}): Promise<Favorito> {
  const fav = await pegarFavorito(id);
  if (fav.kind !== "vivo") throw new FavoritoError("consulta", "Este favorito já é fixo.");
  await checarCota();
  const run = await executarFavorito(fav, deps);
  if (run.estado !== "ok") throw new FavoritoError("consulta", `Não consegui obter o valor atual: ${run.erro}`);
  const { companyId, userId } = user();
  const stamp = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date(run.resultado.executadoEm));
  const [row] = await db.insert(favoritesTable).values({
    companyId, userId, title: `${fav.title} (${stamp})`.slice(0, 80), originalQuestion: fav.originalQuestion, kind: "fixo", savedSql: null, formats: fav.formats, form: run.resultado.forma,
    intervalSec: null, fixedResult: run.resultado, frozenAt: new Date(run.resultado.executadoEm), order: await proximaOrdem(), onHome: false, queryLogId: fav.queryLogId, lastRunAt: new Date(run.resultado.executadoEm),
    scope: "pessoal",
  }).returning();
  return row!;
}

/** Replaces the query of a card that stopped working with the one from a fresh answer (already prepared as a draft and confirmed). */
export async function substituirConsulta(id: number, rascunhoId: string): Promise<Favorito> {
  const fav = await pegarFavorito(id);
  exigirEdicao(fav);
  const draft = pegarRascunho(rascunhoId);
  if (fav.kind === "vivo" && !draft.podeVivo) throw new FavoritoError("reescrita", `A nova consulta não serve para acompanhar ao vivo: ${draft.motivo ?? "depende de datas fixas"}.`);
  const resultado = redesenhar(draft.resultado, fav.form);
  const [row] = await db.update(favoritesTable).set({
    savedSql: fav.kind === "vivo" && !draft.metrica ? draft.sql : null, tool: fav.kind === "vivo" ? draft.metrica?.ferramenta ?? null : null, toolParams: fav.kind === "vivo" ? draft.metrica?.parametros ?? null : null,
    formats: draft.formatos, form: resultado.forma, queryLogId: draft.queryLogId, lastError: null, lastRunAt: new Date(resultado.executadoEm),
    ...(fav.kind === "fixo" ? { fixedResult: resultado, frozenAt: new Date(resultado.executadoEm) } : {}),
  }).where(and(daEmpresa(), eq(favoritesTable.id, id))).returning();
  drafts.delete(rascunhoId);
  return row!;
}

/* ---------- personal setting ---------- */

export async function faixaTelaInicial(): Promise<boolean> {
  const [row] = await db.select({ on: usersTable.homeFavorites }).from(usersTable).where(eq(usersTable.id, user().userId));
  return row?.on ?? true;
}
export async function definirFaixaTelaInicial(on: boolean): Promise<void> {
  await db.update(usersTable).set({ homeFavorites: on }).where(eq(usersTable.id, user().userId));
}

/**
 * Ids of the cards on this person's home strip: their own marked cards first, then the company's shared cards an
 * administrator put on everyone's screen, three at most in total.
 */
export function faixaDaTelaInicial(items: FavoritoListado[]): number[] {
  const { userId } = user();
  const own = items.filter(f => f.userId === userId && f.onHome).map(f => f.id);
  const todos = items.filter(f => f.scope === "empresa" && f.onHomeAll && !own.includes(f.id)).map(f => f.id);
  return [...own, ...todos].slice(0, HOME_LIMIT);
}

/** Public shape of a favourite (never the SQL). */
export const publico = (f: Favorito | FavoritoListado) => {
  const { userId } = user();
  return {
    id: f.id, titulo: f.title, pergunta: f.originalQuestion, tipo: f.kind, forma: f.form, naTelaInicial: f.onHome, secao: f.section, ordem: f.order,
    guardadoEm: f.frozenAt?.toISOString() ?? null, criadoEm: f.createdAt.toISOString(), ultimaExecucao: f.lastRunAt?.toISOString() ?? null, ultimoErro: f.lastError,
    formas: f.kind === "fixo" ? (f.fixedResult as Resultado | null)?.formas ?? [f.form] : null,
    escopo: f.scope, meu: f.userId === userId, editavel: podeEditar(f), naTelaInicialTodos: f.onHomeAll,
    criadoPor: "criadoPor" in f ? f.criadoPor : null, compartilhadoEm: f.sharedAt?.toISOString() ?? null,
  };
};
