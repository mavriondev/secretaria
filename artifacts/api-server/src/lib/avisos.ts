/**
 * Alerts: rules a person sets on a live favourite ("tell me when this goes above X"). Everything here is decided by code:
 * conditions are fixed, checks run only when the company's data marker moves, and no model is ever called.
 *
 * Flow: scheduler tick → for each company with active rules, read the marker (with that company's connection) →
 * if it moved, run each favourite once (the per-marker cache in favoritos.ts shares the result between rules of the same
 * query) with the permissions of a rule owner → evaluate every rule → notices in the inbox → push when allowed.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNull, sql as dsql } from "drizzle-orm";
import { alertSettingsTable, alertsTable, companiesTable, db, favoritesTable, notificationsTable, pushSubscriptionsTable, usersTable, type AlertCondition } from "@workspace/db";
import { currentTenant, runAsTenant, type Tenant } from "./tenant";
import { loadCompanyData } from "./company-data";
import { executarFavorito, pegarFavorito, type Favorito, type Resultado } from "./favoritos";
import { marcadorDados } from "./marcador-dados";
import { brl, numberBr } from "./facts";
import { enviarPush, pushDisponivel } from "./push";

export const ALERT_QUOTA = 20;
export const DAILY_NOTICE_CAP = 10;
const TZ = "America/Sao_Paulo";

export class AvisoError extends Error {
  constructor(readonly kind: "nao-encontrado" | "cota" | "invalido" | "sem-permissao", message: string) { super(message); this.name = "AvisoError"; }
}
const user = () => { const t = currentTenant(); if (!t) throw new Error("Avisos exigem um usuário autenticado."); return t; };

/* ---------- values and conditions ---------- */

type Observado = { numero: number | null; rotulo: string | null; rows: Array<Record<string, string | null>>; fingerprint: string; tipo: string | null };
/** What a rule looks at: the single number of a number card, otherwise the rows (a text/state value is a one-row, one-column result). */
export function observar(resultado: Resultado): Observado {
  const d = resultado.dados;
  // Only the first 200 rows are kept as the reference between checks; the fingerprint covers the same slice.
  const rows = resultado.rows.slice(0, 200);
  const fingerprint = createHash("sha256").update(JSON.stringify(rows)).digest("hex").slice(0, 32);
  if (d.form === "numero") return { numero: d.value, rotulo: d.value === null ? d.raw : null, rows, fingerprint, tipo: d.column.type };
  return { numero: null, rotulo: null, rows, fingerprint, tipo: null };
}
export const formatarValor = (n: number, tipo: string | null) => tipo === "dinheiro" ? brl(n) : tipo === "percentual" ? `${numberBr(n)}%` : numberBr(n);

export type Avaliacao = { verdadeiro: boolean; valor: string; detalhe: string };
/**
 * Evaluates one rule against the current observation and the previous one. acima/abaixo describe a state (true while it
 * holds); variacao and mudou describe an event between two consecutive checks.
 */
export function avaliar(rule: { condition: AlertCondition; threshold: string | null; thresholdKind: "valor" | "percentual" }, now: Observado, previous: { numero: number | null; fingerprint: string | null; rows: Array<Record<string, string | null>> | null }): Avaliacao {
  const limiar = rule.threshold === null ? null : Number(rule.threshold);
  const valorTexto = now.numero !== null ? formatarValor(now.numero, now.tipo) : now.rotulo ?? `${now.rows.length} linha(s)`;
  switch (rule.condition) {
    case "acima": return { verdadeiro: now.numero !== null && limiar !== null && now.numero > limiar, valor: valorTexto, detalhe: `acima de ${limiar === null ? "?" : formatarValor(limiar, now.tipo)}` };
    case "abaixo": return { verdadeiro: now.numero !== null && limiar !== null && now.numero < limiar, valor: valorTexto, detalhe: `abaixo de ${limiar === null ? "?" : formatarValor(limiar, now.tipo)}` };
    case "variacao": {
      if (now.numero === null || previous.numero === null || limiar === null) return { verdadeiro: false, valor: valorTexto, detalhe: "variação" };
      const delta = now.numero - previous.numero;
      const pct = previous.numero === 0 ? (delta === 0 ? 0 : Infinity) : (delta / Math.abs(previous.numero)) * 100;
      const hit = rule.thresholdKind === "percentual" ? Math.abs(pct) > limiar : Math.abs(delta) > limiar;
      const sinal = delta > 0 ? "subiu" : "caiu";
      const quanto = rule.thresholdKind === "percentual" ? `${numberBr(Math.abs(Number.isFinite(pct) ? pct : 100))}%` : formatarValor(Math.abs(delta), now.tipo);
      return { verdadeiro: hit, valor: valorTexto, detalhe: `${sinal} ${quanto} desde ${formatarValor(previous.numero, now.tipo)}` };
    }
    case "mudou": {
      if (previous.fingerprint === null) return { verdadeiro: false, valor: valorTexto, detalhe: "sem referência anterior" };
      if (now.numero !== null || now.rotulo !== null) {
        const antes = previous.rows?.[0] ? Object.values(previous.rows[0])[0] ?? null : null;
        const agora = now.rows[0] ? Object.values(now.rows[0])[0] ?? null : null;
        return { verdadeiro: previous.fingerprint !== now.fingerprint, valor: valorTexto, detalhe: antes !== null ? `era ${antes}` : "mudou" };
      }
      const antes = new Set((previous.rows ?? []).map(r => JSON.stringify(r)));
      const novas = now.rows.filter(r => !antes.has(JSON.stringify(r))).length;
      const removidas = (previous.rows ?? []).filter(r => !now.rows.some(n => JSON.stringify(n) === JSON.stringify(r))).length;
      return { verdadeiro: previous.fingerprint !== now.fingerprint, valor: valorTexto, detalhe: novas ? `${novas} linha(s) nova(s)` : removidas ? `${removidas} linha(s) saiu/saíram` : "resultado mudou" };
    }
    default: return { verdadeiro: false, valor: valorTexto, detalhe: "condição desconhecida" };
  }
}
export const CONDITION_LABEL: Record<AlertCondition, string> = { acima: "passar de", abaixo: "ficar abaixo de", variacao: "variar mais de", mudou: "mudar" };
export function descreverRegra(rule: { condition: AlertCondition; threshold: string | null; thresholdKind: "valor" | "percentual" }, tipo: string | null): string {
  const limiar = rule.threshold === null ? null : Number(rule.threshold);
  if (rule.condition === "mudou") return "quando mudar";
  if (limiar === null || !Number.isFinite(limiar)) return `quando ${CONDITION_LABEL[rule.condition]} ?`;
  const q = rule.condition === "variacao" && rule.thresholdKind === "percentual" ? `${numberBr(limiar)}%` : formatarValor(limiar, tipo);
  return `quando ${CONDITION_LABEL[rule.condition]} ${q}`;
}
/** Which conditions make sense for a card: a number card takes all four, anything else only "mudou". */
export const condicoesPossiveis = (fav: Favorito): AlertCondition[] => fav.form === "numero" ? ["acima", "abaixo", "variacao", "mudou"] : ["mudou"];

/* ---------- rules (CRUD, scoped to the running user) ---------- */

export type Aviso = typeof alertsTable.$inferSelect;
const mine = () => { const { companyId, userId } = user(); return and(eq(alertsTable.companyId, companyId), eq(alertsTable.userId, userId)); };
export async function listarAvisos(favoriteId?: number): Promise<Aviso[]> {
  return db.select().from(alertsTable).where(favoriteId ? and(mine(), eq(alertsTable.favoriteId, favoriteId)) : mine()).orderBy(asc(alertsTable.id));
}
export type NovoAviso = { favoritoId: number; condicao: AlertCondition; limiar?: number | null; tipoLimiar?: "valor" | "percentual"; reavisarAposMin?: number };
export async function criarAviso(input: NovoAviso): Promise<Aviso> {
  const { companyId, userId } = user();
  // The favourite must be visible to this person (own or shared with the company); the rule is theirs regardless of who created the card.
  const fav = await pegarFavorito(input.favoritoId);
  if (fav.kind !== "vivo") throw new AvisoError("invalido", "Só favoritos acompanhados (ao vivo) recebem avisos; um valor guardado não muda.");
  if (!condicoesPossiveis(fav).includes(input.condicao)) throw new AvisoError("invalido", "Para este cartão só dá para avisar quando o resultado mudar.");
  const precisaLimiar = input.condicao !== "mudou";
  if (precisaLimiar && (input.limiar === null || input.limiar === undefined || !Number.isFinite(input.limiar))) throw new AvisoError("invalido", "Informe o valor de referência do aviso.");
  const [count] = await db.select({ n: dsql<number>`count(*)::int` }).from(alertsTable).where(mine());
  if ((count?.n ?? 0) >= ALERT_QUOTA) throw new AvisoError("cota", `Você já tem ${ALERT_QUOTA} avisos. Exclua algum para criar outro.`);
  const [row] = await db.insert(alertsTable).values({
    companyId, userId, favoriteId: fav.id, condition: input.condicao, threshold: precisaLimiar ? String(input.limiar) : null,
    thresholdKind: input.condicao === "variacao" ? input.tipoLimiar ?? "percentual" : "valor", remindAfterMin: Math.min(Math.max(input.reavisarAposMin ?? 1440, 15), 7 * 1440),
    valueType: tipoDeclarado(fav),
    // Baseline: the card's last value, so the first check compares against something and a state that already holds now does not fire at creation.
    ...(fav.lastValue !== null ? { lastValue: fav.lastValue, currentState: estadoInicial(input, Number(fav.lastValue)) } : {}),
  }).returning();
  return row!;
}
/** Money/percent declared for the card's single column (when the answer declared formats); otherwise learnt at the first check. */
const tipoDeclarado = (fav: Favorito): string | null => {
  const formats = (fav.formats as Array<{ coluna: string; formato: string }> | null) ?? [];
  if (fav.form !== "numero") return null;
  const f = formats.find(x => x.formato === "dinheiro" || x.formato === "percentual");
  return f?.formato ?? null;
};
const estadoInicial = (input: NovoAviso, valor: number) => Number.isFinite(valor) && input.limiar !== null && input.limiar !== undefined && (input.condicao === "acima" ? valor > input.limiar : input.condicao === "abaixo" ? valor < input.limiar : false);
export async function atualizarAviso(id: number, input: Partial<{ ativo: boolean; limiar: number; reavisarAposMin: number }>): Promise<Aviso> {
  const [current] = await db.select().from(alertsTable).where(and(mine(), eq(alertsTable.id, id))).limit(1);
  if (!current) throw new AvisoError("nao-encontrado", "Aviso não encontrado.");
  const set: Partial<typeof alertsTable.$inferInsert> = {};
  if (input.ativo !== undefined) { set.active = input.ativo; if (input.ativo && !current.active) set.currentState = false; }
  if (input.limiar !== undefined) { if (current.condition === "mudou" || !Number.isFinite(input.limiar)) throw new AvisoError("invalido", "Este aviso não usa valor de referência."); set.threshold = String(input.limiar); set.currentState = false; }
  if (input.reavisarAposMin !== undefined) set.remindAfterMin = Math.min(Math.max(input.reavisarAposMin, 15), 7 * 1440);
  const [row] = await db.update(alertsTable).set(set).where(and(mine(), eq(alertsTable.id, id))).returning();
  return row!;
}
export async function excluirAviso(id: number): Promise<void> {
  const deleted = await db.delete(alertsTable).where(and(mine(), eq(alertsTable.id, id))).returning({ id: alertsTable.id });
  if (!deleted.length) throw new AvisoError("nao-encontrado", "Aviso não encontrado.");
}
export const avisoPublico = (a: Aviso, fav?: Pick<Favorito, "title" | "form"> | null) => ({
  id: a.id, favoritoId: a.favoriteId, favoritoTitulo: fav?.title ?? null, condicao: a.condition, limiar: a.threshold === null ? null : Number(a.threshold), tipoLimiar: a.thresholdKind,
  descricao: descreverRegra(a, a.valueType), ativo: a.active, estadoAtual: a.currentState, ultimoValor: a.lastValue, ultimaVerificacao: a.lastCheckedAt?.toISOString() ?? null,
  ultimoDisparo: a.lastFiredAt?.toISOString() ?? null, reavisarAposMin: a.remindAfterMin, ultimoErro: a.lastError, criadoEm: a.createdAt.toISOString(),
});

/* ---------- preferences ---------- */

export type Configuracao = { silencioAtivo: boolean; silencioInicio: number; silencioFim: number };
const DEFAULT_CONFIG: Configuracao = { silencioAtivo: true, silencioInicio: 22, silencioFim: 7 };
export async function configuracaoDe(userId: number): Promise<Configuracao> {
  const [row] = await db.select().from(alertSettingsTable).where(eq(alertSettingsTable.userId, userId)).limit(1);
  return row ? { silencioAtivo: row.quietEnabled, silencioInicio: row.quietStartHour, silencioFim: row.quietEndHour } : DEFAULT_CONFIG;
}
export async function definirConfiguracao(input: Partial<Configuracao>): Promise<Configuracao> {
  const { companyId, userId } = user();
  const current = await configuracaoDe(userId);
  const next = { ...current, ...input };
  for (const h of [next.silencioInicio, next.silencioFim]) if (!Number.isInteger(h) || h < 0 || h > 23) throw new AvisoError("invalido", "Horas entre 0 e 23.");
  await db.insert(alertSettingsTable).values({ userId, companyId, quietEnabled: next.silencioAtivo, quietStartHour: next.silencioInicio, quietEndHour: next.silencioFim, updatedAt: new Date() })
    .onConflictDoUpdate({ target: alertSettingsTable.userId, set: { quietEnabled: next.silencioAtivo, quietStartHour: next.silencioInicio, quietEndHour: next.silencioFim, updatedAt: new Date() } });
  return next;
}
const hourIn = (now: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now));
/** Quiet hours wrap midnight (22 → 7). Equal start and end means a whole day of silence. */
export function emSilencio(cfg: Configuracao, now: Date): boolean {
  if (!cfg.silencioAtivo) return false;
  const h = hourIn(now);
  return cfg.silencioInicio <= cfg.silencioFim ? h >= cfg.silencioInicio && h < cfg.silencioFim || cfg.silencioInicio === cfg.silencioFim : h >= cfg.silencioInicio || h < cfg.silencioFim;
}

/* ---------- inbox ---------- */

export type Notificacao = typeof notificationsTable.$inferSelect;
const startOfDay = (now: Date) => { const d = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); return new Date(`${d}T00:00:00-03:00`); };
export async function listarNotificacoes(limit = 50): Promise<{ itens: Notificacao[]; naoLidas: number }> {
  const { companyId, userId } = user();
  return listarNotificacoesDe(userId, companyId, limit);
}
/** The inbox of one person. The owner has no company (null); everyone else is also scoped by the company of the session. */
export async function listarNotificacoesDe(userId: number, companyId: number | null, limit = 50): Promise<{ itens: Notificacao[]; naoLidas: number }> {
  const where = and(companyId === null ? isNull(notificationsTable.companyId) : eq(notificationsTable.companyId, companyId), eq(notificationsTable.userId, userId));
  const itens = await db.select().from(notificationsTable).where(where).orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id)).limit(limit);
  const [c] = await db.select({ n: dsql<number>`count(*)::int` }).from(notificationsTable).where(and(where, isNull(notificationsTable.readAt)));
  return { itens, naoLidas: c?.n ?? 0 };
}
export async function marcarLidas(ids: number[] | "todas"): Promise<number> {
  const { companyId, userId } = user();
  return marcarLidasDe(userId, companyId, ids);
}
export async function marcarLidasDe(userId: number, companyId: number | null, ids: number[] | "todas"): Promise<number> {
  const where = and(companyId === null ? isNull(notificationsTable.companyId) : eq(notificationsTable.companyId, companyId), eq(notificationsTable.userId, userId), isNull(notificationsTable.readAt), ...(ids === "todas" ? [] : [inArray(notificationsTable.id, ids)]));
  const rows = await db.update(notificationsTable).set({ readAt: new Date() }).where(where).returning({ id: notificationsTable.id });
  return rows.length;
}
export const notificacaoPublica = (n: Notificacao) => ({
  id: n.id, tipo: n.kind, avisoId: n.alertId, favoritoId: n.favoriteId, titulo: n.title, mensagem: n.message, valor: n.value, condicao: n.conditionText, quantidade: n.count,
  empurrada: n.pushed, criadaEm: n.createdAt.toISOString(), lidaEm: n.readAt?.toISOString() ?? null,
});

/**
 * Puts a notice in the person's inbox and pushes it when allowed. Past the daily cap, notices fold into one summary row
 * for the day ("N avisos novos") that is pushed once; the full list stays available in the app.
 */
async function notificar(input: { companyId: number; userId: number; alertId: number; favoriteId: number; title: string; value: string; conditionText: string; now: Date }, deps: Deps): Promise<Notificacao> {
  const since = startOfDay(input.now);
  const [count] = await db.select({ n: dsql<number>`count(*)::int` }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, input.userId), eq(notificationsTable.kind, "aviso"), gte(notificationsTable.createdAt, since)));
  const cfg = await configuracaoDe(input.userId);
  const quiet = emSilencio(cfg, input.now);
  const message = `${input.title}: ${input.value} (${input.conditionText})`;
  if ((count?.n ?? 0) >= DAILY_NOTICE_CAP) {
    const [summary] = await db.select().from(notificationsTable).where(and(eq(notificationsTable.userId, input.userId), eq(notificationsTable.kind, "resumo"), gte(notificationsTable.createdAt, since))).limit(1);
    const n = (summary?.count ?? 0) + 1;
    const text = `${n} aviso${n > 1 ? "s" : ""} novo${n > 1 ? "s" : ""} além dos ${DAILY_NOTICE_CAP} de hoje. Abra o app para ver todos.`;
    let row: Notificacao;
    if (summary) [row] = await db.update(notificationsTable).set({ count: n, message: text, readAt: null, createdAt: input.now }).where(eq(notificationsTable.id, summary.id)).returning() as [Notificacao];
    else [row] = await db.insert(notificationsTable).values({ companyId: input.companyId, userId: input.userId, kind: "resumo", title: "Avisos agrupados", message: text, count: 1, createdAt: input.now, pushSkippedReason: quiet ? "silencio" : null }).returning() as [Notificacao];
    // One push for the summary (when it is created), none afterwards: the person is not flooded.
    if (!summary && !quiet) await empurrar(input.userId, { title: "Tato · avisos agrupados", body: text, url: "/avisos" }, row.id, deps);
    // A notice beyond the cap is still recorded (unpushed) so the list in the app is complete.
    await db.insert(notificationsTable).values({ companyId: input.companyId, userId: input.userId, alertId: input.alertId, favoriteId: input.favoriteId, kind: "aviso", title: input.title, message, value: input.value, conditionText: input.conditionText, createdAt: input.now, pushSkippedReason: "limite-diario" });
    return row;
  }
  const [row] = await db.insert(notificationsTable).values({
    companyId: input.companyId, userId: input.userId, alertId: input.alertId, favoriteId: input.favoriteId, kind: "aviso", title: input.title, message, value: input.value, conditionText: input.conditionText,
    createdAt: input.now, pushSkippedReason: quiet ? "silencio" : null,
  }).returning();
  if (!quiet) await empurrar(input.userId, { title: `Tato · ${input.title}`, body: `${input.value} (${input.conditionText})`, url: `/favoritos?aviso=${row!.id}` }, row!.id, deps);
  return row!;
}
export async function empurrar(userId: number, payload: { title: string; body: string; url: string }, notificationId: number, deps: Deps) {
  const send = deps.push ?? enviarPush;
  const subs = await db.select().from(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.userId, userId));
  let delivered = 0;
  for (const sub of subs) {
    const r = await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload);
    if (r.ok) { delivered++; await db.update(pushSubscriptionsTable).set({ lastUsedAt: new Date(), lastError: null }).where(eq(pushSubscriptionsTable.id, sub.id)); }
    else if (r.gone) await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, sub.id));
    else await db.update(pushSubscriptionsTable).set({ lastError: r.error ?? "falha" }).where(eq(pushSubscriptionsTable.id, sub.id));
  }
  if (delivered) await db.update(notificationsTable).set({ pushed: true }).where(eq(notificationsTable.id, notificationId));
  else if (!subs.length) await db.update(notificationsTable).set({ pushSkippedReason: "sem-assinatura" }).where(eq(notificationsTable.id, notificationId));
}

/* ---------- checking ---------- */

export type PushResult = { ok: boolean; gone?: boolean; error?: string };
export type Deps = {
  now?: () => Date;
  /** Runs a favourite inside the given tenant (tests inject results; production runs executarFavorito). */
  executar?: (fav: Favorito) => ReturnType<typeof executarFavorito>;
  marcador?: () => ReturnType<typeof marcadorDados>;
  push?: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: { title: string; body: string; url: string }) => Promise<PushResult>;
};
export type Verificacao = { empresaId: number; marcador: string | null; verificados: number; disparados: number; pulado?: "sem-marcador-novo" | "sem-avisos" };

/** Last marker seen per company (process memory): the first check after a start evaluates against the stored per-rule values. */
const lastSeen = new Map<number, string | null>();
export const _limparVerificacoes = () => lastSeen.clear();

async function tenantDe(companyId: number, userId: number, role: Tenant["role"]): Promise<Tenant> {
  const base: Tenant = { companyId, userId, role };
  return companyId === 1 ? base : { ...base, data: await loadCompanyData(companyId) };
}

/**
 * Checks every active rule of one company. Each favourite runs once (first rule owner's permissions; the per-marker cache
 * serves the others), rules are evaluated against their own previous observation, and transitions become notices.
 */
export async function verificarAvisosDaEmpresa(companyId: number, deps: Deps = {}, opts: { force?: boolean } = {}): Promise<Verificacao> {
  const now = deps.now?.() ?? new Date();
  const rules = await db.select({ aviso: alertsTable, fav: favoritesTable, ativo: usersTable.active, papel: usersTable.role })
    .from(alertsTable).innerJoin(favoritesTable, eq(favoritesTable.id, alertsTable.favoriteId)).innerJoin(usersTable, eq(usersTable.id, alertsTable.userId))
    .where(and(eq(alertsTable.companyId, companyId), eq(alertsTable.active, true), eq(favoritesTable.kind, "vivo")));
  // A deactivated person's rules are dropped: nobody should keep evaluating data on their behalf.
  const inativos = rules.filter(r => !r.ativo).map(r => r.aviso.id);
  if (inativos.length) await db.delete(alertsTable).where(inArray(alertsTable.id, inativos));
  const active = rules.filter(r => r.ativo);
  if (!active.length) return { empresaId: companyId, marcador: null, verificados: 0, disparados: 0, pulado: "sem-avisos" };
  const first = active[0]!;
  const probeTenant = await tenantDe(companyId, first.aviso.userId, first.papel as Tenant["role"]);
  const marcador = await runAsTenant(probeTenant, () => (deps.marcador ?? marcadorDados)(now));
  const seen = lastSeen.get(companyId);
  if (!opts.force && lastSeen.has(companyId) && seen === marcador.marcador) return { empresaId: companyId, marcador: marcador.marcador, verificados: 0, disparados: 0, pulado: "sem-marcador-novo" };
  lastSeen.set(companyId, marcador.marcador);
  const byFav = new Map<number, typeof active>();
  for (const r of active) byFav.set(r.fav.id, [...(byFav.get(r.fav.id) ?? []), r]);
  let verificados = 0, disparados = 0;
  for (const [, group] of byFav) {
    const owner = group[0]!;
    const tenant = await tenantDe(companyId, owner.aviso.userId, owner.papel as Tenant["role"]);
    const run = await runAsTenant(tenant, () => (deps.executar ?? (f => executarFavorito(f)))(owner.fav)).catch(e => ({ estado: "refazer" as const, erro: e instanceof Error ? e.message : "falha" }));
    for (const r of group) {
      verificados++;
      if (run.estado !== "ok") { await db.update(alertsTable).set({ lastError: run.erro, lastCheckedAt: now, lastMarker: marcador.marcador }).where(eq(alertsTable.id, r.aviso.id)); continue; }
      const obs = observar(run.resultado);
      const previous = { numero: r.aviso.lastValue === null ? null : Number(r.aviso.lastValue), fingerprint: r.aviso.lastRows ? createHash("sha256").update(JSON.stringify(r.aviso.lastRows)).digest("hex").slice(0, 32) : null, rows: r.aviso.lastRows as Array<Record<string, string | null>> | null };
      const evalResult = avaliar(r.aviso, obs, previous);
      const eventLike = r.aviso.condition === "variacao" || r.aviso.condition === "mudou";
      const remindDue = r.aviso.lastFiredAt ? now.getTime() - r.aviso.lastFiredAt.getTime() >= r.aviso.remindAfterMin * 60_000 : true;
      // State rules fire on false → true (and again after the reminder period while still true); event rules fire on each new change.
      const fire = evalResult.verdadeiro && (eventLike || !r.aviso.currentState || remindDue);
      const set: Partial<typeof alertsTable.$inferInsert> = {
        lastCheckedAt: now, lastMarker: marcador.marcador, lastError: null, currentState: eventLike ? false : evalResult.verdadeiro,
        lastValue: obs.numero !== null ? String(obs.numero) : obs.rotulo, lastRows: obs.rows.slice(0, 200), ...(obs.tipo && obs.tipo !== r.aviso.valueType ? { valueType: obs.tipo } : {}),
      };
      if (fire) { set.lastFiredAt = now; disparados++; await notificar({ companyId, userId: r.aviso.userId, alertId: r.aviso.id, favoriteId: r.fav.id, title: r.fav.title, value: evalResult.valor, conditionText: evalResult.detalhe, now }, deps); }
      await db.update(alertsTable).set(set).where(eq(alertsTable.id, r.aviso.id));
    }
  }
  return { empresaId: companyId, marcador: marcador.marcador, verificados, disparados };
}

/** One scheduler step: every active company that has active rules. Errors of one company never stop the others. */
export async function verificarTodas(deps: Deps = {}): Promise<Verificacao[]> {
  const companies = await db.selectDistinct({ id: alertsTable.companyId }).from(alertsTable).innerJoin(companiesTable, eq(companiesTable.id, alertsTable.companyId)).where(and(eq(alertsTable.active, true), eq(companiesTable.active, true)));
  const out: Verificacao[] = [];
  for (const c of companies) { try { out.push(await verificarAvisosDaEmpresa(c.id, deps)); } catch { /* next company */ } }
  return out;
}
let timer: NodeJS.Timeout | null = null;
export function startAvisos(everyMs = 60_000) {
  if (timer || process.env.AVISOS_AGENDADOR === "off") return;
  timer = setInterval(() => { void verificarTodas().catch(() => undefined); }, everyMs);
  timer.unref();
}
export const estadoDoPush = () => pushDisponivel();
