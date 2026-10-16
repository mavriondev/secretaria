import type { FastifyInstance } from "fastify";
import { AMBIENTE_NIVEIS, db, assistantSettingsTable, ENVIO_MODOS, exportDocumentsTable, voicePreferencesTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { CreateExportDocumentBody, UpdateAssistantSettingsBody } from "@workspace/api-zod";
import { z } from "zod";
import { currentCompanyId, currentTenant } from "../lib/tenant";
import { getSettings, normalizeName } from "../lib/preferences";
import { createDocument, documentMetadata, findMetricLog, metricCsv } from "../lib/documents";

export async function preferencesRoutes(app: FastifyInstance) {
  app.get("/settings", getSettings);
  app.put("/settings", async request => {
    const data = UpdateAssistantSettingsBody.parse(request.body);
    const settings = { ...data, preferredName: normalizeName(data.preferredName) };
    await db.insert(assistantSettingsTable).values({ id: currentCompanyId(), ...settings })
      .onConflictDoUpdate({ target: assistantSettingsTable.id, set: settings });
    return settings;
  });
  /** Microphone preferences are per person (not per company): how the question is sent and how noisy the surroundings are. */
  const vozPadrao = { envio: "automatico", ambiente: "normal" } as const;
  const vozDe = async (userId: number) => {
    const [row] = await db.select().from(voicePreferencesTable).where(eq(voicePreferencesTable.userId, userId)).limit(1);
    return row ? { envio: row.sendMode, ambiente: row.environment } : { ...vozPadrao };
  };
  const quem = () => { const t = currentTenant(); if (!t?.userId) throw Object.assign(new Error("Sessão necessária."), { statusCode: 401 }); return t; };
  app.get("/voz/preferencias", async () => vozDe(quem().userId));
  const formaResposta = z.enum(["automatico", "tabela", "ranking", "serie", "texto"]);
  app.get("/respostas/preferencias", async () => {
    const [row] = await db.select({ forma: voicePreferencesTable.resultForm }).from(voicePreferencesTable).where(eq(voicePreferencesTable.userId, quem().userId)).limit(1);
    return { forma: formaResposta.catch("automatico").parse(row?.forma) };
  });
  app.put("/respostas/preferencias", async request => {
    const { userId, companyId } = quem();
    const { forma } = z.object({ forma: formaResposta }).strict().parse(request.body);
    await db.insert(voicePreferencesTable).values({ userId, companyId: companyId || null, resultForm: forma })
      .onConflictDoUpdate({ target: voicePreferencesTable.userId, set: { resultForm: forma, updatedAt: new Date() } });
    return { forma };
  });
  app.put("/voz/preferencias", async request => {
    const { userId, companyId } = quem();
    const body = z.object({ envio: z.enum(ENVIO_MODOS).optional(), ambiente: z.enum(AMBIENTE_NIVEIS).optional() }).strict().parse(request.body);
    const next = { ...(await vozDe(userId)), ...body };
    const values = { sendMode: next.envio, environment: next.ambiente, updatedAt: new Date() };
    await db.insert(voicePreferencesTable).values({ userId, companyId: companyId || null, ...values })
      .onConflictDoUpdate({ target: voicePreferencesTable.userId, set: values });
    return next;
  });
  app.get("/documents", async () =>
    (await db.select().from(exportDocumentsTable).where(eq(exportDocumentsTable.companyId, currentCompanyId())).orderBy(desc(exportDocumentsTable.id)).limit(100)).map(documentMetadata));
  app.post("/documents", async (request, reply) => {
    const input = CreateExportDocumentBody.parse(request.body);
    return reply.code(201).send(await createDocument(input.queryLogId));
  });
  app.get("/documents/:id/download", async (request, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const [document] = await db.select().from(exportDocumentsTable).where(and(eq(exportDocumentsTable.id, id), eq(exportDocumentsTable.companyId, currentCompanyId())));
    if (!document) return reply.code(404).send({ error: "Documento não encontrado." });
    const { log, metrics } = await findMetricLog(document.queryLogId);
    return reply.header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="consulta-${document.id}.csv"`)
      .header("Cache-Control", "no-store").send("\uFEFF" + metrics.map(metric => metricCsv(log.question, metric).replace(/^\uFEFF/, "")).join("\r\n\r\n"));
  });
}
