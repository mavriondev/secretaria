import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { currentCompanyId } from "../lib/tenant";
import { db, pool, queryLogsTable } from "@workspace/db";
import {
  AskAssistantBody, AskAssistantWithAudioBody, AskAssistantResponse, RunConferenceBody,
  RunConferenceResponse, GetDemoStatusResponse, ListQueryLogsQueryParams, ListQueryLogsResponse,
} from "@workspace/api-zod";
import { answerQuestion } from "../lib/assistant";
import { transcribeAudio } from "../lib/elevenlabs";
import { verificarTeto } from "../lib/limite-custo";
import { range } from "../lib/periods";
import { contasAReceberVencidas, faturamento, produtosMaisVendidos } from "../lib/metrics";

import { versaoInstalada } from "../lib/versao";
import { explicarResposta } from "../lib/explicacao";
import { FavoritoError } from "../lib/favoritos";
import { z } from "zod";

export async function erpRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async () => ({ status: "ok", versao: versaoInstalada() }));
  app.get("/demo/status", async (request, reply) => {
    if (request.user?.companyId !== 1) return reply.code(404).send({ error: "Disponível apenas na empresa de demonstração." });
    const { rows } = await pool.query(`SELECT
      (SELECT COUNT(*)::integer FROM "TGFPAR") AS customers,
      (SELECT COUNT(*)::integer FROM "TGFPRO") AS products,
      (SELECT COUNT(*)::integer FROM "TGFVEN") AS salespeople,
      (SELECT COUNT(*)::integer FROM "TGFCAB") AS invoices,
      (SELECT COUNT(*)::integer FROM "TGFITE") AS "invoiceItems",
      (SELECT COUNT(*)::integer FROM "TGFFIN") AS receivables,
      loaded_at AS "lastUpdatedAt" FROM demo_metadata WHERE id = 1`);
    if (!rows[0]) throw new Error("Carregue o seed de demonstração antes de usar o app.");
    return GetDemoStatusResponse.parse({ ...rows[0], lastUpdatedAt: new Date(rows[0].lastUpdatedAt).toISOString() });
  });
  app.post("/assistant/ask", async request => {
    const body = AskAssistantBody.parse(request.body);
    return AskAssistantResponse.parse(await answerQuestion(body));
  });
  app.post("/assistant/audio", async request => {
    const startedAt = Date.now();
    const body = AskAssistantWithAudioBody.parse(request.body);
    // The ceiling is checked before the transcription, which is paid too; a blocked turn then costs nothing at all.
    const teto = await verificarTeto(currentCompanyId());
    if (teto.bloqueado) return AskAssistantResponse.parse(await answerQuestion({ question: "(áudio)", freedomLevel: body.freedomLevel, includeVoice: false }, null, startedAt));
    const transcript = await transcribeAudio(body.audioBase64, body.mimeType);
    return AskAssistantResponse.parse(await answerQuestion({ question: transcript, freedomLevel: body.freedomLevel, includeVoice: body.includeVoice }, transcript, startedAt));
  });
  /** "Como calculei": explanation of one answer, read from its audit log; no model call, SQL only for administrators. */
  app.get("/assistant/respostas/:id/explicacao", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    try { return await explicarResposta(id); }
    catch (error) { if (error instanceof FavoritoError && error.kind === "nao-encontrado") return reply.code(404).send({ error: error.message }); throw error; }
  });
  app.post("/conference", async request => {
    const body = RunConferenceBody.parse(request.body);
    const period = range(body.startDate, body.endDate);
    const results = await Promise.all([
      faturamento(period), contasAReceberVencidas(body.referenceDate), produtosMaisVendidos(period, body.productLimit),
    ]);
    return RunConferenceResponse.parse({ ...body, results });
  });
  app.get("/logs", async request => {
    const params = ListQueryLogsQueryParams.parse(request.query);
    const rows = await db.select().from(queryLogsTable).where(eq(queryLogsTable.companyId, currentCompanyId())).orderBy(desc(queryLogsTable.id)).limit(params.limit ?? 50);
    return ListQueryLogsResponse.parse(rows.map(row => ({
      ...row, createdAt: row.createdAt.toISOString(), estimatedCostUsd: row.estimatedCostUsd == null ? null : Number(row.estimatedCostUsd),
    })));
  });
}
