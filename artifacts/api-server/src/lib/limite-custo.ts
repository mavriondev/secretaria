import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { ceilingEventsTable, companiesTable, costsTable, db, notificationsTable, platformSettingsTable, usersTable, type CostKind } from "@workspace/db";
import { logger } from "./logger";
import { aiConfig } from "./openai-direct";
import { currentTenant } from "./tenant";

/** Share of a ceiling at which the owner and the administrators are warned (once per period). */
export const WARN_AT = 0.8;
const TIME_ZONE = "America/Sao_Paulo";

export type BudgetStatus = { limiteUsd: number | null; usadoUsd: number; percentual: number | null; aviso: boolean; bloqueado: boolean; mesDesde: string };
export type DailyStatus = { limiteUsd: number | null; usadoUsd: number; percentual: number | null; aviso: boolean; bloqueado: boolean; diaDesde: string; padrao: boolean };
export type Motivo = "empresa_mes" | "empresa_dia" | "plataforma_dia";
export type TetoStatus = { mes: BudgetStatus; dia: DailyStatus; plataforma: DailyStatus; bloqueado: boolean; motivo: Motivo | null; mensagem: string | null };

/* ---------- calendar (São Paulo) ---------- */

const ymd = (now: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
/** First instant of the current month in São Paulo: the monthly ceiling renews on day 1 at local midnight. */
export const monthStart = (now = new Date()): Date => {
  const [year, month] = ymd(now).split("-").map(Number) as [number, number];
  // São Paulo has no daylight saving time since 2019, so a fixed -03:00 offset is exact for any date this system will see.
  return new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00-03:00`);
};
/** Local midnight of the current São Paulo day: the daily ceilings turn over there, not at UTC midnight. */
export const dayStart = (now = new Date()): Date => new Date(`${ymd(now)}T00:00:00-03:00`);
export const dayKey = (now = new Date()): string => ymd(now);
export const monthKey = (now = new Date()): string => ymd(now).slice(0, 7);

/* ---------- prices (estimates, configurable per deployment) ---------- */

export const precos = {
  /** ElevenLabs text-to-speech, US$ per 1 000 characters sent (billed on characters, interrupted or not). */
  vozUsdPor1kCaracteres: Number(process.env.ELEVENLABS_TTS_USD_PER_1K_CHARS ?? 0.15),
  /** ElevenLabs Scribe, US$ per hour of audio. */
  transcricaoUsdPorHora: Number(process.env.ELEVENLABS_STT_USD_PER_HOUR ?? 0.4),
};
export const custoTexto = (inputTokens: number, outputTokens: number): number => (inputTokens * aiConfig.inputUsdPerMillion + outputTokens * aiConfig.outputUsdPerMillion) / 1_000_000;
export const custoVoz = (caracteres: number): number => (caracteres / 1000) * precos.vozUsdPor1kCaracteres;
export const custoTranscricao = (segundos: number): number => (segundos / 3600) * precos.transcricaoUsdPorHora;

/* ---------- owner settings ---------- */

export const CONFIG_PADRAO = {
  /** Daily ceiling of the whole platform, all companies added up. */
  teto_diario_plataforma_usd: 25,
  /** Daily ceiling of a company that has neither its own daily ceiling nor a monthly one. */
  teto_diario_empresa_padrao_usd: 2,
} as const;
export type ConfigChave = keyof typeof CONFIG_PADRAO;
/** A company's default daily ceiling is a tenth of the monthly one, but never below this. */
export const MINIMO_DIARIO_USD = 0.5;

export async function lerConfiguracao(): Promise<Record<ConfigChave, number>> {
  const rows = await db.select().from(platformSettingsTable);
  const out = { ...CONFIG_PADRAO } as Record<ConfigChave, number>;
  for (const r of rows) {
    if (r.key in CONFIG_PADRAO) { const v = Number(r.value); if (Number.isFinite(v) && v >= 0) out[r.key as ConfigChave] = v; }
  }
  return out;
}
export async function gravarConfiguracao(values: Partial<Record<ConfigChave, number>>): Promise<Record<ConfigChave, number>> {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in CONFIG_PADRAO) || typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Configuração inválida: ${key}.`);
    await db.insert(platformSettingsTable).values({ key, value: value.toFixed(4), updatedAt: new Date() })
      .onConflictDoUpdate({ target: platformSettingsTable.key, set: { value: value.toFixed(4), updatedAt: new Date() } });
  }
  return lerConfiguracao();
}

/** Effective daily ceiling of a company: its own value, else a tenth of the monthly one (at least the minimum), else the platform default. */
export function tetoDiarioEfetivo(company: { monthlyLimitUsd: string | null; dailyLimitUsd: string | null }, padraoUsd: number): { limiteUsd: number; padrao: boolean } {
  if (company.dailyLimitUsd != null) return { limiteUsd: Number(company.dailyLimitUsd), padrao: false };
  if (company.monthlyLimitUsd != null) return { limiteUsd: Math.max(Number(company.monthlyLimitUsd) / 10, MINIMO_DIARIO_USD), padrao: true };
  return { limiteUsd: padraoUsd, padrao: true };
}

/* ---------- status ---------- */

export const evaluateBudget = (limiteUsd: number | null, usadoUsd: number, since: Date): BudgetStatus => {
  const percentual = limiteUsd && limiteUsd > 0 ? usadoUsd / limiteUsd : null;
  return { limiteUsd, usadoUsd, percentual, aviso: percentual !== null && percentual >= WARN_AT - 1e-9, bloqueado: limiteUsd !== null && usadoUsd >= limiteUsd, mesDesde: since.toISOString() };
};
const evaluateDay = (limiteUsd: number | null, usadoUsd: number, since: Date, padrao: boolean): DailyStatus => {
  const b = evaluateBudget(limiteUsd, usadoUsd, since);
  return { limiteUsd: b.limiteUsd, usadoUsd: b.usadoUsd, percentual: b.percentual, aviso: b.aviso, bloqueado: b.bloqueado, diaDesde: since.toISOString(), padrao };
};

const somaDesde = async (since: Date, companyId?: number): Promise<number> => {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${costsTable.costUsd}), 0)` }).from(costsTable)
    .where(companyId === undefined ? gte(costsTable.createdAt, since) : and(eq(costsTable.companyId, companyId), gte(costsTable.createdAt, since)));
  return Number(row?.total ?? 0);
};

/** What the company has spent this month on every paid call, against its monthly ceiling. */
export async function budgetStatus(companyId: number, now = new Date()): Promise<BudgetStatus> {
  const since = monthStart(now);
  const [company] = await db.select({ limit: companiesTable.monthlyLimitUsd }).from(companiesTable).where(eq(companiesTable.id, companyId));
  return evaluateBudget(company?.limit == null ? null : Number(company.limit), await somaDesde(since, companyId), since);
}

/** Month, day and platform-day in one reading; `bloqueado` is true when any of the three is reached. */
export async function statusDosTetos(companyId: number, now = new Date()): Promise<TetoStatus> {
  const config = await lerConfiguracao();
  const [company] = await db.select({ monthlyLimitUsd: companiesTable.monthlyLimitUsd, dailyLimitUsd: companiesTable.dailyLimitUsd }).from(companiesTable).where(eq(companiesTable.id, companyId));
  const mesDesde = monthStart(now), diaDesde = dayStart(now);
  const [usadoMes, usadoDia, usadoPlataforma] = await Promise.all([somaDesde(mesDesde, companyId), somaDesde(diaDesde, companyId), somaDesde(diaDesde)]);
  const mes = evaluateBudget(company?.monthlyLimitUsd == null ? null : Number(company.monthlyLimitUsd), usadoMes, mesDesde);
  const diario = company ? tetoDiarioEfetivo(company, config.teto_diario_empresa_padrao_usd) : { limiteUsd: config.teto_diario_empresa_padrao_usd, padrao: true };
  const dia = evaluateDay(diario.limiteUsd, usadoDia, diaDesde, diario.padrao);
  const plataforma = evaluateDay(config.teto_diario_plataforma_usd, usadoPlataforma, diaDesde, false);
  const motivo: Motivo | null = mes.bloqueado ? "empresa_mes" : dia.bloqueado ? "empresa_dia" : plataforma.bloqueado ? "plataforma_dia" : null;
  return { mes, dia, plataforma, bloqueado: motivo !== null, motivo, mensagem: motivo ? mensagens[motivo] : null };
}

/** Short, plain sentences for the manager; nothing is invented when a ceiling is reached. */
export const mensagens: Record<Motivo, string> = {
  empresa_mes: "O limite de uso deste mês foi atingido, então não consigo responder agora. Fale com o responsável pela sua conta para liberar mais consultas.",
  empresa_dia: "Atingimos o limite de uso de hoje. Volte amanhã ou fale com o administrador.",
  plataforma_dia: "O serviço atingiu o limite de uso de hoje. Tente amanhã ou fale com o administrador.",
};
export const blockedMessage = mensagens.empresa_mes;

/**
 * The gate every paid path calls before spending. When blocked, the "100 %" event of that scope is recorded once
 * (so the warning is also sent when a ceiling was lowered below what was already spent).
 */
export async function verificarTeto(companyId: number, now = new Date()): Promise<{ bloqueado: boolean; motivo: Motivo | null; mensagem: string | null }> {
  const status = await statusDosTetos(companyId, now);
  if (status.bloqueado) await registrarEventos(companyId, status, now).catch(error => logger.warn({ err: error }, "Não foi possível registrar o evento de teto"));
  return { bloqueado: status.bloqueado, motivo: status.motivo, mensagem: status.mensagem };
}

/* ---------- ledger ---------- */

export type NovoCusto = {
  companyId?: number; userId?: number | null; tipo: CostKind; provedor: string; modelo?: string | null;
  quantidade: number; unidade: "tokens" | "caracteres" | "segundos"; custoUsd: number; queryLogId?: number | null; now?: Date;
};

/**
 * Records one paid call in the ledger and, right after, checks whether a ceiling crossed 80 % or 100 %.
 * Never throws into the caller's path: a failure to account must not lose an answer that was already produced.
 */
export async function registrarCusto(input: NovoCusto): Promise<void> {
  const tenant = currentTenant();
  const companyId = input.companyId ?? tenant?.companyId;
  if (!companyId) { logger.warn({ tipo: input.tipo }, "Custo sem empresa; não registrado"); return; }
  if (!Number.isFinite(input.custoUsd) || input.custoUsd < 0) return;
  try {
    await db.insert(costsTable).values({
      companyId, userId: input.userId === undefined ? tenant?.userId || null : input.userId, kind: input.tipo, provider: input.provedor, model: input.modelo ?? null,
      quantity: input.quantidade.toFixed(3), unit: input.unidade, costUsd: input.custoUsd.toFixed(8), queryLogId: input.queryLogId ?? null, createdAt: input.now ?? new Date(),
    });
    if (input.custoUsd > 0) await registrarEventos(companyId, await statusDosTetos(companyId, input.now), input.now ?? new Date());
  } catch (error) {
    logger.warn({ err: error, tipo: input.tipo }, "Não foi possível registrar o custo");
  }
}

/* ---------- events (80 % / block), once per scope and period ---------- */

export type EventoTeto = { id: number; empresaId: number; escopo: string; periodo: string; nivel: number; usadoUsd: number; limiteUsd: number; disparadoPor: number | null; criadoEm: string };
const titulos: Record<Motivo, string> = { empresa_mes: "Limite mensal", empresa_dia: "Limite de hoje", plataforma_dia: "Limite de hoje da plataforma" };

async function registrarEventos(companyId: number, status: TetoStatus, now: Date) {
  const checks: Array<{ escopo: Motivo; s: BudgetStatus | DailyStatus; periodo: string; empresaId: number }> = [
    { escopo: "empresa_mes", s: status.mes, periodo: monthKey(now), empresaId: companyId },
    { escopo: "empresa_dia", s: status.dia, periodo: dayKey(now), empresaId: companyId },
    { escopo: "plataforma_dia", s: status.plataforma, periodo: dayKey(now), empresaId: 0 },
  ];
  for (const c of checks) {
    if (c.s.limiteUsd === null) continue;
    for (const nivel of [80, 100] as const) {
      if (nivel === 80 ? !c.s.aviso : !c.s.bloqueado) continue;
      const inserted = await db.insert(ceilingEventsTable).values({
        companyId: c.empresaId, scope: c.escopo, period: c.periodo, level: nivel, usedUsd: c.s.usadoUsd.toFixed(8), limitUsd: c.s.limiteUsd.toFixed(2),
        triggeredBy: c.empresaId === 0 ? companyId : null, createdAt: now,
      }).onConflictDoNothing().returning({ id: ceilingEventsTable.id });
      if (inserted.length) await avisarAdministradores(companyId, c.escopo, nivel, c.s.usadoUsd, c.s.limiteUsd, now);
    }
  }
}

/** The company's administrators get one inbox notice per event; the owner reads the same events in the usage panel. */
async function avisarAdministradores(companyId: number, escopo: Motivo, nivel: 80 | 100, usadoUsd: number, limiteUsd: number, now: Date) {
  const admins = await db.select({ id: usersTable.id }).from(usersTable).where(and(eq(usersTable.companyId, companyId), eq(usersTable.role, "administrador"), eq(usersTable.active, true)));
  if (!admins.length) return;
  const fmt = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;
  const title = nivel === 100 ? `${titulos[escopo]} atingido` : `${titulos[escopo]} a 80 %`;
  const message = nivel === 100
    ? (escopo === "plataforma_dia" ? "O serviço inteiro chegou ao teto de hoje; as perguntas com IA ficam pausadas até amanhã." : escopo === "empresa_dia" ? "As perguntas com IA desta empresa ficam pausadas até amanhã. Favoritos e listas continuam funcionando." : "As perguntas com IA desta empresa ficam pausadas até o próximo mês. Favoritos e listas continuam funcionando.")
    : "O uso chegou a 80 % do teto. Se continuar nesse ritmo, as perguntas com IA serão pausadas ao atingir o limite.";
  await db.insert(notificationsTable).values(admins.map(a => ({
    companyId, userId: a.id, kind: "sistema" as const, title, message, value: `${fmt(usadoUsd)} de ${fmt(limiteUsd)}`,
    conditionText: nivel === 100 ? "bloqueado" : "80 % do limite", createdAt: now, pushSkippedReason: "sistema",
  })));
}

/** Latest events for the owner's panel (all companies) or for one company. */
export async function eventosRecentes(limit = 20, companyId?: number): Promise<EventoTeto[]> {
  const rows = await db.select().from(ceilingEventsTable)
    .where(companyId === undefined ? undefined : inArray(ceilingEventsTable.companyId, [companyId, 0]))
    .orderBy(desc(ceilingEventsTable.createdAt), desc(ceilingEventsTable.id)).limit(limit);
  return rows.map(r => ({ id: r.id, empresaId: r.companyId, escopo: r.scope, periodo: r.period, nivel: r.level, usadoUsd: Number(r.usedUsd), limiteUsd: Number(r.limitUsd), disparadoPor: r.triggeredBy, criadoEm: r.createdAt.toISOString() }));
}

/** Spend per kind since an instant, for one company or for all. */
export async function gastoPorTipo(since: Date, companyId?: number): Promise<Record<CostKind, number> & { total: number }> {
  const rows = await db.select({ kind: costsTable.kind, total: sql<string>`coalesce(sum(${costsTable.costUsd}), 0)` }).from(costsTable)
    .where(companyId === undefined ? gte(costsTable.createdAt, since) : and(eq(costsTable.companyId, companyId), gte(costsTable.createdAt, since))).groupBy(costsTable.kind);
  const out = { texto: 0, voz: 0, transcricao: 0, reescrita: 0, implantacao: 0, total: 0 };
  for (const r of rows) { const v = Number(r.total); out[r.kind] = v; out.total += v; }
  return out;
}
