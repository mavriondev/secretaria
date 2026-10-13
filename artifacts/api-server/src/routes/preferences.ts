import type { FastifyInstance } from "fastify";
import { db, assistantSettingsTable, exportDocumentsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { CreateExportDocumentBody, UpdateAssistantSettingsBody } from "@workspace/api-zod";
import { z } from "zod";
import { currentCompanyId } from "../lib/tenant";
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
