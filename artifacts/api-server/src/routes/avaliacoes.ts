import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { answerReviewsTable, db, queryLogsTable } from "@workspace/db";
import { currentCompanyId } from "../lib/tenant";

const STATUS = ["nova", "revisada", "descartada"] as const;
const idParam = z.object({ id: z.coerce.number().int().positive() });

/** Managers flag answers that were wrong; administrators review them. Every query is scoped to the company of the session. */
export async function avaliacoesRoutes(app: FastifyInstance) {
  app.post("/avaliacoes", async (request, reply) => {
    const body = z.object({ logId: z.number().int().positive(), motivo: z.string().trim().max(500).default("") }).parse(request.body);
    const [log] = await db.select({ id: queryLogsTable.id }).from(queryLogsTable).where(and(eq(queryLogsTable.id, body.logId), eq(queryLogsTable.companyId, currentCompanyId())));
    if (!log) return reply.code(404).send({ error: "Resposta não encontrada." });
    const values = { companyId: currentCompanyId(), logId: body.logId, userId: request.user!.id, reason: body.motivo, reasonAt: new Date() };
    // Flagging again by the same person updates the reason and reopens the review.
    await db.insert(answerReviewsTable).values(values).onConflictDoUpdate({
      target: [answerReviewsTable.logId, answerReviewsTable.userId], set: { reason: body.motivo, reasonAt: new Date(), status: "nova", reviewedAt: null },
    });
    return reply.code(201).send({ ok: true });
  });
  app.get("/avaliacoes", async request => {
    const { status } = z.object({ status: z.enum(STATUS).optional() }).parse(request.query);
    const where = and(eq(answerReviewsTable.companyId, currentCompanyId()), status ? eq(answerReviewsTable.status, status) : undefined);
    const rows = await db.select({ review: answerReviewsTable, log: queryLogsTable }).from(answerReviewsTable)
      .leftJoin(queryLogsTable, and(eq(queryLogsTable.id, answerReviewsTable.logId), eq(queryLogsTable.companyId, answerReviewsTable.companyId))).where(where).orderBy(desc(answerReviewsTable.createdAt)).limit(200);
    return rows.map(({ review: r, log }) => {
      const p = (log?.parameters ?? {}) as { _dominio?: string; _metrics?: { fallback?: boolean; chamadas?: number } };
      return {
        id: r.id, logId: r.logId, motivo: r.reason, status: r.status, tratativa: r.resolution, criadaEm: r.createdAt.toISOString(), revisadaEm: r.reviewedAt?.toISOString() ?? null,
        pergunta: log?.question ?? "Resposta removida pela política de retenção.", resposta: log?.answer ?? "", funcao: log?.functionName ?? null, dominio: p._dominio ?? null, fallback: p._metrics?.fallback ?? null,
        latenciaMs: log?.latencyMs ?? null, custoUsd: log?.estimatedCostUsd == null ? null : Number(log.estimatedCostUsd), respondidaEm: log?.createdAt.toISOString() ?? r.createdAt.toISOString(),
      };
    });
  });
  app.patch("/avaliacoes/:id", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ status: z.enum(STATUS), tratativa: z.string().trim().max(1000).default("") }).parse(request.body);
    const [row] = await db.update(answerReviewsTable).set({ status: body.status, resolution: body.tratativa, reviewedAt: body.status === "nova" ? null : new Date() })
      .where(and(eq(answerReviewsTable.id, id), eq(answerReviewsTable.companyId, currentCompanyId()))).returning({ id: answerReviewsTable.id });
    return row ? { ok: true } : reply.code(404).send({ error: "Avaliação não encontrada." });
  });
}
