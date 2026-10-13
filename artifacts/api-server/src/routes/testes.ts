import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { count } from "drizzle-orm";
import { z } from "zod";
import { db, testQuestionsTable, testResultsTable, testRunsTable } from "@workspace/db";
import { closeStaleRuns, MAX_ACTIVE_QUESTIONS, startRun } from "../lib/testes";
import { currentCompanyId, currentTenant } from "../lib/tenant";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const texts = z.array(z.string().trim().min(1).max(200)).max(10);
const body = z.object({ pergunta: z.string().trim().min(3).max(500), deveConter: texts.default([]), naoDeveConter: texts.default([]), nota: z.string().trim().max(300).default(""), ativa: z.boolean().default(true) });
const view = (q: typeof testQuestionsTable.$inferSelect) => ({ id: q.id, pergunta: q.question, deveConter: q.mustContain, naoDeveConter: q.mustNotContain, nota: q.note, ativa: q.active });

/** Test questions with their expected answer, and the runs that check them. A run uses the real assistant, so it has a cost, and starts only on request. */
export async function testesRoutes(app: FastifyInstance) {
  const own = (id: number) => and(eq(testQuestionsTable.id, id), eq(testQuestionsTable.companyId, currentCompanyId()));
  app.get("/testes/perguntas", async () =>
    (await db.select().from(testQuestionsTable).where(eq(testQuestionsTable.companyId, currentCompanyId())).orderBy(testQuestionsTable.id)).map(view));
  app.post("/testes/perguntas", async (request, reply) => {
    const b = body.parse(request.body);
    if (!b.deveConter.length && !b.naoDeveConter.length) return reply.code(400).send({ error: "Informe o que a resposta deve conter (ou não pode conter), senão o teste não verifica nada." });
    const [active] = await db.select({ total: count() }).from(testQuestionsTable).where(and(eq(testQuestionsTable.companyId, currentCompanyId()), eq(testQuestionsTable.active, true)));
    if ((active?.total ?? 0) >= MAX_ACTIVE_QUESTIONS) return reply.code(400).send({ error: `Limite de ${MAX_ACTIVE_QUESTIONS} perguntas ativas atingido.` });
    const [row] = await db.insert(testQuestionsTable).values({ companyId: currentCompanyId(), question: b.pergunta, mustContain: b.deveConter, mustNotContain: b.naoDeveConter, note: b.nota, active: b.ativa }).returning();
    return reply.code(201).send(view(row!));
  });
  app.put("/testes/perguntas/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params); const b = body.parse(request.body);
    if (!b.deveConter.length && !b.naoDeveConter.length) return reply.code(400).send({ error: "Informe o que a resposta deve conter (ou não pode conter)." });
    const [row] = await db.update(testQuestionsTable).set({ question: b.pergunta, mustContain: b.deveConter, mustNotContain: b.naoDeveConter, note: b.nota, active: b.ativa }).where(own(id)).returning();
    return row ? view(row) : reply.code(404).send({ error: "Pergunta não encontrada." });
  });
  app.delete("/testes/perguntas/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    return (await db.delete(testQuestionsTable).where(own(id)).returning({ id: testQuestionsTable.id })).length ? reply.code(204).send() : reply.code(404).send({ error: "Pergunta não encontrada." });
  });
  app.post("/testes/execucoes", async (request, reply) => {
    const tenant = currentTenant();
    if (!tenant) return reply.code(403).send({ error: "Sem empresa." });
    const started = await startRun(tenant);
    return "error" in started ? reply.code(409).send(started) : reply.code(202).send(started);
  });
  app.get("/testes/execucoes", async () => {
    await closeStaleRuns(currentCompanyId());
    return (await db.select().from(testRunsTable).where(eq(testRunsTable.companyId, currentCompanyId())).orderBy(desc(testRunsTable.id)).limit(20)).map(r => ({
      id: r.id, status: r.status, total: r.total, aprovadas: r.passed, reprovadas: r.failed, custoUsd: Number(r.costUsd), iniciadaEm: r.startedAt.toISOString(), concluidaEm: r.finishedAt?.toISOString() ?? null,
    }));
  });
  app.get("/testes/execucoes/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const [run] = await db.select().from(testRunsTable).where(and(eq(testRunsTable.id, id), eq(testRunsTable.companyId, currentCompanyId())));
    if (!run) return reply.code(404).send({ error: "Rodada não encontrada." });
    const results = await db.select().from(testResultsTable).where(eq(testResultsTable.runId, id)).orderBy(testResultsTable.id);
    return {
      id: run.id, status: run.status, total: run.total, aprovadas: run.passed, reprovadas: run.failed, custoUsd: Number(run.costUsd), iniciadaEm: run.startedAt.toISOString(),
      resultados: results.map(r => ({ perguntaId: r.questionId, pergunta: r.question, resposta: r.answer, aprovada: r.passed, motivo: r.reason, latenciaMs: r.latencyMs, custoUsd: r.costUsd === null ? null : Number(r.costUsd), mudou: r.changed })),
    };
  });
}
