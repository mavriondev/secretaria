import type { FastifyInstance } from "fastify";
import { desc } from "drizzle-orm";
import { db, pool, queryLogsTable } from "@workspace/db";
import {
  AskAssistantBody, AskAssistantWithAudioBody, AskAssistantResponse, RunConferenceBody,
  RunConferenceResponse, GetDemoStatusResponse, ListQueryLogsQueryParams, ListQueryLogsResponse,
} from "@workspace/api-zod";
import { answerQuestion } from "../lib/assistant";
import { transcribeAudio } from "../lib/elevenlabs";
import { range } from "../lib/periods";
import { contasAReceberVencidas, faturamento, produtosMaisVendidos } from "../lib/metrics";

export async function erpRoutes(app: FastifyInstance): Promise<void> {
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/demo/status", async () => {
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
    const transcript = await transcribeAudio(body.audioBase64, body.mimeType);
    return AskAssistantResponse.parse(await answerQuestion({ question: transcript, freedomLevel: body.freedomLevel, includeVoice: body.includeVoice }, transcript, startedAt));
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
    const rows = await db.select().from(queryLogsTable).orderBy(desc(queryLogsTable.id)).limit(params.limit ?? 50);
    return ListQueryLogsResponse.parse(rows.map(row => ({
      ...row, createdAt: row.createdAt.toISOString(), estimatedCostUsd: row.estimatedCostUsd == null ? null : Number(row.estimatedCostUsd),
    })));
  });
}
