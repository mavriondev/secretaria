import type { FastifyInstance } from "fastify";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { companiesTable, db, loadRunsTable } from "@workspace/db";
import { fontePostgres } from "../lib/carga";
import { closeStaleLoads, pacoteDoErp, SOURCE_KINDS, startLoad } from "../lib/carga-empresa";
import { encryptSecret } from "../lib/secrets";

const idParam = z.object({ id: z.coerce.number().int().positive() });
const oneLine = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0]!.replace(/postgres(ql)?:\/\/\S+/gi, "[conexão]");

/** Product owner: where each company's data comes from and the loads that fill its mirror. The source address is stored encrypted and never returned. */
export async function origemRoutes(app: FastifyInstance) {
  const company = async (id: number) => (await db.select().from(companiesTable).where(eq(companiesTable.id, id)))[0];
  app.get("/plataforma/empresas/:id/origem", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const c = await company(id);
    if (!c) return reply.code(404).send({ error: "Empresa não encontrada." });
    await closeStaleLoads(id);
    const runs = await db.select().from(loadRunsTable).where(eq(loadRunsTable.companyId, id)).orderBy(desc(loadRunsTable.id)).limit(10);
    const pacote = pacoteDoErp(c.erp);
    return {
      conectada: Boolean(c.sourceUrlEnc), tipo: c.sourceKind, tiposDisponiveis: SOURCE_KINDS, assuntos: c.subjects, intervaloMin: c.loadEveryMin,
      assuntosDisponiveis: pacote ? Object.fromEntries(Object.entries(pacote.assuntos).map(([nome, tabelas]) => [nome, tabelas])) : null,
      cargas: runs.map(r => ({ id: r.id, modo: r.mode, disparo: r.trigger, status: r.status, ok: r.ok, erro: r.error, relatorio: r.report, iniciadaEm: r.startedAt.toISOString(), concluidaEm: r.finishedAt?.toISOString() ?? null })),
    };
  });
  app.put("/plataforma/empresas/:id/origem", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ url: z.string().max(2000).optional(), tipo: z.enum(SOURCE_KINDS).optional(), assuntos: z.array(z.string().max(40)).max(20).optional(), intervaloMin: z.number().int().min(5).max(10080).nullable().optional() }).parse(request.body);
    const c = await company(id);
    if (!c) return reply.code(404).send({ error: "Empresa não encontrada." });
    if (id === 1) return reply.code(400).send({ error: "A empresa de demonstração não tem origem externa." });
    const pacote = pacoteDoErp(c.erp);
    if (body.assuntos?.length) {
      if (!pacote) return reply.code(400).send({ error: `Ainda não existe pacote de tabelas para o ERP "${c.erp}".` });
      const unknown = body.assuntos.filter(a => !pacote.assuntos[a]);
      if (unknown.length) return reply.code(400).send({ error: `Assunto desconhecido: ${unknown.join(", ")}.` });
    }
    const url = body.url?.trim();
    if (url) {
      if (!/^postgres(ql)?:\/\//i.test(url)) return reply.code(400).send({ error: "O endereço da origem precisa começar com postgresql://." });
      // The address is proven before it is kept: it must connect and answer.
      const probe = fontePostgres(url, 1);
      try { await probe.testar(); }
      catch (error) { return reply.code(422).send({ error: `Não foi possível conectar à origem: ${oneLine(error)}` }); }
      finally { await probe.fechar().catch(() => undefined); }
    }
    await db.update(companiesTable).set({
      ...(url ? { sourceUrlEnc: encryptSecret(url) } : {}), ...(body.tipo ? { sourceKind: body.tipo } : {}),
      ...(body.assuntos ? { subjects: body.assuntos } : {}), ...(body.intervaloMin === undefined ? {} : { loadEveryMin: body.intervaloMin }),
    }).where(eq(companiesTable.id, id));
    return { ok: true };
  });
  app.post("/plataforma/empresas/:id/carga", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { modo } = z.object({ modo: z.enum(["incremental", "completa"]).default("incremental") }).parse(request.body ?? {});
    const started = await startLoad(id, modo, "manual");
    return "error" in started ? reply.code(409).send(started) : reply.code(202).send(started);
  });
}
