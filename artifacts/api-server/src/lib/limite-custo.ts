import { and, eq, gte, sql } from "drizzle-orm";
import { companiesTable, db, queryLogsTable } from "@workspace/db";

/** Share of the monthly ceiling at which managers and the owner start to be warned. */
export const WARN_AT = 0.8;
const TIME_ZONE = "America/Sao_Paulo";

export type BudgetStatus = { limiteUsd: number | null; usadoUsd: number; percentual: number | null; aviso: boolean; bloqueado: boolean; mesDesde: string };

/** First instant of the current month in the company's time zone: the ceiling renews on day 1 at local midnight. */
export const monthStart = (now = new Date()): Date => {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit" }).format(now).split("-").map(Number) as [number, number];
  // São Paulo has no daylight saving time since 2019, so a fixed -03:00 offset is exact for any date this system will see.
  return new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00-03:00`);
};

export const evaluateBudget = (limiteUsd: number | null, usadoUsd: number, since: Date): BudgetStatus => {
  const percentual = limiteUsd && limiteUsd > 0 ? usadoUsd / limiteUsd : null;
  return { limiteUsd, usadoUsd, percentual, aviso: percentual !== null && percentual >= WARN_AT - 1e-9, bloqueado: limiteUsd !== null && usadoUsd >= limiteUsd, mesDesde: since.toISOString() };
};

/** What the company has spent this month on answers (text model, as measured per turn) against its ceiling. */
export async function budgetStatus(companyId: number, now = new Date()): Promise<BudgetStatus> {
  const since = monthStart(now);
  const [company] = await db.select({ limit: companiesTable.monthlyLimitUsd }).from(companiesTable).where(eq(companiesTable.id, companyId));
  const [used] = await db.select({ total: sql<string>`coalesce(sum(${queryLogsTable.estimatedCostUsd}), 0)` }).from(queryLogsTable)
    .where(and(eq(queryLogsTable.companyId, companyId), gte(queryLogsTable.createdAt, since)));
  return evaluateBudget(company?.limit == null ? null : Number(company.limit), Number(used?.total ?? 0), since);
}

export const blockedMessage = "O limite de uso deste mês foi atingido, então não consigo responder agora. Fale com o responsável pela sua conta para liberar mais consultas.";
