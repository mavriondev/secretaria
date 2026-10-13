import { and, desc, eq, lt } from "drizzle-orm";
import { db, queryLogsTable, testQuestionsTable, testResultsTable, testRunsTable } from "@workspace/db";
import { answerQuestion } from "./assistant";
import { runAsTenant, type Tenant } from "./tenant";

export const MAX_ACTIVE_QUESTIONS = 100;
export const STALE_RUN_MINUTES = 30;
const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** A question passes when every expected text appears in the answer and no forbidden text does. Accents and case are ignored; numbers must match as the answer writes them. */
export function judge(answer: string, mustContain: string[], mustNotContain: string[]): { passed: boolean; reason: string } {
  const text = normalize(answer);
  const missing = mustContain.filter(s => s.trim() && !text.includes(normalize(s)));
  const forbidden = mustNotContain.filter(s => s.trim() && text.includes(normalize(s)));
  const reasons = [...missing.map(s => `faltou "${s}"`), ...forbidden.map(s => `apareceu "${s}"`)];
  return { passed: reasons.length === 0, reason: reasons.join("; ") };
}

export type Answerer = (question: string) => Promise<{ answer: string; latencyMs: number; logId: number | null }>;
/** Real answerer: the same path a manager's question takes, at the balanced level, without voice. */
export const realAnswerer: Answerer = async question => {
  const r = await answerQuestion({ question, freedomLevel: 1, includeVoice: false });
  return { answer: r.answer, latencyMs: r.latencyMs, logId: r.id };
};

/** Runs are closed by whoever reads them if the server restarted in the middle. */
export async function closeStaleRuns(companyId: number) {
  const limit = new Date(Date.now() - STALE_RUN_MINUTES * 60_000);
  await db.update(testRunsTable).set({ status: "interrompida", finishedAt: new Date() })
    .where(and(eq(testRunsTable.companyId, companyId), eq(testRunsTable.status, "executando"), lt(testRunsTable.startedAt, limit)));
}

export async function startRun(tenant: Tenant, answerer: Answerer = realAnswerer): Promise<{ runId: number } | { error: string }> {
  await closeStaleRuns(tenant.companyId);
  const [running] = await db.select({ id: testRunsTable.id }).from(testRunsTable).where(and(eq(testRunsTable.companyId, tenant.companyId), eq(testRunsTable.status, "executando"))).limit(1);
  if (running) return { error: "Já existe uma rodada em andamento. Aguarde terminar." };
  const questions = await db.select().from(testQuestionsTable).where(and(eq(testQuestionsTable.companyId, tenant.companyId), eq(testQuestionsTable.active, true))).orderBy(testQuestionsTable.id);
  if (!questions.length) return { error: "Cadastre ao menos uma pergunta ativa." };
  const [run] = await db.insert(testRunsTable).values({ companyId: tenant.companyId, userId: tenant.userId, total: questions.length }).returning();
  // Runs in the background in the tenant of whoever started it; progress is written as it goes.
  void runAsTenant(tenant, () => execute(run!.id, tenant.companyId, questions, answerer)).catch(async () => {
    await db.update(testRunsTable).set({ status: "interrompida", finishedAt: new Date() }).where(eq(testRunsTable.id, run!.id));
  });
  return { runId: run!.id };
}

async function execute(runId: number, companyId: number, questions: Array<typeof testQuestionsTable.$inferSelect>, answerer: Answerer) {
  let passed = 0, failed = 0, cost = 0;
  for (const q of questions) {
    const [previous] = await db.select({ passed: testResultsTable.passed }).from(testResultsTable).where(eq(testResultsTable.questionId, q.id)).orderBy(desc(testResultsTable.id)).limit(1);
    let answer = "", latencyMs: number | null = null, verdict: { passed: boolean; reason: string }, logId: number | null = null;
    try {
      const r = await answerer(q.question);
      answer = r.answer; latencyMs = r.latencyMs; logId = r.logId;
      verdict = judge(answer, q.mustContain, q.mustNotContain);
    } catch (error) {
      verdict = { passed: false, reason: `a pergunta falhou: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}` };
    }
    let questionCost: number | null = null;
    if (logId) {
      const [log] = await db.select({ cost: queryLogsTable.estimatedCostUsd }).from(queryLogsTable).where(and(eq(queryLogsTable.id, logId), eq(queryLogsTable.companyId, companyId)));
      questionCost = log?.cost == null ? null : Number(log.cost);
    }
    cost += questionCost ?? 0;
    if (verdict.passed) passed++; else failed++;
    await db.insert(testResultsTable).values({ runId, questionId: q.id, question: q.question, answer, passed: verdict.passed, reason: verdict.reason, latencyMs,
      costUsd: questionCost === null ? null : questionCost.toFixed(8), changed: previous !== undefined && previous.passed !== verdict.passed });
    await db.update(testRunsTable).set({ passed, failed, costUsd: cost.toFixed(8) }).where(eq(testRunsTable.id, runId));
  }
  await db.update(testRunsTable).set({ status: "concluida", finishedAt: new Date() }).where(eq(testRunsTable.id, runId));
}
